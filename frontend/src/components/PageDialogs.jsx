import { useId, useImperativeHandle, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useDocuments } from '../hooks/useDocuments';
import { documentsAPI } from '../utils/api';
import {
	getDocumentFile,
	getDocumentPassword,
} from '../utils/documentFileCache';
import { filterAndSortDocuments } from '../utils/library';
import {
	pageRanges,
	partTitle,
	pdfFileName,
	splitBefore,
	splitByOutline,
	splitEvery,
} from '../utils/pages';
import { DOCUMENTS_QUERY_KEY, SEARCH_QUERY_KEY } from '../utils/queryClient';
import './PageDialogs.css';

// Documents au plus d'un découpage ; fichier inséré au plus (comme le
// moteur).
const MAX_PARTS = 200;
const MAX_INSERTED_BYTES = 100 * 1024 * 1024;

// 🔹 Dialogues du mode « Pages » (T5a), dans un seul <dialog> modal que la
// visionneuse ouvre par `ref` :
// - insertFromLibrary() : choisir un document de la bibliothèque, dont
//   toutes les pages sont insérées (pageTools.insertAt) ;
// - insertFile(file, at) : insérer les pages d'un fichier PDF ;
//   l'un et l'autre demandent le mot de passe d'un PDF protégé ;
// - extract() : les pages sélectionnées deviennent un nouveau document de
//   la bibliothèque (et peuvent être retirées de celui-ci) ;
// - split() : scinder le document en plusieurs nouveaux documents (toutes
//   les n pages, par le sommaire, avant les pages sélectionnées).
// Les nouveaux documents sont faits avec les modifications en cours.
function PageDialogs({ ref, pdf, document, pageTools }) {
	const dialogRef = useRef(null);
	const [view, setView] = useState(null);
	const [error, setError] = useState(null);
	const [isBusy, setIsBusy] = useState(false);
	const queryClient = useQueryClient();
	const titleId = useId();

	function open(next) {
		setView(next);
		setError(null);
		if (!dialogRef.current?.open) dialogRef.current?.showModal?.();
	}

	function close() {
		dialogRef.current?.close?.();
	}

	// Insère `data` ; un PDF protégé ouvre la saisie de son mot de passe.
	async function insert(data, { name, at, password }) {
		setIsBusy(true);
		try {
			const result = await pageTools.insertFile(data, { at, password });
			if (result) close();
			// L'erreur du moteur est affichée par la visionneuse.
			else close();
		} catch (insertError) {
			if (insertError.name !== 'PasswordRequiredError') throw insertError;
			open({
				kind: 'password',
				name,
				data,
				at,
				isWrong: Boolean(password),
			});
		} finally {
			setIsBusy(false);
		}
	}

	async function insertDocument(source) {
		setIsBusy(true);
		setError(null);
		try {
			const buffer = await getDocumentFile(source.id, source.currentRevision);
			await insert(new Uint8Array(buffer), {
				name: source.title,
				at: pageTools.insertAt,
				password:
					getDocumentPassword(source.id, source.currentRevision) ?? undefined,
			});
		} catch (insertError) {
			setError(insertError.message);
		} finally {
			setIsBusy(false);
		}
	}

	useImperativeHandle(ref, () => ({
		insertFromLibrary: () => open({ kind: 'library', query: '' }),
		insertFile: async (file, at = pageTools.insertAt) => {
			// Avant toute lecture : un fichier énorme déposé par erreur ne
			// sature pas la mémoire de l'onglet.
			if (file.size > MAX_INSERTED_BYTES) {
				open({
					kind: 'failure',
					message: 'Fichier trop lourd (100 Mo au plus)',
				});
				return;
			}
			try {
				const data = new Uint8Array(await file.arrayBuffer());
				await insert(data, { name: file.name, at });
			} catch (insertError) {
				open({ kind: 'failure', message: insertError.message });
			}
		},
		extract: () =>
			open({
				kind: 'extract',
				title: partTitle(document.title, pageTools.selected),
				removeAfter: false,
			}),
		split: () =>
			open({
				kind: 'split',
				method: pageTools.selected.length > 0 ? 'selection' : 'every',
				size: 1,
			}),
	}));

	// Fait un nouveau document de la bibliothèque de chaque groupe ({ pages,
	// title }), un par un ; renvoie le compte rendu.
	async function createDocuments(parts) {
		const results = [];
		for (const [position, { pages, title }] of parts.entries()) {
			setView((value) => ({ ...value, progress: position }));
			try {
				const data = await pdf.extractPages(pages, { title });
				const created = await documentsAPI.upload(
					new File([data], pdfFileName(title), { type: 'application/pdf' }),
				);
				results.push({ title, document: created });
			} catch (createError) {
				if (createError.status === 401) throw createError;
				results.push({
					title,
					error: createError.message,
					existingId: createError.data?.documentId ?? null,
				});
			}
		}
		queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
		queryClient.invalidateQueries({ queryKey: SEARCH_QUERY_KEY });
		return results;
	}

	async function handleExtract(event) {
		event.preventDefault();
		const pages = pageTools.selected;
		const title = String(new FormData(event.currentTarget).get('title'))
			.trim()
			.slice(0, 300);
		if (!title || pages.length === 0) return;
		setIsBusy(true);
		try {
			const results = await createDocuments([{ pages, title }]);
			if (view.removeAfter && results[0].document) await pageTools.remove();
			setView({ kind: 'results', results });
		} catch (extractError) {
			setError(extractError.message);
		} finally {
			setIsBusy(false);
		}
	}

	function splitParts() {
		if (!view || view.kind !== 'split') return [];
		const count = pdf.pageCount;
		let groups;
		if (view.method === 'every') groups = splitEvery(count, view.size);
		else if (view.method === 'outline')
			groups = splitByOutline(count, pdf.outline);
		else groups = splitBefore(count, pageTools.selected);
		return groups.map((group) => ({
			pages: group.pages,
			title: partTitle(document.title, group.pages, group.title),
		}));
	}

	async function handleSplit(event) {
		event.preventDefault();
		const parts = splitParts();
		if (parts.length < 2 || parts.length > MAX_PARTS) return;
		setIsBusy(true);
		try {
			setView({ kind: 'results', results: await createDocuments(parts) });
		} catch (splitError) {
			setError(splitError.message);
		} finally {
			setIsBusy(false);
		}
	}

	function handlePasswordSubmit(event) {
		event.preventDefault();
		const password = String(new FormData(event.currentTarget).get('password'));
		insert(view.data, { name: view.name, at: view.at, password });
	}

	function renderContent() {
		switch (view?.kind) {
			case 'library':
				return (
					<LibraryChooser
						currentId={document.id}
						query={view.query}
						onQueryChange={(query) => setView({ ...view, query })}
						onChoose={insertDocument}
						isBusy={isBusy}
					/>
				);
			case 'password':
				return (
					<form onSubmit={handlePasswordSubmit}>
						<p>
							« {view.name} » est protégé par un mot de passe : il faut le
							saisir pour en insérer les pages.
						</p>
						<label className="field">
							<span className="field__label">Mot de passe</span>
							<input
								className="field__input"
								type="password"
								name="password"
								autoComplete="off"
								required
								aria-invalid={view.isWrong || undefined}
								aria-describedby={view.isWrong ? `${titleId}-wrong` : undefined}
							/>
						</label>
						{!document.isEncrypted && (
							<p className="page-dialogs__note">
								Ses pages seront enregistrées dans ce document, qui n’est pas
								protégé par mot de passe.
							</p>
						)}
						{view.isWrong && (
							<p id={`${titleId}-wrong`} className="page-dialogs__error">
								Mot de passe incorrect.
							</p>
						)}
						<div className="page-dialogs__actions">
							<button
								type="button"
								className="button button--ghost"
								onClick={close}
							>
								Annuler
							</button>
							<button
								type="submit"
								className="button button--primary"
								disabled={isBusy}
							>
								Insérer les pages
							</button>
						</div>
					</form>
				);
			case 'extract': {
				const count = pageTools.selected.length;
				return (
					<form onSubmit={handleExtract}>
						<p>
							{count > 1
								? `Les pages ${pageRanges(pageTools.selected)}`
								: `La page ${pageRanges(pageTools.selected)}`}{' '}
							{count > 1 ? 'deviennent' : 'devient'} un nouveau document de la
							bibliothèque, avec les modifications en cours.
						</p>
						<label className="field">
							<span className="field__label">Titre du nouveau document</span>
							<input
								className="field__input"
								name="title"
								defaultValue={view.title}
								maxLength={300}
								required
							/>
						</label>
						<label className="page-dialogs__check">
							<input
								type="checkbox"
								checked={view.removeAfter}
								disabled={count >= pdf.pageCount}
								onChange={(event) =>
									setView({ ...view, removeAfter: event.target.checked })
								}
							/>
							Les retirer de ce document (à enregistrer ensuite)
						</label>
						{document.isEncrypted && (
							<p className="page-dialogs__note">
								Le nouveau document ne sera pas protégé par mot de passe.
							</p>
						)}
						<div className="page-dialogs__actions">
							<button
								type="button"
								className="button button--ghost"
								onClick={close}
							>
								Annuler
							</button>
							<button
								type="submit"
								className="button button--primary"
								disabled={isBusy}
							>
								{isBusy ? 'Création…' : 'Créer le document'}
							</button>
						</div>
					</form>
				);
			}
			case 'split': {
				const parts = splitParts();
				const hasOutline = pdf.outline.some((item) => item.page !== null);
				const canCut = pageTools.selected.some((index) => index > 0);
				return (
					<form onSubmit={handleSplit}>
						<fieldset className="page-dialogs__methods">
							<legend>Scinder ce document</legend>
							<label className="page-dialogs__check">
								<input
									type="radio"
									name="method"
									checked={view.method === 'every'}
									onChange={() => setView({ ...view, method: 'every' })}
								/>
								Toutes les
								<input
									className="field__input page-dialogs__size"
									type="number"
									min={1}
									max={pdf.pageCount}
									value={view.size}
									aria-label="Nombre de pages par document"
									onChange={(event) =>
										setView({
											...view,
											method: 'every',
											size: Math.min(
												Math.max(Number(event.target.value) || 1, 1),
												pdf.pageCount,
											),
										})
									}
								/>
								pages
							</label>
							<label className="page-dialogs__check">
								<input
									type="radio"
									name="method"
									checked={view.method === 'outline'}
									disabled={!hasOutline}
									onChange={() => setView({ ...view, method: 'outline' })}
								/>
								Par le sommaire (un document par chapitre)
							</label>
							<label className="page-dialogs__check">
								<input
									type="radio"
									name="method"
									checked={view.method === 'selection'}
									disabled={!canCut}
									onChange={() => setView({ ...view, method: 'selection' })}
								/>
								Avant chaque page sélectionnée
							</label>
						</fieldset>
						<p className="page-dialogs__note" aria-live="polite">
							{parts.length > MAX_PARTS
								? `${parts.length} documents : c’est trop (${MAX_PARTS} au plus).`
								: parts.length < 2
									? 'Un seul document : rien à scinder.'
									: `${parts.length} nouveaux documents : ${parts
											.slice(0, 6)
											.map((part) => `pages ${pageRanges(part.pages)}`)
											.join(' ; ')}${parts.length > 6 ? '…' : ''}`}
						</p>
						{document.isEncrypted && (
							<p className="page-dialogs__note">
								Les nouveaux documents ne seront pas protégés par mot de passe.
							</p>
						)}
						{view.progress !== undefined && isBusy && (
							<p className="page-dialogs__note">
								Création {view.progress + 1} / {parts.length}…
							</p>
						)}
						<div className="page-dialogs__actions">
							<button
								type="button"
								className="button button--ghost"
								onClick={close}
							>
								Annuler
							</button>
							<button
								type="submit"
								className="button button--primary"
								disabled={
									isBusy || parts.length < 2 || parts.length > MAX_PARTS
								}
							>
								Créer les documents
							</button>
						</div>
					</form>
				);
			}
			case 'results':
				return (
					<>
						<ul className="page-dialogs__results">
							{view.results.map((result) => (
								<li key={result.title}>
									{result.document ? (
										<>
											Créé :{' '}
											<Link to={`/documents/${result.document.id}`}>
												{result.document.title}
											</Link>
										</>
									) : (
										<>
											« {result.title} » : {result.error}
											{result.existingId && (
												<>
													{' '}
													(
													<Link to={`/documents/${result.existingId}`}>
														voir le document
													</Link>
													)
												</>
											)}
										</>
									)}
								</li>
							))}
						</ul>
						<div className="page-dialogs__actions">
							<button
								type="button"
								className="button button--primary"
								onClick={close}
							>
								Fermer
							</button>
						</div>
					</>
				);
			case 'failure':
				return (
					<>
						<p className="page-dialogs__error">{view.message}</p>
						<div className="page-dialogs__actions">
							<button
								type="button"
								className="button button--primary"
								onClick={close}
							>
								Fermer
							</button>
						</div>
					</>
				);
			default:
				return null;
		}
	}

	const titles = {
		library: 'Insérer les pages d’un document',
		password: 'PDF protégé',
		extract: 'Extraire des pages',
		split: 'Scinder le document',
		results: 'Nouveaux documents',
		failure: 'Pages non insérées',
	};
	return (
		<dialog
			ref={dialogRef}
			className="page-dialogs"
			aria-labelledby={titleId}
			onClose={() => setView(null)}
		>
			<h2 id={titleId} className="page-dialogs__title">
				{titles[view?.kind] ?? ''}
			</h2>
			{renderContent()}
			{error && (
				<p className="page-dialogs__error" role="alert">
					{error}
				</p>
			)}
		</dialog>
	);
}

// Choix d'un document de la bibliothèque (sauf celui-ci), avec un filtre.
function LibraryChooser({ currentId, query, onQueryChange, onChoose, isBusy }) {
	const documents = useDocuments();
	const list = filterAndSortDocuments(
		(documents.data ?? []).filter((item) => item.id !== currentId),
		{ query, sort: 'title' },
	).slice(0, 100);
	return (
		<>
			<label className="field">
				<span className="field__label">Filtrer</span>
				<input
					className="field__input"
					type="search"
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
				/>
			</label>
			{documents.isPending && <p>Chargement…</p>}
			<ul className="page-dialogs__documents">
				{list.map((item) => (
					<li key={item.id}>
						<button
							type="button"
							className="button button--ghost page-dialogs__document"
							onClick={() => onChoose(item)}
							disabled={isBusy}
						>
							<span>{item.title}</span>
							<span className="page-dialogs__meta">
								{item.pageCount} {item.pageCount > 1 ? 'pages' : 'page'}
								{item.isEncrypted && ' · protégé'}
							</span>
						</button>
					</li>
				))}
			</ul>
			{documents.isSuccess && list.length === 0 && <p>Aucun document.</p>}
		</>
	);
}

export default PageDialogs;

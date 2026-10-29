import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CollectionsDialog from '../components/CollectionsDialog';
import DocumentGrid from '../components/DocumentGrid';
import DocumentTable from '../components/DocumentTable';
import LibraryFilters from '../components/LibraryFilters';
import BatesDialog from '../components/BatesDialog';
import MergeDialog from '../components/MergeDialog';
import StatusMessage from '../components/StatusMessage';
import UploadReport from '../components/UploadReport';
import { useCollections } from '../hooks/useCollections';
import { useContentSearch } from '../hooks/useContentSearch';
import { useDocuments, useUploadDocuments } from '../hooks/useDocuments';
import { useFileDrop } from '../hooks/useFileDrop';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useStoredChoice } from '../hooks/useStoredChoice';
import {
	DEFAULT_SORT,
	DEFAULT_VIEW,
	SORT_OPTIONS,
	VIEW_OPTIONS,
	collectTags,
	countByCollection,
	filterAndSortDocuments,
	isValidSort,
	isValidView,
} from '../utils/library';
import './LibraryPage.css';

const NO_DOCUMENTS = [];

// 🔹 Page d'accueil : la bibliothèque. Import par le bouton ou en déposant
// des PDF n'importe où sur la page ; recherche (titre, auteur, sujet, nom de
// fichier, et contenu des PDF côté serveur), filtres par collection et
// étiquettes, tri et vue (grille ou liste) mémorisés sur l'appareil ;
// mode « Sélectionner » pour fusionner des documents (MergeDialog) ou
// numéroter leurs pages (BatesDialog).
// Recherche et filtres sont dans l'URL (?q=…&collection=…&tag=…) : ils
// sont retrouvés en revenant d'une fiche.
function LibraryPage() {
	const documents = useDocuments();
	const collections = useCollections();
	const { mutation: upload, progress } = useUploadDocuments();
	const isOnline = useOnlineStatus();
	const [searchParams, setSearchParams] = useSearchParams();
	const query = searchParams.get('q') ?? '';
	const { hits: contentHits, isSearching } = useContentSearch(query);
	const [sort, setSort] = useStoredChoice('editpdf-library-sort', {
		isValid: isValidSort,
		fallback: DEFAULT_SORT,
	});
	const [view, setView] = useStoredChoice('editpdf-library-view', {
		isValid: isValidView,
		fallback: DEFAULT_VIEW,
	});
	const fileInputRef = useRef(null);
	const collectionsDialogRef = useRef(null);
	const mergeDialogRef = useRef(null);
	const batesDialogRef = useRef(null);
	// Mode sélection (fusion, numérotation Bates) : ids dans l'ordre où ils
	// ont été cochés, null hors de ce mode.
	const [selectedIds, setSelectedIds] = useState(null);
	const filterId = useId();
	const sortId = useId();

	const allDocuments = documents.data ?? NO_DOCUMENTS;
	// Documents cochés, dans l'ordre où ils l'ont été.
	const selectedDocuments = (selectedIds ?? []).flatMap(
		(id) => allDocuments.find((document) => document.id === id) ?? [],
	);
	const collectionList = collections.data ?? NO_DOCUMENTS;
	const tags = useMemo(() => collectTags(allDocuments), [allDocuments]);
	const collectionCounts = useMemo(
		() => countByCollection(allDocuments),
		[allDocuments],
	);
	// Un filtre de l'URL qui ne désigne plus rien (collection supprimée,
	// étiquette retirée de tous les documents) est ignoré : sinon la
	// bibliothèque paraîtrait vide sans moyen de le retirer.
	const collectionParam = searchParams.get('collection') ?? '';
	const collectionId = collectionList.some(({ id }) => id === collectionParam)
		? collectionParam
		: '';
	const selectedTags = useMemo(
		() =>
			searchParams
				.getAll('tag')
				.filter((name) => tags.some((tag) => tag.name === name)),
		[searchParams, tags],
	);

	const canUpload = isOnline && !upload.isPending;
	const { mutate: uploadFiles } = upload;
	const handleDrop = useCallback((files) => uploadFiles(files), [uploadFiles]);
	const isDragging = useFileDrop({ onDrop: handleDrop, disabled: !canUpload });

	const visibleDocuments = useMemo(
		() =>
			filterAndSortDocuments(allDocuments, {
				query,
				sort,
				collectionId,
				tags: selectedTags,
				contentHits,
			}),
		[allDocuments, query, sort, collectionId, selectedTags, contentHits],
	);

	// replace : taper une recherche ne doit pas remplir l'historique.
	function updateSearchParams(update) {
		setSearchParams(
			(params) => {
				const next = new URLSearchParams(params);
				update(next);
				return next;
			},
			{ replace: true },
		);
	}

	function handleImportClick() {
		fileInputRef.current.click();
	}

	function handleFilesChange(event) {
		const files = Array.from(event.target.files);
		// Vidé tout de suite : choisir à nouveau le même fichier doit redéclencher l'import.
		event.target.value = '';
		if (files.length > 0) upload.mutate(files);
	}

	function handleQueryChange(event) {
		const { value } = event.target;
		updateSearchParams((params) => {
			if (value) params.set('q', value);
			else params.delete('q');
		});
	}

	function handleCollectionChange(id) {
		updateSearchParams((params) => {
			if (id) params.set('collection', id);
			else params.delete('collection');
		});
	}

	function handleTagToggle(name) {
		const next = selectedTags.includes(name)
			? selectedTags.filter((tag) => tag !== name)
			: [...selectedTags, name];
		updateSearchParams((params) => {
			params.delete('tag');
			for (const tag of next) params.append('tag', tag);
		});
	}

	function handleClearFilters() {
		updateSearchParams((params) => {
			params.delete('collection');
			params.delete('tag');
		});
	}

	function handleManageCollections() {
		collectionsDialogRef.current.showModal();
	}

	function handleToggleSelect(document) {
		setSelectedIds((ids) =>
			ids.includes(document.id)
				? ids.filter((id) => id !== document.id)
				: [...ids, document.id],
		);
	}

	function handleSortChange(event) {
		setSort(event.target.value);
	}

	function renderContent() {
		if (documents.isPending) {
			return <StatusMessage>Chargement de la bibliothèque…</StatusMessage>;
		}
		if (documents.isError) {
			return (
				<StatusMessage>
					Impossible de charger la bibliothèque : {documents.error.message}
				</StatusMessage>
			);
		}
		if (documents.data.length === 0) {
			return (
				<p className="library-page__empty">
					Votre bibliothèque est vide. Importez des PDF avec le bouton
					ci-dessus, ou déposez-les sur la page.
				</p>
			);
		}
		if (visibleDocuments.length === 0) {
			if (isSearching) {
				return <StatusMessage>Recherche dans le contenu…</StatusMessage>;
			}
			return (
				<p className="library-page__empty">
					{query.trim()
						? `Aucun document ne correspond à « ${query.trim()} »`
						: 'Aucun document ne correspond'}
					{(collectionId || selectedTags.length > 0) && ' avec ces filtres'}.
				</p>
			);
		}
		const selectionProps = {
			selectedIds,
			onToggleSelect: handleToggleSelect,
		};
		return view === 'list' ? (
			<DocumentTable
				documents={visibleDocuments}
				contentHits={contentHits}
				{...selectionProps}
			/>
		) : (
			<DocumentGrid
				documents={visibleDocuments}
				contentHits={contentHits}
				{...selectionProps}
			/>
		);
	}

	const hasDocuments = documents.data?.length > 0;

	return (
		<section className="library-page" aria-labelledby="library-page-title">
			<div className="library-page__header">
				<h1 id="library-page-title" className="library-page__title">
					Bibliothèque{' '}
					{hasDocuments && (
						<span className="library-page__count">
							({documents.data.length})
						</span>
					)}
				</h1>
				<button
					type="button"
					className="button button--primary"
					onClick={handleImportClick}
					disabled={!canUpload}
				>
					Importer des PDF
				</button>
				<input
					ref={fileInputRef}
					type="file"
					accept=".pdf,application/pdf"
					multiple
					hidden
					onChange={handleFilesChange}
				/>
			</div>

			<UploadReport upload={upload} progress={progress} />

			{hasDocuments && (
				<div className="library-page__toolbar">
					<search className="field library-page__filter">
						<label htmlFor={filterId} className="field__label">
							Rechercher
						</label>
						<input
							id={filterId}
							type="search"
							className="field__input"
							placeholder="Titre, auteur, contenu…"
							value={query}
							onChange={handleQueryChange}
						/>
					</search>
					<div className="field">
						<label htmlFor={sortId} className="field__label">
							Trier par
						</label>
						<select
							id={sortId}
							className="field__input"
							value={sort}
							onChange={handleSortChange}
						>
							{SORT_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</div>
					<div
						className="library-page__views"
						role="group"
						aria-label="Affichage"
					>
						{VIEW_OPTIONS.map((option) => (
							<button
								key={option.value}
								type="button"
								className="button"
								aria-pressed={view === option.value}
								onClick={() => setView(option.value)}
							>
								{option.label}
							</button>
						))}
					</div>
					<button
						type="button"
						className="button"
						aria-pressed={selectedIds !== null}
						onClick={() => setSelectedIds(selectedIds ? null : [])}
					>
						Sélectionner
					</button>
				</div>
			)}

			{hasDocuments && (
				<LibraryFilters
					collections={collectionList}
					collectionCounts={collectionCounts}
					documentCount={allDocuments.length}
					tags={tags}
					collectionId={collectionId}
					selectedTags={selectedTags}
					onCollectionChange={handleCollectionChange}
					onTagToggle={handleTagToggle}
					onClear={handleClearFilters}
					onManageCollections={handleManageCollections}
				/>
			)}

			{selectedIds && (
				<div
					className="library-page__selection"
					role="region"
					aria-label="Sélection"
				>
					<p className="library-page__selection-count" aria-live="polite">
						{selectedIds.length === 0
							? 'Cochez les documents à fusionner ou à numéroter'
							: `${selectedIds.length} ${selectedIds.length > 1 ? 'documents sélectionnés' : 'document sélectionné'}`}
					</p>
					<button
						type="button"
						className="button button--primary"
						onClick={() => mergeDialogRef.current?.showModal()}
						disabled={selectedIds.length < 2}
					>
						Fusionner…
					</button>
					<button
						type="button"
						className="button button--ghost"
						onClick={() => batesDialogRef.current?.showModal()}
						disabled={selectedIds.length < 1}
					>
						Numéroter (Bates)…
					</button>
					<button
						type="button"
						className="button button--ghost"
						onClick={() => setSelectedIds(null)}
					>
						Terminer la sélection
					</button>
				</div>
			)}

			{renderContent()}

			<MergeDialog
				ref={mergeDialogRef}
				documents={selectedDocuments}
				onMerged={() => setSelectedIds(null)}
			/>

			<BatesDialog
				ref={batesDialogRef}
				documents={selectedDocuments}
				onNumbered={() => setSelectedIds(null)}
			/>

			<CollectionsDialog
				ref={collectionsDialogRef}
				collections={collectionList}
				collectionCounts={collectionCounts}
			/>

			{isDragging && (
				<div className="library-page__drop-overlay" aria-hidden="true">
					Déposez vos PDF pour les importer
				</div>
			)}
		</section>
	);
}

export default LibraryPage;

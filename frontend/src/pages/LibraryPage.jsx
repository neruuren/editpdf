import { useCallback, useId, useMemo, useRef, useState } from 'react';
import DocumentGrid from '../components/DocumentGrid';
import DocumentTable from '../components/DocumentTable';
import StatusMessage from '../components/StatusMessage';
import UploadReport from '../components/UploadReport';
import { useDocuments, useUploadDocuments } from '../hooks/useDocuments';
import { useFileDrop } from '../hooks/useFileDrop';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useStoredChoice } from '../hooks/useStoredChoice';
import {
	DEFAULT_SORT,
	DEFAULT_VIEW,
	SORT_OPTIONS,
	VIEW_OPTIONS,
	filterAndSortDocuments,
	isValidSort,
	isValidView,
} from '../utils/library';
import './LibraryPage.css';

// 🔹 Page d'accueil : la bibliothèque. Import par le bouton ou en déposant
// des PDF n'importe où sur la page ; filtre rapide (titre, auteur, sujet,
// nom de fichier), tri et vue (grille ou liste) mémorisés sur l'appareil.
function LibraryPage() {
	const documents = useDocuments();
	const { mutation: upload, progress } = useUploadDocuments();
	const isOnline = useOnlineStatus();
	const [query, setQuery] = useState('');
	const [sort, setSort] = useStoredChoice('editpdf-library-sort', {
		isValid: isValidSort,
		fallback: DEFAULT_SORT,
	});
	const [view, setView] = useStoredChoice('editpdf-library-view', {
		isValid: isValidView,
		fallback: DEFAULT_VIEW,
	});
	const fileInputRef = useRef(null);
	const filterId = useId();
	const sortId = useId();

	const canUpload = isOnline && !upload.isPending;
	const { mutate: uploadFiles } = upload;
	const handleDrop = useCallback((files) => uploadFiles(files), [uploadFiles]);
	const isDragging = useFileDrop({ onDrop: handleDrop, disabled: !canUpload });

	const visibleDocuments = useMemo(
		() => filterAndSortDocuments(documents.data ?? [], { query, sort }),
		[documents.data, query, sort],
	);

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
		setQuery(event.target.value);
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
			return (
				<p className="library-page__empty">
					Aucun document ne correspond à « {query} ».
				</p>
			);
		}
		return view === 'list' ? (
			<DocumentTable documents={visibleDocuments} />
		) : (
			<DocumentGrid documents={visibleDocuments} />
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
							Filtrer
						</label>
						<input
							id={filterId}
							type="search"
							className="field__input"
							placeholder="Titre, auteur, sujet…"
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
				</div>
			)}

			{renderContent()}

			{isDragging && (
				<div className="library-page__drop-overlay" aria-hidden="true">
					Déposez vos PDF pour les importer
				</div>
			)}
		</section>
	);
}

export default LibraryPage;

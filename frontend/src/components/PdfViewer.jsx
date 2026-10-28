import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DocumentDetails from './DocumentDetails';
import PdfPages from './PdfPages';
import PdfPasswordForm from './PdfPasswordForm';
import PdfPresentation from './PdfPresentation';
import PrintDialog from './PrintDialog';
import StatusMessage from './StatusMessage';
import ViewerSearchBar from './ViewerSearchBar';
import ViewerSidebar from './ViewerSidebar';
import ViewerToolbar from './ViewerToolbar';
import {
	useBookmarks,
	useRemoveBookmark,
	useSetBookmark,
} from '../hooks/useBookmarks';
import { useDocumentSearch } from '../hooks/useDocumentSearch';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { useReadingPosition } from '../hooks/useReadingPosition';
import {
	POINTS_TO_PX,
	ROTATIONS,
	firstHitFrom,
	parseStoredZoom,
	stepZoom,
} from '../utils/viewer';
import { getStoredZoom, storeZoom } from '../utils/viewerZoomStore';
import './PdfViewer.css';

// Les champs de saisie gardent leurs touches (le formulaire du panneau
// d'informations, l'aller à la page…).
function isTypingTarget(target) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
	);
}

// Résultat actif tant que l'utilisateur n'en a pas choisi : le premier à
// partir de la page où la recherche a commencé, sinon (une fois toutes
// les pages cherchées) le premier du document.
function initialResult(search, startPage) {
	const position = search.results.findIndex(
		(result) => result.page >= startPage,
	);
	if (position !== -1) return position;
	return search.status === 'done' && search.results.length > 0
		? firstHitFrom(search.results, 0)
		: null;
}

// 🔹 Visionneuse d'un document : barre d'outils, barre de recherche,
// panneau de navigation (miniatures, sommaire, signets, résultats), pages
// en défilement continu avec leur calque de texte, panneau
// « Informations » (la fiche), présentation et impression. Reprend à la
// page enregistrée sur le serveur (et l'y enregistre en lisant), au zoom
// mémorisé par l'appareil. Un PDF protégé demande son mot de passe.
// Raccourcis : ← / → page précédente / suivante, Début / Fin, + / − / 0
// (largeur), aussi avec Ctrl (à la place du zoom du navigateur), Ctrl + F
// recherche, F3 / Maj + F3 résultat suivant / précédent, Ctrl + P
// impression, Échap ferme la recherche puis les panneaux.
function PdfViewer({ document }) {
	const pdfState = usePdfDocument(document);
	const pdf = pdfState.status === 'ready' ? pdfState.pdf : null;
	const saveReading = useReadingPosition(document.id);
	const bookmarks = useBookmarks(document.id).data ?? [];
	const setBookmark = useSetBookmark(document.id);
	const removeBookmark = useRemoveBookmark(document.id);
	const [zoom, setZoom] = useState(() =>
		parseStoredZoom(getStoredZoom(document.id)),
	);
	const [scale, setScale] = useState(POINTS_TO_PX);
	const [rotation, setRotation] = useState(0);
	const [page, setPage] = useState(() =>
		Math.max(0, (document.lastPage ?? 1) - 1),
	);
	const [isSidebarOpen, setIsSidebarOpen] = useState(false);
	const [sidebarTab, setSidebarTab] = useState(null);
	const [isInfoOpen, setIsInfoOpen] = useState(false);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [searchStartPage, setSearchStartPage] = useState(0);
	const [chosenResult, setChosenResult] = useState(null);
	const [isPresenting, setIsPresenting] = useState(false);
	const pagesRef = useRef(null);
	const searchInputRef = useRef(null);
	const printRef = useRef(null);
	const hasSavedRef = useRef(false);

	const pageCount = pdf?.pageCount ?? document.pageCount;
	const search = useDocumentSearch(pdf, isSearchOpen ? searchQuery : '');
	const activeResult = chosenResult ?? initialResult(search, searchStartPage);
	const active =
		activeResult === null ? null : (search.results[activeResult] ?? null);
	const isBookmarked = bookmarks.some((item) => item.page === page + 1);
	// Le sommaire d'abord quand le PDF en a un.
	const tab =
		sidebarTab ?? (pdf?.outline.length > 0 ? 'outline' : 'thumbnails');

	// Surlignages par page : tous les résultats, l'actif marqué.
	const highlights = useMemo(() => {
		const byPage = new Map();
		search.results.forEach((result, position) => {
			if (!byPage.has(result.page)) byPage.set(result.page, []);
			byPage
				.get(result.page)
				.push({ rects: result.rects, isActive: position === activeResult });
		});
		return byPage;
	}, [search.results, activeResult]);

	// Le résultat actif est amené à l'écran.
	useEffect(() => {
		if (active) pagesRef.current?.scrollToRect(active.page, active.rects[0]);
	}, [active]);

	// Ouverture (date de dernière ouverture) tout de suite, puis chaque
	// changement de page quelques secondes plus tard.
	useEffect(() => {
		if (!pdf) return;
		saveReading(page + 1, { immediate: !hasSavedRef.current });
		hasSavedRef.current = true;
	}, [pdf, page, saveReading]);

	useEffect(() => {
		if (pdf) storeZoom(document.id, zoom);
	}, [pdf, document.id, zoom]);

	const goToPage = useCallback(
		(index) => {
			if (!pdf) return;
			pagesRef.current?.scrollToPage(
				Math.min(Math.max(index, 0), pdf.pageCount - 1),
			);
		},
		[pdf],
	);

	const handleZoomStep = useCallback(
		(direction) => setZoom(stepZoom(scale, direction)),
		[scale],
	);

	function handleRotate() {
		setRotation((current) => ROTATIONS[(ROTATIONS.indexOf(current) + 1) % 4]);
	}

	// Sur un petit écran, le panneau recouvre les pages : on le referme
	// après un choix.
	function closeSidebarOnSmallScreen() {
		if (window.matchMedia?.('(width < 48rem)').matches) setIsSidebarOpen(false);
	}

	function handleSelectPage(index) {
		goToPage(index);
		closeSidebarOnSmallScreen();
	}

	const openSearch = useCallback(() => {
		setIsSearchOpen(true);
		// Déjà ouverte : le champ reprend le focus, texte sélectionné.
		searchInputRef.current?.focus();
		searchInputRef.current?.select();
	}, []);

	function closeSearch() {
		setIsSearchOpen(false);
		setChosenResult(null);
		if (sidebarTab === 'results') setSidebarTab(null);
	}

	function handleSearchQueryChange(query) {
		setSearchQuery(query);
		setSearchStartPage(page);
		setChosenResult(null);
	}

	const stepResult = useCallback(
		(direction) => {
			const count = search.results.length;
			if (count === 0) return;
			setChosenResult(
				activeResult === null
					? direction > 0
						? 0
						: count - 1
					: (activeResult + direction + count) % count,
			);
		},
		[search.results.length, activeResult],
	);

	function handleSelectResult(position) {
		setChosenResult(position);
		closeSidebarOnSmallScreen();
	}

	function handleToggleBookmark() {
		setBookmark.reset();
		removeBookmark.reset();
		if (isBookmarked) removeBookmark.mutate(page + 1);
		else setBookmark.mutate({ page: page + 1 });
	}

	function handleRenameBookmark(bookmarkPage, label) {
		removeBookmark.reset();
		setBookmark.mutate({ page: bookmarkPage, label });
	}

	function handleRemoveBookmark(bookmarkPage) {
		setBookmark.reset();
		removeBookmark.mutate(bookmarkPage);
	}

	const openPrint = useCallback(() => printRef.current?.showModal(), []);

	function handlePresentationClose(index) {
		setIsPresenting(false);
		goToPage(index);
	}

	useEffect(() => {
		function handleKeyDown(event) {
			// La présentation a ses propres touches.
			if (event.defaultPrevented || isPresenting) return;
			if (window.document.querySelector('dialog[open]')) return;
			const withModifier = event.ctrlKey || event.metaKey;
			if (event.altKey) return;
			// Pas encore de document (téléchargement, mot de passe) : seul
			// Échap sert, à fermer les informations.
			if (!pdf) {
				if (event.key === 'Escape' && !isTypingTarget(event.target)) {
					setIsInfoOpen(false);
				}
				return;
			}
			// Avant le test des champs : Ctrl + F depuis la recherche elle-même
			// resélectionne sa saisie.
			const key = event.key.toLowerCase();
			if (withModifier && key === 'f') {
				event.preventDefault();
				openSearch();
				return;
			}
			if (withModifier && key === 'p') {
				event.preventDefault();
				openPrint();
				return;
			}
			if (event.key === 'F3' && isSearchOpen) {
				event.preventDefault();
				stepResult(event.shiftKey ? -1 : 1);
				return;
			}
			if (isTypingTarget(event.target)) return;
			const zoomKeys = { '+': 1, '=': 1, '-': -1 };
			if (event.key in zoomKeys) {
				event.preventDefault();
				handleZoomStep(zoomKeys[event.key]);
				return;
			}
			if (event.key === '0') {
				event.preventDefault();
				setZoom('width');
				return;
			}
			if (withModifier) return;
			const pageKeys = {
				ArrowLeft: page - 1,
				ArrowRight: page + 1,
				Home: 0,
				End: pageCount - 1,
			};
			if (event.key in pageKeys) {
				event.preventDefault();
				goToPage(pageKeys[event.key]);
				return;
			}
			if (event.key === 'Escape') {
				if (isInfoOpen) setIsInfoOpen(false);
				else setIsSidebarOpen(false);
			}
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [
		pdf,
		page,
		pageCount,
		isInfoOpen,
		isSearchOpen,
		isPresenting,
		goToPage,
		handleZoomStep,
		openSearch,
		openPrint,
		stepResult,
	]);

	function renderPages() {
		switch (pdfState.status) {
			case 'downloading':
				return (
					<div className="pdf-viewer__status">
						<StatusMessage>Téléchargement du document…</StatusMessage>
						{pdfState.progress !== null && (
							<progress
								className="pdf-viewer__progress"
								value={pdfState.progress}
								aria-label="Téléchargement"
							/>
						)}
					</div>
				);
			case 'opening':
				return <StatusMessage>Ouverture du document…</StatusMessage>;
			case 'password':
				return (
					<PdfPasswordForm
						isWrongPassword={pdfState.isWrongPassword}
						onUnlock={pdfState.unlock}
					/>
				);
			case 'error':
				return (
					<p className="pdf-viewer__notice" role="alert">
						Impossible d’ouvrir ce PDF : {pdfState.error.message}
					</p>
				);
			default:
				return (
					<PdfPages
						ref={pagesRef}
						pdf={pdf}
						zoom={zoom}
						rotation={rotation}
						// Lu une fois par ouverture du PDF (et par révision).
						initialPage={page}
						onScaleChange={setScale}
						onPageChange={setPage}
						onZoomChange={setZoom}
						highlights={isSearchOpen ? highlights : undefined}
					/>
				);
		}
	}

	return (
		<div className="pdf-viewer">
			<ViewerToolbar
				document={document}
				pageCount={pageCount}
				currentPage={page}
				zoom={zoom}
				scale={scale}
				isReady={Boolean(pdf)}
				isSidebarOpen={isSidebarOpen}
				isInfoOpen={isInfoOpen}
				isSearchOpen={isSearchOpen}
				isBookmarked={isBookmarked}
				onGoToPage={goToPage}
				onZoomChange={setZoom}
				onZoomStep={handleZoomStep}
				onRotate={handleRotate}
				onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
				onToggleInfo={() => setIsInfoOpen(!isInfoOpen)}
				onToggleSearch={isSearchOpen ? closeSearch : openSearch}
				onToggleBookmark={handleToggleBookmark}
				onPresent={() => setIsPresenting(true)}
				onPrint={openPrint}
			/>
			{pdf && isSearchOpen && (
				<ViewerSearchBar
					inputRef={searchInputRef}
					query={searchQuery}
					search={search}
					activeResult={activeResult}
					onQueryChange={handleSearchQueryChange}
					onStep={stepResult}
					onClose={closeSearch}
				/>
			)}
			{(setBookmark.error || removeBookmark.error) && (
				<p className="pdf-viewer__error" role="alert">
					Signet non enregistré :{' '}
					{(setBookmark.error ?? removeBookmark.error).message}
				</p>
			)}
			<div className="pdf-viewer__body">
				{pdf && isSidebarOpen && (
					<div className="pdf-viewer__sidebar">
						<ViewerSidebar
							pdf={pdf}
							rotation={rotation}
							currentPage={page}
							tab={tab === 'results' && !isSearchOpen ? 'thumbnails' : tab}
							onTabChange={setSidebarTab}
							onSelectPage={handleSelectPage}
							bookmarks={bookmarks}
							onRenameBookmark={handleRenameBookmark}
							onRemoveBookmark={handleRemoveBookmark}
							search={isSearchOpen ? search : null}
							activeResult={activeResult}
							onSelectResult={handleSelectResult}
						/>
					</div>
				)}
				<div className="pdf-viewer__pages">{renderPages()}</div>
				{isInfoOpen && (
					<aside className="pdf-viewer__info" aria-label="Informations">
						<div className="pdf-viewer__info-header">
							<button
								type="button"
								className="button button--ghost"
								onClick={() => setIsInfoOpen(false)}
								aria-label="Fermer les informations"
							>
								<span aria-hidden="true">✕</span>
							</button>
						</div>
						<DocumentDetails document={document} />
					</aside>
				)}
			</div>
			{pdf && (
				<PrintDialog
					ref={printRef}
					pdf={pdf}
					currentPage={page}
					title={document.title}
				/>
			)}
			{pdf && isPresenting && (
				<PdfPresentation
					pdf={pdf}
					initialPage={page}
					rotation={rotation}
					onClose={handlePresentationClose}
				/>
			)}
		</div>
	);
}

export default PdfViewer;

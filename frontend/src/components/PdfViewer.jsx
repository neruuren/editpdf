import { useCallback, useEffect, useRef, useState } from 'react';
import DocumentDetails from './DocumentDetails';
import PdfPages from './PdfPages';
import StatusMessage from './StatusMessage';
import ViewerSidebar from './ViewerSidebar';
import ViewerToolbar from './ViewerToolbar';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { useReadingPosition } from '../hooks/useReadingPosition';
import {
	POINTS_TO_PX,
	ROTATIONS,
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

// 🔹 Visionneuse d'un document : barre d'outils, panneau de navigation
// (miniatures, sommaire), pages en défilement continu et panneau
// « Informations » (la fiche). Reprend à la page enregistrée sur le
// serveur (et l'y enregistre en lisant), au zoom mémorisé par l'appareil.
// Raccourcis : ← / → page précédente / suivante, Début / Fin, + / − / 0
// (largeur), aussi avec Ctrl (à la place du zoom du navigateur), Échap
// ferme les panneaux. Le panneau « Informations » est ouvert d'emblée pour
// un PDF protégé, que la visionneuse ne sait pas encore ouvrir.
function PdfViewer({ document }) {
	const pdfState = usePdfDocument(document);
	const pdf = pdfState.status === 'ready' ? pdfState.pdf : null;
	const saveReading = useReadingPosition(document.id);
	const [zoom, setZoom] = useState(() =>
		parseStoredZoom(getStoredZoom(document.id)),
	);
	const [scale, setScale] = useState(POINTS_TO_PX);
	const [rotation, setRotation] = useState(0);
	const [page, setPage] = useState(() =>
		Math.max(0, (document.lastPage ?? 1) - 1),
	);
	const [isSidebarOpen, setIsSidebarOpen] = useState(false);
	const [isInfoOpen, setIsInfoOpen] = useState(document.isEncrypted);
	const pagesRef = useRef(null);
	const hasSavedRef = useRef(false);

	const pageCount = pdf?.pageCount ?? document.pageCount;

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

	function handleSelectPage(index) {
		goToPage(index);
		// Sur un petit écran, le panneau recouvre les pages : on le referme.
		if (window.matchMedia?.('(width < 48rem)').matches) setIsSidebarOpen(false);
	}

	useEffect(() => {
		function handleKeyDown(event) {
			if (event.defaultPrevented || isTypingTarget(event.target)) return;
			if (window.document.querySelector('dialog[open]')) return;
			const withModifier = event.ctrlKey || event.metaKey;
			if (event.altKey) return;
			const zoomKeys = { '+': 1, '=': 1, '-': -1 };
			if (event.key in zoomKeys && pdf) {
				event.preventDefault();
				handleZoomStep(zoomKeys[event.key]);
				return;
			}
			if (event.key === '0' && pdf) {
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
			if (event.key in pageKeys && pdf) {
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
	}, [pdf, page, pageCount, isInfoOpen, goToPage, handleZoomStep]);

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
			case 'locked':
				return (
					<p className="pdf-viewer__notice">
						Ce PDF est protégé par un mot de passe. Son ouverture dans la
						visionneuse arrive bientôt ; en attendant, vous pouvez le
						télécharger.
					</p>
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
				onGoToPage={goToPage}
				onZoomChange={setZoom}
				onZoomStep={handleZoomStep}
				onRotate={handleRotate}
				onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
				onToggleInfo={() => setIsInfoOpen(!isInfoOpen)}
			/>
			<div className="pdf-viewer__body">
				{pdf && isSidebarOpen && (
					<div className="pdf-viewer__sidebar">
						<ViewerSidebar
							pdf={pdf}
							rotation={rotation}
							currentPage={page}
							onSelectPage={handleSelectPage}
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
		</div>
	);
}

export default PdfViewer;

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import AnnotationToolbar from './AnnotationToolbar';
import StampDialog from './StampDialog';
import ConfirmDialog from './ConfirmDialog';
import DocumentDetails from './DocumentDetails';
import NotePopover from './NotePopover';
import PageDialogs from './PageDialogs';
import PageToolbar from './PageToolbar';
import PdfPageGrid from './PdfPageGrid';
import PdfPages from './PdfPages';
import PdfPasswordForm from './PdfPasswordForm';
import PdfPresentation from './PdfPresentation';
import PrintDialog from './PrintDialog';
import SaveConflictDialog from './SaveConflictDialog';
import SelectionToolbar from './SelectionToolbar';
import StatusMessage from './StatusMessage';
import TextEditToolbar from './TextEditToolbar';
import ViewerSearchBar from './ViewerSearchBar';
import ViewerSidebar from './ViewerSidebar';
import ViewerToolbar from './ViewerToolbar';
import {
	isSaveConflict,
	useAnnotationEditor,
} from '../hooks/useAnnotationEditor';
import { useAnnotationList } from '../hooks/useAnnotationList';
import { useAnnotationTools } from '../hooks/useAnnotationTools';
import { useStamps } from '../hooks/useStamps';
import { useSession } from '../hooks/useAuth';
import {
	useBookmarks,
	useRemoveBookmark,
	useSetBookmark,
} from '../hooks/useBookmarks';
import { useDocumentSearch } from '../hooks/useDocumentSearch';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { useReadingPosition } from '../hooks/useReadingPosition';
import { usePageTools } from '../hooks/usePageTools';
import { useTextEditTools } from '../hooks/useTextEditTools';
import { useTextSelection } from '../hooks/useTextSelection';
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
// « Informations » (la fiche), présentation, impression et annotations
// (barre AnnotationToolbar, barre de la sélection de texte, bulles des
// notes ; enregistrées en nouvelle révision). Reprend à la page
// enregistrée sur le serveur (et l'y enregistre en lisant), au zoom
// mémorisé par l'appareil. Un PDF protégé demande son mot de passe. Tant
// que des annotations ne sont pas enregistrées, la révision ouverte reste
// affichée (même si une autre devient courante) et quitter la visionneuse
// demande confirmation.
// Raccourcis : ← / → page précédente / suivante, Début / Fin, + / − / 0
// (largeur), aussi avec Ctrl (à la place du zoom du navigateur), Ctrl + F
// recherche, F3 / Maj + F3 résultat suivant / précédent, Ctrl + P
// impression, Ctrl + S enregistrer, Ctrl + Z / Ctrl + Maj + Z (ou Ctrl + Y)
// annuler / rétablir, Suppr supprimer l'annotation sélectionnée, Échap
// la désélectionne, puis ferme la recherche et les panneaux.
function PdfViewer({ document }) {
	// Révision retenue tant que des annotations ne sont pas enregistrées.
	const [heldRevision, setHeldRevision] = useState(null);
	const pdfState = usePdfDocument(
		document.id,
		heldRevision ?? document.currentRevision,
	);
	const openedPdf = pdfState.status === 'ready' ? pdfState.pdf : null;
	const author = useSession().data?.annotationAuthor ?? '';
	const editor = useAnnotationEditor({
		document,
		pdf: openedPdf,
		revision: pdfState.revision,
		author,
	});
	// Pages réorganisées (T5a) : leur nouvelle disposition remplace celle du
	// PDF ouvert ; un nouvel objet, pour que tout ce qui en dépend se relise.
	const { layout } = editor;
	const pdf = useMemo(
		() => (openedPdf && layout ? { ...openedPdf, ...layout } : openedPdf),
		[openedPdf, layout],
	);
	const isEditLocked = editor.isLocked || Boolean(pdfState.isReloading);
	const tools = useAnnotationTools(editor, { isLocked: isEditLocked });
	// Mode « Modifier » (texte du contenu, T4a) : exclusif du mode annotation,
	// avec le même historique et le même enregistrement.
	const textTools = useTextEditTools(editor, { isLocked: isEditLocked });
	// Mode « Pages » (organisation des pages, T5a) : exclusif lui aussi.
	const pageTools = usePageTools(editor, {
		pageCount: pdf?.pageCount ?? 0,
		isLocked: isEditLocked,
	});
	const pageDialogsRef = useRef(null);
	const isStampTool = tools.isAnnotating && tools.tool === 'stamp';
	const stamps = useStamps({ isEnabled: isStampTool });
	const stampList = stamps.data ?? [];
	const stampImage = tools.stampChoice.startsWith('image:')
		? (stampList.find((stamp) => `image:${stamp.id}` === tools.stampChoice) ??
			null)
		: null;
	let stampLabel = tools.stampChoice.slice('text:'.length);
	if (tools.stampChoice === 'custom') stampLabel = tools.customStampText;
	else if (tools.stampChoice.startsWith('image:')) {
		stampLabel = stampImage?.name ?? 'Image';
	}
	const holdRevision = editor.isDirty ? pdfState.revision : null;
	if (holdRevision !== heldRevision) setHeldRevision(holdRevision);
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
	const pagesWrapperRef = useRef(null);
	const searchInputRef = useRef(null);
	const printRef = useRef(null);
	const conflictRef = useRef(null);
	const leaveRef = useRef(null);
	const stampDialogRef = useRef(null);
	const flattenRef = useRef(null);
	// Message passager de la visionneuse (rien à aplatir…).
	const [notice, setNotice] = useState(null);
	const hasSavedRef = useRef(false);
	const [shownPdf, setShownPdf] = useState(pdf);
	// Autre PDF (révision suivante) : sélection et bulles oubliées.
	if (shownPdf !== pdf) {
		setShownPdf(pdf);
		tools.reset();
	}

	const pageCount = pdf?.pageCount ?? document.pageCount;
	if (pdf && page > pdf.pageCount - 1) setPage(pdf.pageCount - 1);
	const search = useDocumentSearch(pdf, isSearchOpen ? searchQuery : '');
	const activeResult = chosenResult ?? initialResult(search, searchStartPage);
	const active =
		activeResult === null ? null : (search.results[activeResult] ?? null);
	const isBookmarked = bookmarks.some((item) => item.page === page + 1);
	// Le sommaire d'abord quand le PDF en a un.
	const tab =
		sidebarTab ?? (pdf?.outline.length > 0 ? 'outline' : 'thumbnails');
	const annotationList = useAnnotationList(pdf, {
		versions: editor.versions,
		allVersion: editor.allVersion,
		isEnabled: isSidebarOpen && tab === 'annotations',
	});
	const placesAnnotations =
		tools.isAnnotating && (tools.tool === 'note' || tools.tool === 'text');
	const [textSelection, clearTextSelection] = useTextSelection(
		pagesWrapperRef,
		{
			isEnabled:
				Boolean(pdf) &&
				!placesAnnotations &&
				!textTools.isEditingText &&
				!isPresenting,
			// Outil Surligner : la sélection faite à la souris est annotée
			// aussitôt, dans le style choisi.
			onPointerSelection: (selection) => {
				if (!tools.isAnnotating || tools.tool !== 'markup') return;
				clearTextSelection();
				tools.markup(tools.markupStyle, selection.ranges);
			},
		},
	);

	// Quitter la visionneuse (lien, retour du navigateur) avec des
	// annotations non enregistrées : confirmation.
	const blocker = useBlocker(
		({ currentLocation, nextLocation }) =>
			editor.isDirty && currentLocation.pathname !== nextLocation.pathname,
	);
	// Réponse donnée dans le dialogue (rester ou quitter).
	const hasAnsweredLeaveRef = useRef(false);
	useEffect(() => {
		if (blocker.state !== 'blocked') return undefined;
		hasAnsweredLeaveRef.current = false;
		const dialog = leaveRef.current;
		dialog?.showModal();
		// Retour du navigateur : React Router remet l'historique en place par
		// une seconde navigation, qui ferme le dialogue (constaté sous
		// Chromium) : il est rouvert tant qu'on n'y a pas répondu.
		let timer;
		function handleClose() {
			timer = setTimeout(() => {
				if (!hasAnsweredLeaveRef.current && !dialog.open) dialog.showModal();
			}, 0);
		}
		dialog?.addEventListener('close', handleClose);
		return () => {
			dialog?.removeEventListener('close', handleClose);
			clearTimeout(timer);
		};
	}, [blocker.state]);

	// Fermer l'onglet ou recharger : l'avertissement du navigateur.
	useEffect(() => {
		if (!editor.isDirty) return undefined;
		function handleBeforeUnload(event) {
			event.preventDefault();
		}
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	}, [editor.isDirty]);

	const { save } = editor;
	const saveAnnotations = useCallback(
		(options) => {
			if (!editor.isDirty || save.isPending) return;
			save.mutate(options, {
				onError: (error) => {
					if (isSaveConflict(error)) conflictRef.current?.showModal();
				},
			});
		},
		[editor.isDirty, save],
	);

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
			// Jamais la boîte « Enregistrer la page » du navigateur.
			if (withModifier && key === 's') {
				event.preventDefault();
				saveAnnotations();
				return;
			}
			if (event.key === 'F3' && isSearchOpen) {
				event.preventDefault();
				stepResult(event.shiftKey ? -1 : 1);
				return;
			}
			if (isTypingTarget(event.target)) return;
			if (withModifier && (key === 'z' || key === 'y')) {
				event.preventDefault();
				if (key === 'y' || event.shiftKey) tools.redo();
				else tools.undo();
				return;
			}
			if (
				(event.key === 'Delete' || event.key === 'Backspace') &&
				tools.isAnnotating &&
				tools.selected
			) {
				event.preventDefault();
				tools.removeSelected();
				return;
			}
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
				if (tools.selected) tools.select(null, null);
				else if (isInfoOpen) setIsInfoOpen(false);
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
		saveAnnotations,
		editor,
		tools,
	]);

	const annotating = {
		pageVersion: editor.pageVersion,
		isAnnotating: tools.isAnnotating,
		isLocked: isEditLocked,
		tool: tools.tool,
		shapeType: tools.shapeType,
		drawStyle: tools.drawStyle,
		shapeStyle: tools.shapeStyle,
		hasPen: tools.hasPen,
		selected: tools.selected,
		textEditor: tools.textEditor,
		onSelect: tools.select,
		onSelectedChange: tools.handleSelectedChange,
		onChange: editor.update,
		onPlace: (index, tool, point) =>
			tools.place(index, tool, point, stampImage),
		onPen: tools.notePen,
		onStroke: tools.drawStroke,
		onErase: tools.erase,
		onShape: tools.drawShape,
		onOpenNote: tools.openNote,
		onEditText: tools.editText,
		onCommitText: tools.commitText,
		onCancelText: tools.cancelText,
		textEditing: {
			isEditingText: textTools.isEditingText,
			tool: textTools.tool,
			session: textTools.session,
			onEdit: textTools.editText,
			onAdd: textTools.addTextAt,
			onExtendToBlock: textTools.extendToBlock,
			onCommit: textTools.commit,
			onCancel: textTools.cancel,
			imageSelection: textTools.imageSelection,
			onSelectImage: textTools.selectImage,
			onMoveImage: textTools.moveImage,
			onDeleteImage: textTools.deleteImage,
		},
	};

	function handleToggleAnnotate() {
		if (textTools.isEditingText) textTools.setIsEditingText(false);
		if (pageTools.isOrganizing) pageTools.setIsOrganizing(false);
		tools.toggleAnnotating();
	}

	function handleToggleEditText() {
		if (tools.isAnnotating) tools.toggleAnnotating();
		if (pageTools.isOrganizing) pageTools.setIsOrganizing(false);
		textTools.toggleEditing();
	}

	function handleToggleOrganize() {
		if (tools.isAnnotating) tools.toggleAnnotating();
		if (textTools.isEditingText) textTools.setIsEditingText(false);
		pageTools.toggleOrganizing();
	}

	// Une page de la grille ouverte (Entrée, double clic) : retour aux pages,
	// à celle-ci.
	function handleOpenPage(index) {
		setPage(index);
		pageTools.setIsOrganizing(false);
	}

	// Annuler / rétablir depuis la barre « Modifier » : la saisie en cours
	// est abandonnée d'abord.
	function handleTextHistory(direction) {
		textTools.cancel();
		textTools.selectImage(null, null);
		if (direction < 0) tools.undo();
		else tools.redo();
	}

	// Image ajoutée : au centre de la page affichée.
	function handleAddImage(file) {
		const { width, height } = pdf.pages[page];
		textTools.addImage(file, page, [width / 2, height / 2]);
	}

	// Une annotation choisie dans la liste : amenée à l'écran ; sélectionnée
	// en mode annotation, sinon son texte s'ouvre (s'il en a un).
	function handleSelectAnnotation(index, annotation) {
		pagesRef.current?.scrollToRect(index, annotation.rect);
		closeSidebarOnSmallScreen();
		if (tools.isAnnotating) tools.select(index, annotation);
		else if (annotation.type === 'Text' || annotation.contents.trim()) {
			tools.openNote(index, annotation);
		}
	}

	async function handleCopySelection() {
		const text = window.getSelection()?.toString() ?? '';
		try {
			await navigator.clipboard?.writeText(text);
		} catch {
			// Presse-papiers refusé : Ctrl + C reste possible.
		}
		clearTextSelection();
	}

	function handleSelectionMarkup(type) {
		const ranges = textSelection?.ranges ?? [];
		clearTextSelection();
		tools.markup(type, ranges);
	}

	// Aplatir : la barre d'annotation s'ouvre, pour enregistrer (ou annuler).
	async function handleFlattenConfirm() {
		textTools.setIsEditingText(false);
		pageTools.setIsOrganizing(false);
		tools.setIsAnnotating(true);
		const result = await editor.flatten();
		if (result?.count === 0) setNotice('Aucune annotation à aplatir.');
	}

	function handleSelectionUnmark() {
		const ranges = textSelection?.ranges ?? [];
		clearTextSelection();
		tools.unmark(ranges);
	}

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
				if (pageTools.isOrganizing) {
					return (
						<PdfPageGrid
							pdf={pdf}
							pageVersion={editor.pageVersion}
							selection={pageTools.selection}
							isLocked={isEditLocked}
							onSelect={pageTools.select}
							onSelectAll={pageTools.selectAll}
							onClearSelection={pageTools.clearSelection}
							onMove={pageTools.moveTo}
							onStep={pageTools.step}
							onDelete={pageTools.remove}
							onOpen={handleOpenPage}
							onDropFile={(file, at) =>
								pageDialogsRef.current?.insertFile(file, at)
							}
						/>
					);
				}
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
						annotating={annotating}
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
				isAnnotating={tools.isAnnotating}
				isEditingText={textTools.isEditingText}
				isOrganizing={pageTools.isOrganizing}
				hasUnsavedChanges={editor.isDirty}
				onGoToPage={goToPage}
				onZoomChange={setZoom}
				onZoomStep={handleZoomStep}
				onRotate={handleRotate}
				onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
				onToggleInfo={() => setIsInfoOpen(!isInfoOpen)}
				onToggleSearch={isSearchOpen ? closeSearch : openSearch}
				onToggleBookmark={handleToggleBookmark}
				onToggleAnnotate={handleToggleAnnotate}
				onToggleEditText={handleToggleEditText}
				onToggleOrganize={handleToggleOrganize}
				onPresent={() => setIsPresenting(true)}
				onPrint={openPrint}
				onFlatten={
					isEditLocked
						? undefined
						: () => {
								setNotice(null);
								flattenRef.current?.showModal();
							}
				}
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
			{pdf && tools.isAnnotating && (
				<AnnotationToolbar
					tool={tools.tool}
					onToolChange={tools.changeTool}
					markupStyle={tools.markupStyle}
					onMarkupStyleChange={tools.setMarkupStyle}
					shapeType={tools.shapeType}
					onShapeTypeChange={tools.setShapeType}
					color={tools.color}
					onColorChange={tools.changeColor}
					fontSize={tools.fontSize}
					onFontSizeChange={tools.changeFontSize}
					lineWidth={tools.lineWidth}
					onLineWidthChange={tools.changeLineWidth}
					opacity={tools.opacity}
					onOpacityChange={tools.changeOpacity}
					fill={tools.fill}
					onFillChange={tools.changeFill}
					stampLabel={stampLabel}
					isImageStamp={tools.stampChoice.startsWith('image:')}
					onChooseStamp={() => stampDialogRef.current?.showModal()}
					selected={tools.selected?.annotation ?? null}
					onComment={tools.commentSelected}
					onEditText={() =>
						tools.editText(tools.selected.page, tools.selected.annotation)
					}
					onDelete={tools.removeSelected}
					canUndo={editor.canUndo && !isEditLocked}
					canRedo={editor.canRedo && !isEditLocked}
					onUndo={tools.undo}
					onRedo={tools.redo}
					isDirty={editor.isDirty}
					isSaving={save.isPending || Boolean(pdfState.isReloading)}
					isLocked={isEditLocked}
					onSave={() => saveAnnotations()}
					onClose={tools.toggleAnnotating}
				/>
			)}
			{pdf && textTools.isEditingText && (
				<TextEditToolbar
					tool={textTools.tool}
					onToolChange={textTools.changeTool}
					style={textTools.style}
					session={textTools.session}
					onStyleChange={textTools.changeStyle}
					onExtendToBlock={textTools.extendToBlock}
					imageSelection={textTools.imageSelection}
					onAddImage={handleAddImage}
					onReplaceImage={textTools.replaceImage}
					onDeleteImage={textTools.deleteImage}
					canUndo={editor.canUndo && !isEditLocked}
					canRedo={editor.canRedo && !isEditLocked}
					onUndo={() => handleTextHistory(-1)}
					onRedo={() => handleTextHistory(1)}
					isDirty={editor.isDirty}
					isSaving={save.isPending || Boolean(pdfState.isReloading)}
					isLocked={isEditLocked}
					onSave={() => saveAnnotations()}
					onClose={handleToggleEditText}
				/>
			)}
			{pdf && pageTools.isOrganizing && (
				<PageToolbar
					selectedCount={pageTools.selected.length}
					pageCount={pdf.pageCount}
					canStepBack={pageTools.selected[0] > 0}
					canStepForward={pageTools.selected.at(-1) < pdf.pageCount - 1}
					onSelectAll={pageTools.selectAll}
					onRotate={pageTools.rotate}
					onStep={pageTools.step}
					onDuplicate={pageTools.duplicate}
					onDelete={pageTools.remove}
					onInsertBlank={pageTools.insertBlank}
					onInsertFromLibrary={() =>
						pageDialogsRef.current?.insertFromLibrary()
					}
					onInsertFile={(file) => pageDialogsRef.current?.insertFile(file)}
					onExtract={() => pageDialogsRef.current?.extract()}
					onSplit={() => pageDialogsRef.current?.split()}
					canUndo={editor.canUndo && !isEditLocked}
					canRedo={editor.canRedo && !isEditLocked}
					onUndo={tools.undo}
					onRedo={tools.redo}
					isDirty={editor.isDirty}
					isSaving={save.isPending || Boolean(pdfState.isReloading)}
					isLocked={isEditLocked}
					onSave={() => saveAnnotations()}
					onClose={handleToggleOrganize}
				/>
			)}
			{textTools.isEditingText && textTools.notice && (
				<p className="pdf-viewer__notice-bar" role="status">
					{textTools.notice}
				</p>
			)}
			{notice && (
				<p className="pdf-viewer__notice-bar" role="status">
					{notice}
				</p>
			)}
			{editor.error && (
				<p className="pdf-viewer__error" role="alert">
					{pageTools.isOrganizing
						? 'Pages non modifiées'
						: !textTools.isEditingText
							? 'Annotation non modifiée'
							: textTools.tool === 'image'
								? 'Image non modifiée'
								: 'Texte non modifié'}{' '}
					: {editor.error.message}
				</p>
			)}
			{save.error && !isSaveConflict(save.error) && (
				<p className="pdf-viewer__error" role="alert">
					Annotations non enregistrées : {save.error.message}
				</p>
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
							annotationList={annotationList}
							selectedAnnotation={tools.selected}
							onSelectAnnotation={handleSelectAnnotation}
							pageVersion={editor.pageVersion}
						/>
					</div>
				)}
				<div ref={pagesWrapperRef} className="pdf-viewer__pages">
					{renderPages()}
				</div>
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
				<PageDialogs
					ref={pageDialogsRef}
					pdf={pdf}
					document={document}
					pageTools={pageTools}
				/>
			)}
			{pdf && (
				<PrintDialog
					ref={printRef}
					pdf={pdf}
					currentPage={page}
					title={document.title}
				/>
			)}
			{pdf && textSelection && !isPresenting && (
				<SelectionToolbar
					selection={textSelection}
					color={tools.markupColor}
					onColorChange={tools.setMarkupColor}
					onMarkup={handleSelectionMarkup}
					onUnmark={handleSelectionUnmark}
					onCopy={handleCopySelection}
					isLocked={isEditLocked}
				/>
			)}
			{pdf && tools.note && (
				<NotePopover
					key={`${tools.note.page}:${tools.note.annotation.id}`}
					annotation={tools.note.annotation}
					getAnchor={tools.note.getAnchor}
					canEdit={tools.canEdit && !tools.note.annotation.isLocked}
					onClose={tools.closeNote}
				/>
			)}
			<StampDialog
				ref={stampDialogRef}
				choice={tools.stampChoice}
				customText={tools.customStampText}
				withDate={tools.stampWithDate}
				stamps={stampList}
				isLoading={stamps.isLoading}
				onChoose={tools.chooseStamp}
				onCustomTextChange={tools.setCustomStampText}
				onWithDateChange={tools.setStampWithDate}
			/>
			<ConfirmDialog
				ref={flattenRef}
				title="Aplatir les annotations ?"
				confirmLabel="Aplatir"
				onConfirm={handleFlattenConfirm}
			>
				<p>
					Toutes les annotations du document seront fondues dans les pages :
					elles s’afficheront et s’imprimeront à l’identique partout, mais ne se
					modifieront plus. Les liens et les champs de formulaire restent.
				</p>
				<p>
					Ce n’est pas un caviardage : un rectangle noir aplati ne retire pas le
					texte qu’il cache, qui reste aussi dans le fichier.
				</p>
				<p>
					Vous pourrez encore annuler avant d’enregistrer, et l’historique garde
					la version d’avant.
				</p>
			</ConfirmDialog>
			<SaveConflictDialog
				ref={conflictRef}
				onForce={() => saveAnnotations({ force: true })}
				onDiscard={editor.discard}
			/>
			<ConfirmDialog
				ref={leaveRef}
				title="Quitter sans enregistrer ?"
				confirmLabel="Quitter sans enregistrer"
				onConfirm={() => {
					hasAnsweredLeaveRef.current = true;
					blocker.proceed?.();
				}}
				onCancel={() => {
					hasAnsweredLeaveRef.current = true;
					blocker.reset?.();
				}}
			>
				<p>Vos annotations non enregistrées seront perdues.</p>
			</ConfirmDialog>
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

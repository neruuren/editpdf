import { useEffect, useRef, useState } from 'react';
import FreeTextEditor from './FreeTextEditor';
import PdfAnnotationLayer from './PdfAnnotationLayer';
import PdfTextLayer from './PdfTextLayer';
import { annotationAt, pagePointAt } from '../utils/annotations';
import './PdfPageView.css';

// Attente avant de rendre : pendant un défilement rapide ou un pincement,
// les pages qui ne font que passer ne sont jamais rendues.
const RENDER_DELAY_MS = 80;
// Au-delà, l'écran n'y gagne rien et la mémoire si.
const MAX_PIXEL_RATIO = 3;

const NO_ANNOTATIONS = [];

// 🔹 Une page de la visionneuse, montée par PdfPages seulement quand elle
// est proche de l'écran : un emplacement à sa taille et son rendu par le
// moteur PDF sur un <canvas> à la résolution de l'écran. Pendant un
// changement de zoom, l'ancien rendu reste affiché, étiré, jusqu'au nouveau.
// Par-dessus, le calque de texte (sélection, surlignage des `highlights` de
// la recherche) puis celui des annotations, sauf `withTextLayer={false}`
// (présentation). `annotating` (PdfViewer) : version de la page (elle est
// redessinée à chaque modification), mode et outil d'annotation,
// annotation sélectionnée, éditeur de texte libre et leurs actions.
function PdfPageView({
	pdf,
	index,
	pageCount,
	scale,
	rotation,
	style,
	highlights,
	withTextLayer = true,
	annotating,
}) {
	const canvasRef = useRef(null);
	const elementRef = useRef(null);
	const [status, setStatus] = useState('empty');
	const [annotations, setAnnotations] = useState(NO_ANNOTATIONS);
	const version = annotating?.pageVersion(index) ?? '';
	const page = pdf.pages[index];

	useEffect(() => {
		const controller = new AbortController();
		const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
		const timer = setTimeout(async () => {
			try {
				const { bitmap, width, height } = await pdf.renderPage(index, {
					scale: scale * pixelRatio,
					rotation,
					signal: controller.signal,
				});
				const canvas = canvasRef.current;
				if (controller.signal.aborted || !canvas) {
					bitmap.close();
					return;
				}
				canvas.width = width;
				canvas.height = height;
				canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
				bitmap.close();
				setStatus('rendered');
			} catch (error) {
				if (error.name !== 'AbortError') setStatus('error');
			}
		}, RENDER_DELAY_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
		// `version` : une annotation de la page a changé.
	}, [pdf, index, scale, rotation, version]);

	const isReady = status === 'rendered';
	const withAnnotations = withTextLayer && Boolean(annotating);

	useEffect(() => {
		if (!withAnnotations || !isReady) return undefined;
		const controller = new AbortController();
		pdf
			.getAnnotations(index, { signal: controller.signal })
			.then(setAnnotations)
			.catch(() => {});
		return () => controller.abort();
	}, [pdf, index, isReady, version, withAnnotations]);

	// L'annotation sélectionnée suit ses modifications (couleur, texte…) ;
	// supprimée ou annulée, elle n'est plus sélectionnée. Celle qui vient
	// d'être posée (annotation encore null) attend que la page soit relue.
	const selected =
		annotating?.selected?.page === index ? annotating.selected : null;
	const onSelectedChange = annotating?.onSelectedChange;
	useEffect(() => {
		if (!selected || annotations === NO_ANNOTATIONS) return;
		const item =
			annotations.find((annotation) => annotation.id === selected.id) ?? null;
		if (!item && !selected.annotation) return;
		if (item !== selected.annotation) onSelectedChange(index, item);
	}, [annotations, selected, index, onSelectedChange]);

	// Clic sur la page en mode annotation : poser une note ou un texte libre
	// (selon l'outil), sinon sélectionner l'annotation touchée.
	function handleClick(event) {
		if (!annotating?.isAnnotating || !withTextLayer) return;
		const point = pagePointAt(event, elementRef.current, page, scale, rotation);
		const { tool } = annotating;
		if (tool === 'note' || tool === 'text') {
			annotating.onPlace(index, tool, point);
			return;
		}
		if (tool !== 'select') return;
		// Fin d'une sélection de texte : ce n'est pas un clic.
		if (!window.getSelection?.()?.isCollapsed) return;
		annotating.onSelect(index, annotationAt(annotations, point));
	}

	const textEditor =
		annotating?.textEditor?.page === index ? annotating.textEditor : null;

	return (
		// Le clic sur la page n'est qu'un raccourci de la souris ou du doigt :
		// au clavier, les annotations se choisissent dans la liste du panneau.
		<div
			ref={elementRef}
			className="pdf-page-view"
			style={style}
			role="group"
			aria-label={`Page ${index + 1} sur ${pageCount}`}
			data-status={status}
			data-page-index={index}
			onClick={handleClick}
		>
			<canvas
				ref={canvasRef}
				className="pdf-page-view__canvas"
				aria-hidden="true"
			/>
			{withTextLayer && (
				<PdfTextLayer
					pdf={pdf}
					index={index}
					page={page}
					scale={scale}
					rotation={rotation}
					isReady={isReady}
					highlights={highlights}
				/>
			)}
			{withAnnotations && (
				<PdfAnnotationLayer
					page={page}
					scale={scale}
					rotation={rotation}
					annotations={annotations}
					isAnnotating={annotating.isAnnotating}
					canSelect={annotating.tool === 'select' && !annotating.isLocked}
					selectedId={selected?.id ?? null}
					onSelect={(annotation) => annotating.onSelect(index, annotation)}
					onChange={(id, changes) => annotating.onChange(index, id, changes)}
					onOpenNote={(annotation, anchor) =>
						annotating.onOpenNote(index, annotation, anchor)
					}
					onEditText={(annotation) => annotating.onEditText(index, annotation)}
				>
					{textEditor && (
						<FreeTextEditor
							editor={textEditor}
							scale={scale}
							onCommit={annotating.onCommitText}
							onCancel={annotating.onCancelText}
						/>
					)}
				</PdfAnnotationLayer>
			)}
			{status !== 'rendered' && (
				<span className="pdf-page-view__placeholder" aria-hidden="true">
					{status === 'error' ? 'Page illisible' : index + 1}
				</span>
			)}
		</div>
	);
}

export default PdfPageView;

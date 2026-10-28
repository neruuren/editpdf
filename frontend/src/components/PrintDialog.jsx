import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './PrintDialog.css';

// 200 points par pouce : net à l'impression, une page A4 en ~4 Mpx.
const PRINT_DPI = 200;
// En dessous, le texte devient flou : on refuse plutôt.
const MIN_PRINT_DPI = 100;
// Pixels au plus d'une page imprimée (même borne que le worker,
// pdfRenderer MAX_PRINT_PIXELS) et de toute l'impression : chaque page
// reste en mémoire jusqu'à la fin, et le navigateur décode les images pour
// imprimer (4 octets par pixel). 600 Mpx = ~150 pages A4 à 200 dpi.
const MAX_PIXELS_PER_PAGE = 4.2 * 1024 * 1024;
const MAX_PRINT_PIXELS = 600 * 1024 * 1024;
export const MAX_PRINT_PAGES = 300;

// Échelle de rendu (px par point) des pages choisies : 200 dpi, baissée
// jusqu'à 100 dpi pour tenir dans MAX_PRINT_PIXELS ; null au-delà.
function printScale(pdf, pages) {
	const scale = PRINT_DPI / 72;
	const total = pages.reduce((sum, index) => {
		const { width, height } = pdf.pages[index];
		return sum + Math.min(MAX_PIXELS_PER_PAGE, width * height * scale ** 2);
	}, 0);
	const fitted = scale * Math.min(1, Math.sqrt(MAX_PRINT_PIXELS / total));
	return fitted >= MIN_PRINT_DPI / 72 ? fitted : null;
}

// Pages (index 0) à imprimer d'après le formulaire, ou un message d'erreur.
function selectedPages(form, pageCount, currentPage) {
	const range = form.get('range');
	if (range === 'current') return { pages: [currentPage] };
	const from = range === 'all' ? 1 : Number(form.get('from'));
	const to = range === 'all' ? pageCount : Number(form.get('to'));
	if (
		!Number.isInteger(from) ||
		!Number.isInteger(to) ||
		from < 1 ||
		to > pageCount ||
		from > to
	) {
		return { error: `Choisissez des pages entre 1 et ${pageCount}.` };
	}
	if (to - from + 1 > MAX_PRINT_PAGES) {
		return {
			error: `${MAX_PRINT_PAGES} pages au plus par impression : choisissez une partie du document.`,
		};
	}
	return {
		pages: Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i),
	};
}

// 🔹 Impression dans un <dialog> modal : toutes les pages, la page
// affichée ou un intervalle. Les pages sont rendues par le moteur PDF en
// JPEG à 200 dpi, posées dans un conteneur qui seul s'imprime (voir
// PrintDialog.css), puis la boîte d'impression du navigateur s'ouvre ;
// tout est libéré ensuite. Le parent l'ouvre via `ref.current.showModal()`.
function PrintDialog({ ref, pdf, currentPage, title }) {
	const titleId = useId();
	const fromId = useId();
	const toId = useId();
	const [status, setStatus] = useState({ step: 'idle' });
	const [images, setImages] = useState(null);
	const controllerRef = useRef(null);

	// Annule une préparation en cours si la visionneuse se ferme.
	useEffect(() => () => controllerRef.current?.abort(), []);

	// Images en place : on attend qu'elles soient décodées, on imprime, puis
	// on libère tout. `afterprint` plutôt que le retour de window.print() :
	// sur mobile, il rend la main avant que la feuille d'impression ait lu
	// les pages.
	useEffect(() => {
		if (!images) return undefined;
		let cancelled = false;
		const { body } = window.document;
		const previousTitle = window.document.title;
		function handleAfterPrint() {
			setImages(null);
			setStatus({ step: 'idle' });
		}
		// Chargées, pas décodées d'un coup : le navigateur décode au fil de
		// l'impression.
		const nodes = [...window.document.querySelectorAll('.print-pages img')];
		Promise.all(
			nodes.map(
				(node) =>
					node.complete ||
					new Promise((resolve) => {
						node.addEventListener('load', resolve, { once: true });
						node.addEventListener('error', resolve, { once: true });
					}),
			),
		).then(() => {
			if (cancelled) return;
			ref.current?.close();
			// Nom proposé par « Enregistrer au format PDF ».
			window.document.title = title;
			body.classList.add('is-printing-pages');
			window.addEventListener('afterprint', handleAfterPrint, { once: true });
			window.print();
		});
		return () => {
			cancelled = true;
			window.removeEventListener('afterprint', handleAfterPrint);
			body.classList.remove('is-printing-pages');
			window.document.title = previousTitle;
			for (const image of images) URL.revokeObjectURL(image.url);
		};
	}, [images, ref, title]);

	async function handleSubmit(event) {
		event.preventDefault();
		const { pages, error } = selectedPages(
			new FormData(event.currentTarget),
			pdf.pageCount,
			currentPage,
		);
		if (error) {
			setStatus({ step: 'idle', error });
			return;
		}
		const scale = printScale(pdf, pages);
		if (scale === null) {
			setStatus({
				step: 'idle',
				error:
					'Ces pages sont trop grandes pour être imprimées en une fois : choisissez-en moins.',
			});
			return;
		}
		const controller = new AbortController();
		controllerRef.current = controller;
		const prepared = [];
		try {
			for (const [position, index] of pages.entries()) {
				setStatus({ step: 'preparing', done: position, total: pages.length });
				const jpeg = await pdf.renderPageJpeg(index, {
					scale,
					signal: controller.signal,
				});
				prepared.push({
					index,
					url: URL.createObjectURL(new Blob([jpeg], { type: 'image/jpeg' })),
				});
			}
			setStatus({ step: 'printing' });
			setImages(prepared);
		} catch (renderError) {
			for (const image of prepared) URL.revokeObjectURL(image.url);
			setStatus(
				renderError.name === 'AbortError'
					? { step: 'idle' }
					: { step: 'idle', error: 'Impossible de préparer l’impression.' },
			);
		} finally {
			controllerRef.current = null;
		}
	}

	function handleCancel() {
		controllerRef.current?.abort();
		ref.current.close();
	}

	const isBusy = status.step !== 'idle';

	return (
		<>
			<dialog
				ref={ref}
				className="print-dialog"
				aria-labelledby={titleId}
				// Échap pendant la préparation l'annule aussi.
				onClose={() => controllerRef.current?.abort()}
			>
				<h2 id={titleId} className="print-dialog__title">
					Imprimer
				</h2>
				<form className="print-dialog__form" onSubmit={handleSubmit}>
					<fieldset className="print-dialog__choices" disabled={isBusy}>
						<legend className="visually-hidden">Pages à imprimer</legend>
						<label className="print-dialog__choice">
							<input type="radio" name="range" value="all" defaultChecked />
							Tout le document ({pdf.pageCount} page
							{pdf.pageCount > 1 ? 's' : ''})
						</label>
						<label className="print-dialog__choice">
							<input type="radio" name="range" value="current" />
							Page affichée ({currentPage + 1})
						</label>
						<div className="print-dialog__choice">
							<label className="print-dialog__choice">
								<input type="radio" name="range" value="custom" />
								Pages
							</label>
							<label htmlFor={fromId} className="visually-hidden">
								Première page
							</label>
							<input
								id={fromId}
								name="from"
								className="field__input print-dialog__page"
								inputMode="numeric"
								pattern="[0-9]*"
								defaultValue={1}
							/>
							<span aria-hidden="true">à</span>
							<label htmlFor={toId} className="visually-hidden">
								Dernière page
							</label>
							<input
								id={toId}
								name="to"
								className="field__input print-dialog__page"
								inputMode="numeric"
								pattern="[0-9]*"
								defaultValue={pdf.pageCount}
							/>
						</div>
					</fieldset>
					<p className="print-dialog__hint">
						Les pages sont imprimées en images à 200 dpi (moins pour un long
						extrait), {MAX_PRINT_PAGES} au plus à la fois.
					</p>
					{status.error && (
						<p className="print-dialog__error" role="alert">
							{status.error}
						</p>
					)}
					{status.step === 'preparing' && (
						<div className="print-dialog__progress">
							<progress
								value={status.done}
								max={status.total}
								aria-label="Préparation de l’impression"
							/>
							<span>
								Préparation… {status.done} / {status.total}
							</span>
						</div>
					)}
					<div className="print-dialog__actions">
						<button type="button" className="button" onClick={handleCancel}>
							Annuler
						</button>
						<button
							type="submit"
							className="button button--primary"
							disabled={isBusy}
						>
							Imprimer
						</button>
					</div>
				</form>
			</dialog>
			{images &&
				createPortal(
					<div className="print-pages">
						{images.map((image) => (
							<img
								key={image.index}
								className="print-pages__page"
								src={image.url}
								alt={`Page ${image.index + 1}`}
							/>
						))}
					</div>,
					window.document.body,
				)}
		</>
	);
}

export default PrintDialog;

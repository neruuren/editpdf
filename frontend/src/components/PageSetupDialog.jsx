import { useId, useImperativeHandle, useRef, useState } from 'react';
import { usePageCanvas } from '../hooks/usePageCanvas';
import {
	DEFAULT_HEADERS,
	DEFAULT_WATERMARK,
	HEADER_SLOTS,
	HEADER_TOKENS,
	PAGE_SIZES,
	draggedRect,
	headerText,
	marginsOf,
	readSettings,
	rectOf,
	toMillimeters,
	toPoints,
	todayLabel,
	writeSettings,
} from '../utils/pageSetup';
import { pageRanges } from '../utils/pages';
import './PageSetupDialog.css';

const HEADERS_KEY = 'editpdf-page-headers';
const WATERMARK_KEY = 'editpdf-page-watermark';
const TITLES = {
	crop: 'Recadrer les pages',
	size: 'Changer la taille des pages',
	headers: 'En-têtes, pieds de page et numéros',
	watermark: 'Filigrane',
};
// Largeur de l'aperçu, en pixels CSS.
const PREVIEW_SIZE = 240;
const SIDES = [
	{ id: 'top', label: 'Haut' },
	{ id: 'bottom', label: 'Bas' },
	{ id: 'left', label: 'Gauche' },
	{ id: 'right', label: 'Droite' },
];
const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const range = (count) => Array.from({ length: count }, (_, index) => index);

// Nombre d'un champ, ou `fallback` s'il est vide ou illisible.
function numberOf(value, fallback) {
	const number = Number.parseFloat(String(value).replace(',', '.'));
	return Number.isFinite(number) ? number : fallback;
}

// Largeur d'un texte en Helvetica à 1 point (aperçu du filigrane) ; sans
// canvas pour la mesurer, une estimation.
let measureContext = null;
function textWidth(text) {
	try {
		measureContext ??= document.createElement('canvas').getContext('2d');
		measureContext.font = '100px Helvetica, Arial, sans-serif';
		const { width } = measureContext.measureText(text);
		if (Number.isFinite(width) && width > 0) return width / 100;
	} catch {
		// Pas de canvas (environnement de test, navigateur bridé).
	}
	return text.length * 0.55;
}

// 🔹 Aperçu de la page `index` : la miniature, et par-dessus `children`
// (positionnés en pourcentage de la page). `pageSize` : { width, height }
// en points.
function PagePreview({ pdf, index, version, pageSize, children }) {
	const scale = PREVIEW_SIZE / Math.max(pageSize.width, pageSize.height);
	const canvasRef = usePageCanvas(pdf, index, { scale, version });
	return (
		<div
			className="page-setup__preview"
			style={{
				inlineSize: `${pageSize.width * scale}px`,
				blockSize: `${pageSize.height * scale}px`,
				'--preview-scale': scale,
			}}
		>
			<canvas
				ref={canvasRef}
				className="page-setup__canvas"
				aria-hidden="true"
			/>
			{children}
		</div>
	);
}

// 🔹 Dialogues de mise en page du mode « Pages » (T5b), dans un seul
// <dialog> modal que la visionneuse ouvre par `ref.current.open(kind)` :
// - 'crop' : recadrer (cadre à étirer sur l'aperçu, marges en mm, ou
//   marges blanches de chaque page), ou remettre les pages entières ;
// - 'size' : changer la taille (contenu mis à l'échelle et centré) ;
// - 'headers' : en-têtes et pieds de page, numéros de page, numérotation
//   Bates ;
// - 'watermark' : filigrane.
// Le tout s'applique aux pages sélectionnées ou à toutes, avec `editor`
// (useAnnotationEditor). Réglages des en-têtes et du filigrane gardés sur
// l'appareil (localStorage `editpdf-page-headers`, `-watermark`).
function PageSetupDialog({ ref, pdf, document, pageTools, editor }) {
	const dialogRef = useRef(null);
	const dragRef = useRef(null);
	const lastSlotRef = useRef('bottomRight');
	const [view, setView] = useState(null);
	const [layers, setLayers] = useState({ headers: 0, watermarks: 0 });
	const [isBusy, setIsBusy] = useState(false);
	const titleId = useId();

	const pages =
		view?.scope === 'selection' && pageTools.selected.length > 0
			? pageTools.selected
			: range(pdf.pageCount);
	const reference = pages[0] ?? 0;
	const pageSize = pdf.pages[reference] ?? { width: 595, height: 842 };

	useImperativeHandle(ref, () => ({
		open: (kind) => {
			const scope = pageTools.selected.length > 0 ? 'selection' : 'all';
			const first = scope === 'selection' ? pageTools.selected[0] : 0;
			const size = pdf.pages[first] ?? { width: 595, height: 842 };
			const base = { kind, scope };
			if (kind === 'crop') {
				setView({
					...base,
					mode: 'manual',
					rect: [0, 0, size.width, size.height],
					padding: 3,
					contentBox: null,
				});
			} else if (kind === 'size') {
				setView({
					...base,
					size: 'a4',
					width: 210,
					height: 297,
					orientation: 'auto',
				});
			} else if (kind === 'headers') {
				setView({ ...base, spec: readSettings(HEADERS_KEY, DEFAULT_HEADERS) });
			} else {
				setView({
					...base,
					spec: readSettings(WATERMARK_KEY, DEFAULT_WATERMARK),
				});
			}
			if (kind === 'headers' || kind === 'watermark') {
				pdf
					.getPageLayers()
					.then(setLayers)
					.catch(() => setLayers({ headers: 0, watermarks: 0 }));
			}
			if (!dialogRef.current?.open) dialogRef.current?.showModal?.();
		},
	}));

	function close() {
		dialogRef.current?.close?.();
	}

	// Applique `action` (une action de l'éditeur) puis ferme : une erreur
	// est affichée par la visionneuse.
	async function apply(action) {
		setIsBusy(true);
		try {
			await action();
			close();
		} finally {
			setIsBusy(false);
		}
	}

	function update(changes) {
		setView((value) => ({ ...value, ...changes }));
	}

	function updateSpec(changes) {
		setView((value) => ({ ...value, spec: { ...value.spec, ...changes } }));
	}

	// Le cadre suit la page de référence : il est remis à zéro quand elle
	// change (autre portée).
	function changeScope(scope) {
		const first =
			scope === 'selection' && pageTools.selected.length > 0
				? pageTools.selected[0]
				: 0;
		const size = pdf.pages[first] ?? pageSize;
		setView((value) => ({
			...value,
			scope,
			...(value.kind === 'crop'
				? { rect: [0, 0, size.width, size.height], contentBox: null }
				: {}),
		}));
	}

	function renderScope() {
		const selected = pageTools.selected;
		return (
			<fieldset className="page-setup__fieldset">
				<legend>Pages</legend>
				<label className="page-setup__check">
					<input
						type="radio"
						name="scope"
						checked={view.scope === 'selection' && selected.length > 0}
						disabled={selected.length === 0}
						onChange={() => changeScope('selection')}
					/>
					{selected.length > 0
						? `Sélectionnées (${pageRanges(selected)})`
						: 'Sélectionnées (aucune)'}
				</label>
				<label className="page-setup__check">
					<input
						type="radio"
						name="scope"
						checked={view.scope === 'all' || selected.length === 0}
						onChange={() => changeScope('all')}
					/>
					Toutes ({pdf.pageCount})
				</label>
			</fieldset>
		);
	}

	function renderActions(label, { extra = null, disabled = false } = {}) {
		return (
			<div className="page-setup__actions">
				{extra}
				<button type="button" className="button button--ghost" onClick={close}>
					Annuler
				</button>
				<button
					type="submit"
					className="button button--primary"
					disabled={isBusy || disabled}
				>
					{label}
				</button>
			</div>
		);
	}

	// ----- Recadrer -----

	function handleCropPointerDown(event, handle) {
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		dragRef.current = {
			handle,
			x: event.clientX,
			y: event.clientY,
			rect: view.rect,
		};
	}

	function handleCropPointerMove(event) {
		const drag = dragRef.current;
		if (!drag) return;
		const scale = PREVIEW_SIZE / Math.max(pageSize.width, pageSize.height);
		update({
			rect: draggedRect(
				drag.rect,
				drag.handle,
				(event.clientX - drag.x) / scale,
				(event.clientY - drag.y) / scale,
				pageSize.width,
				pageSize.height,
			),
		});
	}

	function handleCropPointerUp() {
		dragRef.current = null;
	}

	function handleMarginChange(side, value) {
		const margins = marginsOf(view.rect, pageSize.width, pageSize.height);
		const next = {
			...margins,
			[side]: Math.max(0, toPoints(numberOf(value, 0))),
		};
		update({ rect: rectOf(next, pageSize.width, pageSize.height) });
	}

	async function handleCropModeChange(mode) {
		update({ mode });
		if (mode === 'content' && !view.contentBox) {
			try {
				const box = await pdf.getContentBounds(reference);
				update({ contentBox: box ?? false });
			} catch {
				update({ contentBox: false });
			}
		}
	}

	function handleCrop(event) {
		event.preventDefault();
		if (view.mode === 'content') {
			apply(() =>
				editor.cropPagesToContent(pages, toPoints(numberOf(view.padding, 0))),
			);
			return;
		}
		apply(() =>
			editor.cropPages(
				pages,
				marginsOf(view.rect, pageSize.width, pageSize.height),
			),
		);
	}

	function renderCrop() {
		const margins = marginsOf(view.rect, pageSize.width, pageSize.height);
		const [x0, y0, x1, y1] =
			view.mode === 'content' && view.contentBox
				? [
						Math.max(0, view.contentBox[0] - toPoints(view.padding)),
						Math.max(0, view.contentBox[1] - toPoints(view.padding)),
						Math.min(
							pageSize.width,
							view.contentBox[2] + toPoints(view.padding),
						),
						Math.min(
							pageSize.height,
							view.contentBox[3] + toPoints(view.padding),
						),
					]
				: view.rect;
		const percent = (value, size) => `${(value / size) * 100}%`;
		const isManual = view.mode === 'manual';
		const isFull =
			isManual && Object.values(margins).every((value) => value < 0.5);
		return (
			<form onSubmit={handleCrop}>
				<div className="page-setup__layout">
					<PagePreview
						pdf={pdf}
						index={reference}
						version={editor.pageVersion(reference)}
						pageSize={pageSize}
					>
						{(isManual || view.contentBox) && (
							<div
								className="page-setup__crop"
								style={{
									insetInlineStart: percent(x0, pageSize.width),
									insetBlockStart: percent(y0, pageSize.height),
									inlineSize: percent(x1 - x0, pageSize.width),
									blockSize: percent(y1 - y0, pageSize.height),
								}}
								onPointerDown={
									isManual
										? (event) => handleCropPointerDown(event, 'move')
										: undefined
								}
								onPointerMove={handleCropPointerMove}
								onPointerUp={handleCropPointerUp}
								onPointerCancel={handleCropPointerUp}
								data-movable={isManual || undefined}
							>
								{isManual &&
									CROP_HANDLES.map((handle) => (
										<span
											key={handle}
											className={`page-setup__handle page-setup__handle--${handle}`}
											onPointerDown={(event) =>
												handleCropPointerDown(event, handle)
											}
											onPointerMove={handleCropPointerMove}
											onPointerUp={handleCropPointerUp}
											onPointerCancel={handleCropPointerUp}
										/>
									))}
							</div>
						)}
					</PagePreview>
					<div className="page-setup__fields">
						{renderScope()}
						<fieldset className="page-setup__fieldset">
							<legend>Recadrage</legend>
							<label className="page-setup__check">
								<input
									type="radio"
									name="crop-mode"
									checked={isManual}
									onChange={() => handleCropModeChange('manual')}
								/>
								Marges choisies (cadre ou champs)
							</label>
							<label className="page-setup__check">
								<input
									type="radio"
									name="crop-mode"
									checked={!isManual}
									onChange={() => handleCropModeChange('content')}
								/>
								Marges blanches de chaque page
							</label>
						</fieldset>
						{isManual ? (
							<div className="page-setup__grid">
								{SIDES.map(({ id, label }) => (
									<label key={id} className="field">
										<span className="field__label">{label} (mm)</span>
										<input
											className="field__input"
											type="number"
											inputMode="decimal"
											min="0"
											step="any"
											value={toMillimeters(margins[id])}
											onChange={(event) =>
												handleMarginChange(id, event.target.value)
											}
										/>
									</label>
								))}
							</div>
						) : (
							<>
								<label className="field">
									<span className="field__label">
										Marge autour du contenu (mm)
									</span>
									<input
										className="field__input"
										type="number"
										inputMode="decimal"
										min="0"
										step="any"
										value={view.padding}
										onChange={(event) =>
											update({
												padding: Math.max(0, numberOf(event.target.value, 0)),
											})
										}
									/>
								</label>
								{view.contentBox === false && (
									<p className="page-setup__note">
										Cette page est blanche : elle ne sera pas recadrée.
									</p>
								)}
							</>
						)}
						<p className="page-setup__note">
							Le contenu retiré reste dans le fichier : « Pages entières » le
							rend.
						</p>
					</div>
				</div>
				{renderActions('Recadrer', {
					disabled: isManual && isFull,
					extra: (
						<button
							type="button"
							className="button button--ghost page-setup__extra"
							onClick={() => apply(() => editor.uncropPages(pages))}
							disabled={isBusy}
						>
							Pages entières
						</button>
					),
				})}
			</form>
		);
	}

	// ----- Taille -----

	function handleResize(event) {
		event.preventDefault();
		const preset = PAGE_SIZES.find((size) => size.id === view.size);
		const width = preset ? preset.width : toPoints(numberOf(view.width, 0));
		const height = preset ? preset.height : toPoints(numberOf(view.height, 0));
		apply(() =>
			editor.resizePages(pages, {
				width,
				height,
				orientation: view.orientation,
			}),
		);
	}

	function renderSize() {
		const isCustom = view.size === 'custom';
		return (
			<form onSubmit={handleResize}>
				{renderScope()}
				<label className="field">
					<span className="field__label">Nouvelle taille</span>
					<select
						className="field__input"
						value={view.size}
						onChange={(event) => update({ size: event.target.value })}
					>
						{PAGE_SIZES.map((size) => (
							<option key={size.id} value={size.id}>
								{size.label}
							</option>
						))}
						<option value="custom">Personnalisée</option>
					</select>
				</label>
				{isCustom && (
					<div className="page-setup__grid">
						<label className="field">
							<span className="field__label">Largeur (mm)</span>
							<input
								className="field__input"
								type="number"
								inputMode="decimal"
								min="13"
								max="5080"
								step="1"
								required
								value={view.width}
								onChange={(event) => update({ width: event.target.value })}
							/>
						</label>
						<label className="field">
							<span className="field__label">Hauteur (mm)</span>
							<input
								className="field__input"
								type="number"
								inputMode="decimal"
								min="13"
								max="5080"
								step="1"
								required
								value={view.height}
								onChange={(event) => update({ height: event.target.value })}
							/>
						</label>
					</div>
				)}
				<fieldset className="page-setup__fieldset">
					<legend>Orientation</legend>
					{[
						['auto', 'Celle de chaque page'],
						['portrait', 'Portrait'],
						['landscape', 'Paysage'],
					].map(([value, label]) => (
						<label key={value} className="page-setup__check">
							<input
								type="radio"
								name="orientation"
								checked={view.orientation === value}
								onChange={() => update({ orientation: value })}
							/>
							{label}
						</label>
					))}
				</fieldset>
				<p className="page-setup__note">
					Le contenu visible est mis à l’échelle et centré, les annotations
					suivent. En-têtes et filigrane déjà posés changent d’échelle avec lui
					: posez-les après.
				</p>
				{renderActions('Changer la taille')}
			</form>
		);
	}

	// ----- En-têtes -----

	function updateSlot(slot, value) {
		updateSpec({ slots: { ...view.spec.slots, [slot]: value } });
	}

	function insertToken(token) {
		const slot = lastSlotRef.current;
		updateSlot(slot, `${view.spec.slots[slot]}${token}`);
	}

	function updateBates(changes) {
		updateSpec({ bates: { ...view.spec.bates, ...changes } });
	}

	function headerSpec() {
		const { spec } = view;
		return {
			slots: spec.slots,
			fontSize: Math.min(72, Math.max(4, numberOf(spec.fontSize, 10))),
			color: spec.color,
			margin: Math.min(144, Math.max(0, spec.margin)),
			start: Math.max(0, Math.trunc(numberOf(spec.start, 1))),
			bates: {
				prefix: spec.bates.prefix,
				suffix: spec.bates.suffix,
				start: Math.max(0, Math.trunc(numberOf(spec.bates.start, 1))),
				digits: Math.min(
					12,
					Math.max(1, Math.trunc(numberOf(spec.bates.digits, 6))),
				),
			},
		};
	}

	function handleHeaders(event) {
		event.preventDefault();
		const spec = headerSpec();
		writeSettings(HEADERS_KEY, view.spec);
		apply(() =>
			editor.addHeaders(pages, spec, {
				title: document.title,
				date: todayLabel(),
			}),
		);
	}

	function renderHeaders() {
		const spec = headerSpec();
		const values = {
			rank: 0,
			total: pages.length,
			title: document.title,
			date: todayLabel(),
		};
		const isEmpty = HEADER_SLOTS.every(({ id }) => !spec.slots[id].trim());
		const usesBates = HEADER_SLOTS.some(({ id }) =>
			spec.slots[id].includes('{bates}'),
		);
		return (
			<form onSubmit={handleHeaders}>
				<div className="page-setup__layout">
					<PagePreview
						pdf={pdf}
						index={reference}
						version={editor.pageVersion(reference)}
						pageSize={pageSize}
					>
						<div
							className="page-setup__headers"
							style={{
								'--header-size': spec.fontSize,
								'--header-margin': spec.margin,
								color: spec.color,
							}}
							aria-hidden="true"
						>
							{HEADER_SLOTS.map(({ id }) => (
								<span
									key={id}
									className={`page-setup__header page-setup__header--${id}`}
								>
									{headerText(spec.slots[id], spec, values)}
								</span>
							))}
						</div>
					</PagePreview>
					<div className="page-setup__fields">{renderScope()}</div>
				</div>
				<div className="page-setup__slots">
					{HEADER_SLOTS.map(({ id, label }) => (
						<label key={id} className="field">
							<span className="field__label">{label}</span>
							<input
								className="field__input"
								value={view.spec.slots[id]}
								maxLength={200}
								onFocus={() => {
									lastSlotRef.current = id;
								}}
								onChange={(event) => updateSlot(id, event.target.value)}
							/>
						</label>
					))}
				</div>
				<p className="page-setup__tokens">
					<span>Insérer :</span>
					{HEADER_TOKENS.map(({ token, label }) => (
						<button
							key={token}
							type="button"
							className="button button--ghost page-setup__token"
							title={label}
							aria-label={`Insérer ${label}`}
							onClick={() => insertToken(token)}
						>
							{token}
						</button>
					))}
				</p>
				<div className="page-setup__grid">
					<label className="field">
						<span className="field__label">Taille (pt)</span>
						<input
							className="field__input"
							type="number"
							min="4"
							max="72"
							value={view.spec.fontSize}
							onChange={(event) => updateSpec({ fontSize: event.target.value })}
						/>
					</label>
					<label className="field">
						<span className="field__label">Couleur</span>
						<input
							className="field__input page-setup__color"
							type="color"
							value={view.spec.color}
							onChange={(event) => updateSpec({ color: event.target.value })}
						/>
					</label>
					<label className="field">
						<span className="field__label">Marge (mm)</span>
						<input
							className="field__input"
							type="number"
							inputMode="decimal"
							min="0"
							max="50"
							step="any"
							value={toMillimeters(view.spec.margin)}
							onChange={(event) =>
								updateSpec({
									margin: toPoints(
										Math.max(0, numberOf(event.target.value, 0)),
									),
								})
							}
						/>
					</label>
					<label className="field">
						<span className="field__label">Premier numéro de page</span>
						<input
							className="field__input"
							type="number"
							min="0"
							value={view.spec.start}
							onChange={(event) => updateSpec({ start: event.target.value })}
						/>
					</label>
				</div>
				{usesBates && (
					<fieldset className="page-setup__fieldset">
						<legend>Numérotation Bates</legend>
						<div className="page-setup__grid">
							<label className="field">
								<span className="field__label">Préfixe</span>
								<input
									className="field__input"
									value={view.spec.bates.prefix}
									maxLength={40}
									onChange={(event) =>
										updateBates({ prefix: event.target.value })
									}
								/>
							</label>
							<label className="field">
								<span className="field__label">Premier numéro</span>
								<input
									className="field__input"
									type="number"
									min="0"
									value={view.spec.bates.start}
									onChange={(event) =>
										updateBates({ start: event.target.value })
									}
								/>
							</label>
							<label className="field">
								<span className="field__label">Chiffres</span>
								<input
									className="field__input"
									type="number"
									min="1"
									max="12"
									value={view.spec.bates.digits}
									onChange={(event) =>
										updateBates({ digits: event.target.value })
									}
								/>
							</label>
							<label className="field">
								<span className="field__label">Suffixe</span>
								<input
									className="field__input"
									value={view.spec.bates.suffix}
									maxLength={40}
									onChange={(event) =>
										updateBates({ suffix: event.target.value })
									}
								/>
							</label>
						</div>
					</fieldset>
				)}
				<p className="page-setup__note">
					Les numéros comptent les pages choisies, dans l’ordre.{' '}
					{layers.headers > 0
						? `Les en-têtes déjà posés par editpdf (${layers.headers} ${layers.headers > 1 ? 'pages' : 'page'}) sont remplacés sur ces pages.`
						: ''}
				</p>
				{renderActions('Poser', {
					disabled: isEmpty,
					extra:
						layers.headers > 0 ? (
							<button
								type="button"
								className="button button--ghost page-setup__extra"
								onClick={() =>
									apply(() => editor.removePageLayer(pages, 'Header'))
								}
								disabled={isBusy}
							>
								Retirer les en-têtes
							</button>
						) : null,
				})}
			</form>
		);
	}

	// ----- Filigrane -----

	function watermarkSpec() {
		const { spec } = view;
		return {
			text: spec.text,
			fontSize:
				spec.fontSize === null
					? null
					: Math.min(400, Math.max(4, numberOf(spec.fontSize, 48))),
			color: spec.color,
			opacity: Math.min(1, Math.max(0.05, spec.opacity)),
			angle: spec.angle,
			behind: spec.behind,
		};
	}

	function handleWatermark(event) {
		event.preventDefault();
		writeSettings(WATERMARK_KEY, view.spec);
		apply(() => editor.addWatermark(pages, watermarkSpec()));
	}

	function renderWatermark() {
		const spec = watermarkSpec();
		const { width, height } = pageSize;
		const angle = spec.angle === 'diagonal' ? Math.atan2(height, width) : 0;
		let size = spec.fontSize;
		if (size === null) {
			const unit = textWidth(spec.text || ' ');
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			size = Math.min(
				(0.8 * width) / (unit * cos + 0.718 * sin),
				(0.8 * height) / (unit * sin + 0.718 * cos),
			);
		}
		return (
			<form onSubmit={handleWatermark}>
				<div className="page-setup__layout">
					<PagePreview
						pdf={pdf}
						index={reference}
						version={editor.pageVersion(reference)}
						pageSize={pageSize}
					>
						<span
							className="page-setup__watermark"
							style={{
								'--watermark-size': size,
								color: spec.color,
								opacity: spec.opacity,
								transform: `translate(-50%, -50%) rotate(${-angle}rad)`,
							}}
							aria-hidden="true"
						>
							{spec.text}
						</span>
					</PagePreview>
					<div className="page-setup__fields">
						{renderScope()}
						<label className="field">
							<span className="field__label">Texte</span>
							<input
								className="field__input"
								value={view.spec.text}
								maxLength={100}
								required
								onChange={(event) => updateSpec({ text: event.target.value })}
							/>
						</label>
					</div>
				</div>
				<div className="page-setup__grid">
					<label className="page-setup__check">
						<input
							type="checkbox"
							checked={view.spec.fontSize === null}
							onChange={(event) =>
								updateSpec({
									fontSize: event.target.checked ? null : Math.round(size),
								})
							}
						/>
						Taille ajustée à la page
					</label>
					{view.spec.fontSize !== null && (
						<label className="field">
							<span className="field__label">Taille (pt)</span>
							<input
								className="field__input"
								type="number"
								min="4"
								max="400"
								value={view.spec.fontSize}
								onChange={(event) =>
									updateSpec({ fontSize: event.target.value })
								}
							/>
						</label>
					)}
					<label className="field">
						<span className="field__label">Couleur</span>
						<input
							className="field__input page-setup__color"
							type="color"
							value={view.spec.color}
							onChange={(event) => updateSpec({ color: event.target.value })}
						/>
					</label>
					<label className="field">
						<span className="field__label">
							Opacité ({Math.round(spec.opacity * 100)} %)
						</span>
						<input
							type="range"
							min="5"
							max="100"
							step="5"
							value={Math.round(view.spec.opacity * 100)}
							onChange={(event) =>
								updateSpec({ opacity: Number(event.target.value) / 100 })
							}
						/>
					</label>
				</div>
				<fieldset className="page-setup__fieldset">
					<legend>Orientation</legend>
					<label className="page-setup__check">
						<input
							type="radio"
							name="angle"
							checked={view.spec.angle === 'diagonal'}
							onChange={() => updateSpec({ angle: 'diagonal' })}
						/>
						En diagonale
					</label>
					<label className="page-setup__check">
						<input
							type="radio"
							name="angle"
							checked={view.spec.angle === 'horizontal'}
							onChange={() => updateSpec({ angle: 'horizontal' })}
						/>
						Horizontal
					</label>
				</fieldset>
				<label className="page-setup__check">
					<input
						type="checkbox"
						checked={view.spec.behind}
						onChange={(event) => updateSpec({ behind: event.target.checked })}
					/>
					Derrière le contenu (une image pleine page, un scan le cachent)
				</label>
				{layers.watermarks > 0 && (
					<p className="page-setup__note">
						Le filigrane déjà posé par editpdf est remplacé sur ces pages.
					</p>
				)}
				{renderActions('Poser', {
					disabled: !view.spec.text.trim(),
					extra:
						layers.watermarks > 0 ? (
							<button
								type="button"
								className="button button--ghost page-setup__extra"
								onClick={() =>
									apply(() => editor.removePageLayer(pages, 'Watermark'))
								}
								disabled={isBusy}
							>
								Retirer le filigrane
							</button>
						) : null,
				})}
			</form>
		);
	}

	function renderContent() {
		switch (view?.kind) {
			case 'crop':
				return renderCrop();
			case 'size':
				return renderSize();
			case 'headers':
				return renderHeaders();
			case 'watermark':
				return renderWatermark();
			default:
				return null;
		}
	}

	return (
		<dialog
			ref={dialogRef}
			className="page-setup"
			aria-labelledby={titleId}
			onClose={() => setView(null)}
		>
			<h2 id={titleId} className="page-setup__title">
				{TITLES[view?.kind] ?? 'Mise en page'}
			</h2>
			{renderContent()}
		</dialog>
	);
}

export default PageSetupDialog;

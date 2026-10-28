import { useId } from 'react';
import ColorPalette from './ColorPalette';
import {
	FONT_SIZES,
	LINE_WIDTHS,
	MARKUP_STYLES,
	OPACITIES,
	PALETTE,
	SHAPE_STYLES,
	annotationLabel,
	hasFill,
	hasStroke,
} from '../utils/annotations';
import './AnnotationToolbar.css';

const TOOLS = [
	{
		value: 'select',
		label: 'Sélection',
		icon: <path d="M6 3l12 9-6 1-3 6z" />,
	},
	{
		value: 'markup',
		label: 'Surligner',
		icon: (
			<>
				<path d="M14 4l6 6-8 8H6v-6z" />
				<path d="M4 21h16" />
			</>
		),
	},
	{
		value: 'note',
		label: 'Note',
		icon: <path d="M4 5h16v11H9l-5 4z" />,
	},
	{
		value: 'text',
		label: 'Texte',
		icon: (
			<>
				<path d="M5 6V4h14v2" />
				<path d="M12 4v16" />
				<path d="M9 20h6" />
			</>
		),
	},
	{
		value: 'draw',
		label: 'Dessin',
		icon: (
			<>
				<path d="M4 20l1-5L16 4l4 4L9 19z" />
				<path d="M14 6l4 4" />
			</>
		),
	},
	{
		value: 'eraser',
		label: 'Gomme',
		icon: (
			<>
				<path d="M8 20h12" />
				<path d="M8 20l-4-4 10-10 6 6-8 8" />
				<path d="M9 11l6 6" />
			</>
		),
	},
	{
		value: 'shape',
		label: 'Forme',
		icon: (
			<>
				<rect x="3" y="10" width="11" height="11" rx="1" />
				<circle cx="16" cy="8" r="5" />
			</>
		),
	},
	{
		value: 'stamp',
		label: 'Tampon',
		icon: (
			<>
				<path d="M9 4h6v5l3 4H6l3-4z" />
				<path d="M4 17h16v3H4z" />
			</>
		),
	},
];

const OPACITY_LABEL = (value) => `${Math.round(value * 100)} %`;

function Icon({ children }) {
	return (
		<svg
			className="annotation-toolbar__svg"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

// 🔹 Barre du mode annotation, sous la barre d'outils (en bas de l'écran
// sur un téléphone) : outil (sélection, surligner, note, texte, dessin,
// gomme, forme, tampon), style du surlignage, forme, couleur, taille du
// texte, épaisseur, opacité, fond, tampon choisi (`stampLabel`, bouton qui
// ouvre le choix : `onChooseStamp`), actions sur l'annotation sélectionnée
// (`selected` : commentaire, modifier le texte, supprimer), annuler /
// rétablir, enregistrer, terminer. Les réglages s'appliquent à
// l'annotation sélectionnée, sinon à l'outil.
function AnnotationToolbar({
	tool,
	onToolChange,
	markupStyle,
	onMarkupStyleChange,
	shapeType,
	onShapeTypeChange,
	color,
	onColorChange,
	fontSize,
	onFontSizeChange,
	lineWidth,
	onLineWidthChange,
	opacity,
	onOpacityChange,
	fill,
	onFillChange,
	stampLabel,
	isImageStamp,
	onChooseStamp,
	selected,
	onComment,
	onEditText,
	onDelete,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	isDirty,
	isSaving,
	isLocked,
	onSave,
	onClose,
}) {
	const styleId = useId();
	const shapeId = useId();
	const sizeId = useId();
	const widthId = useId();
	const opacityId = useId();
	const fillId = useId();
	const canEditSelected = selected && !selected.isLocked && !isLocked;
	// Réglages : ceux de l'annotation sélectionnée, sinon ceux de l'outil
	// qui pose quelque chose.
	const showsColor = selected
		? canEditSelected && selected.color !== null
		: !['select', 'eraser'].includes(tool) &&
			!(tool === 'stamp' && isImageStamp);
	const showsFontSize = selected
		? canEditSelected && selected.type === 'FreeText'
		: tool === 'text';
	const showsStroke = selected
		? canEditSelected && hasStroke(selected)
		: tool === 'draw' || tool === 'shape';
	const showsFill = selected
		? canEditSelected && hasFill(selected)
		: tool === 'shape' && ['Square', 'Circle', 'Polygon'].includes(shapeType);
	const isCustomFill =
		fill !== null && !PALETTE.some((item) => item.value === fill);

	return (
		<div className="annotation-toolbar" role="toolbar" aria-label="Annotations">
			{/* Outils et réglages : défilent sur un écran étroit ; la fin de la
			    barre (annuler, enregistrer, terminer) reste visible. */}
			<div className="annotation-toolbar__main">
				<div
					className="annotation-toolbar__group"
					role="group"
					aria-label="Outil"
				>
					{TOOLS.map(({ value, label, icon }) => (
						<button
							key={value}
							type="button"
							className="button button--ghost annotation-toolbar__button"
							aria-pressed={tool === value}
							// Infobulle : le libellé est masqué sur un écran moyen.
							title={label}
							onClick={() => onToolChange(value)}
							disabled={isLocked}
						>
							<Icon>{icon}</Icon>
							<span className="annotation-toolbar__label">{label}</span>
						</button>
					))}
				</div>

				{tool === 'markup' && !selected && (
					<div className="annotation-toolbar__group">
						<label htmlFor={styleId} className="visually-hidden">
							Style
						</label>
						<select
							id={styleId}
							className="field__input annotation-toolbar__select"
							value={markupStyle}
							onChange={(event) => onMarkupStyleChange(event.target.value)}
							disabled={isLocked}
						>
							{MARKUP_STYLES.map((style) => (
								<option key={style.type} value={style.type}>
									{style.label}
								</option>
							))}
						</select>
					</div>
				)}

				{tool === 'shape' && !selected && (
					<div className="annotation-toolbar__group">
						<label htmlFor={shapeId} className="visually-hidden">
							Forme
						</label>
						<select
							id={shapeId}
							className="field__input annotation-toolbar__select"
							value={shapeType}
							onChange={(event) => onShapeTypeChange(event.target.value)}
							disabled={isLocked}
						>
							{SHAPE_STYLES.map((style) => (
								<option key={style.type} value={style.type}>
									{style.label}
								</option>
							))}
						</select>
					</div>
				)}

				{tool === 'stamp' && !selected && (
					<div className="annotation-toolbar__group">
						<button
							type="button"
							className="button annotation-toolbar__stamp"
							aria-haspopup="dialog"
							onClick={onChooseStamp}
							disabled={isLocked}
						>
							<span className="visually-hidden">Tampon : </span>
							<span className="annotation-toolbar__stamp-label">
								{stampLabel}
							</span>
							<span aria-hidden="true">▾</span>
						</button>
					</div>
				)}

				{showsColor && (
					<ColorPalette
						label={
							selected
								? 'Couleur de l’annotation sélectionnée'
								: 'Couleur de l’outil'
						}
						value={color}
						onChange={onColorChange}
						isDisabled={isLocked}
					/>
				)}

				{showsFontSize && (
					<div className="annotation-toolbar__group">
						<label htmlFor={sizeId} className="visually-hidden">
							Taille du texte
						</label>
						<select
							id={sizeId}
							className="field__input annotation-toolbar__select"
							value={String(fontSize)}
							onChange={(event) => onFontSizeChange(Number(event.target.value))}
							disabled={isLocked}
						>
							{!FONT_SIZES.includes(fontSize) && (
								<option value={String(fontSize)}>
									{Math.round(fontSize)} pt
								</option>
							)}
							{FONT_SIZES.map((size) => (
								<option key={size} value={String(size)}>
									{size} pt
								</option>
							))}
						</select>
					</div>
				)}

				{showsStroke && (
					<div className="annotation-toolbar__group">
						<label
							htmlFor={widthId}
							className="annotation-toolbar__field-label"
						>
							Épaisseur
						</label>
						<select
							id={widthId}
							className="field__input annotation-toolbar__select"
							value={String(lineWidth)}
							onChange={(event) =>
								onLineWidthChange(Number(event.target.value))
							}
							disabled={isLocked}
						>
							{!LINE_WIDTHS.includes(lineWidth) && (
								<option value={String(lineWidth)}>
									{Math.round(lineWidth * 10) / 10} pt
								</option>
							)}
							{LINE_WIDTHS.map((width) => (
								<option key={width} value={String(width)}>
									{width} pt
								</option>
							))}
						</select>
						<label
							htmlFor={opacityId}
							className="annotation-toolbar__field-label"
						>
							Opacité
						</label>
						<select
							id={opacityId}
							className="field__input annotation-toolbar__select"
							value={String(opacity)}
							onChange={(event) => onOpacityChange(Number(event.target.value))}
							disabled={isLocked}
						>
							{!OPACITIES.includes(opacity) && (
								<option value={String(opacity)}>
									{OPACITY_LABEL(opacity)}
								</option>
							)}
							{OPACITIES.map((value) => (
								<option key={value} value={String(value)}>
									{OPACITY_LABEL(value)}
								</option>
							))}
						</select>
					</div>
				)}

				{showsFill && (
					<div className="annotation-toolbar__group">
						<label htmlFor={fillId} className="annotation-toolbar__field-label">
							Fond
						</label>
						<select
							id={fillId}
							className="field__input annotation-toolbar__select"
							value={fill ?? 'none'}
							onChange={(event) =>
								onFillChange(
									event.target.value === 'none' ? null : event.target.value,
								)
							}
							disabled={isLocked}
						>
							<option value="none">Aucun</option>
							{isCustomFill && <option value={fill}>Autre</option>}
							{PALETTE.map((item) => (
								<option key={item.value} value={item.value}>
									{item.label}
								</option>
							))}
						</select>
					</div>
				)}

				{selected && (
					<div
						className="annotation-toolbar__group"
						role="group"
						aria-label={`Annotation sélectionnée : ${annotationLabel(selected)}`}
					>
						{selected.type === 'FreeText' ? (
							<button
								type="button"
								className="button button--ghost annotation-toolbar__button"
								onClick={onEditText}
								disabled={!canEditSelected}
							>
								Modifier le texte
							</button>
						) : (
							<button
								type="button"
								className="button button--ghost annotation-toolbar__button"
								onClick={onComment}
							>
								{selected.type === 'Text' ? 'Texte de la note' : 'Commentaire'}
							</button>
						)}
						<button
							type="button"
							className="button button--ghost annotation-toolbar__button annotation-toolbar__danger"
							aria-keyshortcuts="Delete"
							onClick={onDelete}
							disabled={!canEditSelected}
						>
							Supprimer
						</button>
					</div>
				)}
			</div>

			<div className="annotation-toolbar__group annotation-toolbar__end">
				<button
					type="button"
					className="button button--ghost annotation-toolbar__button"
					aria-label="Annuler"
					aria-keyshortcuts="Control+Z"
					onClick={onUndo}
					disabled={!canUndo}
				>
					<Icon>
						<path d="M9 14L4 9l5-5" />
						<path d="M4 9h10a6 6 0 010 12h-3" />
					</Icon>
				</button>
				<button
					type="button"
					className="button button--ghost annotation-toolbar__button"
					aria-label="Rétablir"
					aria-keyshortcuts="Control+Shift+Z"
					onClick={onRedo}
					disabled={!canRedo}
				>
					<Icon>
						<path d="M15 14l5-5-5-5" />
						<path d="M20 9H10a6 6 0 000 12h3" />
					</Icon>
				</button>
				<button
					type="button"
					className="button button--primary annotation-toolbar__save"
					aria-keyshortcuts="Control+S"
					onClick={onSave}
					disabled={!isDirty || isSaving || isLocked}
				>
					{isSaving ? 'Enregistrement…' : 'Enregistrer'}
				</button>
				<button
					type="button"
					className="button button--ghost annotation-toolbar__button"
					aria-label="Terminer les annotations"
					onClick={onClose}
				>
					<span aria-hidden="true">✕</span>
				</button>
			</div>
		</div>
	);
}

export default AnnotationToolbar;

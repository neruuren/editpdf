import { useId } from 'react';
import ColorPalette from './ColorPalette';
import {
	FONT_SIZES,
	MARKUP_STYLES,
	annotationTypeLabel,
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
];

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
// sur un téléphone) : outil (sélection, surligner, note, texte), style du
// surlignage, couleur et taille du texte, actions sur l'annotation
// sélectionnée (`selected` : commentaire, modifier le texte, supprimer),
// annuler / rétablir, enregistrer, terminer. La couleur et la taille
// s'appliquent à l'annotation sélectionnée, sinon à l'outil.
function AnnotationToolbar({
	tool,
	onToolChange,
	markupStyle,
	onMarkupStyleChange,
	color,
	onColorChange,
	fontSize,
	onFontSizeChange,
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
	const sizeId = useId();
	const canEditSelected = selected && !selected.isLocked && !isLocked;
	// Couleur et taille : celles de l'annotation sélectionnée, sinon celles
	// de l'outil qui pose quelque chose.
	const showsColor = selected ? canEditSelected : tool !== 'select';
	const showsFontSize = selected
		? canEditSelected && selected.type === 'FreeText'
		: tool === 'text';

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

				{selected && (
					<div
						className="annotation-toolbar__group"
						role="group"
						aria-label={`${annotationTypeLabel(selected.type)} sélectionné`}
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

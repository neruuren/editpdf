import { useId, useRef } from 'react';
import ColorPalette from './ColorPalette';
import { IMAGE_FILE_TYPES } from '../utils/imageEdit';
import { TEXT_ALIGNMENTS, TEXT_FAMILIES, TEXT_SIZES } from '../utils/textEdit';
import './TextEditToolbar.css';

const TOOLS = [
	{
		value: 'edit',
		label: 'Modifier le texte',
		icon: (
			<>
				<path d="M4 6V4h12v2" />
				<path d="M10 4v14" />
				<path d="M14 20l1-4 5-5 3 3-5 5z" />
			</>
		),
	},
	{
		value: 'add',
		label: 'Ajouter du texte',
		icon: (
			<>
				<path d="M4 6V4h12v2" />
				<path d="M10 4v14" />
				<path d="M18 14v6" />
				<path d="M15 17h6" />
			</>
		),
	},
	{
		value: 'image',
		label: 'Images',
		icon: (
			<>
				<rect x="3" y="5" width="18" height="14" rx="2" />
				<circle cx="8.5" cy="10" r="1.5" />
				<path d="M21 16l-5-5-8 8" />
			</>
		),
	},
];

const ALIGN_ICONS = {
	left: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
	center: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
	right: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
};

function Icon({ children }) {
	return (
		<svg
			className="text-edit-toolbar__svg"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

// 🔹 Barre du mode « Modifier » (contenu : texte T4a, images T4b), sous la
// barre d'outils (en bas de l'écran sur un téléphone) : outil (modifier le
// texte, ajouter du texte, images), annuler / rétablir, enregistrer,
// terminer.
// - Texte : police, gras, italique, taille, couleur, alignement, passage au
//   paragraphe entier. Les réglages s'appliquent au texte en cours de
//   saisie (`session`), sinon au texte ajouté. `data-keeps-text-editor` :
//   y cliquer ne valide pas la saisie (TextEditBox).
// - Images : ajouter une image (fichier choisi : `onAddImage(file)`), et pour
//   l'image sélectionnée (`imageSelection`), la remplacer
//   (`onReplaceImage(file)`) ou la supprimer.
function TextEditToolbar({
	tool,
	onToolChange,
	style,
	session,
	onStyleChange,
	onExtendToBlock,
	imageSelection,
	onAddImage,
	onReplaceImage,
	onDeleteImage,
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
	const fontId = useId();
	const sizeId = useId();
	const original = session?.original ?? null;
	const canExtend = session?.kind === 'line' && session.block.lines.length > 1;
	const addInputRef = useRef(null);
	const replaceInputRef = useRef(null);
	const selectedImage = imageSelection?.image ?? null;

	// Le même fichier peut être choisi deux fois de suite.
	function handleFile(event, onFile) {
		const [file] = event.target.files;
		event.target.value = '';
		if (file) onFile(file);
	}
	return (
		<div
			className="text-edit-toolbar"
			role="toolbar"
			aria-label="Modification du contenu"
			data-keeps-text-editor
		>
			<div className="text-edit-toolbar__main">
				<div
					className="text-edit-toolbar__group"
					role="group"
					aria-label="Outil"
				>
					{TOOLS.map(({ value, label, icon }) => (
						<button
							key={value}
							type="button"
							className="button button--ghost text-edit-toolbar__button"
							aria-pressed={tool === value}
							title={label}
							onClick={() => onToolChange(value)}
							disabled={isLocked}
						>
							<Icon>{icon}</Icon>
							<span className="text-edit-toolbar__label">{label}</span>
						</button>
					))}
				</div>
				{tool === 'image' ? (
					<div className="text-edit-toolbar__group">
						<input
							ref={addInputRef}
							type="file"
							accept={IMAGE_FILE_TYPES}
							hidden
							onChange={(event) => handleFile(event, onAddImage)}
						/>
						<input
							ref={replaceInputRef}
							type="file"
							accept={IMAGE_FILE_TYPES}
							hidden
							onChange={(event) => handleFile(event, onReplaceImage)}
						/>
						<button
							type="button"
							className="button button--ghost text-edit-toolbar__button"
							onClick={() => addInputRef.current?.click()}
							disabled={isLocked}
						>
							Ajouter une image…
						</button>
						<button
							type="button"
							className="button button--ghost text-edit-toolbar__button"
							onClick={() => replaceInputRef.current?.click()}
							disabled={isLocked || !selectedImage?.canMove}
						>
							Remplacer…
						</button>
						<button
							type="button"
							className="button button--ghost text-edit-toolbar__button"
							onClick={onDeleteImage}
							disabled={isLocked || !selectedImage}
						>
							Supprimer
						</button>
						{selectedImage && !selectedImage.canMove && (
							<span className="text-edit-toolbar__hint">
								Cette image peut seulement être supprimée.
							</span>
						)}
					</div>
				) : (
					<>
						<div className="text-edit-toolbar__group">
							<label htmlFor={fontId} className="visually-hidden">
								Police
							</label>
							<select
								id={fontId}
								className="field__input text-edit-toolbar__select"
								value={style.font}
								onChange={(event) =>
									onStyleChange({ font: event.target.value })
								}
								disabled={isLocked}
							>
								{original && (
									<option value="original">
										{original.isReusable
											? `D’origine (${original.name})`
											: `D’origine (${original.name}, remplacée)`}
									</option>
								)}
								{TEXT_FAMILIES.map((item) => (
									<option key={item.value} value={item.value}>
										{item.label}
									</option>
								))}
							</select>
							<button
								type="button"
								className="button button--ghost text-edit-toolbar__button text-edit-toolbar__bold"
								aria-pressed={style.bold}
								aria-label="Gras"
								title="Gras"
								onClick={() => onStyleChange({ bold: !style.bold })}
								disabled={isLocked}
							>
								G
							</button>
							<button
								type="button"
								className="button button--ghost text-edit-toolbar__button text-edit-toolbar__italic"
								aria-pressed={style.italic}
								aria-label="Italique"
								title="Italique"
								onClick={() => onStyleChange({ italic: !style.italic })}
								disabled={isLocked}
							>
								I
							</button>
							<label htmlFor={sizeId} className="visually-hidden">
								Taille du texte
							</label>
							<select
								id={sizeId}
								className="field__input text-edit-toolbar__select"
								value={String(style.size)}
								onChange={(event) =>
									onStyleChange({ size: Number(event.target.value) })
								}
								disabled={isLocked}
							>
								{!TEXT_SIZES.includes(style.size) && (
									<option value={String(style.size)}>{style.size} pt</option>
								)}
								{TEXT_SIZES.map((size) => (
									<option key={size} value={String(size)}>
										{size} pt
									</option>
								))}
							</select>
						</div>
						<div className="text-edit-toolbar__group">
							<ColorPalette
								label="Couleur du texte"
								value={style.color}
								onChange={(color) => onStyleChange({ color })}
								isDisabled={isLocked}
							/>
						</div>
						<div
							className="text-edit-toolbar__group"
							role="group"
							aria-label="Alignement"
						>
							{TEXT_ALIGNMENTS.map(({ value, label }) => (
								<button
									key={value}
									type="button"
									className="button button--ghost text-edit-toolbar__button"
									aria-pressed={style.align === value}
									aria-label={label}
									title={label}
									onClick={() => onStyleChange({ align: value })}
									disabled={isLocked}
								>
									<Icon>{ALIGN_ICONS[value]}</Icon>
								</button>
							))}
						</div>
						{canExtend && (
							<div className="text-edit-toolbar__group">
								<button
									type="button"
									className="button button--ghost text-edit-toolbar__button"
									onClick={onExtendToBlock}
									disabled={isLocked}
								>
									Paragraphe entier
								</button>
							</div>
						)}
					</>
				)}
			</div>

			<div className="text-edit-toolbar__group text-edit-toolbar__end">
				<button
					type="button"
					className="button button--ghost text-edit-toolbar__button"
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
					className="button button--ghost text-edit-toolbar__button"
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
					className="button button--primary text-edit-toolbar__save"
					aria-keyshortcuts="Control+S"
					onClick={onSave}
					disabled={!isDirty || isSaving || isLocked}
				>
					{isSaving ? 'Enregistrement…' : 'Enregistrer'}
				</button>
				<button
					type="button"
					className="button button--ghost text-edit-toolbar__button"
					aria-label="Terminer la modification du contenu"
					onClick={onClose}
				>
					<span aria-hidden="true">✕</span>
				</button>
			</div>
		</div>
	);
}

export default TextEditToolbar;

import { useRef } from 'react';
import ColorPalette from './ColorPalette';
import { useFloatingPosition } from '../hooks/useFloatingPosition';
import { MARKUP_STYLES } from '../utils/annotations';
import './SelectionToolbar.css';

// 🔹 Petite barre posée sous une sélection de texte des pages (au-dessus
// si la place manque ; sous elle, le menu du téléphone reste visible) :
// surligner, souligner, barrer, onduler dans la couleur choisie, retirer
// ces effets du texte sélectionné (`onUnmark`), ou copier. `selection` : { ranges, range } (useTextSelection).
function SelectionToolbar({
	selection,
	color,
	onColorChange,
	onMarkup,
	onUnmark,
	onCopy,
	isLocked,
}) {
	const ref = useRef(null);
	const { ranges, range } = selection;
	const position = useFloatingPosition(
		ref,
		() => range.getBoundingClientRect?.() ?? null,
		JSON.stringify(ranges),
	);

	return (
		<div
			ref={ref}
			className="selection-toolbar"
			role="toolbar"
			aria-label="Texte sélectionné"
			style={
				position
					? { insetBlockStart: position.top, insetInlineStart: position.left }
					: undefined
			}
			data-placed={position ? true : undefined}
			// Un appui sur la barre ne doit pas défaire la sélection.
			onPointerDown={(event) => {
				if (event.target.type !== 'color') event.preventDefault();
			}}
		>
			<div className="selection-toolbar__actions">
				{MARKUP_STYLES.map((style) => (
					<button
						key={style.type}
						type="button"
						className="button button--ghost selection-toolbar__button"
						data-style={style.type}
						style={{ '--markup-color': color }}
						onClick={() => onMarkup(style.type)}
						disabled={isLocked}
					>
						{style.label}
					</button>
				))}
				<button
					type="button"
					className="button button--ghost selection-toolbar__button"
					onClick={onUnmark}
					disabled={isLocked}
				>
					Retirer
				</button>
				<button
					type="button"
					className="button button--ghost selection-toolbar__button"
					onClick={onCopy}
				>
					Copier
				</button>
			</div>
			<ColorPalette
				label="Couleur du surlignage"
				value={color}
				onChange={onColorChange}
				isDisabled={isLocked}
			/>
		</div>
	);
}

export default SelectionToolbar;

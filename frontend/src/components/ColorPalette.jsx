import { useId } from 'react';
import { PALETTE } from '../utils/annotations';
import './ColorPalette.css';

// 🔹 Choix d'une couleur d'annotation : les 6 couleurs prêtes (boutons
// radio) et une couleur libre (sélecteur natif). `value` : '#rrggbb'.
function ColorPalette({ label, value, onChange, isDisabled = false }) {
	const name = useId();
	const isCustom = !PALETTE.some((color) => color.value === value);

	return (
		<fieldset className="color-palette" disabled={isDisabled}>
			<legend className="visually-hidden">{label}</legend>
			{PALETTE.map((color) => (
				<label
					key={color.value}
					className="color-palette__swatch"
					style={{ '--swatch-color': color.value }}
					title={color.label}
				>
					<input
						type="radio"
						name={name}
						className="visually-hidden"
						value={color.value}
						checked={value === color.value}
						onChange={() => onChange(color.value)}
					/>
					<span className="visually-hidden">{color.label}</span>
				</label>
			))}
			<label
				className="color-palette__swatch color-palette__custom"
				data-checked={isCustom || undefined}
				style={isCustom ? { '--swatch-color': value } : undefined}
				title="Autre couleur"
			>
				<input
					type="color"
					className="color-palette__picker"
					value={value}
					onChange={(event) => onChange(event.target.value)}
				/>
				<span className="visually-hidden">Autre couleur</span>
			</label>
		</fieldset>
	);
}

export default ColorPalette;

import { useId } from 'react';
import { useAppTheme } from '../hooks/useAppTheme';
import { APP_THEMES } from '../utils/appTheme';
import './AppThemeMenu.css';

// 🔹 Choix de l'apparence de l'application dans un popover natif ancré au
// bouton (Échap et clic à côté le ferment). Appliqué dès le choix.
function AppThemeMenu() {
	const [appTheme, setAppTheme] = useAppTheme();
	const menuId = useId();

	function handleChange(event) {
		setAppTheme(event.target.value);
	}

	return (
		<>
			<button
				type="button"
				className="button button--ghost app-theme-menu__button"
				aria-label="Apparence"
				popoverTarget={menuId}
			>
				<span aria-hidden="true">◐{'︎'}</span>
			</button>
			<div id={menuId} className="app-theme-menu" popover="auto">
				<fieldset className="app-theme-menu__group">
					<legend className="app-theme-menu__legend">Apparence</legend>
					{APP_THEMES.map((theme) => (
						<label key={theme.value} className="app-theme-menu__choice">
							<input
								type="radio"
								name="app-theme"
								value={theme.value}
								checked={appTheme === theme.value}
								onChange={handleChange}
							/>
							{theme.label}
						</label>
					))}
				</fieldset>
			</div>
		</>
	);
}

export default AppThemeMenu;

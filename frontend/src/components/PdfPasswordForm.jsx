import { useId, useState } from 'react';
import './PdfPasswordForm.css';

// 🔹 Mot de passe d'un PDF protégé, demandé à l'ouverture. Il est essayé
// dans le moteur PDF du navigateur : jamais envoyé au serveur, gardé
// seulement le temps de la session (documentFileCache).
function PdfPasswordForm({ isWrongPassword, onUnlock }) {
	const inputId = useId();
	const errorId = useId();
	const [isChecking, setIsChecking] = useState(false);
	const [error, setError] = useState(null);

	async function handleSubmit(event) {
		event.preventDefault();
		const form = event.currentTarget;
		const password = new FormData(form).get('password');
		setIsChecking(true);
		setError(null);
		try {
			await onUnlock(password);
		} catch {
			setError('Le moteur PDF n’a pas pu vérifier ce mot de passe.');
		} finally {
			setIsChecking(false);
		}
		form.elements.password?.select();
	}

	const message = error ?? (isWrongPassword ? 'Mot de passe incorrect.' : null);

	return (
		<form className="pdf-password-form" onSubmit={handleSubmit}>
			<p className="pdf-password-form__intro">
				Ce PDF est protégé par un mot de passe.
			</p>
			<label htmlFor={inputId} className="field__label">
				Mot de passe du PDF
			</label>
			<input
				id={inputId}
				name="password"
				type="password"
				className="field__input"
				autoComplete="off"
				required
				maxLength={1024}
				aria-invalid={message ? 'true' : undefined}
				aria-describedby={message ? errorId : undefined}
				// Seule chose à faire sur cet écran.
				autoFocus
			/>
			{message && (
				<p id={errorId} className="pdf-password-form__error" role="alert">
					{message}
				</p>
			)}
			<button
				type="submit"
				className="button button--primary"
				disabled={isChecking}
			>
				Ouvrir
			</button>
			<p className="pdf-password-form__hint">
				Le mot de passe reste dans cet onglet le temps de la session : il n’est
				jamais envoyé au serveur.
			</p>
		</form>
	);
}

export default PdfPasswordForm;

import { Navigate, useLocation } from 'react-router-dom';
import { useLogin, useSession } from '../hooks/useAuth';
import './LoginPage.css';

function LoginPage() {
	const location = useLocation();
	const { data: user } = useSession();
	const login = useLogin();

	// Une fois connecté, retour à la page demandée avant la redirection vers /login.
	if (user) {
		const from = location.state?.from?.pathname || '/';
		return <Navigate to={from} replace />;
	}

	function handleSubmit(event) {
		// onSubmit plutôt qu'une action de formulaire React 19 : celle-ci
		// réinitialise les champs, ce qui viderait l'identifiant après une erreur.
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		login.mutate({
			username: formData.get('username'),
			password: formData.get('password'),
		});
	}

	return (
		<main className="login-page">
			<form className="login-page__form" onSubmit={handleSubmit}>
				<img
					className="login-page__logo"
					src="/logo.svg"
					alt=""
					width="72"
					height="72"
				/>
				<h1 className="login-page__title">editpdf</h1>

				<label className="field">
					<span className="field__label">Identifiant</span>
					<input
						className="field__input"
						name="username"
						autoComplete="username"
						autoCapitalize="none"
						required
					/>
				</label>
				<label className="field">
					<span className="field__label">Mot de passe</span>
					<input
						className="field__input"
						name="password"
						type="password"
						autoComplete="current-password"
						required
					/>
				</label>

				{login.isError && (
					<p className="login-page__error" role="alert">
						{login.error.message}
					</p>
				)}

				<button
					type="submit"
					className="button button--primary"
					disabled={login.isPending}
				>
					{login.isPending ? 'Connexion…' : 'Se connecter'}
				</button>
			</form>
		</main>
	);
}

export default LoginPage;

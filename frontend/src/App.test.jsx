import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { mockFetch, renderWithProviders } from './testUtils';

const NO_SESSION = {
	status: 401,
	body: { success: false, error: 'Non authentifié' },
};
const SESSION = {
	status: 200,
	body: { success: true, data: { username: 'owner' } },
};

describe('App : authentification', () => {
	it('redirige vers la page de connexion sans session', async () => {
		mockFetch({ 'GET /api/auth/me': NO_SESSION });
		renderWithProviders(<App />, { route: '/' });
		expect(
			await screen.findByRole('button', { name: 'Se connecter' }),
		).toBeInTheDocument();
	});

	it('affiche la bibliothèque avec une session', async () => {
		mockFetch({ 'GET /api/auth/me': SESSION });
		renderWithProviders(<App />, { route: '/' });
		expect(
			await screen.findByRole('heading', { name: 'Bibliothèque' }),
		).toBeInTheDocument();
	});

	it('range la déconnexion dans le menu burger', async () => {
		mockFetch({ 'GET /api/auth/me': SESSION });
		renderWithProviders(<App />, { route: '/' });

		const menuButton = await screen.findByRole('button', { name: 'Menu' });
		const menu = document.getElementById(
			menuButton.getAttribute('popovertarget'),
		);
		expect(menu).toHaveAttribute('popover', 'auto');
		// Le contenu d'un popover fermé reste masqué dans jsdom (sans API
		// popover), d'où { hidden: true }.
		expect(
			within(menu)
				.getAllByRole('button', { hidden: true })
				.map((button) => button.textContent),
		).toEqual(['Se déconnecter']);
	});

	it('ramène à l’accueil par le logo et le nom de l’app', async () => {
		mockFetch({ 'GET /api/auth/me': SESSION });
		renderWithProviders(<App />, { route: '/' });
		expect(
			await screen.findByRole('link', { name: 'editpdf' }),
		).toHaveAttribute('href', '/');
	});

	it('connecte puis ramène à la bibliothèque', async () => {
		const fetchMock = mockFetch({
			'GET /api/auth/me': NO_SESSION,
			'POST /api/auth/login': SESSION,
		});
		renderWithProviders(<App />, { route: '/' });

		await userEvent.type(await screen.findByLabelText('Identifiant'), 'owner');
		await userEvent.type(screen.getByLabelText('Mot de passe'), 'secret');
		await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

		expect(
			await screen.findByRole('heading', { name: 'Bibliothèque' }),
		).toBeInTheDocument();
		const [, loginOptions] = fetchMock.mock.calls.find(
			([url]) => url === '/api/auth/login',
		);
		expect(JSON.parse(loginOptions.body)).toEqual({
			username: 'owner',
			password: 'secret',
		});
	});

	it("affiche l'erreur du serveur si les identifiants sont refusés", async () => {
		mockFetch({
			'GET /api/auth/me': NO_SESSION,
			'POST /api/auth/login': {
				status: 401,
				body: { success: false, error: 'Identifiants invalides' },
			},
		});
		renderWithProviders(<App />, { route: '/' });

		await userEvent.type(await screen.findByLabelText('Identifiant'), 'owner');
		await userEvent.type(screen.getByLabelText('Mot de passe'), 'faux');
		await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Identifiants invalides',
		);
		// L'identifiant saisi est conservé après l'échec.
		expect(screen.getByLabelText('Identifiant')).toHaveValue('owner');
	});

	it('déconnecte et revient à la page de connexion', async () => {
		mockFetch({
			'GET /api/auth/me': SESSION,
			'POST /api/auth/logout': {
				status: 200,
				body: { success: true, data: null },
			},
		});
		renderWithProviders(<App />, { route: '/' });

		await userEvent.click(
			await screen.findByRole('button', {
				name: 'Se déconnecter',
				hidden: true,
			}),
		);
		expect(
			await screen.findByRole('button', { name: 'Se connecter' }),
		).toBeInTheDocument();
	});

	it('propose de réessayer si le serveur est injoignable', async () => {
		mockFetch({
			'GET /api/auth/me': {
				status: 500,
				body: { success: false, error: 'Internal server error' },
			},
		});
		renderWithProviders(<App />, { route: '/' });
		expect(
			await screen.findByRole(
				'button',
				{ name: 'Réessayer' },
				{ timeout: 5000 },
			),
		).toBeInTheDocument();
	});

	it('affiche une page 404 pour une URL inconnue', async () => {
		mockFetch({});
		renderWithProviders(<App />, { route: '/nimporte-quoi' });
		expect(
			await screen.findByRole('heading', { name: 'Page introuvable' }),
		).toBeInTheDocument();
	});
});

describe('App : apparence', () => {
	afterEach(() => {
		delete document.documentElement.dataset.theme;
	});

	it('change l’apparence de l’application depuis l’en-tête', async () => {
		mockFetch({ 'GET /api/auth/me': SESSION });
		renderWithProviders(<App />, { route: '/' });

		// jsdom ne sait pas ouvrir un popover : contenu cherché avec hidden.
		await screen.findByRole('button', { name: 'Apparence' });
		const dark = screen.getByRole('radio', { name: 'Sombre', hidden: true });
		await userEvent.click(dark);
		expect(document.documentElement.dataset.theme).toBe('dark');
		expect(localStorage.getItem('editpdf-app-theme')).toBe('dark');
		expect(dark).toBeChecked();
	});
});

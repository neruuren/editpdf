import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { mockFetch, renderWithProviders } from '../testUtils';

const SESSION = {
	status: 200,
	body: { success: true, data: { username: 'owner' } },
};

const BAIL = {
	id: 'bail',
	title: 'Contrat de bail',
	author: 'Agence Dupont',
	subject: null,
	pageCount: 12,
	isEncrypted: false,
	originalName: 'bail-2026.pdf',
	currentRevision: 0,
	fileSize: 3 * 1024 * 1024,
	hasThumbnail: true,
	addedAt: '2026-03-01T10:00:00.000Z',
	updatedAt: '2026-03-01T10:00:00.000Z',
	lastOpenedAt: null,
};

function ok(data, status = 200) {
	return { status, body: { success: true, data } };
}

describe('DocumentPage', () => {
	it('montre les informations et propose le téléchargement', async () => {
		mockFetch({
			'GET /api/auth/me': SESSION,
			'GET /api/v1/documents/bail': ok(BAIL),
		});
		renderWithProviders(<App />, { route: '/documents/bail' });
		expect(
			await screen.findByRole('heading', { name: 'Contrat de bail' }),
		).toBeInTheDocument();
		expect(screen.getByText('12 pages')).toBeInTheDocument();
		expect(screen.getByText('bail-2026.pdf')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Télécharger' })).toHaveAttribute(
			'href',
			'/api/v1/documents/bail/file',
		);
		// Pas encore de révision : l'original est le fichier courant.
		expect(
			screen.queryByRole('link', { name: 'Télécharger l’original' }),
		).not.toBeInTheDocument();
	});

	it('propose l’original quand une révision existe', async () => {
		mockFetch({
			'GET /api/auth/me': SESSION,
			'GET /api/v1/documents/bail': ok({ ...BAIL, currentRevision: 2 }),
		});
		renderWithProviders(<App />, { route: '/documents/bail' });
		expect(
			await screen.findByRole('link', { name: 'Télécharger l’original' }),
		).toHaveAttribute('href', '/api/v1/documents/bail/revisions/0/file');
	});

	it('enregistre les métadonnées modifiées', async () => {
		const fetchMock = mockFetch({
			'GET /api/auth/me': SESSION,
			'GET /api/v1/documents/bail': ok(BAIL),
			'PATCH /api/v1/documents/bail': (options) =>
				ok({
					...BAIL,
					...JSON.parse(options.body),
					updatedAt: '2026-03-02T10:00:00.000Z',
				}),
		});
		renderWithProviders(<App />, { route: '/documents/bail' });
		const title = await screen.findByLabelText('Titre');
		await userEvent.clear(title);
		await userEvent.type(title, 'Bail signé');
		await userEvent.type(screen.getByLabelText('Sujet'), 'Logement');
		await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

		expect(await screen.findByText('Enregistré.')).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Bail signé' }),
		).toBeInTheDocument();
		const patch = fetchMock.mock.calls.find(
			([, options]) => options?.method === 'PATCH',
		);
		expect(JSON.parse(patch[1].body)).toEqual({
			title: 'Bail signé',
			author: 'Agence Dupont',
			subject: 'Logement',
		});
	});

	it('affiche l’erreur du serveur', async () => {
		mockFetch({
			'GET /api/auth/me': SESSION,
			'GET /api/v1/documents/bail': ok(BAIL),
			'PATCH /api/v1/documents/bail': {
				status: 400,
				body: { success: false, error: 'Le champ « title » est requis' },
			},
		});
		renderWithProviders(<App />, { route: '/documents/bail' });
		await userEvent.click(
			await screen.findByRole('button', { name: 'Enregistrer' }),
		);
		expect(
			await screen.findByText('Le champ « title » est requis'),
		).toBeInTheDocument();
	});

	it('supprime après confirmation et revient à la bibliothèque', async () => {
		const fetchMock = mockFetch({
			'GET /api/auth/me': SESSION,
			'GET /api/v1/documents/bail': ok(BAIL),
			'DELETE /api/v1/documents/bail': ok(null),
			'GET /api/v1/documents': {
				status: 200,
				body: { success: true, count: 0, data: [] },
			},
		});
		renderWithProviders(<App />, { route: '/documents/bail' });
		await userEvent.click(
			await screen.findByRole('button', { name: 'Supprimer' }),
		);
		const dialog = screen.getByRole('dialog', {
			name: 'Supprimer ce document ?',
		});
		expect(dialog).toHaveTextContent('« Contrat de bail » sera supprimé');
		await userEvent.click(
			screen.getByRole('button', { name: 'Supprimer définitivement' }),
		);
		expect(
			await screen.findByText(/Votre bibliothèque est vide/),
		).toBeInTheDocument();
		expect(
			fetchMock.mock.calls.some(
				([url, options]) =>
					url === '/api/v1/documents/bail' && options?.method === 'DELETE',
			),
		).toBe(true);
	});

	it('signale un document qui n’existe pas', async () => {
		mockFetch({ 'GET /api/auth/me': SESSION });
		renderWithProviders(<App />, { route: '/documents/inconnu' });
		expect(
			await screen.findByText('Ce document n’existe pas ou a été supprimé.'),
		).toBeInTheDocument();
	});
});

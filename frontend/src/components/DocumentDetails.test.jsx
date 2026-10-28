import { screen, waitFor, within } from '@testing-library/react';
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
	tags: [],
	collectionIds: [],
};

function ok(data, status = 200) {
	return { status, body: { success: true, data } };
}

const ORIGINAL = {
	number: 0,
	size: 3 * 1024 * 1024,
	origin: 'upload',
	restoredFrom: null,
	note: null,
	createdAt: '2026-03-01T10:00:00.000Z',
	identicalToCurrent: true,
};

// Session ouverte, bibliothèque, collections et historique minimaux.
const BASE_ROUTES = {
	'GET /api/auth/me': SESSION,
	'GET /api/v1/documents': ok([BAIL]),
	'GET /api/v1/collections': ok([]),
	'GET /api/v1/documents/bail/revisions': ok([ORIGINAL]),
};

// La fiche est le panneau « Informations » de la visionneuse : on l'ouvre.
// Le PDF lui-même n'est pas servi (404) : la visionneuse affiche son
// erreur, le panneau fonctionne quand même.
async function openDetails() {
	renderWithProviders(<App />, { route: '/documents/bail' });
	await userEvent.click(
		await screen.findByRole('button', { name: 'Informations' }),
	);
}

// Corps JSON de l'appel `method url` (le dernier).
function sentBody(fetchMock, method, url) {
	const call = fetchMock.mock.calls.findLast(
		([callUrl, options]) => callUrl === url && options?.method === method,
	);
	return call && JSON.parse(call[1].body);
}

describe('DocumentDetails (panneau Informations)', () => {
	it('montre les informations et propose le téléchargement', async () => {
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents/bail': ok(BAIL),
		});
		await openDetails();
		expect(
			await screen.findByRole('heading', { name: 'Contrat de bail', level: 2 }),
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
			...BASE_ROUTES,
			'GET /api/v1/documents/bail': ok({ ...BAIL, currentRevision: 2 }),
		});
		await openDetails();
		expect(
			await screen.findByRole('link', { name: 'Télécharger l’original' }),
		).toHaveAttribute('href', '/api/v1/documents/bail/revisions/0/file');
	});

	it('enregistre les métadonnées modifiées', async () => {
		const fetchMock = mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents/bail': ok(BAIL),
			'PATCH /api/v1/documents/bail': (options) =>
				ok({
					...BAIL,
					...JSON.parse(options.body),
					updatedAt: '2026-03-02T10:00:00.000Z',
				}),
		});
		await openDetails();
		const title = await screen.findByLabelText('Titre');
		await userEvent.clear(title);
		await userEvent.type(title, 'Bail signé');
		await userEvent.type(screen.getByLabelText('Sujet'), 'Logement');
		await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

		expect(await screen.findByText('Enregistré.')).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Bail signé', level: 2 }),
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
			...BASE_ROUTES,
			'GET /api/v1/documents/bail': ok(BAIL),
			'PATCH /api/v1/documents/bail': {
				status: 400,
				body: { success: false, error: 'Le champ « title » est requis' },
			},
		});
		await openDetails();
		await userEvent.click(
			await screen.findByRole('button', { name: 'Enregistrer' }),
		);
		expect(
			await screen.findByText('Le champ « title » est requis'),
		).toBeInTheDocument();
	});

	it('supprime après confirmation et revient à la bibliothèque', async () => {
		const fetchMock = mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents/bail': ok(BAIL),
			'DELETE /api/v1/documents/bail': ok(null),
			'GET /api/v1/documents': {
				status: 200,
				body: { success: true, count: 0, data: [] },
			},
		});
		await openDetails();
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

	it('range le document dans des collections et lui ajoute des étiquettes', async () => {
		let current = { ...BAIL, tags: ['bail'] };
		const fetchMock = mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': ok([
				current,
				{ ...BAIL, id: 'autre', tags: ['logement'] },
			]),
			'GET /api/v1/collections': ok([
				{ id: 'impots', name: 'Impôts' },
				{ id: 'maison', name: 'Maison' },
			]),
			'GET /api/v1/documents/bail': () => ok(current),
			'PUT /api/v1/documents/bail/collections': (options) => {
				current = { ...current, ...JSON.parse(options.body) };
				return ok(current);
			},
			'PUT /api/v1/documents/bail/tags': (options) => {
				current = { ...current, ...JSON.parse(options.body) };
				return ok(current);
			},
		});
		await openDetails();

		await userEvent.click(
			await screen.findByRole('checkbox', { name: 'Maison' }),
		);
		await waitFor(() =>
			expect(screen.getByRole('checkbox', { name: 'Maison' })).toBeChecked(),
		);
		expect(
			sentBody(fetchMock, 'PUT', '/api/v1/documents/bail/collections'),
		).toEqual({ collectionIds: ['maison'] });

		const tagInput = screen.getByLabelText('Étiquettes');
		// Les étiquettes des autres documents sont suggérées.
		expect(
			document.querySelector(`#${CSS.escape(tagInput.getAttribute('list'))}`),
		).toContainHTML('value="logement"');
		await userEvent.type(tagInput, 'logement{Enter}');
		expect(
			await screen.findByRole('button', {
				name: 'Retirer l’étiquette logement',
			}),
		).toBeInTheDocument();
		expect(sentBody(fetchMock, 'PUT', '/api/v1/documents/bail/tags')).toEqual({
			tags: ['bail', 'logement'],
		});
		expect(tagInput).toHaveValue('');

		await userEvent.click(
			screen.getByRole('button', { name: 'Retirer l’étiquette bail' }),
		);
		await waitFor(() =>
			expect(
				screen.queryByRole('button', { name: 'Retirer l’étiquette bail' }),
			).not.toBeInTheDocument(),
		);
		expect(sentBody(fetchMock, 'PUT', '/api/v1/documents/bail/tags')).toEqual({
			tags: ['logement'],
		});
	});

	it('montre l’historique et fait d’une nouvelle version la révision courante', async () => {
		let current = BAIL;
		let revisions = [ORIGINAL];
		const fetchMock = mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents/bail': () => ok(current),
			'GET /api/v1/documents/bail/revisions': () => ok(revisions),
			'POST /api/v1/documents/bail/revisions': () => {
				current = { ...BAIL, currentRevision: 1 };
				revisions = [
					{
						...ORIGINAL,
						number: 1,
						createdAt: '2026-03-02T10:00:00.000Z',
					},
					{ ...ORIGINAL, identicalToCurrent: false },
				];
				return ok(current, 201);
			},
		});
		await openDetails();
		const history = (
			await screen.findByRole('heading', { name: 'Historique' })
		).closest('section');
		expect(await within(history).findByText('Original')).toBeInTheDocument();
		expect(history).toHaveTextContent('version courante');
		// Ni restauration ni suppression de la version courante.
		expect(
			within(history).queryByRole('button', { name: /Restaurer|Supprimer/ }),
		).not.toBeInTheDocument();

		await userEvent.upload(
			history.querySelector('input[type="file"]'),
			new File(['%PDF-1.7'], 'signe.pdf', { type: 'application/pdf' }),
		);
		expect(
			await within(history).findByText(
				'Révision 1 enregistrée : c’est la version courante.',
			),
		).toBeInTheDocument();
		expect(
			await within(history).findByRole('link', {
				name: 'Télécharger : Révision 1',
			}),
		).toHaveAttribute('href', '/api/v1/documents/bail/revisions/1/file');
		expect(
			within(history).getByRole('button', { name: 'Restaurer : Original' }),
		).toBeEnabled();
		const upload = fetchMock.mock.calls.find(
			([url, options]) =>
				url === '/api/v1/documents/bail/revisions' &&
				options?.method === 'POST',
		);
		expect(upload[1].body.get('file').name).toBe('signe.pdf');
	});

	it('affiche le refus d’une version déjà présente', async () => {
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents/bail': ok(BAIL),
			'POST /api/v1/documents/bail/revisions': {
				status: 409,
				body: {
					success: false,
					error: 'Ce PDF est déjà la version courante',
					data: { revision: 0 },
				},
			},
		});
		await openDetails();
		const history = (
			await screen.findByRole('heading', { name: 'Historique' })
		).closest('section');
		await userEvent.upload(
			history.querySelector('input[type="file"]'),
			new File(['%PDF-1.7'], 'meme.pdf', { type: 'application/pdf' }),
		);
		expect(
			await within(history).findByText('Ce PDF est déjà la version courante'),
		).toBeInTheDocument();
	});

	it('restaure une révision et en supprime une après confirmation', async () => {
		const REVISION_1 = { ...ORIGINAL, number: 1, identicalToCurrent: false };
		const REVISION_2 = { ...ORIGINAL, number: 2 };
		let current = { ...BAIL, currentRevision: 2 };
		let revisions = [
			REVISION_2,
			REVISION_1,
			{ ...ORIGINAL, identicalToCurrent: false },
		];
		const fetchMock = mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents/bail': () => ok(current),
			'GET /api/v1/documents/bail/revisions': () => ok(revisions),
			'POST /api/v1/documents/bail/revisions/0/restore': () => {
				current = { ...BAIL, currentRevision: 3 };
				revisions = [
					{ ...ORIGINAL, number: 3, origin: 'restore', restoredFrom: 0 },
					{ ...REVISION_2, identicalToCurrent: false },
					REVISION_1,
					ORIGINAL,
				];
				return ok(current, 201);
			},
			'DELETE /api/v1/documents/bail/revisions/1': ok(null),
		});
		await openDetails();
		const history = (
			await screen.findByRole('heading', { name: 'Historique' })
		).closest('section');

		await userEvent.click(
			await within(history).findByRole('button', {
				name: 'Restaurer : Original',
			}),
		);
		expect(
			await within(history).findByText(/restauration de l’original/),
		).toBeInTheDocument();
		expect(
			within(history).getByText(
				'Révision 3 enregistrée : c’est la version courante.',
			),
		).toBeInTheDocument();

		await userEvent.click(
			within(history).getByRole('button', { name: 'Supprimer : Révision 1' }),
		);
		const dialog = screen.getByRole('dialog', {
			name: 'Supprimer cette révision ?',
		});
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Supprimer la révision' }),
		);
		expect(
			await within(history).findByText('Révision supprimée.'),
		).toBeInTheDocument();
		expect(within(history).queryByText('Révision 1')).not.toBeInTheDocument();
		expect(
			fetchMock.mock.calls.some(
				([url, options]) =>
					url === '/api/v1/documents/bail/revisions/1' &&
					options?.method === 'DELETE',
			),
		).toBe(true);
	});
});

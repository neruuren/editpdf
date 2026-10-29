import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { mockFetch, renderWithProviders } from '../testUtils';

const SESSION = {
	status: 200,
	body: { success: true, data: { username: 'owner' } },
};

function doc(overrides) {
	return {
		author: null,
		subject: null,
		pageCount: 2,
		isEncrypted: false,
		originalName: 'x.pdf',
		currentRevision: 0,
		fileSize: 2048,
		hasThumbnail: true,
		addedAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		lastOpenedAt: null,
		tags: [],
		collectionIds: [],
		...overrides,
	};
}

const BAIL = doc({
	id: 'bail',
	title: 'Contrat de bail',
	author: 'Agence Dupont',
	addedAt: '2026-03-01T00:00:00.000Z',
});
const IMPOTS = doc({
	id: 'impots',
	title: 'Impôts 2026',
	isEncrypted: true,
	hasThumbnail: false,
});

function listResponse(documents) {
	return {
		status: 200,
		body: { success: true, count: documents.length, data: documents },
	};
}

// Session ouverte, aucune collection, recherche dans le contenu sans résultat.
const BASE_ROUTES = {
	'GET /api/auth/me': SESSION,
	'GET /api/v1/collections': listResponse([]),
	'GET /api/v1/search': listResponse([]),
};

function pdfFile(name) {
	return new File(['%PDF-1.7'], name, { type: 'application/pdf' });
}

// L'input est caché (hidden) : userEvent.upload le vise directement.
function fileInput() {
	return document.querySelector('input[type="file"]');
}

describe('LibraryPage', () => {
	it('invite à importer quand la bibliothèque est vide', async () => {
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([]),
		});
		renderWithProviders(<App />, { route: '/' });
		expect(
			await screen.findByText(/Votre bibliothèque est vide/),
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Importer des PDF' }),
		).toBeEnabled();
		// Ni filtre ni tri sans document.
		expect(screen.queryByLabelText('Rechercher')).not.toBeInTheDocument();
	});

	it('affiche les documents en grille, vignette ou cadenas', async () => {
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([BAIL, IMPOTS]),
		});
		renderWithProviders(<App />, { route: '/' });
		const bail = await screen.findByRole('link', { name: 'Contrat de bail' });
		expect(bail).toHaveAttribute('href', '/documents/bail');
		expect(bail.closest('li').querySelector('img')).toHaveAttribute(
			'src',
			'/api/v1/documents/bail/thumbnail?v=0',
		);
		const impots = screen
			.getByRole('link', { name: 'Impôts 2026' })
			.closest('li');
		expect(impots).toHaveTextContent('protégé');
		expect(impots.querySelector('img')).toBeNull();
		expect(
			screen.getByRole('heading', { name: 'Bibliothèque (2)' }),
		).toBeInTheDocument();
	});

	it('filtre sans tenir compte des accents', async () => {
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([BAIL, IMPOTS]),
		});
		renderWithProviders(<App />, { route: '/' });
		await userEvent.type(await screen.findByLabelText('Rechercher'), 'impots');
		expect(screen.getByRole('link', { name: /Impôts 2026/ })).toBeVisible();
		expect(
			screen.queryByRole('link', { name: /Contrat de bail/ }),
		).not.toBeInTheDocument();

		await userEvent.clear(screen.getByLabelText('Rechercher'));
		await userEvent.type(screen.getByLabelText('Rechercher'), 'zzz');
		// Après la recherche dans le contenu (sans résultat).
		expect(
			await screen.findByText('Aucun document ne correspond à « zzz ».'),
		).toBeInTheDocument();
	});

	it('passe en liste et s’en souvient sur l’appareil', async () => {
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([BAIL, IMPOTS]),
		});
		const { unmount } = renderWithProviders(<App />, { route: '/' });
		await userEvent.click(await screen.findByRole('button', { name: 'Liste' }));
		expect(screen.getByRole('button', { name: 'Liste' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		const table = screen.getByRole('table');
		expect(within(table).getByText('Agence Dupont')).toBeInTheDocument();
		unmount();

		renderWithProviders(<App />, { route: '/' });
		expect(await screen.findByRole('table')).toBeInTheDocument();
	});

	it('trie selon le choix et s’en souvient', async () => {
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([BAIL, IMPOTS]),
		});
		renderWithProviders(<App />, { route: '/' });
		await screen.findByRole('link', { name: /Contrat de bail/ });
		await userEvent.selectOptions(screen.getByLabelText('Trier par'), 'title');
		const titles = screen
			.getAllByRole('link', { name: /Contrat|Impôts/ })
			.map((link) => link.textContent);
		expect(titles[0]).toMatch(/Contrat de bail/);
		expect(localStorage.getItem('editpdf-library-sort')).toBe('title');
	});

	it('importe plusieurs PDF un par un et rend compte des échecs', async () => {
		const NEW = doc({ id: 'new', title: 'Nouveau' });
		let uploads = 0;
		const fetchMock = mockFetch({
			...BASE_ROUTES,
			// Relue après l'import : le nouveau document y est.
			'GET /api/v1/documents': () =>
				listResponse(uploads > 0 ? [NEW, BAIL] : [BAIL]),
			'POST /api/v1/documents': () => {
				uploads += 1;
				return uploads === 1
					? { status: 201, body: { success: true, data: NEW } }
					: {
							status: 409,
							body: {
								success: false,
								error: 'Ce PDF est déjà dans la bibliothèque',
								data: { documentId: 'bail' },
							},
						};
			},
		});
		renderWithProviders(<App />, { route: '/' });
		await screen.findByRole('link', { name: /Contrat de bail/ });

		await userEvent.upload(
			fileInput(),
			[pdfFile('nouveau.pdf'), pdfFile('copie.pdf'), pdfFile('notes.txt')],
			{ applyAccept: false },
		);

		expect(await screen.findByText('1 document importé.')).toBeInTheDocument();
		expect(
			screen.getByText(/copie\.pdf : Ce PDF est déjà dans la bibliothèque/),
		).toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'Voir le document' }),
		).toHaveAttribute('href', '/documents/bail');
		expect(
			screen.getByText('notes.txt : Ce n’est pas un fichier PDF'),
		).toBeInTheDocument();
		// Le fichier qui n'est pas un PDF n'est jamais envoyé.
		const posts = fetchMock.mock.calls.filter(
			([, options]) => options?.method === 'POST',
		);
		expect(posts).toHaveLength(2);
		await waitFor(() =>
			expect(screen.getByRole('link', { name: /Nouveau/ })).toBeVisible(),
		);

		await userEvent.click(
			screen.getByRole('button', {
				name: 'Fermer le compte rendu de l’import',
			}),
		);
		expect(screen.queryByText('1 document importé.')).not.toBeInTheDocument();
	});

	it('trouve aussi un document par son contenu, avec un extrait surligné', async () => {
		const fetchMock = mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([BAIL, IMPOTS]),
			'GET /api/v1/search': (_options, url) =>
				listResponse(
					url.searchParams.get('q') === 'loyer'
						? [
								{
									documentId: 'bail',
									page: 3,
									pageCount: 2,
									snippet: 'Le \u0002loyer\u0003 est payable',
								},
							]
						: [],
				),
		});
		renderWithProviders(<App />, { route: '/' });
		await userEvent.type(await screen.findByLabelText('Rechercher'), 'loyer');

		const bail = await screen.findByRole('link', { name: 'Contrat de bail' });
		const card = bail.closest('li');
		expect(card).toHaveTextContent('Page 3 et 1 autre : Le loyer est payable');
		expect(within(card).getByText('loyer', { selector: 'mark' })).toBeVisible();
		expect(
			screen.queryByRole('link', { name: 'Impôts 2026' }),
		).not.toBeInTheDocument();
		// Une seule requête une fois la frappe calmée, pas une par lettre.
		const searches = fetchMock.mock.calls.filter(([url]) =>
			url.startsWith('/api/v1/search'),
		);
		expect(searches.map(([url]) => url)).toEqual(['/api/v1/search?q=loyer']);
	});

	it('filtre par collection et par étiquettes (toutes requises)', async () => {
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/collections': listResponse([
				{ id: 'logement', name: 'Logement' },
			]),
			'GET /api/v1/documents': listResponse([
				{ ...BAIL, tags: ['2026', 'contrat'], collectionIds: ['logement'] },
				{ ...IMPOTS, tags: ['2026'] },
			]),
		});
		renderWithProviders(<App />, { route: '/' });
		await screen.findByRole('link', { name: 'Contrat de bail' });

		const tag2026 = screen.getByRole('button', { name: '2026 2' });
		await userEvent.click(tag2026);
		expect(tag2026).toHaveAttribute('aria-pressed', 'true');
		expect(
			screen.getAllByRole('link', { name: /Contrat|Impôts/ }),
		).toHaveLength(2);
		await userEvent.click(screen.getByRole('button', { name: 'contrat 1' }));
		expect(
			screen.queryByRole('link', { name: 'Impôts 2026' }),
		).not.toBeInTheDocument();

		await userEvent.click(
			screen.getByRole('button', { name: 'Effacer les filtres' }),
		);
		expect(screen.getByRole('link', { name: 'Impôts 2026' })).toBeVisible();

		await userEvent.selectOptions(
			screen.getByLabelText('Collection'),
			'Logement (1)',
		);
		expect(
			screen.queryByRole('link', { name: 'Impôts 2026' }),
		).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Contrat de bail' })).toBeVisible();
	});

	it('reprend les filtres de l’URL et ignore ceux qui ne désignent plus rien', async () => {
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([
				{ ...BAIL, tags: ['contrat'] },
				IMPOTS,
			]),
		});
		renderWithProviders(<App />, {
			route: '/?tag=contrat&tag=disparue&collection=supprimee',
		});
		await screen.findByRole('link', { name: 'Contrat de bail' });
		expect(screen.getByRole('button', { name: 'contrat 1' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		expect(
			screen.queryByRole('link', { name: 'Impôts 2026' }),
		).not.toBeInTheDocument();
	});

	it('crée une collection depuis la bibliothèque', async () => {
		let collections = [];
		const fetchMock = mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([BAIL]),
			'GET /api/v1/collections': () => listResponse(collections),
			'POST /api/v1/collections': (options) => {
				const created = { id: 'c1', name: JSON.parse(options.body).name };
				collections = [created];
				return { status: 201, body: { success: true, data: created } };
			},
		});
		renderWithProviders(<App />, { route: '/' });
		await userEvent.click(
			await screen.findByRole('button', { name: 'Créer une collection' }),
		);
		const dialog = screen.getByRole('dialog', { name: 'Collections' });
		await userEvent.type(
			within(dialog).getByLabelText('Nom de la nouvelle collection'),
			'Impôts',
		);
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Créer' }),
		);

		expect(
			await within(dialog).findByLabelText('Nom de la collection Impôts'),
		).toHaveValue('Impôts');
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/v1/collections',
			expect.objectContaining({ method: 'POST' }),
		);
		expect(await screen.findByLabelText('Collection')).toBeInTheDocument();
	});
});

describe('LibraryPage : fusionner', () => {
	const DEVIS = doc({ id: 'devis', title: 'Devis', pageCount: 3 });

	it('sélectionne des documents, les ordonne et les fusionne', async () => {
		let body;
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([BAIL, DEVIS, IMPOTS]),
			'POST /api/v1/documents/merge': (options) => {
				body = JSON.parse(options.body);
				return {
					status: 201,
					body: {
						success: true,
						data: doc({ id: 'dossier', title: 'Dossier', pageCount: 5 }),
					},
				};
			},
		});
		renderWithProviders(<App />, { route: '/' });
		await screen.findByRole('link', { name: 'Devis' });
		expect(screen.queryByRole('checkbox')).toBeNull();
		await userEvent.click(screen.getByRole('button', { name: 'Sélectionner' }));
		const merge = screen.getByRole('button', { name: 'Fusionner…' });
		expect(merge).toBeDisabled();
		await userEvent.click(
			screen.getByRole('checkbox', { name: 'Sélectionner « Devis »' }),
		);
		await userEvent.click(
			screen.getByRole('checkbox', {
				name: 'Sélectionner « Contrat de bail »',
			}),
		);
		expect(screen.getByText('2 documents sélectionnés')).toBeInTheDocument();
		await userEvent.click(merge);
		const dialog = screen.getByRole('dialog', {
			name: 'Fusionner des documents',
		});
		await userEvent.click(
			within(dialog).getByRole('button', {
				name: 'Monter « Contrat de bail »',
			}),
		);
		const title = within(dialog).getByRole('textbox', {
			name: 'Titre du nouveau document',
		});
		await userEvent.clear(title);
		await userEvent.type(title, 'Dossier');
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Fusionner' }),
		);
		expect(
			await within(dialog).findByRole('link', { name: 'Dossier' }),
		).toHaveAttribute('href', '/documents/dossier');
		expect(body).toEqual({ documentIds: ['bail', 'devis'], title: 'Dossier' });
		// La sélection est terminée.
		expect(screen.queryByRole('button', { name: 'Fusionner…' })).toBeNull();
	});

	it('refuse un document protégé par mot de passe', async () => {
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([BAIL, IMPOTS]),
		});
		renderWithProviders(<App />, { route: '/' });
		await screen.findByRole('link', { name: 'Impôts 2026' });
		await userEvent.click(screen.getByRole('button', { name: 'Sélectionner' }));
		await userEvent.click(
			screen.getByRole('checkbox', { name: 'Sélectionner « Impôts 2026 »' }),
		);
		await userEvent.click(
			screen.getByRole('checkbox', {
				name: 'Sélectionner « Contrat de bail »',
			}),
		);
		await userEvent.click(screen.getByRole('button', { name: 'Fusionner…' }));
		const dialog = screen.getByRole('dialog', {
			name: 'Fusionner des documents',
		});
		expect(within(dialog).getByText(/ne se fusionne pas/)).toBeInTheDocument();
		expect(
			within(dialog).getByRole('button', { name: 'Fusionner' }),
		).toBeDisabled();
	});
});

describe('LibraryPage : numérotation Bates', () => {
	const DEVIS = doc({ id: 'devis', title: 'Devis', pageCount: 3 });

	it('numérote les pages des documents choisis, à la suite', async () => {
		let body;
		mockFetch({
			...BASE_ROUTES,
			'GET /api/v1/documents': listResponse([BAIL, DEVIS]),
			'POST /api/v1/documents/bates': (options) => {
				body = JSON.parse(options.body);
				return {
					status: 200,
					body: {
						success: true,
						data: {
							documents: [
								{ ...DEVIS, currentRevision: 1 },
								{ ...BAIL, currentRevision: 1 },
							],
							first: 100,
							last: 100 + DEVIS.pageCount + BAIL.pageCount - 1,
						},
					},
				};
			},
		});
		renderWithProviders(<App />, { route: '/' });
		await screen.findByRole('link', { name: 'Devis' });
		await userEvent.click(screen.getByRole('button', { name: 'Sélectionner' }));
		await userEvent.click(
			screen.getByRole('checkbox', { name: 'Sélectionner « Devis »' }),
		);
		await userEvent.click(
			screen.getByRole('checkbox', {
				name: 'Sélectionner « Contrat de bail »',
			}),
		);
		await userEvent.click(
			screen.getByRole('button', { name: 'Numéroter (Bates)…' }),
		);
		const dialog = screen.getByRole('dialog', { name: 'Numérotation Bates' });
		await userEvent.type(
			within(dialog).getByRole('textbox', { name: 'Préfixe' }),
			'DOS-',
		);
		const start = within(dialog).getByRole('spinbutton', {
			name: 'Premier numéro',
		});
		await userEvent.clear(start);
		await userEvent.type(start, '100');
		expect(within(dialog).getByText('DOS-000100')).toBeInTheDocument();
		await userEvent.selectOptions(
			within(dialog).getByRole('combobox', { name: 'Emplacement' }),
			'topRight',
		);
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Numéroter' }),
		);
		expect(
			await within(dialog).findByText(/Pages numérotées de DOS-000100 à/),
		).toBeInTheDocument();
		expect(body).toEqual({
			documentIds: ['devis', 'bail'],
			prefix: 'DOS-',
			suffix: '',
			start: 100,
			digits: 6,
			slot: 'topRight',
			fontSize: 9,
		});
		expect(within(dialog).getByRole('link', { name: 'Devis' })).toHaveAttribute(
			'href',
			'/documents/devis',
		);
	});
});

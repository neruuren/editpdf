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
			'GET /api/auth/me': SESSION,
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
		expect(screen.queryByLabelText('Filtrer')).not.toBeInTheDocument();
	});

	it('affiche les documents en grille, vignette ou cadenas', async () => {
		mockFetch({
			'GET /api/auth/me': SESSION,
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
			'GET /api/auth/me': SESSION,
			'GET /api/v1/documents': listResponse([BAIL, IMPOTS]),
		});
		renderWithProviders(<App />, { route: '/' });
		await userEvent.type(await screen.findByLabelText('Filtrer'), 'impots');
		expect(screen.getByRole('link', { name: /Impôts 2026/ })).toBeVisible();
		expect(
			screen.queryByRole('link', { name: /Contrat de bail/ }),
		).not.toBeInTheDocument();

		await userEvent.clear(screen.getByLabelText('Filtrer'));
		await userEvent.type(screen.getByLabelText('Filtrer'), 'zzz');
		expect(
			screen.getByText('Aucun document ne correspond à « zzz ».'),
		).toBeInTheDocument();
	});

	it('passe en liste et s’en souvient sur l’appareil', async () => {
		mockFetch({
			'GET /api/auth/me': SESSION,
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
			'GET /api/auth/me': SESSION,
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
			'GET /api/auth/me': SESSION,
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
});

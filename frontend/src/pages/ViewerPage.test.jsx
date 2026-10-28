import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../App';
import { mockFetch, renderWithProviders } from '../testUtils';
import { clearDocumentFileCache } from '../utils/documentFileCache';
import { openPdf } from '../utils/pdfEngine';

// Le moteur PDF (worker + WASM) n'existe pas sous jsdom : il est simulé.
// Le vrai rendu est testé dans workers/pdfRenderer.test.js.
vi.mock('../utils/pdfEngine', () => ({ openPdf: vi.fn() }));

const SESSION = {
	status: 200,
	body: { success: true, data: { username: 'owner' } },
};

const RAPPORT = {
	id: 'rapport',
	title: 'Rapport annuel',
	author: null,
	subject: null,
	pageCount: 3,
	isEncrypted: false,
	originalName: 'rapport.pdf',
	currentRevision: 0,
	fileSize: 4096,
	hasThumbnail: true,
	addedAt: '2026-03-01T10:00:00.000Z',
	updatedAt: '2026-03-01T10:00:00.000Z',
	lastOpenedAt: null,
	lastPage: 2,
	tags: [],
	collectionIds: [],
};

function ok(data, status = 200) {
	return { status, body: { success: true, data } };
}

function fakePdf() {
	return {
		pageCount: 3,
		needsPassword: false,
		pages: [
			{ width: 595, height: 842 },
			{ width: 595, height: 842 },
			{ width: 842, height: 595 },
		],
		outline: [
			{
				title: 'Introduction',
				page: 0,
				children: [{ title: 'Contexte', page: 1, children: [] }],
			},
			{ title: 'Site web', page: null, children: [] },
		],
		renderPage: vi.fn(async () => ({
			width: 10,
			height: 10,
			bitmap: { close: vi.fn() },
		})),
		getTextLayer: vi.fn(async (index) => [
			{
				text: `Texte de la page ${index + 1}`,
				x: 72,
				y: 72,
				width: 200,
				height: 20,
				angle: 0,
			},
		]),
		// « rapport » sur les pages 1 et 3.
		searchPages: vi.fn(async (from) =>
			from === 0
				? [
						{
							index: 0,
							hits: [
								{
									rects: [[72, 72, 150, 92]],
									before: 'Le ',
									match: 'rapport',
									after: ' annuel',
								},
							],
						},
						{
							index: 2,
							hits: [
								{
									rects: [[72, 300, 150, 320]],
									before: 'Annexe du ',
									match: 'rapport',
									after: '',
								},
							],
						},
					]
				: [],
		),
		renderPageJpeg: vi.fn(async () => new Uint8Array([0xff, 0xd8])),
		unlock: vi.fn(async () => null),
		close: vi.fn(async () => null),
	};
}

function routes(document = RAPPORT, extra = {}) {
	return {
		'GET /api/auth/me': SESSION,
		'GET /api/v1/documents': ok([document]),
		'GET /api/v1/collections': ok([]),
		[`GET /api/v1/documents/${document.id}`]: ok(document),
		[`GET /api/v1/documents/${document.id}/revisions`]: ok([]),
		[`GET /api/v1/documents/${document.id}/file`]: { status: 200, body: null },
		[`PUT /api/v1/documents/${document.id}/reading`]: (options) =>
			ok({ ...document, lastPage: JSON.parse(options.body).page }),
		[`GET /api/v1/documents/${document.id}/bookmarks`]: ok([]),
		...extra,
	};
}

beforeEach(() => {
	clearDocumentFileCache();
	openPdf.mockReset();
	// jsdom ne dessine pas : un contexte 2d factice suffit.
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		drawImage: vi.fn(),
	});
});

async function openViewer(document = RAPPORT, extra) {
	const pdf = fakePdf();
	openPdf.mockResolvedValue(pdf);
	const fetchMock = mockFetch(routes(document, extra));
	renderWithProviders(<App />, { route: `/documents/${document.id}` });
	await screen.findByLabelText('Pages du document');
	return { pdf, fetchMock };
}

describe('ViewerPage', () => {
	it('ouvre le document à la dernière page lue et enregistre l’ouverture', async () => {
		const { pdf, fetchMock } = await openViewer();
		expect(
			screen.getByRole('heading', { level: 1, name: 'Rapport annuel' }),
		).toBeInTheDocument();
		expect(screen.getByLabelText('Page')).toHaveValue('2');
		expect(screen.getByText('/ 3')).toBeInTheDocument();
		expect(
			screen.getAllByRole('group', { name: /^Page \d sur 3$/ }).length,
		).toBeGreaterThan(0);
		await waitFor(() => expect(pdf.renderPage).toHaveBeenCalled());

		const reading = fetchMock.mock.calls.find(([url]) =>
			url.endsWith('/reading'),
		);
		expect(reading[1]).toMatchObject({ method: 'PUT' });
		expect(JSON.parse(reading[1].body)).toEqual({ page: 2 });
	});

	it('change le zoom et le mémorise sur l’appareil', async () => {
		await openViewer();
		const zoom = screen.getByLabelText('Zoom', { selector: 'select' });
		expect(zoom).toHaveValue('width');

		await userEvent.selectOptions(zoom, '150 %');
		expect(zoom).toHaveValue('1.5');
		expect(JSON.parse(localStorage.getItem('editpdf-viewer-zoom'))).toEqual({
			rapport: 1.5,
		});

		await userEvent.click(screen.getByRole('button', { name: 'Zoom avant' }));
		expect(zoom).toHaveValue('2');
		await userEvent.keyboard('-');
		expect(zoom).toHaveValue('1.5');
		await userEvent.keyboard('0');
		expect(zoom).toHaveValue('width');
	});

	it('reprend le zoom mémorisé pour ce document', async () => {
		localStorage.setItem(
			'editpdf-viewer-zoom',
			JSON.stringify({ rapport: 'page' }),
		);
		await openViewer();
		expect(screen.getByLabelText('Zoom', { selector: 'select' })).toHaveValue(
			'page',
		);
	});

	it('ouvre le sommaire et les miniatures dans le panneau de navigation', async () => {
		await openViewer();
		await userEvent.click(screen.getByRole('button', { name: /Navigation/ }));
		const nav = screen.getByRole('navigation', {
			name: 'Navigation dans le document',
		});
		// Le sommaire d'abord quand le PDF en a un.
		expect(
			within(nav).getByRole('button', { name: 'Sommaire' }),
		).toHaveAttribute('aria-pressed', 'true');
		expect(
			within(nav).getByRole('button', { name: /Contexte/ }),
		).toBeInTheDocument();
		// Entrée sans page : du texte, pas un bouton.
		expect(within(nav).getByText('Site web').tagName).toBe('SPAN');

		await userEvent.click(
			within(nav).getByRole('button', { name: 'Miniatures' }),
		);
		expect(
			within(nav).getAllByRole('button', { name: /^Page \d$/ }),
		).toHaveLength(3);
	});

	it('affiche la fiche dans le panneau Informations, fermé par Échap', async () => {
		await openViewer();
		const toggle = screen.getByRole('button', { name: 'Informations' });
		await userEvent.click(toggle);
		const panel = screen.getByRole('complementary', { name: 'Informations' });
		expect(
			within(panel).getByRole('heading', { level: 2, name: 'Rapport annuel' }),
		).toBeInTheDocument();
		expect(toggle).toHaveAttribute('aria-pressed', 'true');

		await userEvent.keyboard('{Escape}');
		expect(
			screen.queryByRole('complementary', { name: 'Informations' }),
		).not.toBeInTheDocument();
	});

	it('désactive « page précédente » sur la première page', async () => {
		await openViewer({ ...RAPPORT, lastPage: null });
		expect(screen.getByLabelText('Page')).toHaveValue('1');
		expect(
			screen.getByRole('button', { name: 'Page précédente' }),
		).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Page suivante' })).toBeEnabled();
	});

	it('demande le mot de passe d’un PDF protégé et le garde pour la session', async () => {
		const locked = { ...fakePdf(), needsPassword: true, pages: [] };
		const unlocked = fakePdf();
		locked.unlock.mockImplementation(async (password) =>
			password === 'secret' ? unlocked : null,
		);
		openPdf.mockResolvedValue(locked);
		const secret = { ...RAPPORT, id: 'secret', isEncrypted: true };
		mockFetch(routes(secret));
		const { unmount } = renderWithProviders(<App />, {
			route: '/documents/secret',
		});

		const input = await screen.findByLabelText('Mot de passe du PDF');
		await userEvent.type(input, 'faux');
		await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Mot de passe incorrect.',
		);

		await userEvent.clear(input);
		await userEvent.type(input, 'secret');
		await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
		expect(
			await screen.findByLabelText('Pages du document'),
		).toBeInTheDocument();
		expect(locked.unlock).toHaveBeenLastCalledWith('secret');
		unmount();

		// Rouvert dans la même session : le mot de passe n'est pas redemandé.
		locked.unlock.mockClear();
		renderWithProviders(<App />, { route: '/documents/secret' });
		expect(
			await screen.findByLabelText('Pages du document'),
		).toBeInTheDocument();
		expect(locked.unlock).toHaveBeenCalledWith('secret');
		expect(screen.queryByLabelText('Mot de passe du PDF')).toBeNull();
	});

	it('pose le texte de la page sur son rendu, sélectionnable', async () => {
		const { pdf } = await openViewer({ ...RAPPORT, lastPage: null });
		const page = screen.getByRole('group', { name: 'Page 1 sur 3' });
		expect(await within(page).findByText('Texte de la page 1')).toBeVisible();
		expect(pdf.getTextLayer).toHaveBeenCalledWith(0, expect.anything());
	});

	it('cherche dans le document (Ctrl + F), surligne et parcourt les résultats', async () => {
		const { pdf } = await openViewer({ ...RAPPORT, lastPage: null });
		await userEvent.keyboard('{Control>}f{/Control}');
		const input = screen.getByLabelText('Rechercher dans le document', {
			selector: 'input',
		});
		expect(input).toHaveFocus();

		await userEvent.type(input, 'rapport');
		expect(await screen.findByText('1 / 2')).toBeInTheDocument();
		expect(pdf.searchPages).toHaveBeenCalledWith(
			0,
			expect.any(Number),
			'rapport',
			expect.anything(),
		);
		await userEvent.keyboard('{Enter}');
		expect(screen.getByText('2 / 2')).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole('button', { name: 'Résultat suivant' }),
		);
		expect(screen.getByText('1 / 2')).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: /Navigation/ }));
		await userEvent.click(screen.getByRole('button', { name: 'Résultats' }));
		const results = screen.getAllByRole('button', { name: /^Page \d[A-Z]/ });
		expect(results).toHaveLength(2);
		expect(results[0]).toHaveTextContent('Page 1Le rapport annuel');
		expect(results[0]).toHaveAttribute('aria-current', 'true');
		await userEvent.click(results[1]);
		expect(screen.getByText('2 / 2')).toBeInTheDocument();

		await userEvent.click(input);
		await userEvent.keyboard('{Escape}');
		expect(
			screen.queryByLabelText('Rechercher dans le document', {
				selector: 'input',
			}),
		).toBeNull();
		expect(screen.queryByRole('button', { name: 'Résultats' })).toBeNull();
	});

	it('pose, renomme et retire un signet', async () => {
		const { fetchMock } = await openViewer(RAPPORT, {
			'PUT /api/v1/documents/rapport/bookmarks/2': (options) =>
				ok(
					{
						page: 2,
						label: JSON.parse(options.body).label,
						createdAt: '2026-10-28T10:00:00.000Z',
					},
					201,
				),
			'DELETE /api/v1/documents/rapport/bookmarks/2': ok(null),
		});
		const toggle = screen.getByRole('button', {
			name: 'Signet sur cette page',
		});
		expect(toggle).toHaveAttribute('aria-pressed', 'false');
		await userEvent.click(toggle);
		await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));

		await userEvent.click(screen.getByRole('button', { name: /Navigation/ }));
		await userEvent.click(screen.getByRole('button', { name: 'Signets' }));
		// Sans libellé : le titre du sommaire qui mène à la page 2.
		expect(
			screen.getByRole('button', { name: /^Contexte/ }),
		).toBeInTheDocument();

		await userEvent.click(
			screen.getByRole('button', { name: 'Renommer le signet « Contexte »' }),
		);
		const label = screen.getByLabelText('Libellé du signet de la page 2');
		await userEvent.type(label, 'Chiffres clés');
		await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
		expect(
			await screen.findByRole('button', { name: /^Chiffres clés/ }),
		).toBeInTheDocument();
		const rename = fetchMock.mock.calls.findLast(([url]) =>
			url.endsWith('/bookmarks/2'),
		);
		expect(JSON.parse(rename[1].body)).toEqual({ label: 'Chiffres clés' });

		await userEvent.click(
			screen.getByRole('button', {
				name: 'Retirer le signet « Chiffres clés »',
			}),
		);
		expect(await screen.findByText(/Aucun signet/)).toBeInTheDocument();
		expect(toggle).toHaveAttribute('aria-pressed', 'false');
	});

	it('présente le document page par page', async () => {
		await openViewer();
		await userEvent.click(
			screen.getByRole('button', { name: 'Présenter', hidden: true }),
		);
		const presentation = screen.getByRole('dialog', { name: 'Présentation' });
		expect(within(presentation).getByText('2 / 3')).toBeInTheDocument();
		await userEvent.keyboard('{ArrowRight}');
		expect(within(presentation).getByText('3 / 3')).toBeInTheDocument();
		await userEvent.keyboard('{ArrowRight}');
		expect(within(presentation).getByText('3 / 3')).toBeInTheDocument();
		await userEvent.keyboard('{Escape}');
		expect(screen.queryByRole('dialog', { name: 'Présentation' })).toBeNull();
	});

	it('imprime la page affichée, rendue par le moteur', async () => {
		const print = vi.spyOn(window, 'print').mockImplementation(() => {});
		URL.createObjectURL = vi.fn(() => 'blob:page');
		URL.revokeObjectURL = vi.fn();
		const { pdf } = await openViewer();
		await userEvent.click(
			screen.getByRole('button', { name: 'Imprimer…', hidden: true }),
		);
		const dialog = screen.getByRole('dialog', { name: 'Imprimer' });

		await userEvent.click(within(dialog).getByLabelText('Pages'));
		await userEvent.clear(within(dialog).getByLabelText('Première page'));
		await userEvent.type(within(dialog).getByLabelText('Première page'), '3');
		await userEvent.clear(within(dialog).getByLabelText('Dernière page'));
		await userEvent.type(within(dialog).getByLabelText('Dernière page'), '2');
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Imprimer' }),
		);
		expect(within(dialog).getByRole('alert')).toHaveTextContent(
			'Choisissez des pages entre 1 et 3.',
		);

		await userEvent.click(within(dialog).getByLabelText('Page affichée (2)'));
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Imprimer' }),
		);
		// jsdom ne charge pas les images : on signale la page chargée.
		const image = await waitFor(() => {
			const node = document.querySelector('.print-pages img');
			expect(node).not.toBeNull();
			return node;
		});
		image.dispatchEvent(new Event('load'));
		await waitFor(() => expect(print).toHaveBeenCalled());
		expect(pdf.renderPageJpeg).toHaveBeenCalledTimes(1);
		expect(pdf.renderPageJpeg).toHaveBeenCalledWith(1, expect.anything());
		expect(document.querySelector('.print-pages img')).toHaveAttribute(
			'alt',
			'Page 2',
		);
		window.dispatchEvent(new Event('afterprint'));
		await waitFor(() =>
			expect(document.querySelector('.print-pages')).toBeNull(),
		);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page');
		print.mockRestore();
	});

	it('signale un PDF que le moteur ne peut pas ouvrir', async () => {
		openPdf.mockRejectedValue(new Error('format inconnu'));
		mockFetch(routes());
		renderWithProviders(<App />, { route: '/documents/rapport' });
		expect(
			await screen.findByText('Impossible d’ouvrir ce PDF : format inconnu'),
		).toBeInTheDocument();
	});

	it('signale un fichier introuvable sur le serveur', async () => {
		mockFetch(
			routes(RAPPORT, {
				'GET /api/v1/documents/rapport/file': {
					status: 404,
					body: { success: false, error: 'Fichier introuvable' },
				},
			}),
		);
		renderWithProviders(<App />, { route: '/documents/rapport' });
		expect(
			await screen.findByText(
				'Impossible d’ouvrir ce PDF : Fichier introuvable',
			),
		).toBeInTheDocument();
		expect(openPdf).not.toHaveBeenCalled();
	});

	it('ne monte que les pages et miniatures proches de l’écran', async () => {
		const pdf = fakePdf();
		pdf.pageCount = 5000;
		pdf.pages = Array.from({ length: 5000 }, () => ({
			width: 595,
			height: 842,
		}));
		openPdf.mockResolvedValue(pdf);
		mockFetch(routes({ ...RAPPORT, pageCount: 5000, lastPage: null }));
		renderWithProviders(<App />, { route: '/documents/rapport' });
		await screen.findByText('/ 5000');
		expect(
			screen.getAllByRole('group', { name: /sur 5000$/ }).length,
		).toBeLessThanOrEqual(24);

		await userEvent.click(screen.getByRole('button', { name: /Navigation/ }));
		await userEvent.click(screen.getByRole('button', { name: 'Miniatures' }));
		expect(
			screen.getAllByRole('button', { name: /^Page \d+$/ }).length,
		).toBeLessThan(20);
	});
});

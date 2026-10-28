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
			screen.getAllByRole('img', { name: /^Page \d sur 3$/ }).length,
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

	it('n’ouvre pas un PDF protégé et montre sa fiche', async () => {
		const locked = { ...RAPPORT, id: 'secret', isEncrypted: true };
		const fetchMock = mockFetch(routes(locked));
		renderWithProviders(<App />, { route: '/documents/secret' });
		expect(
			await screen.findByText(/protégé par un mot de passe\. Son ouverture/),
		).toBeInTheDocument();
		expect(
			screen.getByRole('complementary', { name: 'Informations' }),
		).toBeInTheDocument();
		expect(openPdf).not.toHaveBeenCalled();
		expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/file'))).toBe(
			false,
		);
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
			screen.getAllByRole('img', { name: /sur 5000$/ }).length,
		).toBeLessThanOrEqual(24);

		await userEvent.click(screen.getByRole('button', { name: /Navigation/ }));
		await userEvent.click(screen.getByRole('button', { name: 'Miniatures' }));
		expect(
			screen.getAllByRole('button', { name: /^Page \d+$/ }).length,
		).toBeLessThan(20);
	});
});

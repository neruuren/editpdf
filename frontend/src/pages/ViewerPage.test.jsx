import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
	body: {
		success: true,
		data: { username: 'owner', annotationAuthor: 'Grégory' },
	},
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
				start: 0,
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
		...fakeAnnotations(),
	};
}

// Annotations simulées : une note sur la page 1, puis ce que les tests
// ajoutent. Chaque modification compte dans l'historique.
function fakeAnnotations() {
	const pages = new Map([
		[
			0,
			[
				{
					id: 7,
					type: 'Text',
					rect: [100, 100, 124, 124],
					color: '#ffeb3b',
					contents: 'Relire ce passage',
					author: 'Acrobat',
					modifiedAt: '2026-03-02T10:00:00.000Z',
					isLocked: false,
					canMove: true,
					canResize: false,
				},
			],
		],
	]);
	let position = 0;
	let nextId = 100;
	const history = (page) => ({
		page,
		canUndo: position > 0,
		canRedo: false,
		isDirty: position > 0,
	});
	const list = (index) => [...(pages.get(index) ?? [])];
	const images = new Map();
	const fields = new Map();
	const fieldList = (index) =>
		fields.get(index) ??
		(index === 0
			? [
					{
						id: 40,
						type: 'text',
						name: 'nom',
						label: 'Votre nom',
						rect: [100, 400, 300, 420],
						isReadOnly: false,
						isRequired: true,
						value: '',
						isMultiline: false,
						isPassword: false,
						isComb: false,
						maxLength: 0,
						fontSize: 12,
						align: 'left',
					},
					{
						id: 41,
						type: 'checkbox',
						name: 'accord',
						label: 'J’accepte',
						rect: [100, 430, 114, 444],
						isReadOnly: false,
						isRequired: false,
						isOn: false,
					},
					{
						id: 42,
						type: 'combobox',
						name: 'ville',
						label: 'Ville',
						rect: [100, 460, 300, 480],
						isReadOnly: false,
						isRequired: false,
						value: '75',
						options: [
							{ value: '75', label: 'Paris' },
							{ value: '69', label: 'Lyon' },
						],
						isEditable: false,
						isMultiSelect: false,
						fontSize: 10,
					},
					{
						id: 43,
						type: 'signature',
						name: 'signature',
						label: 'Signature du client',
						rect: [100, 500, 300, 550],
						isReadOnly: false,
						isRequired: false,
						isSigned: false,
					},
				]
			: []);
	let pageCount = 3;
	const layout = (count) => ({
		pageCount: count,
		pages: Array.from({ length: count }, () => ({ width: 595, height: 842 })),
		outline: [],
	});
	const imageList = (index) =>
		images.get(index) ?? [
			{
				index: 0,
				rect: [100, 200, 300, 350],
				width: 640,
				height: 480,
				canMove: true,
			},
		];
	return {
		getAnnotations: vi.fn(async (index) => list(index)),
		getAnnotationPages: vi.fn(async (from, count) =>
			[...pages.keys()]
				.filter((index) => index >= from && index < from + count)
				.filter((index) => pages.get(index).length > 0)
				.sort()
				.map((index) => ({ index, annotations: list(index) })),
		),
		createAnnotation: vi.fn(async (index, spec, { author }) => {
			const id = nextId++;
			const annotation = {
				id,
				type: spec.type,
				rect: spec.rect ?? [72, 72, 150, 92],
				rects: spec.from !== undefined ? [[72, 72, 150, 92]] : undefined,
				color: spec.color,
				contents: spec.contents ?? '',
				excerpt: spec.from !== undefined ? 'Texte' : undefined,
				author,
				modifiedAt: '2026-10-28T10:00:00.000Z',
				isLocked: false,
				canMove: spec.type === 'Text' || spec.type === 'FreeText',
				canResize: spec.type === 'FreeText',
			};
			pages.set(index, [...list(index), annotation]);
			position += 1;
			return { id, ...history(index) };
		}),
		updateAnnotation: vi.fn(async (index, id, changes) => {
			pages.set(
				index,
				list(index).map((item) =>
					item.id === id ? { ...item, ...changes } : item,
				),
			);
			position += 1;
			return history(index);
		}),
		deleteAnnotation: vi.fn(async (index, id) => {
			pages.set(
				index,
				list(index).filter((item) => item.id !== id),
			);
			position += 1;
			return history(index);
		}),
		removeMarkup: vi.fn(async (index) => {
			position += 1;
			return { count: 1, ...history(index) };
		}),
		undo: vi.fn(async () => {
			position = Math.max(0, position - 1);
			return { ...history(null), canRedo: true };
		}),
		redo: vi.fn(async () => {
			position += 1;
			return history(null);
		}),
		// Texte du contenu (T4a) : un bloc de deux lignes sur chaque page.
		getTextBlocks: vi.fn(async () => [
			{
				index: 0,
				rect: [72, 60, 300, 100],
				lines: [
					{
						index: 0,
						text: 'Première ligne',
						rect: [72, 60, 200, 74],
						baseline: 71,
						size: 12,
						color: '#000000',
						font: {
							name: 'Arial',
							family: 'sans',
							bold: false,
							italic: false,
							isReusable: true,
						},
						isEditable: true,
					},
					{
						index: 1,
						text: 'Seconde ligne',
						rect: [72, 76, 190, 90],
						baseline: 87,
						size: 12,
						color: '#000000',
						font: {
							name: 'Arial',
							family: 'sans',
							bold: false,
							italic: false,
							isReusable: false,
						},
						isEditable: true,
					},
				],
			},
		]),
		replaceText: vi.fn(async (index) => {
			position += 1;
			return { fontReplaced: null, ...history(index) };
		}),
		addText: vi.fn(async (index) => {
			position += 1;
			return {
				fontReplaced: { from: 'Arial', to: 'Helvetica-Bold' },
				...history(index),
			};
		}),
		// Pages (T5a) : trois pages A4 qu'on réorganise.
		movePages: vi.fn(async () => {
			position += 1;
			return { ...history(null), layout: layout(pageCount) };
		}),
		rotatePages: vi.fn(async () => {
			position += 1;
			return { ...history(null), layout: layout(pageCount) };
		}),
		deletePages: vi.fn(async (indexes) => {
			pageCount -= indexes.length;
			position += 1;
			return { ...history(null), layout: layout(pageCount) };
		}),
		duplicatePages: vi.fn(async (indexes) => {
			pageCount += indexes.length;
			position += 1;
			return { ...history(null), layout: layout(pageCount) };
		}),
		insertBlankPage: vi.fn(async () => {
			pageCount += 1;
			position += 1;
			return { ...history(null), layout: layout(pageCount) };
		}),
		insertPages: vi.fn(async () => {
			pageCount += 2;
			position += 1;
			return { count: 2, ...history(null), layout: layout(pageCount) };
		}),
		extractPages: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
		// Mise en page (T5b).
		cropPages: vi.fn(async () => {
			position += 1;
			return { ...history(null), layout: layout(pageCount) };
		}),
		uncropPages: vi.fn(async () => {
			position += 1;
			return { ...history(null), layout: layout(pageCount) };
		}),
		cropPagesToContent: vi.fn(async () => {
			position += 1;
			return { count: 1, ...history(null), layout: layout(pageCount) };
		}),
		getContentBounds: vi.fn(async () => [50, 60, 500, 780]),
		resizePages: vi.fn(async () => {
			position += 1;
			return { ...history(null), layout: layout(pageCount) };
		}),
		addHeaders: vi.fn(async () => {
			position += 1;
			return { ...history(null), layout: layout(pageCount) };
		}),
		addWatermark: vi.fn(async () => {
			position += 1;
			return { ...history(null), layout: layout(pageCount) };
		}),
		removePageLayer: vi.fn(async () => {
			position += 1;
			return { count: 1, ...history(null), layout: layout(pageCount) };
		}),
		getPageLayers: vi.fn(async () => ({ headers: 0, watermarks: 0 })),
		// Formulaire (T6a) : quatre champs sur la page 1.
		getFormFields: vi.fn(async (index) => fieldList(index)),
		setFieldValue: vi.fn(async (index, id, value) => {
			fields.set(
				index,
				fieldList(index).map((field) =>
					field.id !== id
						? field
						: 'isOn' in field
							? { ...field, isOn: value }
							: { ...field, value },
				),
			);
			position += 1;
			return { pages: [index], ...history(null) };
		}),
		signField: vi.fn(async (index, id) => {
			fields.set(
				index,
				fieldList(index).map((field) =>
					field.id === id ? { ...field, isSigned: true } : field,
				),
			);
			position += 1;
			return { id: nextId++, pages: [index], ...history(null) };
		}),
		flattenForm: vi.fn(async () => {
			const count = fieldList(0).length;
			fields.set(0, []);
			if (count > 0) position += 1;
			return { count, ...history(null) };
		}),
		// Images du contenu (T4b) : une photo sur chaque page.
		getImages: vi.fn(async (index) => imageList(index)),
		moveImage: vi.fn(async (index, { target, rect }) => {
			images.set(
				index,
				imageList(index).map((image) =>
					image.index === target.index ? { ...image, rect } : image,
				),
			);
			position += 1;
			return { rect, ...history(index) };
		}),
		deleteImage: vi.fn(async (index, { target }) => {
			images.set(
				index,
				imageList(index).filter((image) => image.index !== target.index),
			);
			position += 1;
			return history(index);
		}),
		replaceImage: vi.fn(async (index, { target }) => {
			position += 1;
			return { rect: target.rect, ...history(index) };
		}),
		addImage: vi.fn(async (index) => {
			const rect = [250, 400, 350, 450];
			images.set(index, [
				...imageList(index),
				{
					index: imageList(index).length,
					rect,
					width: 200,
					height: 100,
					canMove: true,
				},
			]);
			position += 1;
			return { rect, ...history(index) };
		}),
		save: vi.fn(async () => ({
			data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
			origin: 'annotate',
		})),
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
	// Le premier test paie le chargement à froid de la page (lazy) : plus
	// d’une seconde sur un runner de CI.
	await screen.findByLabelText('Pages du document', {}, { timeout: 5000 });
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

// Bulle d'une note (popover) : jsdom n'a pas l'API Popover et la tient
// pour masquée, sans nom accessible calculé ; on la retrouve par son libellé.
function findBubble(name) {
	return waitFor(() => {
		const bubble = screen
			.getAllByRole('dialog', { hidden: true })
			.find((element) => element.getAttribute('aria-label') === name);
		if (!bubble) throw new Error(`Bulle « ${name} » absente`);
		return bubble;
	});
}

describe('ViewerPage : annotations', () => {
	// Page 1 affichée, son calque de texte et ses annotations lus.
	async function openAnnotated(extra) {
		const opened = await openViewer({ ...RAPPORT, lastPage: null }, extra);
		const page = screen.getByRole('group', { name: 'Page 1 sur 3' });
		await within(page).findByText('Texte de la page 1');
		return { ...opened, page };
	}

	async function startAnnotating() {
		await userEvent.click(screen.getByRole('button', { name: 'Annoter' }));
		return screen.getByRole('toolbar', { name: 'Annotations' });
	}

	it('ouvre le texte d’une note du PDF, en lecture seule hors du mode annotation', async () => {
		const { page } = await openAnnotated();
		await userEvent.click(
			await within(page).findByRole('button', {
				name: 'Note de Acrobat : Relire ce passage',
			}),
		);
		const bubble = await findBubble('Note de Acrobat');
		expect(within(bubble).getByText('Relire ce passage')).toBeInTheDocument();
		expect(within(bubble).queryByRole('textbox', { hidden: true })).toBeNull();
	});

	it('surligne la sélection de texte depuis la barre qui apparaît', async () => {
		const { pdf, page } = await openAnnotated();
		const line = within(page).getByText('Texte de la page 1');
		const selection = window.getSelection();
		const range = document.createRange();
		range.setStart(line.firstChild, 6);
		range.setEnd(line.firstChild, 8);
		selection.removeAllRanges();
		selection.addRange(range);
		fireEvent(document, new Event('selectionchange'));

		const bar = await screen.findByRole('toolbar', {
			name: 'Texte sélectionné',
		});
		await userEvent.click(within(bar).getByRole('radio', { name: 'Vert' }));
		await userEvent.click(
			within(bar).getByRole('button', { name: 'Souligner' }),
		);
		expect(pdf.createAnnotation).toHaveBeenCalledWith(
			0,
			{ type: 'Underline', from: 6, to: 7, color: '#66bb6a' },
			{ author: 'Grégory' },
		);
		await waitFor(() =>
			expect(
				screen.queryByRole('toolbar', { name: 'Texte sélectionné' }),
			).toBeNull(),
		);
	});

	it('retire l’effet du texte sélectionné depuis la barre', async () => {
		const { pdf, page } = await openAnnotated();
		const line = within(page).getByText('Texte de la page 1');
		const range = document.createRange();
		range.setStart(line.firstChild, 0);
		range.setEnd(line.firstChild, 5);
		window.getSelection().removeAllRanges();
		window.getSelection().addRange(range);
		fireEvent(document, new Event('selectionchange'));
		const bar = await screen.findByRole('toolbar', {
			name: 'Texte sélectionné',
		});
		await userEvent.click(within(bar).getByRole('button', { name: 'Retirer' }));
		expect(pdf.removeMarkup).toHaveBeenCalledWith(0, 0, 4);
	});

	it('pose une note avec son texte, puis annule et rétablit', async () => {
		const { pdf, page } = await openAnnotated();
		const toolbar = await startAnnotating();
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Note' }),
		);
		fireEvent.click(page, { clientX: 200, clientY: 300 });
		await waitFor(() =>
			expect(pdf.createAnnotation).toHaveBeenCalledWith(
				0,
				expect.objectContaining({ type: 'Text', color: '#ffeb3b' }),
				{ author: 'Grégory' },
			),
		);
		const bubble = await findBubble('Note de Grégory');
		await userEvent.type(
			within(bubble).getByRole('textbox', { hidden: true }),
			'À vérifier',
		);
		await userEvent.click(
			within(bubble).getByRole('button', { name: 'Fermer', hidden: true }),
		);
		expect(pdf.updateAnnotation).toHaveBeenCalledWith(0, 100, {
			contents: 'À vérifier',
		});

		expect(
			screen.getByRole('button', {
				name: 'Annoter (modifications non enregistrées)',
			}),
		).toBeInTheDocument();
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Annuler' }),
		);
		expect(pdf.undo).toHaveBeenCalled();
		await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
		expect(pdf.redo).toHaveBeenCalled();
	});

	it('pose un texte libre à l’endroit touché', async () => {
		const { pdf, page } = await openAnnotated();
		const toolbar = await startAnnotating();
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Texte' }),
		);
		await userEvent.selectOptions(
			within(toolbar).getByLabelText('Taille du texte'),
			'24 pt',
		);
		fireEvent.click(page, { clientX: 96, clientY: 192 });
		const input = await screen.findByLabelText('Texte de l’annotation');
		await userEvent.type(input, 'Bon pour accord');
		fireEvent.blur(input);
		await waitFor(() =>
			expect(pdf.createAnnotation).toHaveBeenCalledWith(
				0,
				expect.objectContaining({
					type: 'FreeText',
					contents: 'Bon pour accord',
					fontSize: 24,
					color: '#e53935',
				}),
				{ author: 'Grégory' },
			),
		);
		// 96 px CSS = 72 points à 100 %.
		const [{ rect }] = pdf.createAnnotation.mock.calls.at(-1).slice(1);
		expect(rect[0]).toBeCloseTo(72);
		expect(rect[1]).toBeCloseTo(144);
	});

	it('sélectionne une annotation, la recolore et la supprime', async () => {
		const { pdf, page } = await openAnnotated();
		const toolbar = await startAnnotating();
		await userEvent.click(
			await within(page).findByRole('button', {
				name: 'Note de Acrobat : Relire ce passage',
			}),
		);
		// La bulle de la note s'ouvre aussi ; on la referme.
		await userEvent.click(
			within(await findBubble('Note de Acrobat')).getByRole('button', {
				name: 'Fermer',
				hidden: true,
			}),
		);
		await userEvent.click(
			within(toolbar).getByRole('radio', { name: 'Rouge' }),
		);
		expect(pdf.updateAnnotation).toHaveBeenCalledWith(0, 7, {
			color: '#e53935',
		});
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Supprimer' }),
		);
		expect(pdf.deleteAnnotation).toHaveBeenCalledWith(0, 7);
	});

	it('liste les annotations du document dans le panneau', async () => {
		await openAnnotated();
		await userEvent.click(screen.getByRole('button', { name: /Navigation/ }));
		await userEvent.click(screen.getByRole('button', { name: 'Annotations' }));
		const nav = screen.getByRole('navigation', {
			name: 'Navigation dans le document',
		});
		expect(
			await within(nav).findByRole('heading', { name: 'Page 1' }),
		).toBeInTheDocument();
		const item = within(nav).getByRole('button', { name: /^Note/ });
		expect(item).toHaveTextContent('Relire ce passage');
		expect(item).toHaveTextContent('Acrobat');
	});

	it('enregistre les annotations en nouvelle révision, sans retélécharger le PDF', async () => {
		const saved = { ...RAPPORT, lastPage: null, currentRevision: 1 };
		let body;
		const { pdf, page, fetchMock } = await openAnnotated({
			'POST /api/v1/documents/rapport/revisions': (options) => {
				body = options.body;
				return ok(saved, 201);
			},
		});
		const toolbar = await startAnnotating();
		const saveButton = within(toolbar).getByRole('button', {
			name: 'Enregistrer',
		});
		expect(saveButton).toBeDisabled();
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Note' }),
		);
		fireEvent.click(page, { clientX: 10, clientY: 10 });
		await waitFor(() => expect(saveButton).toBeEnabled());
		await userEvent.click(
			within(await findBubble('Note de Grégory')).getByRole('button', {
				name: 'Fermer',
				hidden: true,
			}),
		);

		openPdf.mockClear();
		await userEvent.keyboard('{Control>}s{/Control}');
		await waitFor(() => expect(openPdf).toHaveBeenCalled());
		expect(pdf.save).toHaveBeenCalled();
		expect(body.get('origin')).toBe('annotate');
		expect(body.get('baseRevision')).toBe('0');
		expect(body.get('file').name).toBe('modifications.pdf');
		// Le PDF enregistré est rouvert tel quel : pas de nouveau téléchargement.
		expect(
			fetchMock.mock.calls.filter(([url]) => url.includes('/file')),
		).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Annoter' })).toBeInTheDocument();
	});

	it('propose d’enregistrer quand même si le document a changé entre-temps', async () => {
		const bodies = [];
		const { page } = await openAnnotated({
			'POST /api/v1/documents/rapport/revisions': (options) => {
				bodies.push(options.body);
				return options.body.get('baseRevision')
					? {
							status: 409,
							body: {
								success: false,
								error: 'Le document a changé depuis son ouverture',
								data: { currentRevision: 1 },
							},
						}
					: ok({ ...RAPPORT, currentRevision: 2 }, 201);
			},
		});
		const toolbar = await startAnnotating();
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Note' }),
		);
		fireEvent.click(page, { clientX: 10, clientY: 10 });
		await userEvent.click(
			within(await findBubble('Note de Grégory')).getByRole('button', {
				name: 'Fermer',
				hidden: true,
			}),
		);
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Enregistrer' }),
		);
		const dialog = await screen.findByRole('dialog', {
			name: 'Le document a changé',
		});
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Enregistrer quand même' }),
		);
		await waitFor(() => expect(bodies).toHaveLength(2));
		expect(bodies[1].get('baseRevision')).toBeNull();
	});

	it('demande confirmation avant de quitter avec des annotations non enregistrées', async () => {
		const { page } = await openAnnotated();
		const toolbar = await startAnnotating();
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Note' }),
		);
		fireEvent.click(page, { clientX: 10, clientY: 10 });
		await userEvent.click(
			within(await findBubble('Note de Grégory')).getByRole('button', {
				name: 'Fermer',
				hidden: true,
			}),
		);

		await userEvent.click(
			screen.getByRole('link', { name: 'Retour à la bibliothèque' }),
		);
		const dialog = await screen.findByRole('dialog', {
			name: 'Quitter sans enregistrer ?',
		});
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Annuler' }),
		);
		expect(screen.getByLabelText('Pages du document')).toBeInTheDocument();

		await userEvent.click(
			screen.getByRole('link', { name: 'Retour à la bibliothèque' }),
		);
		await userEvent.click(
			within(
				await screen.findByRole('dialog', {
					name: 'Quitter sans enregistrer ?',
				}),
			).getByRole('button', { name: 'Quitter sans enregistrer' }),
		);
		await waitFor(() =>
			expect(screen.queryByLabelText('Pages du document')).toBeNull(),
		);
	});
});

describe('ViewerPage : modifier le texte', () => {
	async function openEditing(extra) {
		const opened = await openViewer({ ...RAPPORT, lastPage: null }, extra);
		const page = screen.getByRole('group', { name: 'Page 1 sur 3' });
		await within(page).findByText('Texte de la page 1');
		await userEvent.click(
			screen.getByRole('button', { name: 'Modifier le contenu' }),
		);
		const toolbar = screen.getByRole('toolbar', {
			name: 'Modification du contenu',
		});
		return { ...opened, page, toolbar };
	}

	it('remplace une ligne avec sa police d’origine, puis l’enregistre', async () => {
		let body;
		const { pdf, page, toolbar } = await openEditing({
			'POST /api/v1/documents/rapport/revisions': (options) => {
				body = options.body;
				return { status: 201, body: { success: true, data: RAPPORT } };
			},
		});
		pdf.save.mockResolvedValue({
			data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
			origin: 'edit',
		});
		await userEvent.click(
			await within(page).findByRole('button', {
				name: 'Modifier la ligne « Première ligne »',
			}),
		);
		const input = within(page).getByRole('textbox', {
			name: 'Texte de la ligne',
		});
		expect(
			within(toolbar).getByRole('combobox', { name: 'Police' }),
		).toHaveValue('original');
		await userEvent.clear(input);
		await userEvent.type(input, 'Ligne corrigée{Enter}');
		await waitFor(() =>
			expect(pdf.replaceText).toHaveBeenCalledWith(0, {
				target: { block: 0, line: 0, text: 'Première ligne' },
				text: 'Ligne corrigée',
				style: {
					font: 'original',
					bold: false,
					italic: false,
					size: 12,
					color: '#000000',
					align: 'left',
				},
			}),
		);
		const saveButton = within(toolbar).getByRole('button', {
			name: 'Enregistrer',
		});
		await waitFor(() => expect(saveButton).toBeEnabled());
		await userEvent.click(saveButton);
		await waitFor(() => expect(body?.get('origin')).toBe('edit'));
	});

	it('n’écrit rien si la ligne n’a pas changé', async () => {
		const { pdf, page } = await openEditing();
		await userEvent.click(
			await within(page).findByRole('button', {
				name: 'Modifier la ligne « Première ligne »',
			}),
		);
		await userEvent.keyboard('{Enter}');
		expect(
			within(page).queryByRole('textbox', { name: 'Texte de la ligne' }),
		).toBeNull();
		expect(pdf.replaceText).not.toHaveBeenCalled();
	});

	it('passe de la ligne au paragraphe, avec le style changé dans la barre', async () => {
		const { pdf, page, toolbar } = await openEditing();
		await userEvent.click(
			await within(page).findByRole('button', {
				name: 'Modifier la ligne « Première ligne »',
			}),
		);
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Paragraphe entier' }),
		);
		const input = within(page).getByRole('textbox', {
			name: 'Texte du paragraphe',
		});
		expect(input).toHaveValue('Première ligne\nSeconde ligne');
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Gras' }),
		);
		// Le réglage garde la saisie ouverte.
		expect(input).toBeInTheDocument();
		await userEvent.type(input, ' fin{Control>}{Enter}{/Control}');
		await waitFor(() => expect(pdf.replaceText).toHaveBeenCalled());
		const [, params] = pdf.replaceText.mock.calls[0];
		expect(params.target).toEqual({
			block: 0,
			line: null,
			text: 'Première ligne\nSeconde ligne',
		});
		expect(params.text).toBe('Première ligne\nSeconde ligne fin');
		// Gras sur la police d’origine : la police standard de sa famille.
		expect(params.style).toMatchObject({ font: 'sans', bold: true });
	});

	it('ajoute du texte d’un clic et prévient d’une police remplacée', async () => {
		const { pdf, page, toolbar } = await openEditing();
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Ajouter du texte' }),
		);
		const layer = page.querySelector('.pdf-text-edit-layer');
		fireEvent.click(layer, { clientX: 20, clientY: 30 });
		const input = within(page).getByRole('textbox', { name: 'Texte ajouté' });
		await userEvent.type(input, 'Nouveau{Control>}{Enter}{/Control}');
		await waitFor(() =>
			expect(pdf.addText).toHaveBeenCalledWith(
				0,
				expect.objectContaining({ text: 'Nouveau' }),
			),
		);
		expect(
			await screen.findByText(
				'La police « Arial » du document ne peut pas écrire ce texte : il est écrit en Helvetica.',
			),
		).toBeInTheDocument();
	});

	it('Échap abandonne la saisie, et le mode exclut les annotations', async () => {
		const { pdf, page } = await openEditing();
		await userEvent.click(
			await within(page).findByRole('button', {
				name: 'Modifier la ligne « Seconde ligne »',
			}),
		);
		const input = within(page).getByRole('textbox', {
			name: 'Texte de la ligne',
		});
		await userEvent.type(input, 'xyz{Escape}');
		expect(pdf.replaceText).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole('button', { name: 'Annoter' }));
		expect(
			screen.queryByRole('toolbar', { name: 'Modification du contenu' }),
		).toBeNull();
		expect(
			screen.getByRole('toolbar', { name: 'Annotations' }),
		).toBeInTheDocument();
	});
});

describe('ViewerPage : modifier les images', () => {
	async function openImages() {
		const opened = await openViewer({ ...RAPPORT, lastPage: null });
		const page = screen.getByRole('group', { name: 'Page 1 sur 3' });
		await userEvent.click(
			screen.getByRole('button', { name: 'Modifier le contenu' }),
		);
		const toolbar = screen.getByRole('toolbar', {
			name: 'Modification du contenu',
		});
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Images' }),
		);
		return { ...opened, page, toolbar };
	}

	it('sélectionne une image et la déplace aux flèches', async () => {
		const { pdf, page, toolbar } = await openImages();
		expect(
			within(toolbar).queryByRole('combobox', { name: 'Police' }),
		).toBeNull();
		const image = await within(page).findByRole('button', {
			name: 'Image 1 (640 × 480 pixels)',
		});
		await userEvent.click(image);
		expect(image).toHaveAttribute('aria-pressed', 'true');
		await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}{ArrowDown}');
		await waitFor(() => expect(pdf.moveImage).toHaveBeenCalledTimes(1));
		expect(pdf.moveImage).toHaveBeenCalledWith(0, {
			target: { index: 0, rect: [100, 200, 300, 350] },
			rect: [110, 201, 310, 351],
		});
		// Relue à sa nouvelle place, elle reste sélectionnée.
		await waitFor(() =>
			expect(
				within(page).getByRole('button', {
					name: 'Image 1 (640 × 480 pixels)',
				}),
			).toHaveAttribute('aria-pressed', 'true'),
		);
		expect(
			within(toolbar).getByRole('button', { name: 'Enregistrer' }),
		).toBeEnabled();
	});

	it('supprime l’image sélectionnée', async () => {
		const { pdf, page, toolbar } = await openImages();
		const remove = within(toolbar).getByRole('button', { name: 'Supprimer' });
		expect(remove).toBeDisabled();
		await userEvent.click(
			await within(page).findByRole('button', {
				name: 'Image 1 (640 × 480 pixels)',
			}),
		);
		await userEvent.click(remove);
		expect(pdf.deleteImage).toHaveBeenCalledWith(0, {
			target: { index: 0, rect: [100, 200, 300, 350] },
		});
		await waitFor(() =>
			expect(
				within(page).queryByRole('button', { name: /^Image 1/ }),
			).toBeNull(),
		);
	});

	it('ajoute une image au centre de la page affichée et la sélectionne', async () => {
		const { pdf, page, toolbar } = await openImages();
		const [input] = toolbar.querySelectorAll('input[type="file"]');
		const file = new File([new Uint8Array([0x89, 0x50])], 'logo.png', {
			type: 'image/png',
		});
		await userEvent.upload(input, file);
		await waitFor(() => expect(pdf.addImage).toHaveBeenCalled());
		const [index, params] = pdf.addImage.mock.calls[0];
		expect(index).toBe(0);
		expect(params.point).toEqual([297.5, 421]);
		expect(params.data).toEqual(new Uint8Array([0x89, 0x50]));
		expect(
			await within(page).findByRole('button', {
				name: 'Image 2 (200 × 100 pixels)',
				pressed: true,
			}),
		).toBeInTheDocument();
	});
});

describe('ViewerPage : organiser les pages', () => {
	async function openPages(extra) {
		const opened = await openViewer({ ...RAPPORT, lastPage: null }, extra);
		await userEvent.click(
			screen.getByRole('button', { name: 'Organiser les pages' }),
		);
		const grid = screen.getByRole('listbox', { name: 'Pages du document' });
		const toolbar = screen.getByRole('toolbar', {
			name: 'Organisation des pages',
		});
		return { ...opened, grid, toolbar };
	}

	it('sélectionne des pages et les déplace au clavier', async () => {
		const { pdf, grid, toolbar } = await openPages();
		expect(within(grid).getAllByRole('option')).toHaveLength(3);
		const user = userEvent.setup();
		await user.click(within(grid).getByRole('option', { name: 'Page 1' }));
		// Maj + clic : la plage.
		await user.keyboard('{Shift>}');
		await user.click(within(grid).getByRole('option', { name: 'Page 2' }));
		await user.keyboard('{/Shift}');
		expect(
			within(toolbar).getByText('2 / 3 pages sélectionnées'),
		).toBeInTheDocument();
		await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
		await waitFor(() => expect(pdf.movePages).toHaveBeenCalledWith([2, 0, 1]));
		await waitFor(() =>
			expect(
				within(grid).getByRole('option', { name: 'Page 3' }),
			).toHaveAttribute('aria-selected', 'true'),
		);
		expect(
			within(grid).getByRole('option', { name: 'Page 1' }),
		).toHaveAttribute('aria-selected', 'false');
	});

	it('supprime, pivote et insère une page blanche', async () => {
		const { pdf, grid, toolbar } = await openPages();
		await userEvent.click(within(grid).getByRole('option', { name: 'Page 1' }));
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Pivoter à droite' }),
		);
		expect(pdf.rotatePages).toHaveBeenCalledWith([0], 1);
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Supprimer' }),
		);
		expect(pdf.deletePages).toHaveBeenCalledWith([0]);
		await waitFor(() =>
			expect(within(grid).getAllByRole('option')).toHaveLength(2),
		);
		await userEvent.click(
			within(toolbar).getByRole('button', {
				name: 'Une page blanche',
				hidden: true,
			}),
		);
		expect(pdf.insertBlankPage).toHaveBeenCalledWith(1);
		await waitFor(() =>
			expect(within(grid).getAllByRole('option')).toHaveLength(3),
		);
	});

	it('extrait des pages vers un nouveau document de la bibliothèque', async () => {
		let uploaded;
		const { pdf, grid, toolbar } = await openPages({
			'POST /api/v1/documents': (options) => {
				uploaded = options.body;
				return {
					status: 201,
					body: {
						success: true,
						data: {
							...RAPPORT,
							id: 'extrait',
							title: 'Rapport annuel (page 2)',
						},
					},
				};
			},
		});
		await userEvent.click(within(grid).getByRole('option', { name: 'Page 2' }));
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Extraire…' }),
		);
		const dialog = screen.getByRole('dialog', { name: 'Extraire des pages' });
		expect(
			within(dialog).getByRole('textbox', {
				name: 'Titre du nouveau document',
			}),
		).toHaveValue('Rapport annuel (page 2)');
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Créer le document' }),
		);
		expect(
			await within(dialog).findByRole('link', {
				name: 'Rapport annuel (page 2)',
			}),
		).toHaveAttribute('href', '/documents/extrait');
		expect(pdf.extractPages).toHaveBeenCalledWith([1], {
			title: 'Rapport annuel (page 2)',
		});
		expect(uploaded.get('file').name).toBe('Rapport annuel (page 2).pdf');
	});

	it('enregistre en « organize » et recale les signets', async () => {
		let remapped;
		const { pdf, grid, toolbar } = await openPages({
			'POST /api/v1/documents/rapport/revisions': () => ({
				status: 201,
				body: { success: true, data: RAPPORT },
			}),
			'POST /api/v1/documents/rapport/bookmarks/remap': (options) => {
				remapped = JSON.parse(options.body);
				return { status: 200, body: { success: true, data: [] } };
			},
		});
		pdf.save.mockResolvedValue({
			data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
			origin: 'organize',
			pageMap: [1, 0, 2],
		});
		await userEvent.click(within(grid).getByRole('option', { name: 'Page 1' }));
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Avancer' }),
		);
		await userEvent.click(
			within(toolbar).getByRole('button', { name: 'Enregistrer' }),
		);
		await waitFor(() => expect(remapped).toEqual({ pageMap: [1, 0, 2] }));
	});
});

describe('ViewerPage : mise en page', () => {
	async function openSetup(kind) {
		const opened = await openViewer({ ...RAPPORT, lastPage: null });
		await userEvent.click(
			screen.getByRole('button', { name: 'Organiser les pages' }),
		);
		const grid = screen.getByRole('listbox', { name: 'Pages du document' });
		const toolbar = screen.getByRole('toolbar', {
			name: 'Organisation des pages',
		});
		return { ...opened, grid, toolbar, kind };
	}

	async function openDialog(toolbar, item, name) {
		await userEvent.click(
			within(toolbar).getByRole('button', { name: item, hidden: true }),
		);
		return screen.getByRole('dialog', { name });
	}

	it('recadre les pages sélectionnées avec les marges saisies', async () => {
		const { pdf, grid, toolbar } = await openSetup();
		await userEvent.click(within(grid).getByRole('option', { name: 'Page 2' }));
		const dialog = await openDialog(toolbar, 'Recadrer…', 'Recadrer les pages');
		expect(
			within(dialog).getByRole('radio', { name: /Sélectionnées \(2\)/ }),
		).toBeChecked();
		const top = within(dialog).getByRole('spinbutton', { name: 'Haut (mm)' });
		await userEvent.clear(top);
		await userEvent.type(top, '10');
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Recadrer' }),
		);
		await waitFor(() => expect(pdf.cropPages).toHaveBeenCalled());
		const [pages, margins] = pdf.cropPages.mock.calls[0];
		expect(pages).toEqual([1]);
		expect(margins.top).toBeCloseTo(28.35, 1);
		expect(margins.bottom).toBe(0);
	});

	it('recadre chaque page sur son contenu, ou la remet entière', async () => {
		const { pdf, toolbar } = await openSetup();
		let dialog = await openDialog(toolbar, 'Recadrer…', 'Recadrer les pages');
		await userEvent.click(
			within(dialog).getByRole('radio', {
				name: 'Marges blanches de chaque page',
			}),
		);
		await waitFor(() => expect(pdf.getContentBounds).toHaveBeenCalledWith(0));
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Recadrer' }),
		);
		await waitFor(() =>
			expect(pdf.cropPagesToContent).toHaveBeenCalledWith(
				[0, 1, 2],
				expect.closeTo(8.5, 1),
			),
		);
		dialog = await openDialog(toolbar, 'Recadrer…', 'Recadrer les pages');
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Pages entières' }),
		);
		await waitFor(() =>
			expect(pdf.uncropPages).toHaveBeenCalledWith([0, 1, 2]),
		);
	});

	it('change la taille des pages', async () => {
		const { pdf, toolbar } = await openSetup();
		const dialog = await openDialog(
			toolbar,
			'Changer la taille…',
			'Changer la taille des pages',
		);
		await userEvent.selectOptions(
			within(dialog).getByRole('combobox', { name: 'Nouvelle taille' }),
			'letter',
		);
		await userEvent.click(
			within(dialog).getByRole('radio', { name: 'Paysage' }),
		);
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Changer la taille' }),
		);
		await waitFor(() =>
			expect(pdf.resizePages).toHaveBeenCalledWith([0, 1, 2], {
				width: 612,
				height: 792,
				orientation: 'landscape',
			}),
		);
	});

	it('pose des en-têtes avec numéros Bates, montrés dans l’aperçu', async () => {
		const { pdf, toolbar } = await openSetup();
		pdf.getPageLayers.mockResolvedValue({ headers: 3, watermarks: 0 });
		const dialog = await openDialog(
			toolbar,
			'En-têtes, pieds de page et numéros…',
			'En-têtes, pieds de page et numéros',
		);
		// Réglage par défaut : « Page {page} / {pages} » en bas à droite.
		expect(within(dialog).getByText('Page 1 / 3')).toBeInTheDocument();
		const slot = within(dialog).getByRole('textbox', {
			name: 'En bas à gauche',
		});
		await userEvent.click(slot);
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Insérer numéro Bates' }),
		);
		expect(slot).toHaveValue('{bates}');
		const prefix = within(dialog).getByRole('textbox', { name: 'Préfixe' });
		await userEvent.type(prefix, 'DOS-');
		expect(within(dialog).getByText('DOS-000001')).toBeInTheDocument();
		expect(
			await within(dialog).findByRole('button', {
				name: 'Retirer les en-têtes',
			}),
		).toBeInTheDocument();
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Poser' }),
		);
		await waitFor(() => expect(pdf.addHeaders).toHaveBeenCalled());
		const [pages, spec, values] = pdf.addHeaders.mock.calls[0];
		expect(pages).toEqual([0, 1, 2]);
		expect(spec.slots).toMatchObject({
			bottomLeft: '{bates}',
			bottomRight: 'Page {page} / {pages}',
		});
		expect(spec.bates).toEqual({
			prefix: 'DOS-',
			suffix: '',
			start: 1,
			digits: 6,
		});
		expect(values.title).toBe('Rapport annuel');
		// Réglages gardés sur l'appareil.
		expect(
			JSON.parse(localStorage.getItem('editpdf-page-headers')).bates.prefix,
		).toBe('DOS-');
	});

	it('pose et retire un filigrane', async () => {
		const { pdf, toolbar } = await openSetup();
		pdf.getPageLayers.mockResolvedValue({ headers: 0, watermarks: 3 });
		let dialog = await openDialog(toolbar, 'Filigrane…', 'Filigrane');
		const text = within(dialog).getByRole('textbox', { name: 'Texte' });
		await userEvent.clear(text);
		await userEvent.type(text, 'COPIE');
		await userEvent.click(
			within(dialog).getByRole('checkbox', { name: /Derrière le contenu/ }),
		);
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Poser' }),
		);
		await waitFor(() =>
			expect(pdf.addWatermark).toHaveBeenCalledWith([0, 1, 2], {
				text: 'COPIE',
				fontSize: null,
				color: '#c62828',
				opacity: 0.25,
				angle: 'diagonal',
				behind: true,
			}),
		);
		dialog = await openDialog(toolbar, 'Filigrane…', 'Filigrane');
		await userEvent.click(
			await within(dialog).findByRole('button', {
				name: 'Retirer le filigrane',
			}),
		);
		await waitFor(() =>
			expect(pdf.removePageLayer).toHaveBeenCalledWith([0, 1, 2], 'Watermark'),
		);
	});
});

describe('ViewerPage : formulaires et signature', () => {
	const SIGNATURE = {
		id: '5f0c4a8e-3b1d-4c2e-9a7f-1e2d3c4b5a69',
		name: 'Grégory',
		kind: 'signature',
		width: 300,
		height: 80,
		size: 1000,
		createdAt: '2026-03-01T10:00:00.000Z',
	};
	const LOGO = { ...SIGNATURE, id: 'b1', name: 'Logo', kind: 'stamp' };

	function signatureRoutes(extra = {}) {
		return {
			'GET /api/v1/stamps': ok([LOGO, SIGNATURE]),
			[`GET /api/v1/stamps/${SIGNATURE.id}/image`]: { status: 200, body: null },
			...extra,
		};
	}

	it('remplit les champs en lecture, puis enregistre une révision « form »', async () => {
		let body;
		const { pdf } = await openViewer(RAPPORT, {
			'POST /api/v1/documents/rapport/revisions': (options) => {
				body = options.body;
				return ok({ ...RAPPORT, currentRevision: 1 }, 201);
			},
		});
		pdf.save.mockResolvedValue({
			data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
			origin: 'form',
		});
		const name = await screen.findByRole('textbox', { name: 'Votre nom' });
		expect(name).toBeRequired();
		await userEvent.type(name, 'Grégory{Enter}');
		await waitFor(() =>
			expect(pdf.setFieldValue).toHaveBeenCalledWith(0, 40, 'Grégory'),
		);
		await userEvent.click(screen.getByRole('checkbox', { name: 'J’accepte' }));
		expect(pdf.setFieldValue).toHaveBeenCalledWith(0, 41, true);
		await userEvent.selectOptions(
			screen.getByRole('combobox', { name: 'Ville' }),
			'Lyon',
		);
		expect(pdf.setFieldValue).toHaveBeenCalledWith(0, 42, '69');

		const bar = await screen.findByRole('toolbar', {
			name: 'Modifications non enregistrées',
		});
		await userEvent.click(
			within(bar).getByRole('button', { name: 'Enregistrer' }),
		);
		await waitFor(() => expect(body.get('origin')).toBe('form'));
	});

	it('Échap abandonne la saisie d’un champ sans rien écrire', async () => {
		const { pdf } = await openViewer();
		const name = await screen.findByRole('textbox', { name: 'Votre nom' });
		await userEvent.type(name, 'Brouillon{Escape}');
		expect(name).toHaveValue('');
		expect(pdf.setFieldValue).not.toHaveBeenCalled();
	});

	it('signe un champ de signature avec une signature gardée sur le serveur', async () => {
		const { pdf } = await openViewer(RAPPORT, signatureRoutes());
		await userEvent.click(
			await screen.findByRole('button', {
				name: 'Signer : Signature du client',
			}),
		);
		const dialog = await screen.findByRole('dialog', { name: 'Signer' });
		expect(
			within(dialog).getByText(/dans le champ « Signature du client »/),
		).toBeInTheDocument();
		// Les tampons ne sont pas des signatures.
		expect(within(dialog).queryByText('Logo')).not.toBeInTheDocument();
		await userEvent.click(
			await within(dialog).findByRole('button', { name: 'Grégory' }),
		);
		await waitFor(() =>
			expect(pdf.signField).toHaveBeenCalledWith(
				0,
				43,
				expect.any(Uint8Array),
				{ author: 'Grégory' },
			),
		);
		await waitFor(() =>
			expect(
				screen.queryByRole('button', { name: 'Signer : Signature du client' }),
			).not.toBeInTheDocument(),
		);
	});

	it('« Signer » charge la signature dans l’outil Tampon, à poser d’un clic', async () => {
		await openViewer(RAPPORT, signatureRoutes());
		await userEvent.click(screen.getByRole('button', { name: 'Signer' }));
		const dialog = await screen.findByRole('dialog', { name: 'Signer' });
		await userEvent.click(
			await within(dialog).findByRole('button', { name: 'Grégory' }),
		);
		expect(
			await screen.findByText(/Touchez la page à l’endroit où poser/),
		).toBeInTheDocument();
		expect(
			screen.getByRole('toolbar', { name: /annotation/i }),
		).toBeInTheDocument();
	});

	it('crée une signature saisie et l’envoie au serveur comme signature', async () => {
		let body;
		await openViewer(RAPPORT, {
			'GET /api/v1/stamps': ok([]),
			'POST /api/v1/stamps': (options) => {
				body = options.body;
				return ok(SIGNATURE, 201);
			},
		});
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
			drawImage: vi.fn(),
			measureText: () => ({ width: 200 }),
			fillText: vi.fn(),
			getImageData: (x, y, width, height) => ({
				data: new Uint8ClampedArray(width * height * 4).fill(255),
			}),
		});
		vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
			(callback) => callback(new Blob(['png'], { type: 'image/png' })),
		);
		globalThis.FontFace ??= class {
			load() {
				return Promise.resolve(this);
			}
		};
		document.fonts ??= { add: vi.fn() };
		await userEvent.click(screen.getByRole('button', { name: 'Signer' }));
		const dialog = await screen.findByRole('dialog', { name: 'Signer' });
		await userEvent.click(
			within(dialog).getByRole('radio', { name: 'Saisir' }),
		);
		await userEvent.type(
			within(dialog).getByRole('textbox', { name: 'Votre nom' }),
			'Grégory Day',
		);
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Enregistrer et signer' }),
		);
		await waitFor(() => expect(body.get('kind')).toBe('signature'));
		expect(body.get('name')).toBe('Grégory Day');
		expect(body.get('file').type).toBe('image/png');
	});

	it('aplatit le formulaire après confirmation', async () => {
		const { pdf } = await openViewer();
		await screen.findByRole('textbox', { name: 'Votre nom' });
		await userEvent.click(
			screen.getByRole('button', { name: 'Plus d’actions' }),
		);
		// jsdom n'a pas l'API Popover : le menu reste « caché ».
		await userEvent.click(
			screen.getByRole('button', {
				name: /Aplatir le formulaire/,
				hidden: true,
			}),
		);
		const dialog = await screen.findByRole('dialog', {
			name: 'Aplatir le formulaire ?',
		});
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'Aplatir' }),
		);
		await waitFor(() => expect(pdf.flattenForm).toHaveBeenCalled());
		await waitFor(() =>
			expect(
				screen.queryByRole('textbox', { name: 'Votre nom' }),
			).not.toBeInTheDocument(),
		);
	});
});

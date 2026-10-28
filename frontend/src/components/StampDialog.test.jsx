import { createRef } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import StampDialog from './StampDialog';
import { mockFetch, renderWithProviders } from '../testUtils';

const LOGO = {
	id: '6f1c2b8e-0a3d-4c1e-9f7a-2b4c6d8e0f12',
	name: 'Logo',
	width: 300,
	height: 100,
	size: 1200,
	createdAt: '2026-10-28T10:00:00.000Z',
};

function setup(props = {}) {
	const ref = createRef();
	const handlers = {
		onChoose: vi.fn(),
		onCustomTextChange: vi.fn(),
		onWithDateChange: vi.fn(),
	};
	renderWithProviders(
		<StampDialog
			ref={ref}
			choice="text:APPROUVÉ"
			customText="VU ET APPROUVÉ"
			withDate
			stamps={[LOGO]}
			isLoading={false}
			{...handlers}
			{...props}
		/>,
	);
	ref.current.showModal();
	return { ref, ...handlers };
}

describe('StampDialog', () => {
	it('choisit un tampon texte, un texte libre, la date', async () => {
		const user = userEvent.setup();
		const { onChoose, onCustomTextChange, onWithDateChange } = setup();
		const dialog = await screen.findByRole('dialog', { name: 'Tampon' });
		expect(
			within(dialog).getByRole('radio', { name: 'APPROUVÉ' }),
		).toBeChecked();

		await user.click(within(dialog).getByText('REFUSÉ'));
		expect(onChoose).toHaveBeenLastCalledWith('text:REFUSÉ');

		const text = within(dialog).getByRole('textbox', {
			name: 'Texte du tampon',
		});
		await user.type(text, ' !');
		expect(onChoose).toHaveBeenLastCalledWith('custom');
		expect(onCustomTextChange).toHaveBeenLastCalledWith('VU ET APPROUVÉ !');

		await user.click(within(dialog).getByRole('checkbox', { name: /date/ }));
		expect(onWithDateChange).toHaveBeenLastCalledWith(false);
	});

	it('montre et choisit les tampons image', async () => {
		const user = userEvent.setup();
		const { onChoose } = setup();
		const dialog = await screen.findByRole('dialog', { name: 'Tampon' });
		await user.click(within(dialog).getByRole('radio', { name: 'Logo' }));
		expect(onChoose).toHaveBeenLastCalledWith(`image:${LOGO.id}`);
	});

	it('ajoute une image et la choisit, ou choisit celle qui existe déjà', async () => {
		const user = userEvent.setup();
		const created = { ...LOGO, id: '0b6c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4' };
		let isDuplicate = false;
		const fetch = mockFetch({
			'POST /api/v1/stamps': () =>
				isDuplicate
					? {
							status: 409,
							body: {
								success: false,
								error: 'Ce tampon existe déjà',
								data: { stampId: LOGO.id },
							},
						}
					: { status: 201, body: { success: true, data: created } },
			'GET /api/v1/stamps': { body: { success: true, data: [LOGO, created] } },
		});
		const { onChoose } = setup();
		const dialog = await screen.findByRole('dialog', { name: 'Tampon' });
		const input = dialog.querySelector('input[type=file]');
		const file = new File(['png'], 'signature.png', { type: 'image/png' });

		await user.upload(input, file);
		await waitFor(() =>
			expect(onChoose).toHaveBeenLastCalledWith(`image:${created.id}`),
		);
		const [, options] = fetch.mock.calls.find(([url]) =>
			url.endsWith('/v1/stamps'),
		);
		expect(options.body.get('file').name).toBe('signature.png');

		isDuplicate = true;
		await user.upload(input, file);
		await waitFor(() =>
			expect(onChoose).toHaveBeenLastCalledWith(`image:${LOGO.id}`),
		);
		expect(
			await within(dialog).findByText(/déjà un tampon : il est choisi/),
		).toBeInTheDocument();
	});

	it('supprime un tampon image après confirmation', async () => {
		const user = userEvent.setup();
		const fetch = mockFetch({
			[`DELETE /api/v1/stamps/${LOGO.id}`]: {
				body: { success: true, data: null },
			},
			'GET /api/v1/stamps': { body: { success: true, data: [] } },
		});
		const { onChoose } = setup({ choice: `image:${LOGO.id}` });
		const dialog = await screen.findByRole('dialog', { name: 'Tampon' });
		await user.click(
			within(dialog).getByRole('button', { name: 'Supprimer Logo' }),
		);
		const confirm = screen.getByRole('dialog', {
			name: 'Supprimer ce tampon ?',
		});
		await user.click(
			within(confirm).getByRole('button', { name: 'Supprimer le tampon' }),
		);
		await waitFor(() =>
			expect(fetch).toHaveBeenCalledWith(
				`/api/v1/stamps/${LOGO.id}`,
				expect.objectContaining({ method: 'DELETE' }),
			),
		);
		// Le tampon choisi n'existe plus : retour au premier tampon texte.
		await waitFor(() =>
			expect(onChoose).toHaveBeenLastCalledWith('text:APPROUVÉ'),
		);
	});
});

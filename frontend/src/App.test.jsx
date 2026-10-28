import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';

describe('App', () => {
	it('renders the heading', () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ text: 'Hello from the backend!!!!! :)' }),
			}),
		);

		render(<App />);
		expect(screen.getByText('Message from Backend')).toBeInTheDocument();
	});

	it('displays the message fetched from the backend', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ text: 'Hello from the backend!!!!! :)' }),
			}),
		);

		render(<App />);
		expect(
			await screen.findByText('Hello from the backend!!!!! :)'),
		).toBeInTheDocument();
	});

	it('shows an error message when the backend request fails', async () => {
		globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));

		render(<App />);
		expect(
			await screen.findByText('Unable to load the message from the backend.'),
		).toBeInTheDocument();
	});
});

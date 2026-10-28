import { act, render, screen } from '@testing-library/react';
import AppUpdateOverlay from './AppUpdateOverlay';
import { _resetAppUpdate, watchServiceWorkerUpdates } from '../pwa/appUpdate';

describe('AppUpdateOverlay', () => {
	afterEach(() => {
		_resetAppUpdate();
		delete navigator.serviceWorker;
	});

	it('n’affiche rien sans mise à jour', () => {
		render(<AppUpdateOverlay />);
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	it('affiche un spinner pendant la mise à jour', () => {
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: Object.assign(new EventTarget(), { controller: {} }),
		});
		const registration = new EventTarget();
		registration.installing = null;
		const unwatch = watchServiceWorkerUpdates(registration);
		render(<AppUpdateOverlay />);

		act(() => {
			registration.installing = new EventTarget();
			registration.dispatchEvent(new Event('updatefound'));
		});

		expect(screen.getByRole('status')).toHaveTextContent(
			'Mise à jour en cours',
		);
		unwatch();
	});
});

import {
	_resetAppUpdate,
	isAppUpdating,
	subscribeAppUpdate,
	watchServiceWorkerUpdates,
} from './appUpdate';

function fakeWorker() {
	const worker = new EventTarget();
	worker.state = 'installing';
	return worker;
}

function fakeRegistration() {
	const registration = new EventTarget();
	registration.installing = null;
	registration.waiting = null;
	registration.update = vi.fn(() => Promise.resolve());
	return registration;
}

function startUpdate(registration) {
	const worker = fakeWorker();
	registration.installing = worker;
	registration.dispatchEvent(new Event('updatefound'));
	return worker;
}

function setController(controller) {
	const serviceWorker = new EventTarget();
	serviceWorker.controller = controller;
	Object.defineProperty(navigator, 'serviceWorker', {
		configurable: true,
		value: serviceWorker,
	});
	return serviceWorker;
}

describe('appUpdate', () => {
	let unwatch;

	afterEach(() => {
		unwatch?.();
		unwatch = undefined;
		_resetAppUpdate();
		delete navigator.serviceWorker;
		vi.useRealTimers();
	});

	it('signale une mise à jour quand un service worker contrôle déjà la page', () => {
		setController({});
		const registration = fakeRegistration();
		const listener = vi.fn();
		const unsubscribe = subscribeAppUpdate(listener);
		unwatch = watchServiceWorkerUpdates(registration);

		startUpdate(registration);

		expect(isAppUpdating()).toBe(true);
		expect(listener).toHaveBeenCalledOnce();
		unsubscribe();
	});

	it('ignore la première installation', () => {
		setController(null);
		const registration = fakeRegistration();
		unwatch = watchServiceWorkerUpdates(registration);

		startUpdate(registration);

		expect(isAppUpdating()).toBe(false);
	});

	it('voit une installation commencée avant l’abonnement', () => {
		setController({});
		const registration = fakeRegistration();
		registration.installing = fakeWorker();

		unwatch = watchServiceWorkerUpdates(registration);

		expect(isAppUpdating()).toBe(true);
	});

	it('voit une nouvelle version déjà installée avant l’abonnement', () => {
		setController({});
		const registration = fakeRegistration();
		registration.waiting = fakeWorker();

		unwatch = watchServiceWorkerUpdates(registration);

		expect(isAppUpdating()).toBe(true);
	});

	it('recharge la page quand la nouvelle version prend le contrôle', () => {
		const serviceWorker = setController({});
		const reload = vi.fn();
		unwatch = watchServiceWorkerUpdates(fakeRegistration(), { reload });

		serviceWorker.dispatchEvent(new Event('controllerchange'));
		serviceWorker.dispatchEvent(new Event('controllerchange'));

		expect(reload).toHaveBeenCalledOnce();
		expect(isAppUpdating()).toBe(true);
	});

	it('ne recharge pas à la première installation', () => {
		const serviceWorker = setController(null);
		const reload = vi.fn();
		unwatch = watchServiceWorkerUpdates(fakeRegistration(), { reload });

		serviceWorker.dispatchEvent(new Event('controllerchange'));

		expect(reload).not.toHaveBeenCalled();
	});

	it('recharge à la mise à jour qui suit une première installation', () => {
		const serviceWorker = setController(null);
		const reload = vi.fn();
		unwatch = watchServiceWorkerUpdates(fakeRegistration(), { reload });

		serviceWorker.controller = {};
		serviceWorker.dispatchEvent(new Event('controllerchange'));
		expect(reload).not.toHaveBeenCalled();

		serviceWorker.controller = {};
		serviceWorker.dispatchEvent(new Event('controllerchange'));
		expect(reload).toHaveBeenCalledOnce();
	});

	it('retire le spinner si l’installation échoue', () => {
		setController({});
		const registration = fakeRegistration();
		unwatch = watchServiceWorkerUpdates(registration);

		const worker = startUpdate(registration);
		worker.state = 'redundant';
		worker.dispatchEvent(new Event('statechange'));

		expect(isAppUpdating()).toBe(false);
	});

	it('cherche une nouvelle version toutes les heures et au retour au premier plan', () => {
		vi.useFakeTimers();
		const registration = fakeRegistration();
		unwatch = watchServiceWorkerUpdates(registration);

		vi.advanceTimersByTime(60 * 60 * 1000);
		expect(registration.update).toHaveBeenCalledOnce();

		document.dispatchEvent(new Event('visibilitychange'));
		expect(registration.update).toHaveBeenCalledTimes(2);
	});
});

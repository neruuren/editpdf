import { useSyncExternalStore } from 'react';
import { isAppUpdating, subscribeAppUpdate } from '../pwa/appUpdate';

// 🔹 Vrai pendant l'installation d'une nouvelle version de l'app.
export function useAppUpdate() {
	return useSyncExternalStore(subscribeAppUpdate, isAppUpdating);
}

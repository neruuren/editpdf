import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

function subscribe(callback) {
	return onlineManager.subscribe(callback);
}

function getSnapshot() {
	return onlineManager.isOnline();
}

// 🔹 En ligne ou non, d'après l'onlineManager de TanStack Query : la même
// source que celle qui pilote les requêtes, plutôt qu'un second écouteur
// `online` / `offline` qui pourrait le contredire.
export function useOnlineStatus() {
	return useSyncExternalStore(subscribe, getSnapshot);
}

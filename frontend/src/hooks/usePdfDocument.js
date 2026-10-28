import { useEffect, useState } from 'react';
import { getDocumentFile } from '../utils/documentFileCache';
import { openPdf } from '../utils/pdfEngine';

function initialState(isEncrypted) {
	return isEncrypted
		? { status: 'locked' }
		: { status: 'downloading', progress: null };
}

// 🔹 Ouvre la révision courante d'un document dans le moteur PDF :
// téléchargement (ou cache de session), puis ouverture dans le worker.
// État : { status: 'downloading' (progress de 0 à 1, ou null si la taille
// est inconnue) | 'opening' | 'ready' (pdf) | 'error' (error) | 'locked' }.
// 'locked' : PDF protégé par mot de passe, pas encore ouvert (T2b).
// Une nouvelle révision courante (nouvelle version, restauration) rouvre
// le nouveau fichier ; l'ancien document est fermé.
export function usePdfDocument(document) {
	const { id, currentRevision, isEncrypted } = document;
	const key = `${id}:${currentRevision}:${isEncrypted}`;
	// L'état porte la clé du fichier qu'il décrit : dès que la clé change,
	// l'ancien état (et son pdf, fermé) n'est plus jamais rendu.
	const [state, setState] = useState(() => ({
		key,
		...initialState(isEncrypted),
	}));

	useEffect(() => {
		if (isEncrypted) return undefined;
		let cancelled = false;
		let pdf = null;
		const update = (next) => {
			if (!cancelled) setState({ key, ...next });
		};
		getDocumentFile(id, currentRevision, {
			onProgress: (progress) => update({ status: 'downloading', progress }),
		})
			.then((data) => {
				if (cancelled) return null;
				update({ status: 'opening' });
				return openPdf(data);
			})
			.then((opened) => {
				if (!opened) return;
				if (cancelled) {
					opened.close().catch(() => {});
					return;
				}
				pdf = opened;
				update({ status: 'ready', pdf });
			})
			.catch((error) => update({ status: 'error', error }));
		return () => {
			cancelled = true;
			pdf?.close().catch(() => {});
		};
	}, [key, id, currentRevision, isEncrypted]);

	if (state.key !== key) return initialState(isEncrypted);
	return state;
}

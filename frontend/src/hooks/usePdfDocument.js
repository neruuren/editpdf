import { useCallback, useEffect, useRef, useState } from 'react';
import {
	forgetDocumentPassword,
	getDocumentFile,
	getDocumentPassword,
	rememberDocumentPassword,
} from '../utils/documentFileCache';
import { openPdf } from '../utils/pdfEngine';

const INITIAL_STATE = { status: 'downloading', progress: null };

// 🔹 Ouvre la révision courante d'un document dans le moteur PDF :
// téléchargement (ou cache de session), puis ouverture dans le worker.
// Renvoie { status, … } :
// - 'downloading' (progress de 0 à 1, ou null si la taille est inconnue),
//   puis 'opening' ;
// - 'password' : PDF protégé, en attente du mot de passe ; `unlock(mot de
//   passe)` l'essaie (→ 'ready' s'il est bon, sinon `isWrongPassword`) ; un
//   mot de passe déjà saisi dans la session est essayé tout seul ;
// - 'ready' (pdf) ou 'error' (error).
// Une nouvelle révision courante (nouvelle version, restauration) rouvre
// le nouveau fichier ; l'ancien document est fermé.
export function usePdfDocument(document) {
	const { id, currentRevision } = document;
	const key = `${id}:${currentRevision}`;
	// L'état porte la clé du fichier qu'il décrit : dès que la clé change,
	// l'ancien état (et son pdf, fermé) n'est plus jamais rendu.
	const [state, setState] = useState(() => ({ key, ...INITIAL_STATE }));
	// Document verrouillé en attente du mot de passe.
	const lockedRef = useRef(null);

	useEffect(() => {
		let cancelled = false;
		let opened = null;
		const update = (next) => {
			if (!cancelled) setState({ key, ...next });
		};
		async function open() {
			const data = await getDocumentFile(id, currentRevision, {
				onProgress: (progress) => update({ status: 'downloading', progress }),
			});
			if (cancelled) return;
			update({ status: 'opening' });
			opened = await openPdf(data);
			if (cancelled) {
				opened.close().catch(() => {});
				return;
			}
			if (!opened.needsPassword) {
				update({ status: 'ready', pdf: opened });
				return;
			}
			const saved = getDocumentPassword(id, currentRevision);
			const unlocked = saved ? await opened.unlock(saved) : null;
			if (cancelled) return;
			if (unlocked) {
				update({ status: 'ready', pdf: unlocked });
				return;
			}
			if (saved) forgetDocumentPassword(id, currentRevision);
			lockedRef.current = { key, pdf: opened };
			update({ status: 'password', isWrongPassword: false });
		}
		open().catch((error) => update({ status: 'error', error }));
		return () => {
			cancelled = true;
			lockedRef.current = null;
			opened?.close().catch(() => {});
		};
	}, [key, id, currentRevision]);

	const unlock = useCallback(
		async (password) => {
			const locked = lockedRef.current;
			if (!locked || locked.key !== key) return;
			const unlocked = await locked.pdf.unlock(password);
			if (lockedRef.current !== locked) return;
			if (unlocked) {
				lockedRef.current = null;
				rememberDocumentPassword(id, currentRevision, password);
				setState({ key, status: 'ready', pdf: unlocked });
			} else {
				setState({ key, status: 'password', isWrongPassword: true });
			}
		},
		[key, id, currentRevision],
	);

	if (state.key !== key) return INITIAL_STATE;
	return state.status === 'password' ? { ...state, unlock } : state;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
	forgetDocumentPassword,
	getDocumentFile,
	getDocumentPassword,
	rememberDocumentPassword,
} from '../utils/documentFileCache';
import { openPdf } from '../utils/pdfEngine';

const INITIAL_STATE = { status: 'downloading', progress: null };

function _closeAll(pdfs) {
	for (const pdf of pdfs) pdf.close().catch(() => {});
	pdfs.clear();
}

// 🔹 Ouvre la révision `revision` du document `id` dans le moteur PDF :
// téléchargement (ou cache de session), puis ouverture dans le worker.
// Renvoie { status, … } :
// - 'downloading' (progress de 0 à 1, ou null si la taille est inconnue),
//   puis 'opening' ;
// - 'password' : PDF protégé, en attente du mot de passe ; `unlock(mot de
//   passe)` l'essaie (→ 'ready' s'il est bon, sinon `isWrongPassword`) ; un
//   mot de passe déjà saisi dans la session est essayé tout seul ;
// - 'ready' (pdf, revision : celle qui est ouverte) ou 'error' (error).
// Une autre révision du même document (nouvelle version, restauration,
// annotations enregistrées) est ouverte sans quitter l'ancienne : elle
// reste affichée (`isReloading`) jusqu'à ce que la nouvelle soit prête,
// puis elle est fermée.
export function usePdfDocument(id, revision) {
	const key = `${id}:${revision}`;
	// L'état porte la clé du fichier qu'il décrit : dès que la clé change,
	// l'ancien état n'est plus rendu, sauf l'ancien PDF prêt du même document.
	const [state, setState] = useState(() => ({ key, ...INITIAL_STATE }));
	// Dernier PDF prêt : { key, id, revision, pdf }.
	const [shown, setShownState] = useState(null);
	const shownRef = useRef(null);
	// Document verrouillé en attente du mot de passe.
	const lockedRef = useRef(null);
	// PDF encore affichés le temps d'ouvrir la révision suivante.
	const retiringRef = useRef(new Set());

	const setShown = useCallback((value) => {
		shownRef.current = value;
		setShownState(value);
	}, []);

	useEffect(() => {
		let cancelled = false;
		let opened = null;
		const retiring = retiringRef.current;
		const update = (next) => {
			if (cancelled) return;
			setState({ key, ...next });
			if (next.status === 'ready') {
				setShown({ key, id, revision, pdf: next.pdf });
			} else if (next.status !== 'downloading' && next.status !== 'opening') {
				setShown(null);
			}
		};
		async function open() {
			const data = await getDocumentFile(id, revision, {
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
				update({ status: 'ready', pdf: opened, revision });
				return;
			}
			const saved = getDocumentPassword(id, revision);
			const unlocked = saved ? await opened.unlock(saved) : null;
			if (cancelled) return;
			if (unlocked) {
				update({ status: 'ready', pdf: unlocked, revision });
				return;
			}
			if (saved) forgetDocumentPassword(id, revision);
			lockedRef.current = { key, pdf: opened };
			update({ status: 'password', isWrongPassword: false });
		}
		open().catch((error) => update({ status: 'error', error }));
		return () => {
			cancelled = true;
			lockedRef.current = null;
			// Affiché : fermé seulement quand le suivant le remplace.
			if (shownRef.current?.key === key) {
				retiring.add(shownRef.current.pdf);
			} else {
				opened?.close().catch(() => {});
			}
		};
	}, [key, id, revision, setShown]);

	// La nouvelle révision a pris la place (ou a échoué) : les anciens PDF
	// ne sont plus affichés.
	const isSettled =
		state.key === key &&
		state.status !== 'downloading' &&
		state.status !== 'opening';
	useEffect(() => {
		if (isSettled) {
			const current = state.status === 'ready' ? state.pdf : null;
			for (const pdf of retiringRef.current) {
				if (pdf !== current) {
					pdf.close().catch(() => {});
					retiringRef.current.delete(pdf);
				}
			}
		}
	}, [isSettled, state]);

	// Après la fermeture de l'effet d'ouverture (même ordre que la
	// déclaration) : le PDF affiché vient d'y être mis de côté.
	useEffect(() => {
		const retiring = retiringRef.current;
		return () => _closeAll(retiring);
	}, []);

	const unlock = useCallback(
		async (password) => {
			const locked = lockedRef.current;
			if (!locked || locked.key !== key) return;
			const unlocked = await locked.pdf.unlock(password);
			if (lockedRef.current !== locked) return;
			if (unlocked) {
				lockedRef.current = null;
				rememberDocumentPassword(id, revision, password);
				setState({ key, status: 'ready', pdf: unlocked, revision });
				setShown({ key, id, revision, pdf: unlocked });
			} else {
				setState({ key, status: 'password', isWrongPassword: true });
			}
		},
		[key, id, revision, setShown],
	);

	if (state.key !== key || !isSettled) {
		// Une autre révision du même document s'ouvre : l'ancienne reste.
		if (shown?.id === id && shown.revision !== revision) {
			return {
				status: 'ready',
				pdf: shown.pdf,
				revision: shown.revision,
				isReloading: true,
			};
		}
		return state.key === key ? state : INITIAL_STATE;
	}
	return state.status === 'password' ? { ...state, unlock } : state;
}

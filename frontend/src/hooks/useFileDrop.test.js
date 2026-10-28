import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useFileDrop } from './useFileDrop';

// jsdom n'a pas de DragEvent : un Event portant un dataTransfer suffit.
function dragEvent(type, { files = [], types = ['Files'] } = {}) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	event.dataTransfer = { types, files, dropEffect: 'none' };
	return event;
}

function dispatch(event) {
	act(() => {
		window.dispatchEvent(event);
	});
	return event;
}

describe('useFileDrop', () => {
	it('signale le glissé et remet les fichiers déposés', () => {
		const onDrop = vi.fn();
		const { result } = renderHook(() =>
			useFileDrop({ onDrop, disabled: false }),
		);
		expect(result.current).toBe(false);

		dispatch(dragEvent('dragenter'));
		// Passage sur un élément enfant : toujours en cours.
		dispatch(dragEvent('dragenter'));
		dispatch(dragEvent('dragleave'));
		expect(result.current).toBe(true);
		const over = dispatch(dragEvent('dragover'));
		expect(over.defaultPrevented).toBe(true);
		expect(over.dataTransfer.dropEffect).toBe('copy');

		const file = new File(['a'], 'bail.pdf');
		const drop = dispatch(dragEvent('drop', { files: [file] }));
		expect(drop.defaultPrevented).toBe(true);
		expect(onDrop).toHaveBeenCalledWith([file]);
		expect(result.current).toBe(false);
	});

	it('s’arrête quand le glissé quitte la fenêtre', () => {
		const { result } = renderHook(() =>
			useFileDrop({ onDrop: vi.fn(), disabled: false }),
		);
		dispatch(dragEvent('dragenter'));
		dispatch(dragEvent('dragleave'));
		expect(result.current).toBe(false);
	});

	it('désactivé, intercepte le dépôt sans rien importer', () => {
		const onDrop = vi.fn();
		const { result } = renderHook(() =>
			useFileDrop({ onDrop, disabled: true }),
		);
		dispatch(dragEvent('dragenter'));
		expect(result.current).toBe(false);
		expect(dispatch(dragEvent('dragover')).dataTransfer.dropEffect).toBe(
			'none',
		);
		const drop = dispatch(
			dragEvent('drop', { files: [new File(['a'], 'bail.pdf')] }),
		);
		// Sinon le navigateur ouvrirait le fichier et quitterait l'app.
		expect(drop.defaultPrevented).toBe(true);
		expect(onDrop).not.toHaveBeenCalled();
	});

	it('ignore ce qui n’est pas un fichier (texte sélectionné)', () => {
		const onDrop = vi.fn();
		const { result } = renderHook(() =>
			useFileDrop({ onDrop, disabled: false }),
		);
		dispatch(dragEvent('dragenter', { types: ['text/plain'] }));
		expect(result.current).toBe(false);
		const drop = dispatch(dragEvent('drop', { types: ['text/plain'] }));
		expect(drop.defaultPrevented).toBe(false);
		expect(onDrop).not.toHaveBeenCalled();
	});
});

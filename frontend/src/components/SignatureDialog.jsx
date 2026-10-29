import { useEffect, useId, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import SignaturePad from './SignaturePad';
import { useCreateStamp, useDeleteStamp } from '../hooks/useStamps';
import { stampsAPI } from '../utils/api';
import {
	MAX_SIGNATURE_TEXT_LENGTH,
	SIGNATURE_COLORS,
	SIGNATURE_FONTS,
	drawnSignaturePng,
	loadSignatureFont,
	typedSignaturePng,
} from '../utils/signature';
import './SignatureDialog.css';

const MAX_NAME_LENGTH = 60;
const METHODS = [
	{ value: 'draw', label: 'Tracer' },
	{ value: 'type', label: 'Saisir' },
	{ value: 'image', label: 'Importer' },
];

const INITIAL = {
	isCreating: false,
	method: 'draw',
	strokes: [],
	padSize: null,
	text: '',
	fontId: SIGNATURE_FONTS[0].id,
	color: SIGNATURE_COLORS[0].value,
	file: null,
	name: '',
	message: null,
};

// 🔹 Signatures manuscrites (T6a), dans un <dialog> modal que le parent
// ouvre par `ref.current.showModal()` : choisir une signature gardée sur
// le serveur (`signatures`, tous appareils), en supprimer une, ou en créer
// une (tracée, saisie dans une police cursive, ou image PNG / JPEG
// importée), aussitôt choisie. `onChoose(signature)` ({ id, name, width,
// height }) ; `fieldLabel` : le champ de signature à remplir, s'il y en a
// un (sinon la signature se pose ensuite d'un clic sur la page).
function SignatureDialog({ ref, signatures, isLoading, fieldLabel, onChoose }) {
	const create = useCreateStamp();
	const remove = useDeleteStamp();
	const [state, setState] = useState(INITIAL);
	const [toDelete, setToDelete] = useState(null);
	const [isPreparing, setIsPreparing] = useState(false);
	const confirmRef = useRef(null);
	const titleId = useId();
	const methodName = useId();
	const fontName = useId();
	const colorName = useId();
	const isCreating =
		state.isCreating || (!isLoading && signatures.length === 0);
	const font =
		SIGNATURE_FONTS.find((item) => item.id === state.fontId) ??
		SIGNATURE_FONTS[0];

	// Aperçu des polices : chargées dès qu'on choisit de saisir.
	useEffect(() => {
		if (!isCreating || state.method !== 'type') return;
		for (const item of SIGNATURE_FONTS) loadSignatureFont(item).catch(() => {});
	}, [isCreating, state.method]);

	function update(changes) {
		setState((value) => ({ ...value, ...changes, message: null }));
	}

	function choose(signature) {
		onChoose(signature);
		ref.current?.close();
	}

	function handleClose() {
		setState(INITIAL);
		create.reset();
		remove.reset();
	}

	async function signatureFile() {
		if (state.method === 'image') return state.file;
		const blob =
			state.method === 'draw'
				? state.padSize &&
					(await drawnSignaturePng(state.strokes, state.padSize, state.color))
				: await typedSignaturePng(state.text, font, state.color);
		return blob
			? new File([blob], 'signature.png', { type: 'image/png' })
			: null;
	}

	async function handleSubmit(event) {
		event.preventDefault();
		create.reset();
		setIsPreparing(true);
		let file;
		try {
			file = await signatureFile();
		} catch {
			file = null;
		} finally {
			setIsPreparing(false);
		}
		if (!file) {
			setState((value) => ({
				...value,
				message:
					value.method === 'draw'
						? 'Tracez d’abord votre signature.'
						: value.method === 'type'
							? 'Saisissez d’abord votre nom.'
							: 'Choisissez d’abord une image.',
			}));
			return;
		}
		const name =
			state.name.trim() ||
			(state.method === 'type' ? state.text.trim() : '') ||
			'Signature';
		create.mutate(
			{ file, name: name.slice(0, MAX_NAME_LENGTH), kind: 'signature' },
			{
				onSuccess: choose,
				// Déjà là : on la choisit quand même.
				onError: (cause) => {
					const existing = signatures.find(
						(item) => item.id === cause.data?.stampId,
					);
					if (existing) choose(existing);
				},
			},
		);
	}

	function handleDeleteConfirm() {
		if (toDelete) remove.mutate(toDelete.id);
		setToDelete(null);
	}

	const error = state.message ?? create.error?.message ?? remove.error?.message;
	const isBusy = isPreparing || create.isPending;

	return (
		<dialog
			ref={ref}
			className="signature-dialog"
			aria-labelledby={titleId}
			onClose={handleClose}
		>
			<h2 id={titleId} className="signature-dialog__title">
				Signer
			</h2>
			<p className="signature-dialog__hint">
				{fieldLabel
					? `La signature sera posée dans le champ « ${fieldLabel} ».`
					: 'Choisissez une signature, puis touchez la page à l’endroit où la poser.'}
			</p>

			{!isCreating && (
				<>
					{isLoading && <p className="signature-dialog__hint">Chargement…</p>}
					<ul className="signature-dialog__list" role="list">
						{signatures.map((signature) => (
							<li key={signature.id} className="signature-dialog__item">
								<button
									type="button"
									className="signature-dialog__choice"
									onClick={() => choose(signature)}
								>
									<img
										className="signature-dialog__image"
										src={stampsAPI.imageUrl(signature.id)}
										alt=""
										width={signature.width}
										height={signature.height}
									/>
									<span className="signature-dialog__name">
										{signature.name}
									</span>
								</button>
								<button
									type="button"
									className="button button--ghost signature-dialog__danger"
									aria-label={`Supprimer ${signature.name}`}
									disabled={remove.isPending}
									onClick={() => {
										setToDelete(signature);
										confirmRef.current?.showModal();
									}}
								>
									Supprimer
								</button>
							</li>
						))}
					</ul>
					{error && (
						<p className="signature-dialog__error" role="alert">
							{error}
						</p>
					)}
					<div className="signature-dialog__actions">
						<button
							type="button"
							className="button button--ghost"
							onClick={() => ref.current?.close()}
						>
							Annuler
						</button>
						<button
							type="button"
							className="button"
							onClick={() => update({ isCreating: true })}
						>
							Nouvelle signature
						</button>
					</div>
				</>
			)}

			{isCreating && (
				<form className="signature-dialog__form" onSubmit={handleSubmit}>
					<fieldset className="signature-dialog__methods">
						<legend className="visually-hidden">Manière de signer</legend>
						{METHODS.map((method) => (
							<label key={method.value} className="signature-dialog__method">
								<input
									type="radio"
									name={methodName}
									value={method.value}
									checked={state.method === method.value}
									onChange={() => update({ method: method.value })}
								/>
								{method.label}
							</label>
						))}
					</fieldset>

					{state.method === 'draw' && (
						<div className="signature-dialog__panel">
							<SignaturePad
								strokes={state.strokes}
								color={state.color}
								label="Zone où tracer la signature"
								onChange={(strokes, padSize) => update({ strokes, padSize })}
							/>
							<button
								type="button"
								className="button button--ghost"
								disabled={state.strokes.length === 0}
								onClick={() => update({ strokes: [] })}
							>
								Effacer
							</button>
						</div>
					)}

					{state.method === 'type' && (
						<div className="signature-dialog__panel">
							<label className="field">
								<span className="field__label">Votre nom</span>
								<input
									className="field__input"
									value={state.text}
									maxLength={MAX_SIGNATURE_TEXT_LENGTH}
									autoComplete="name"
									onChange={(event) => update({ text: event.target.value })}
								/>
							</label>
							<fieldset className="signature-dialog__fonts">
								<legend className="field__label">Écriture</legend>
								{SIGNATURE_FONTS.map((item) => (
									<label key={item.id} className="signature-dialog__font">
										<input
											type="radio"
											name={fontName}
											checked={state.fontId === item.id}
											onChange={() => update({ fontId: item.id })}
										/>
										<span
											className="signature-dialog__sample"
											style={{
												fontFamily: `"${item.family}", cursive`,
												color: state.color,
											}}
										>
											{state.text.trim() || item.label}
										</span>
									</label>
								))}
							</fieldset>
						</div>
					)}

					{state.method === 'image' && (
						<div className="signature-dialog__panel">
							<label className="field">
								<span className="field__label">
									Image PNG (transparente de préférence) ou JPEG
								</span>
								<input
									className="field__input"
									type="file"
									accept="image/png,image/jpeg"
									onChange={(event) =>
										update({ file: event.target.files[0] ?? null })
									}
								/>
							</label>
						</div>
					)}

					<div className="signature-dialog__row">
						{state.method !== 'image' && (
							<fieldset className="signature-dialog__colors">
								<legend className="field__label">Couleur</legend>
								{SIGNATURE_COLORS.map((item) => (
									<label key={item.value} className="signature-dialog__color">
										<input
											type="radio"
											name={colorName}
											checked={state.color === item.value}
											onChange={() => update({ color: item.value })}
										/>
										<span
											className="signature-dialog__swatch"
											style={{ background: item.value }}
											aria-hidden="true"
										/>
										{item.label}
									</label>
								))}
							</fieldset>
						)}
						<label className="field signature-dialog__name-field">
							<span className="field__label">Nom (facultatif)</span>
							<input
								className="field__input"
								value={state.name}
								maxLength={MAX_NAME_LENGTH}
								onChange={(event) => update({ name: event.target.value })}
							/>
						</label>
					</div>

					<p className="signature-dialog__hint">
						Gardée sur le serveur pour tous vos appareils. Ce n’est pas une
						signature numérique certifiée.
					</p>
					{error && (
						<p className="signature-dialog__error" role="alert">
							{error}
						</p>
					)}
					<div className="signature-dialog__actions">
						<button
							type="button"
							className="button button--ghost"
							onClick={() =>
								signatures.length > 0 ? setState(INITIAL) : ref.current?.close()
							}
						>
							{signatures.length > 0 ? 'Retour' : 'Annuler'}
						</button>
						<button
							type="submit"
							className="button button--primary"
							disabled={isBusy}
						>
							{isBusy ? 'Enregistrement…' : 'Enregistrer et signer'}
						</button>
					</div>
				</form>
			)}

			<ConfirmDialog
				ref={confirmRef}
				title="Supprimer cette signature ?"
				confirmLabel="Supprimer la signature"
				onConfirm={handleDeleteConfirm}
			>
				<p>
					La signature « {toDelete?.name} » sera supprimée de vos signatures.
					Les documents où elle est déjà posée la gardent.
				</p>
			</ConfirmDialog>
		</dialog>
	);
}

export default SignatureDialog;

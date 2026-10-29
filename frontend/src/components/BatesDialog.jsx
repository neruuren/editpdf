import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNumberDocuments } from '../hooks/useDocuments';
import { useDocumentOrder } from '../hooks/useDocumentOrder';
import { HEADER_SLOTS } from '../utils/pageSetup';
import DocumentOrderList from './DocumentOrderList';
import './BatesDialog.css';

// Numéro Bates tel qu'écrit (« DOS-000041 »).
function batesLabel({ prefix, suffix, digits }, value) {
	return `${prefix}${String(value).padStart(digits, '0')}${suffix}`;
}

function integerOf(value, fallback) {
	const number = Number.parseInt(value, 10);
	return Number.isFinite(number) ? number : fallback;
}

// 🔹 Numérotation Bates d'un lot de documents de la bibliothèque (T5b),
// dans un <dialog> modal que le parent ouvre par `ref.current.showModal()`
// : les documents choisis (`documents`) se remettent en ordre, puis le
// serveur numérote leurs pages à la suite (préfixe, premier numéro,
// chiffres, suffixe, emplacement), à la place des en-têtes posés par
// editpdf ; chaque document reçoit une nouvelle révision. Un document
// protégé ne se numérote pas. `onNumbered()` après la numérotation.
function BatesDialog({ ref, documents, onNumbered }) {
	const numbering = useNumberDocuments();
	const { ordered, move, reset } = useDocumentOrder(documents);
	const [settings, setSettings] = useState({
		prefix: '',
		suffix: '',
		start: '1',
		digits: '6',
		slot: 'bottomRight',
		fontSize: '9',
	});
	const [result, setResult] = useState(null);
	const titleId = useId();
	const locked = ordered.filter((document) => document.isEncrypted);
	const pageCount = ordered.reduce(
		(sum, document) => sum + document.pageCount,
		0,
	);
	const parsed = {
		prefix: settings.prefix,
		suffix: settings.suffix,
		start: Math.max(0, integerOf(settings.start, 1)),
		digits: Math.min(12, Math.max(1, integerOf(settings.digits, 6))),
	};

	function update(changes) {
		setSettings((value) => ({ ...value, ...changes }));
	}

	function handleSubmit(event) {
		event.preventDefault();
		numbering.mutate(
			{
				documentIds: ordered.map((document) => document.id),
				...parsed,
				slot: settings.slot,
				fontSize: Math.min(
					72,
					Math.max(4, Number.parseFloat(settings.fontSize) || 9),
				),
			},
			{
				onSuccess: (data) => {
					setResult(data);
					onNumbered?.();
				},
			},
		);
	}

	function handleClose() {
		setResult(null);
		reset();
		numbering.reset();
	}

	return (
		<dialog
			ref={ref}
			className="bates-dialog"
			aria-labelledby={titleId}
			onClose={handleClose}
		>
			<h2 id={titleId} className="bates-dialog__title">
				Numérotation Bates
			</h2>
			{result ? (
				<>
					<p>
						Pages numérotées de {batesLabel(parsed, result.first)} à{' '}
						{batesLabel(parsed, result.last)} :
					</p>
					<ul className="bates-dialog__results">
						{result.documents.map((document) => (
							<li key={document.id}>
								<Link to={`/documents/${document.id}`}>{document.title}</Link>
							</li>
						))}
					</ul>
					<div className="bates-dialog__actions">
						<button
							type="button"
							className="button button--primary"
							onClick={() => ref.current.close()}
						>
							Fermer
						</button>
					</div>
				</>
			) : (
				<form onSubmit={handleSubmit}>
					<p>
						{ordered.length > 1
							? `${ordered.length} documents, numérotés dans cet ordre :`
							: 'Document à numéroter :'}
					</p>
					<DocumentOrderList documents={ordered} onMove={move} />
					<div className="bates-dialog__grid">
						<label className="field">
							<span className="field__label">Préfixe</span>
							<input
								className="field__input"
								value={settings.prefix}
								maxLength={40}
								onChange={(event) => update({ prefix: event.target.value })}
							/>
						</label>
						<label className="field">
							<span className="field__label">Premier numéro</span>
							<input
								className="field__input"
								type="number"
								min="0"
								required
								value={settings.start}
								onChange={(event) => update({ start: event.target.value })}
							/>
						</label>
						<label className="field">
							<span className="field__label">Chiffres</span>
							<input
								className="field__input"
								type="number"
								min="1"
								max="12"
								required
								value={settings.digits}
								onChange={(event) => update({ digits: event.target.value })}
							/>
						</label>
						<label className="field">
							<span className="field__label">Suffixe</span>
							<input
								className="field__input"
								value={settings.suffix}
								maxLength={40}
								onChange={(event) => update({ suffix: event.target.value })}
							/>
						</label>
						<label className="field">
							<span className="field__label">Emplacement</span>
							<select
								className="field__input"
								value={settings.slot}
								onChange={(event) => update({ slot: event.target.value })}
							>
								{HEADER_SLOTS.map(({ id, label }) => (
									<option key={id} value={id}>
										{label}
									</option>
								))}
							</select>
						</label>
						<label className="field">
							<span className="field__label">Taille (pt)</span>
							<input
								className="field__input"
								type="number"
								min="4"
								max="72"
								required
								value={settings.fontSize}
								onChange={(event) => update({ fontSize: event.target.value })}
							/>
						</label>
					</div>
					<p>
						De <strong>{batesLabel(parsed, parsed.start)}</strong> à{' '}
						<strong>{batesLabel(parsed, parsed.start + pageCount - 1)}</strong>{' '}
						({pageCount} pages).
					</p>
					<p className="bates-dialog__note">
						Chaque document reçoit une nouvelle révision ; les en-têtes et pieds
						de page posés par editpdf y sont remplacés.
					</p>
					{locked.length > 0 && (
						<p className="bates-dialog__error">
							Un document protégé par mot de passe ne se numérote pas :
							retirez-le de la sélection.
						</p>
					)}
					{numbering.error && (
						<p className="bates-dialog__error" role="alert">
							{numbering.error.message}
						</p>
					)}
					<div className="bates-dialog__actions">
						<button
							type="button"
							className="button button--ghost"
							onClick={() => ref.current.close()}
						>
							Annuler
						</button>
						<button
							type="submit"
							className="button button--primary"
							disabled={
								numbering.isPending || locked.length > 0 || ordered.length < 1
							}
						>
							{numbering.isPending ? 'Numérotation…' : 'Numéroter'}
						</button>
					</div>
				</form>
			)}
		</dialog>
	);
}

export default BatesDialog;

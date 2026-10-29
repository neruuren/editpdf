import { useEffect, useRef, useState } from 'react';
import { pageLayerTransform } from '../utils/viewer';
import './PdfFormLayer.css';

const NO_FIELDS = [];
// Taille du texte d'un champ en taille automatique (/DA « 0 Tf ») : à la
// hauteur du champ, comme le dessine MuPDF, sans dépasser 12 points.
const AUTO_FONT_RATIO = 0.65;
const MAX_AUTO_FONT_SIZE = 12;

function _box([x0, y0, x1, y1], scale) {
	return {
		insetInlineStart: x0 * scale,
		insetBlockStart: y0 * scale,
		inlineSize: Math.max(x1 - x0, 0) * scale,
		blockSize: Math.max(y1 - y0, 0) * scale,
	};
}

function _fontSize(field, scale) {
	const height = field.rect[3] - field.rect[1];
	const size =
		field.fontSize ||
		Math.min(height * AUTO_FONT_RATIO, MAX_AUTO_FONT_SIZE) ||
		MAX_AUTO_FONT_SIZE;
	return `${size * scale}px`;
}

function _label(field) {
	return field.label || field.name || 'Champ';
}

// Champ texte (ou liste modifiable) : la saisie n'est visible que pendant
// qu'on écrit, le reste du temps la page montre l'apparence dessinée par
// MuPDF. La valeur est écrite dans le PDF en quittant le champ (ou par
// Entrée sur une ligne) ; Échap l'abandonne.
function FormTextField({ field, shown, scale, isLocked, listId, onCommit }) {
	const [draft, setDraft] = useState(null);
	// Échap : le blur qui suit n'écrit rien.
	const isCancelledRef = useRef(false);
	const isEditing = draft !== null;
	const Element = field.isMultiline ? 'textarea' : 'input';

	function commit() {
		const isCancelled = isCancelledRef.current;
		isCancelledRef.current = false;
		if (!isCancelled && draft !== null && draft !== shown) onCommit(draft);
		setDraft(null);
	}

	function handleKeyDown(event) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			isCancelledRef.current = true;
			event.currentTarget.blur();
		} else if (event.key === 'Enter' && !field.isMultiline) {
			event.preventDefault();
			event.currentTarget.blur();
		}
	}

	return (
		<Element
			className="pdf-form-layer__field pdf-form-layer__text"
			data-editing={isEditing}
			data-pending={shown !== field.value}
			type={
				Element === 'input' ? (field.isPassword ? 'password' : 'text') : null
			}
			value={draft ?? shown}
			maxLength={field.maxLength > 0 ? field.maxLength : null}
			list={listId}
			aria-label={_label(field)}
			aria-required={field.isRequired || null}
			title={_label(field)}
			readOnly={isLocked}
			autoComplete="off"
			spellCheck={false}
			style={{
				fontSize: _fontSize(field, scale),
				textAlign: field.align,
			}}
			onFocus={() => setDraft(shown)}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={handleKeyDown}
		/>
	);
}

// 🔹 Calque des champs de formulaire d'une page rendue (T6a), dans le
// repère de la page non tournée, comme les autres calques : chaque champ
// modifiable est un vrai contrôle (saisie, case, bouton radio, liste) posé
// sur son apparence, au clavier dans l'ordre du PDF. La page montre ce que
// MuPDF a dessiné ; une saisie n'est visible que pendant qu'on écrit, et
// jusqu'à ce que la page soit redessinée avec la nouvelle valeur.
// `onChange(field, value)` (texte, booléen coché ou valeur de liste) →
// promesse du résultat ; `onSign(field)` : un champ de signature vide.
// Les champs sont relus à chaque version de la page (`version`).
function PdfFormLayer({
	pdf,
	index,
	page,
	scale,
	rotation,
	version,
	renderedVersion,
	isLocked,
	onChange,
	onSign,
}) {
	const [fields, setFields] = useState(NO_FIELDS);
	// Valeurs écrites, montrées jusqu'au rendu suivant de la page : id →
	// { value, version (rendu de la page au moment de l'écriture) }.
	const [pending, setPending] = useState(() => new Map());

	useEffect(() => {
		const controller = new AbortController();
		pdf
			.getFormFields(index, { signal: controller.signal })
			.then(setFields)
			.catch(() => {});
		return () => controller.abort();
	}, [pdf, index, version]);

	function shownValue(field, fallback) {
		const item = pending.get(field.id);
		return item && item.version === renderedVersion ? item.value : fallback;
	}

	async function change(field, value) {
		setPending((map) =>
			new Map(map).set(field.id, { value, version: renderedVersion }),
		);
		const result = await onChange(field, value);
		// Rien n'a changé (ou refusé) : la page ne sera pas redessinée.
		if (!result?.pages?.length) {
			setPending((map) => {
				const next = new Map(map);
				next.delete(field.id);
				return next;
			});
		}
	}

	if (fields.length === 0) return null;
	return (
		<div
			className="pdf-form-layer"
			style={{
				inlineSize: page.width * scale,
				blockSize: page.height * scale,
				transform: pageLayerTransform(page, scale, rotation),
			}}
			// Un clic dans un champ ne touche pas la page (annotations…).
			onClick={(event) => event.stopPropagation()}
		>
			{fields.map((field) => {
				if (field.isReadOnly) return null;
				const key = `${field.id}`;
				const style = _box(field.rect, scale);
				switch (field.type) {
					case 'text':
						return (
							<div key={key} className="pdf-form-layer__item" style={style}>
								<FormTextField
									field={field}
									shown={shownValue(field, field.value)}
									scale={scale}
									isLocked={isLocked}
									onCommit={(value) => change(field, value)}
								/>
							</div>
						);
					case 'checkbox':
					case 'radio':
						return (
							<div key={key} className="pdf-form-layer__item" style={style}>
								<input
									className="pdf-form-layer__field pdf-form-layer__toggle"
									type={field.type}
									name={
										field.type === 'radio'
											? `pdf-form-${index}-${field.name}`
											: undefined
									}
									checked={shownValue(field, field.isOn)}
									aria-label={_label(field)}
									aria-required={field.isRequired || null}
									title={_label(field)}
									disabled={isLocked}
									onChange={(event) =>
										change(
											field,
											field.type === 'radio' ? true : event.target.checked,
										)
									}
								/>
							</div>
						);
					case 'combobox': {
						if (field.isEditable) {
							const listId = `pdf-form-${index}-${field.id}-choices`;
							return (
								<div key={key} className="pdf-form-layer__item" style={style}>
									<FormTextField
										field={field}
										shown={shownValue(field, field.value)}
										scale={scale}
										isLocked={isLocked}
										listId={listId}
										onCommit={(value) => change(field, value)}
									/>
									<datalist id={listId}>
										{field.options.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</datalist>
								</div>
							);
						}
					}
					// fallthrough : une liste déroulante est un <select>.
					case 'listbox': {
						const value = shownValue(field, field.value);
						const isList = field.type === 'listbox';
						const hasValue = field.options.some(
							(option) => option.value === value,
						);
						return (
							<div key={key} className="pdf-form-layer__item" style={style}>
								<select
									className={`pdf-form-layer__field pdf-form-layer__${isList ? 'list' : 'choice'}`}
									value={value}
									size={isList ? Math.max(field.options.length, 2) : undefined}
									aria-label={_label(field)}
									aria-required={field.isRequired || null}
									title={_label(field)}
									disabled={isLocked}
									style={{ fontSize: _fontSize(field, scale) }}
									onChange={(event) => change(field, event.target.value)}
								>
									{!hasValue && <option value={value}>{value}</option>}
									{field.options.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</div>
						);
					}
					case 'signature':
						if (field.isSigned) return null;
						return (
							<div key={key} className="pdf-form-layer__item" style={style}>
								<button
									type="button"
									className="pdf-form-layer__field pdf-form-layer__sign"
									title="Signer"
									disabled={isLocked}
									onClick={() => onSign(field)}
								>
									<span className="visually-hidden">
										Signer : {_label(field)}
									</span>
								</button>
							</div>
						);
					default:
						return null;
				}
			})}
		</div>
	);
}

export default PdfFormLayer;

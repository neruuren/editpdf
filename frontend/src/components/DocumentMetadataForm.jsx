import { useId } from 'react';
import './DocumentMetadataForm.css';

const FIELDS = [
	{ name: 'title', label: 'Titre', required: true, maxLength: 500 },
	{ name: 'author', label: 'Auteur', maxLength: 500 },
	{ name: 'subject', label: 'Sujet', maxLength: 2000, multiline: true },
];

// 🔹 Titre, auteur et sujet d'un document, enregistrés en base seulement :
// le PDF lui-même n'est pas réécrit. Champs non contrôlés : le formulaire
// repart des valeurs du serveur à chaque enregistrement (key du parent).
// `update` (useUpdateDocument) vient du parent : remonté à chaque
// enregistrement, le formulaire perdrait sinon son « Enregistré ».
function DocumentMetadataForm({ document, update }) {
	const formId = useId();

	function handleSubmit(event) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const changes = Object.fromEntries(
			FIELDS.map(({ name }) => [name, form.get(name)]),
		);
		update.mutate({ id: document.id, changes });
	}

	return (
		<form className="document-metadata-form" onSubmit={handleSubmit}>
			{FIELDS.map((field) => {
				const id = `${formId}-${field.name}`;
				const Control = field.multiline ? 'textarea' : 'input';
				return (
					<div key={field.name} className="field">
						<label htmlFor={id} className="field__label">
							{field.label}
						</label>
						<Control
							id={id}
							name={field.name}
							className="field__input"
							defaultValue={document[field.name] ?? ''}
							required={field.required}
							maxLength={field.maxLength}
							rows={field.multiline ? 3 : undefined}
						/>
					</div>
				);
			})}
			<div className="document-metadata-form__actions">
				<button
					type="submit"
					className="button button--primary"
					disabled={update.isPending}
				>
					{update.isPending && <span className="spinner" aria-hidden="true" />}
					Enregistrer
				</button>
				<p className="document-metadata-form__status" role="status">
					{update.isSuccess && 'Enregistré.'}
					{update.isError && (
						<span className="document-metadata-form__error">
							{update.error.message}
						</span>
					)}
				</p>
			</div>
		</form>
	);
}

export default DocumentMetadataForm;

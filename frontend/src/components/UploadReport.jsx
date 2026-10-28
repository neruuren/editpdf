import { Link } from 'react-router-dom';
import { formatUploadProgress } from '../utils/library';
import './UploadReport.css';

// « 2 documents importés » : chaque mot s'accorde.
function pluralize(count, words) {
	const text = count > 1 ? words.replace(/(\S)(?=\s|$)/g, '$1s') : words;
	return `${count} ${text}`;
}

// 🔹 Compte rendu de l'import (`useUploadDocuments`) : avancement pendant
// l'envoi, puis le nombre de documents importés et chaque échec, avec un
// lien vers le document déjà présent pour un doublon. Reste affiché jusqu'à
// sa fermeture, le temps de lire les échecs.
function UploadReport({ upload, progress }) {
	function handleCloseClick() {
		upload.reset();
	}

	const result = upload.data;
	const hasReport =
		upload.isError || result?.failed.length > 0 || result?.imported.length > 0;

	return (
		// Toujours présente : une région live doit exister avant son contenu
		// pour que les lecteurs d'écran annoncent le résultat.
		<div className="upload-report" role="status">
			{upload.isPending && (
				<p className="upload-report__bubble">
					<span className="spinner" aria-hidden="true" />
					{formatUploadProgress(progress)}
				</p>
			)}
			{hasReport && (
				<div className="upload-report__bubble">
					<div className="upload-report__messages">
						{upload.isError && (
							<p className="upload-report__error">{upload.error.message}</p>
						)}
						{result?.imported.length > 0 && (
							<p>{pluralize(result.imported.length, 'document importé')}.</p>
						)}
						{result?.failed.length > 0 && (
							<ul className="upload-report__error">
								{result.failed.map((failure) => (
									<li key={failure.name}>
										{failure.name} : {failure.message}
										{failure.documentId && (
											<>
												{' '}
												<Link to={`/documents/${failure.documentId}`}>
													Voir le document
												</Link>
											</>
										)}
									</li>
								))}
							</ul>
						)}
					</div>
					<button
						type="button"
						className="button button--ghost upload-report__close"
						onClick={handleCloseClick}
						aria-label="Fermer le compte rendu de l’import"
					>
						<span aria-hidden="true">✕</span>
					</button>
				</div>
			)}
		</div>
	);
}

export default UploadReport;

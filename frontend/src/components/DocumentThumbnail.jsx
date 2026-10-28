import { useState } from 'react';
import { documentsAPI } from '../utils/api';
import './DocumentThumbnail.css';

// 🔹 Vignette d'un document : la miniature de sa page 1 (faite par le
// serveur), sinon un aplat « PDF », ou un cadenas pour un PDF protégé (le
// serveur ne peut pas en dessiner la page). Décorative : le titre est à côté.
function DocumentThumbnail({ document, className = '' }) {
	const [hasFailed, setHasFailed] = useState(false);
	const classes = `document-thumbnail ${className}`;

	function handleError() {
		setHasFailed(true);
	}

	if (document.hasThumbnail && !hasFailed) {
		return (
			<img
				className={classes}
				src={documentsAPI.thumbnailUrl(document)}
				alt=""
				loading="lazy"
				decoding="async"
				onError={handleError}
			/>
		);
	}
	return (
		<div
			className={`${classes} document-thumbnail--placeholder`}
			aria-hidden="true"
		>
			{document.isEncrypted ? '🔒' : 'PDF'}
		</div>
	);
}

export default DocumentThumbnail;

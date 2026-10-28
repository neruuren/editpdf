// 🔹 Client HTTP de l'API. Même origine en prod (Express sert le front) et
// proxy Vite en dev : le cookie de session HttpOnly part tout seul.

// `data` : ce que le serveur joint à l'erreur (ex. { documentId } pour un doublon).
export class ApiError extends Error {
	constructor(message, status, data) {
		super(message);
		this.status = status;
		this.data = data;
	}
}

// Renvoie `data` de la réponse { success, data } ; lève une ApiError sinon.
// Un FormData part tel quel : le navigateur pose lui-même le Content-Type
// multipart avec sa boundary. `keepalive` : la requête survit à la
// fermeture de la page (position de lecture enregistrée en partant).
async function request(path, { method = 'GET', body, keepalive } = {}) {
	const isFormData = body instanceof FormData;
	const response = await fetch(`/api${path}`, {
		method,
		credentials: 'same-origin',
		keepalive,
		headers:
			body && !isFormData ? { 'Content-Type': 'application/json' } : undefined,
		body: body && !isFormData ? JSON.stringify(body) : body,
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok || !payload?.success) {
		throw new ApiError(
			payload?.error || `Erreur ${response.status}`,
			response.status,
			payload?.data,
		);
	}
	return payload.data;
}

export const authAPI = {
	login: (credentials) =>
		request('/auth/login', { method: 'POST', body: credentials }),
	logout: () => request('/auth/logout', { method: 'POST' }),
	// null = pas de session (401 attendu), pas une erreur.
	me: async () => {
		try {
			return await request('/auth/me');
		} catch (error) {
			if (error.status === 401) return null;
			throw error;
		}
	},
};

const documentPath = (id) => `/v1/documents/${encodeURIComponent(id)}`;

export const documentsAPI = {
	list: () => request('/v1/documents'),
	get: (id) => request(documentPath(id)),
	upload: (file) => {
		const formData = new FormData();
		formData.append('file', file);
		return request('/v1/documents', { method: 'POST', body: formData });
	},
	update: ({ id, changes }) =>
		request(documentPath(id), { method: 'PATCH', body: changes }),
	remove: (id) => request(documentPath(id), { method: 'DELETE' }),
	// Page lue dans la visionneuse (1 = première) : reprise et date d'ouverture.
	setReading: ({ id, page, keepalive }) =>
		request(`${documentPath(id)}/reading`, {
			method: 'PUT',
			body: { page },
			keepalive,
		}),
	setTags: ({ id, tags }) =>
		request(`${documentPath(id)}/tags`, { method: 'PUT', body: { tags } }),
	setCollections: ({ id, collectionIds }) =>
		request(`${documentPath(id)}/collections`, {
			method: 'PUT',
			body: { collectionIds },
		}),
	// URL directes (<img>, lien de téléchargement) : le cookie de session part
	// avec, même origine. `?v=` change avec la révision courante : le cache
	// du navigateur ne montre jamais une ancienne miniature.
	thumbnailUrl: (document) =>
		`/api/v1/documents/${encodeURIComponent(document.id)}/thumbnail?v=${document.currentRevision}`,
	fileUrl: (id) => `/api/v1/documents/${encodeURIComponent(id)}/file`,
	revisionFileUrl: (id, number) =>
		`/api/v1/documents/${encodeURIComponent(id)}/revisions/${number}/file`,
};

// Les mutations renvoient le document mis à jour (sauf remove).
export const revisionsAPI = {
	list: (id) => request(`${documentPath(id)}/revisions`),
	// `origin` 'annotate' : enregistrement de la visionneuse ; `baseRevision` :
	// révision ouverte au début des modifications (409 si ce n'est plus la
	// courante, avec data.currentRevision).
	upload: ({ id, file, origin, baseRevision }) => {
		const formData = new FormData();
		// Les champs avant le fichier : le serveur les lit dans l'ordre.
		if (origin) formData.append('origin', origin);
		if (baseRevision !== undefined) {
			formData.append('baseRevision', String(baseRevision));
		}
		formData.append('file', file);
		return request(`${documentPath(id)}/revisions`, {
			method: 'POST',
			body: formData,
		});
	},
	restore: ({ id, number }) =>
		request(`${documentPath(id)}/revisions/${number}/restore`, {
			method: 'POST',
		}),
	remove: ({ id, number }) =>
		request(`${documentPath(id)}/revisions/${number}`, { method: 'DELETE' }),
};

// Signets personnels : [{ page (1 = première), label | null, createdAt }].
export const bookmarksAPI = {
	list: (id) => request(`${documentPath(id)}/bookmarks`),
	set: ({ id, page, label = null }) =>
		request(`${documentPath(id)}/bookmarks/${page}`, {
			method: 'PUT',
			body: { label },
		}),
	remove: ({ id, page }) =>
		request(`${documentPath(id)}/bookmarks/${page}`, { method: 'DELETE' }),
};

const collectionPath = (id) => `/v1/collections/${encodeURIComponent(id)}`;

export const collectionsAPI = {
	list: () => request('/v1/collections'),
	create: (name) =>
		request('/v1/collections', { method: 'POST', body: { name } }),
	rename: ({ id, name }) =>
		request(collectionPath(id), { method: 'PATCH', body: { name } }),
	remove: (id) => request(collectionPath(id), { method: 'DELETE' }),
};

// Recherche dans le contenu : [{ documentId, page, snippet, pageCount }].
export const searchAPI = {
	search: (query) => request(`/v1/search?q=${encodeURIComponent(query)}`),
};

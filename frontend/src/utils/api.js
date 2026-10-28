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
// multipart avec sa boundary.
async function request(path, { method = 'GET', body } = {}) {
	const isFormData = body instanceof FormData;
	const response = await fetch(`/api${path}`, {
		method,
		credentials: 'same-origin',
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

export const documentsAPI = {
	list: () => request('/v1/documents'),
	get: (id) => request(`/v1/documents/${encodeURIComponent(id)}`),
	upload: (file) => {
		const formData = new FormData();
		formData.append('file', file);
		return request('/v1/documents', { method: 'POST', body: formData });
	},
	update: ({ id, changes }) =>
		request(`/v1/documents/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body: changes,
		}),
	remove: (id) =>
		request(`/v1/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
	// URL directes (<img>, lien de téléchargement) : le cookie de session part
	// avec, même origine. `?v=` change avec la révision courante : le cache
	// du navigateur ne montre jamais une ancienne miniature.
	thumbnailUrl: (document) =>
		`/api/v1/documents/${encodeURIComponent(document.id)}/thumbnail?v=${document.currentRevision}`,
	fileUrl: (id) => `/api/v1/documents/${encodeURIComponent(id)}/file`,
	revisionFileUrl: (id, number) =>
		`/api/v1/documents/${encodeURIComponent(id)}/revisions/${number}/file`,
};

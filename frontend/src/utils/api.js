// 🔹 Client HTTP de l'API. Même origine en prod (Express sert le front) et
// proxy Vite en dev : le cookie de session HttpOnly part tout seul.

export class ApiError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
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

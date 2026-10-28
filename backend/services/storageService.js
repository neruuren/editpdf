const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

// 🔹 Fichiers des documents dans DATA_DIR (volume Docker en prod) :
//   documents/<id>/original.pdf, documents/<id>/r<n>.pdf (révisions),
//   documents/<id>/thumbnail.jpg, tmp/ (uploads en cours de validation).
// Un dossier par document : le supprimer emporte tout ce qui le concerne.
// La base ne stocke que des chemins RELATIFS à DATA_DIR : le dossier peut
// être déplacé (autre volume, restauration de sauvegarde) sans migration.

const DOCUMENTS_DIR = 'documents';
const TMP_DIR = path.join(env.dataDir, 'tmp');

// Chemin relatif (venu de la base) → absolu, sans jamais sortir de DATA_DIR.
function resolve(relativePath) {
	const absolute = path.resolve(env.dataDir, relativePath);
	if (!absolute.startsWith(env.dataDir + path.sep)) {
		throw new Error(`Chemin hors de DATA_DIR : ${relativePath}`);
	}
	return absolute;
}

function _documentDir(id) {
	return path.join(DOCUMENTS_DIR, id);
}

async function _write(relativePath, writeFn) {
	const absolute = resolve(relativePath);
	await fs.mkdir(path.dirname(absolute), { recursive: true });
	await writeFn(absolute);
	return relativePath;
}

// Déplace l'upload validé de tmp/ vers son dossier (même volume : rename atomique).
function saveOriginal(tmpPath, id) {
	return _write(path.join(_documentDir(id), 'original.pdf'), (target) =>
		fs.rename(tmpPath, target),
	);
}

function saveThumbnail(id, data) {
	return _write(path.join(_documentDir(id), 'thumbnail.jpg'), (target) =>
		fs.writeFile(target, data),
	);
}

// Suppression best effort : un dossier déjà absent n'est pas une erreur.
async function removeDocumentFiles(id) {
	await fs.rm(resolve(_documentDir(id)), { recursive: true, force: true });
}

async function removeTmpFile(absolutePath) {
	if (absolutePath) await fs.rm(absolutePath, { force: true });
}

// Au démarrage : un upload interrompu (crash, arrêt du conteneur) laisse
// un fichier orphelin dans tmp/.
async function clearTmp() {
	await fs.rm(TMP_DIR, { recursive: true, force: true });
	await fs.mkdir(TMP_DIR, { recursive: true });
}

module.exports = {
	TMP_DIR,
	resolve,
	saveOriginal,
	saveThumbnail,
	removeDocumentFiles,
	removeTmpFile,
	clearTmp,
};

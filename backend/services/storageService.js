const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

// 🔹 Fichiers des documents dans DATA_DIR (volume Docker en prod) :
//   documents/<id>/original.pdf, documents/<id>/r<n>.pdf (révisions),
//   documents/<id>/thumbnail.jpg, stamps/<id>.png (tampons image),
//   tmp/ (uploads en cours de validation).
// Un dossier par document : le supprimer emporte tout ce qui le concerne.
// La base ne stocke que des chemins RELATIFS à DATA_DIR : le dossier peut
// être déplacé (autre volume, restauration de sauvegarde) sans migration.

const DOCUMENTS_DIR = 'documents';
const STAMPS_DIR = 'stamps';
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

// Nouvelle version envoyée : même principe que l'original.
function saveRevision(tmpPath, id, number) {
	return _write(path.join(_documentDir(id), `r${number}.pdf`), (target) =>
		fs.rename(tmpPath, target),
	);
}

// Restauration : la révision restaurée est copiée, jamais déplacée.
function copyRevision(sourcePath, id, number) {
	return _write(path.join(_documentDir(id), `r${number}.pdf`), (target) =>
		fs.copyFile(resolve(sourcePath), target),
	);
}

function _thumbnailPath(id) {
	return path.join(_documentDir(id), 'thumbnail.jpg');
}

// Écrase la miniature précédente (l'URL du client change avec la révision).
function saveThumbnail(id, data) {
	return _write(_thumbnailPath(id), (target) => fs.writeFile(target, data));
}

// Nouvelle révision : la miniature est préparée à côté de l'actuelle, puis
// mise en place seulement une fois la révision enregistrée en base
// (commitThumbnail), ou jetée en cas d'échec (discardThumbnail).
// stageThumbnail renvoie le chemin définitif, celui à enregistrer en base.
function _stagedThumbnailPath(id) {
	return path.join(_documentDir(id), 'thumbnail.next.jpg');
}

async function stageThumbnail(id, data) {
	await _write(_stagedThumbnailPath(id), (target) =>
		fs.writeFile(target, data),
	);
	return _thumbnailPath(id);
}

async function commitThumbnail(id) {
	await fs.rename(
		resolve(_stagedThumbnailPath(id)),
		resolve(_thumbnailPath(id)),
	);
}

async function discardThumbnail(id) {
	await fs.rm(resolve(_stagedThumbnailPath(id)), { force: true });
}

// Une nouvelle révision protégée par mot de passe n'a plus de miniature.
async function removeThumbnail(id) {
	await fs.rm(resolve(_thumbnailPath(id)), { force: true });
}

// Fichier d'une révision supprimée (chemin venu de la base).
async function removeFile(relativePath) {
	await fs.rm(resolve(relativePath), { force: true });
}

// Suppression best effort : un dossier déjà absent n'est pas une erreur.
async function removeDocumentFiles(id) {
	await fs.rm(resolve(_documentDir(id)), { recursive: true, force: true });
}

// Tampon image : le PNG produit par le serveur (jamais le fichier envoyé).
// Renvoie le chemin relatif à enregistrer en base.
function saveStampImage(id, data) {
	return _write(path.join(STAMPS_DIR, `${id}.png`), (target) =>
		fs.writeFile(target, data),
	);
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
	saveRevision,
	copyRevision,
	saveThumbnail,
	stageThumbnail,
	commitThumbnail,
	discardThumbnail,
	removeThumbnail,
	removeFile,
	removeDocumentFiles,
	saveStampImage,
	removeTmpFile,
	clearTmp,
};

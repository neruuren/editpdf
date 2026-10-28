// 🔹 File des écritures sur les fichiers des documents : une à la fois.
// Deux envois de révision simultanés calculeraient le même numéro (le second
// écraserait le fichier du premier), et une suppression de document pendant
// une écriture laisserait des fichiers orphelins sur le disque.
let queue = Promise.resolve();

function serialize(task) {
	const run = queue.then(task);
	queue = run.catch(() => {});
	return run;
}

module.exports = { serialize };

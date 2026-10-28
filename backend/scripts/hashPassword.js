// 🔹 Génère la valeur de AUTH_PASSWORD_HASH.
// Usage : node backend/scripts/hashPassword.js   (sans argument : le mot de passe est
// demandé au clavier sans être affiché, puis une seconde fois pour confirmation)
const bcrypt = require('bcryptjs');
const prompt = require('./prompt');

async function main() {
	// Un argument serait déjà altéré par le shell (espaces, $, !, #...) : on le refuse
	// plutôt que de l'ignorer silencieusement.
	if (process.argv.length > 2) {
		console.error(
			'Ne pas passer le mot de passe en argument : lancer la commande seule,\n' +
				'il sera demandé au clavier (saisie masquée, puis confirmation).',
		);
		process.exit(1);
	}

	const [password, confirmation] = await prompt([
		{ text: 'Mot de passe : ', hidden: true },
		{ text: 'Confirmation : ', hidden: true },
	]);
	if (!password) {
		console.error('Mot de passe vide, abandon.');
		process.exit(1);
	}
	if (password !== confirmation) {
		console.error('Les deux saisies diffèrent, abandon.');
		process.exit(1);
	}

	const hash = bcrypt.hashSync(password, 12);
	console.log(`\nHash (backend/.env, dev) :\n${hash}\n`);
	// docker compose interprète « $ » dans le .env : il faut les doubler en prod.
	console.log(
		`Hash (.env du VPS, lu par docker compose) :\n${hash.replaceAll('$', '$$$$')}`,
	);
}

main();

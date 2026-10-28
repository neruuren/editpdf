// 🔹 Diagnostic de la config d'authentification, chargée exactement comme par server.js.
// Usage : node backend/scripts/checkAuth.js   (identifiant et mot de passe demandés)
// N'affiche jamais le hash ni le secret JWT, seulement des constats.
const path = require('path');

// Variables déjà présentes dans le shell AVANT dotenv : elles masqueraient le .env.
const fromShell = ['AUTH_USERNAME', 'AUTH_PASSWORD_HASH', 'JWT_SECRET'].filter(
	(name) => process.env[name] !== undefined,
);

require('dotenv').config({
	path: path.join(__dirname, '..', '.env'),
	quiet: true,
});
const bcrypt = require('bcryptjs');
const prompt = require('./prompt');

async function main() {
	if (process.argv.length > 2) {
		console.error(
			'Ne rien passer en argument : lancer la commande seule,\n' +
				'identifiant et mot de passe seront demandés au clavier.',
		);
		process.exit(1);
	}

	const [username, password] = await prompt([
		{ text: 'Identifiant : ' },
		{ text: 'Mot de passe : ', hidden: true },
	]);
	check(username, password);
}

function check(username, password) {
	const ok = (msg) => console.log(`  ✅ ${msg}`);
	const ko = (msg) => console.log(`  ❌ ${msg}`);

	console.log('Diagnostic de backend/.env :');

	if (fromShell.length > 0) {
		ko(
			`Défini(es) dans le shell, prioritaire(s) sur le .env : ${fromShell.join(', ')} (unset ces variables)`,
		);
	}

	const envUser = process.env.AUTH_USERNAME;
	if (!envUser) {
		ko('AUTH_USERNAME absent ou vide');
	} else if (envUser !== envUser.trim()) {
		ko('AUTH_USERNAME contient des espaces au début ou à la fin');
	} else if (envUser === username) {
		ok('AUTH_USERNAME correspond à l’identifiant saisi');
	} else if (envUser.toLowerCase() === username.toLowerCase()) {
		ko(
			'AUTH_USERNAME diffère de l’identifiant saisi par la casse (majuscules)',
		);
	} else {
		ko(
			`AUTH_USERNAME ne correspond pas : ${envUser.length} caractère(s) dans le .env, ${username.length} saisi(s)`,
		);
	}

	const hash = process.env.AUTH_PASSWORD_HASH;
	if (!hash) {
		ko('AUTH_PASSWORD_HASH absent ou vide');
	} else if (hash.includes('$$')) {
		ko(
			'AUTH_PASSWORD_HASH contient des « $$ » : c’est la version pour docker compose, utiliser celle avec des $ simples en dev',
		);
	} else if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) {
		ko(
			`AUTH_PASSWORD_HASH n’a pas le format bcrypt attendu ($2b$12$ + 53 caractères, 60 au total) : ${hash.length} caractère(s), début « ${hash.slice(0, 7)} »`,
		);
	} else {
		ok('AUTH_PASSWORD_HASH a un format bcrypt valide');
		if (bcrypt.compareSync(password, hash)) {
			ok('le mot de passe saisi correspond au hash');
		} else {
			ko(
				'le mot de passe saisi NE correspond PAS au hash : régénérer le hash avec hashPassword.js',
			);
		}
	}

	if (!process.env.JWT_SECRET) {
		ko('JWT_SECRET absent ou vide');
	} else {
		ok('JWT_SECRET présent');
	}
}

main();

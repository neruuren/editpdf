const readline = require('readline');

// 🔹 Pose des questions dans le terminal ; `hidden: true` masque la saisie (mots de passe).
// Le mot de passe ne passe ni par les arguments (interprétés par le shell :
// espaces, $, !, #...) ni par l'historique du shell.
// Un seul readline et son itérateur asynchrone : les lignes déjà reçues sont mises
// en file d'attente (entrée redirigée par un pipe), au lieu d'être perdues
// entre deux rl.question().
async function prompt(questions) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: Boolean(process.stdin.isTTY),
	});
	let muted = false;
	// API interne de readline, mais c'est le moyen standard de masquer l'écho.
	rl._writeToOutput = (text) => {
		if (!muted) rl.output.write(text);
	};

	const lines = rl[Symbol.asyncIterator]();
	const answers = [];
	for (const { text, hidden = false } of questions) {
		process.stdout.write(text);
		muted = hidden;
		const { value = '' } = await lines.next();
		muted = false;
		if (hidden || !process.stdin.isTTY) process.stdout.write('\n');
		answers.push(value);
	}
	rl.close();
	return answers;
}

module.exports = prompt;

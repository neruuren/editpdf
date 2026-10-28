module.exports = {
	testEnvironment: 'node',
	verbose: true,
	// Le premier import de MuPDF compile ~10 Mo de WebAssembly (quelques
	// secondes, bien plus sur le runner de la CI) : le délai par défaut de 5 s
	// ne suffit pas.
	testTimeout: 30_000,
	setupFiles: ['<rootDir>/jest.setup.js'],
};

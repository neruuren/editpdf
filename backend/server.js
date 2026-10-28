require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// 🔹 Servir les fichiers statiques du frontend React
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// 🔹 Routes API
app.get('/api/message', (req, res) => {
	res.status(200).json({
		text: 'Hello from the backend!!!!! :)',
	});
});

// 🔹 404 JSON pour les routes API inconnues
app.use('/api', (req, res) => {
	res.status(404).json({ error: 'Not found' });
});

// 🔹 Gérer le routage du frontend React
app.get('*', (req, res) => {
	res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// 🔹 Gestion centralisée des erreurs
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
	console.error(err);
	res.status(err.status || 500).json({ error: 'Internal server error' });
});

// 🔹 Lancer le serveur (sauf si le fichier est importé, ex: dans les tests)
if (require.main === module) {
	app.listen(PORT, () => {
		console.log(`Backend server is running on http://localhost:${PORT}`);
	});
}

module.exports = app;

const express = require('express');
const router = express.Router();
const { searchDocuments } = require('../controllers/searchController');

router.get('/', searchDocuments);

module.exports = router;

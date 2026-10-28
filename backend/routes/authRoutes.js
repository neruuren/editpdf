const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');
const { login, logout, getMe } = require('../controllers/authController');

router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.get('/me', protect, getMe);

module.exports = router;

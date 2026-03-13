/**
 * routes/authRoutes.js
 *
 * Maps HTTP endpoints to controller functions.
 * express-validator is used to validate inputs before they reach the controller.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { login, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], login);

// GET /api/auth/me — requires valid JWT token
router.get('/me', protect, getMe);

module.exports = router;

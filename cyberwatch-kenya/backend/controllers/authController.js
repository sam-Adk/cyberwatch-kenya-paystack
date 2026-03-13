/**
 * controllers/authController.js
 *
 * Handles admin authentication:
 * - login: verify email/password, return JWT token
 * - getMe: return current user info from JWT
 *
 * HOW JWT AUTHENTICATION WORKS:
 * 1. Admin logs in with email + password
 * 2. Server checks password using bcrypt.compare()
 * 3. If correct, server creates a signed JWT token
 * 4. Frontend stores the token in localStorage
 * 5. Every future request includes the token in the Authorization header
 * 6. Server verifies the token with the middleware in authMiddleware.js
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────

exports.login = async (req, res) => {
  try {
    // Check for validation errors from express-validator
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Use generic message to prevent email enumeration attacks
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Compare provided password with stored hashed password
    // bcrypt.compare() is secure — never compare plain text yourself!
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Create JWT payload (don't put sensitive data in here — it's readable!)
    const payload = {
      id: user._id,
      email: user.email,
      role: user.role,
      name: user.name
    };

    // Sign the token — expires in 24 hours
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// GET CURRENT USER (requires auth token)
// ─────────────────────────────────────────────

exports.getMe = async (req, res) => {
  try {
    // req.user is set by the auth middleware after verifying the JWT
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

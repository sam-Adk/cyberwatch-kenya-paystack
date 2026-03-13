/**
 * middleware/authMiddleware.js
 *
 * Protects routes that require admin login.
 *
 * HOW IT WORKS:
 * 1. Frontend sends requests with header: Authorization: Bearer <token>
 * 2. This middleware extracts the token
 * 3. It verifies the token using the JWT_SECRET
 * 4. If valid, it attaches the user info to req.user
 * 5. The route handler can then use req.user.id, req.user.role, etc.
 */

const jwt = require('jsonwebtoken');

const protect = (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    // Extract the token (remove "Bearer " prefix)
    const token = authHeader.split(' ')[1];

    // Verify and decode the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach decoded user data to the request
    req.user = decoded;

    // Continue to the route handler
    next();

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired. Please log in again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
};

// Only allow admins
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required.'
    });
  }
  next();
};

module.exports = { protect, adminOnly };

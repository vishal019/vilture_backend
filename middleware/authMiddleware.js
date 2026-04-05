const jwt = require('jsonwebtoken');

/**
 * Verifies JWT from Authorization: Bearer <token> and attaches req.user.
 * Use for admin routes that require authentication.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required', message: 'Authentication required' });
  }

  const secret = process.env.JWT_SECRET || process.env.SECRET || 'change-me-in-production';
  try {
    const decoded = jwt.verify(token, secret);
    req.user = { id: decoded.id, role: decoded.role, email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token', message: 'Invalid or expired token. Please log in again.' });
  }
}

module.exports = authMiddleware;

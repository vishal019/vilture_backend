const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../dbcon');

const authRouter = express.Router();

// GET /admin/auth/check - verify auth route is mounted (no auth required)
authRouter.get('/check', (req, res) => {
  res.json({ ok: true, route: 'admin/auth' });
});

// Rate limit login attempts: 5 per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /admin/auth/login - Authenticate and return JWT (no password sent to client)
authRouter.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const loginId = (email || '').trim().toLowerCase();

    if (!loginId || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [rows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar, password FROM users WHERE (LOWER(email) = ? OR phoneNumber = ?) LIMIT 1',
      [loginId, loginId]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'active') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Normalize role so RBAC checks are reliable everywhere
    const normalizedRole = (user.role || '').toString().trim().toLowerCase();

    const secret = process.env.JWT_SECRET || process.env.SECRET || 'change-me-in-production';
    const token = jwt.sign(
      { id: user.id, role: normalizedRole, email: user.email },
      secret,
      { expiresIn: '24h' }
    );

    const safeUser = {
      id: String(user.id),
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: normalizedRole,
      status: user.status,
      avatar: user.avatar,
    };

    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

module.exports = authRouter;

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../dbcon');

const router = express.Router();

// The CLIENT_ID needs to match what is configured in your Google Console and frontend
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || 'dummy-client-id');

const SECRET = process.env.JWT_SECRET || process.env.SECRET || 'change-me-in-production';

// Helper to generate JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    SECRET,
    { expiresIn: '24h' }
  );
};

// GET /api/auth/check
router.get('/check', (req, res) => {
  res.json({ ok: true });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phoneNumber = '' } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check existing email
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const [result] = await pool.execute(
      'INSERT INTO users (name, email, phoneNumber, role, status, password) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, phoneNumber, 'user', 'active', hashedPassword]
    );

    const newUser = {
      id: String(result.insertId),
      name,
      email,
      phoneNumber,
      role: 'user',
      status: 'active'
    };

    const token = generateToken(newUser);
    res.status(201).json({ token, user: newUser });
  } catch (err) {
    console.error('Registration error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email or phone number already in use' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status !== 'active') {
      return res.status(401).json({ error: 'Account is inactive' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const safeUser = {
      id: String(user.id),
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      status: user.status,
      avatar: user.avatar
    };

    const token = generateToken(user);
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    
    if (!credential) {
      return res.status(400).json({ error: 'Google credential missing' });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
      });
      payload = ticket.getPayload();
    } catch (e) {
      console.error('Google token verification failed', e);
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const { email, name, picture } = payload;

    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    let user = rows[0];

    // If user doesn't exist, create them
    if (!user) {
      const randomPassword = await bcrypt.hash(Math.random().toString(36).slice(-10), 12);
      const dummyPhone = `GOOGLE_${Math.random().toString(36).slice(-8)}`; // Avoid unique constraint clashes
      
      const [result] = await pool.execute(
        'INSERT INTO users (name, email, phoneNumber, role, status, avatar, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, email, dummyPhone, 'user', 'active', picture, randomPassword]
      );
      
      user = {
        id: result.insertId,
        name,
        email,
        phoneNumber: dummyPhone,
        role: 'user',
        status: 'active',
        avatar: picture
      };
    }

    if (user.status !== 'active') {
      return res.status(401).json({ error: 'Account is inactive' });
    }

    const safeUser = {
      id: String(user.id),
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      status: user.status,
      avatar: user.avatar
    };

    const token = generateToken(user);
    res.json({ token, user: safeUser });

  } catch (err) {
    console.error('Google login error:', err);
    res.status(500).json({ error: 'Google login failed' });
  }
});

module.exports = router;

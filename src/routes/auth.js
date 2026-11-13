const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { text } = require('../validation');

const router = express.Router();
const SALT_ROUNDS = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Used when the email isn't found, so a failed login takes about the same
// time either way and doesn't reveal which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', SALT_ROUNDS);

// express-session uses callbacks; these wrappers let us use await.
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

// Start a fresh session for this user. Regenerating the session ID on login
// protects against session fixation.
async function logIn(req, user) {
  await regenerateSession(req);
  req.session.userId = user.id;
  req.session.userName = user.name;
  await saveSession(req);
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const name = text(req.body.name);
  const email = text(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are all required.' });
  }
  if (name.length > 100) {
    return res.status(400).json({ error: 'Name must be 100 characters or fewer.' });
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 255) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (password.length > 72) {
    // bcrypt only reads the first 72 bytes of a password.
    return res.status(400).json({ error: 'Password must be 72 characters or fewer.' });
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await pool.query(
    'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
    [name, email, hash]
  );
  const user = result.rows[0];

  await logIn(req, user);
  res.status(201).json({ user });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const email = text(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }

  const result = await pool.query(
    'SELECT id, name, email, password FROM users WHERE email = $1',
    [email]
  );
  const user = result.rows[0];
  const matches = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

  if (!user || !matches) {
    return res.status(401).json({ error: 'That email and password don\'t match an account.' });
  }

  await logIn(req, user);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

// POST /api/auth/logout
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('jat.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me  -> who is logged in
router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, email, created_at FROM users WHERE id = $1',
    [req.session.userId]
  );
  if (result.rows.length === 0) {
    // The account was removed while the session was still alive.
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Log in to continue.' });
  }
  res.json({ user: result.rows[0] });
});

module.exports = router;

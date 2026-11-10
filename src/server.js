require('dotenv').config({ quiet: true });

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const pool = require('./db');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// Behind a host like Render or Railway the app sits behind a proxy;
// this lets secure cookies work there.
if (isProduction) app.set('trust proxy', 1);

app.use(express.json({ limit: '50kb' }));
// Express 5 leaves req.body undefined when a request has no JSON body.
app.use((req, res, next) => {
  if (!req.body) req.body = {};
  next();
});

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true, // connect-pg-simple makes its own "session" table
    }),
    name: 'jat.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false, // no cookie until someone actually logs in
    cookie: {
      httpOnly: true, // page JavaScript can't read the cookie
      sameSite: 'lax', // other sites can't send logged-in POST/PUT/DELETE requests
      secure: isProduction, // HTTPS only in production
      maxAge: 1000 * 60 * 60 * 24 * 7, // one week
    },
  })
);

// API
app.use('/api/auth', authRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Any error thrown in a route ends up here (Express 5 catches async errors too).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body isn\'t valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request is too large.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

app.listen(PORT, () => {
  console.log(`Job Application Tracker running at http://localhost:${PORT}`);
});

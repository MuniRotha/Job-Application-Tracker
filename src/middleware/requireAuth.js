// For API routes: reply 401 JSON when nobody is logged in.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Log in to continue.' });
}

// For page routes: send logged-out visitors to the login page.
function requirePageAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.redirect('/login');
}

// For login/register pages: logged-in users go straight to the dashboard.
function redirectIfLoggedIn(req, res, next) {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  return next();
}

module.exports = { requireAuth, requirePageAuth, redirectIfLoggedIn };

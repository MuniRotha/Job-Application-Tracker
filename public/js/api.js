// Small wrapper around fetch for talking to our JSON API.
// Throws an Error with the server's message when a request fails.
async function api(path, { method = 'GET', body } = {}) {
  const options = {
    method,
    headers: { Accept: 'application/json' },
    credentials: 'same-origin', // send the session cookie
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('Can\'t reach the server. Check that it is running and try again.');
  }

  // Session expired somewhere along the way: back to login.
  if (response.status === 401 && !path.startsWith('/api/auth/login')) {
    window.location.href = '/login';
    throw new Error('Log in to continue.');
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

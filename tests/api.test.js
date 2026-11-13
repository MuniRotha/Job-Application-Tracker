// End-to-end API tests: real Express app, real PostgreSQL test database.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  app, pool, request, resetDb, closeDb, newUser, sampleApplication, sessionCookie, PASSWORD,
} = require('./helpers');

before(resetDb);
after(closeDb);

// ---------------------------------------------------------------------------
describe('Register', () => {
  test('creates an account, logs in and sets a safe session cookie', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'Nice', email: 'nice@example.com', password: PASSWORD });

    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.body.user).sort(), ['email', 'id', 'name']);

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('jat.sid='));
    assert.ok(cookie, 'session cookie is set');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  });

  test('stores a bcrypt hash, never the plain password', async () => {
    const { rows } = await pool.query("SELECT password FROM users WHERE email = 'nice@example.com'");
    assert.match(rows[0].password, /^\$2b\$12\$/);
    assert.notEqual(rows[0].password, PASSWORD);
  });

  test('never sends the password hash back', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'A', email: 'nohash@example.com', password: PASSWORD });
    assert.equal(JSON.stringify(res.body).includes('$2b$'), false);
  });

  test('trims the email and makes it lowercase', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'Case', email: '  MiXeD@Example.COM ', password: PASSWORD });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'mixed@example.com');
  });

  test('refuses a second account with the same email, whatever the case', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'Copy', email: 'NICE@example.com', password: PASSWORD });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already exists/);
  });

  const badInputs = [
    ['missing everything', {}, /required/],
    ['missing name', { email: 'a@b.co', password: PASSWORD }, /required/],
    ['name of only spaces', { name: '   ', email: 'a@b.co', password: PASSWORD }, /required/],
    ['name over 100 characters', { name: 'a'.repeat(101), email: 'a@b.co', password: PASSWORD }, /100 characters/],
    ['bad email', { name: 'A', email: 'not-an-email', password: PASSWORD }, /valid email/],
    ['email with a space', { name: 'A', email: 'a b@c.co', password: PASSWORD }, /valid email/],
    ['password under 8 characters', { name: 'A', email: 'a@b.co', password: 'short' }, /at least 8/],
    ['password over 72 bytes', { name: 'A', email: 'a@b.co', password: 'a'.repeat(73) }, /too long/],
    // 40 accented letters is only 40 characters but 80 bytes
    ['password over 72 bytes in accented letters', { name: 'A', email: 'a@b.co', password: 'é'.repeat(40) }, /too long/],
    ['password sent as a number', { name: 'A', email: 'a@b.co', password: 12345678 }, /required/],
  ];
  for (const [label, body, message] of badInputs) {
    test(`rejects ${label}`, async () => {
      const res = await request(app).post('/api/auth/register').send(body);
      assert.equal(res.status, 400);
      assert.match(res.body.error, message);
    });
  }

  test('accepts a Khmer name and a password of exactly 72 bytes', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'ខ្វាន់ មុនីរ័ត្ន', email: 'khmer@example.com', password: 'a'.repeat(72) });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.name, 'ខ្វាន់ មុនីរ័ត្ន');
  });
});

// ---------------------------------------------------------------------------
describe('Login and logout', () => {
  test('logs in with the right password (email in any case)', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: ' Nice@Example.com ', password: PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'nice@example.com');
    assert.ok(sessionCookie(res));
  });

  test('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app).post('/api/auth/login')
      .send({ email: 'nice@example.com', password: 'wrong-password' });
    const unknownEmail = await request(app).post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.body.error, unknownEmail.body.error);
    assert.equal(sessionCookie(wrongPassword), null, 'no session for a failed login');
  });

  test('a long password with the same first 72 bytes does not log in', async () => {
    // 'a' x 72 is the real password of khmer@example.com.
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'khmer@example.com', password: `${'a'.repeat(72)}EXTRA` });
    assert.equal(res.status, 401);
  });

  test('passwords are case sensitive', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'nice@example.com', password: PASSWORD.toUpperCase() });
    assert.equal(res.status, 401);
  });

  test('asks for both fields', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nice@example.com' });
    assert.equal(res.status, 400);
  });

  test('handles a login request with no body', async () => {
    const res = await request(app).post('/api/auth/login');
    assert.equal(res.status, 400);
  });

  test('ignores object tricks in the login fields', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });
    assert.equal(res.status, 400);
  });

  test('gives a new session id on every login (blocks session fixation)', async () => {
    const first = await request(app).post('/api/auth/login').send({ email: 'nice@example.com', password: PASSWORD });
    const oldCookie = sessionCookie(first);

    const second = await request(app).post('/api/auth/login')
      .set('Cookie', oldCookie)
      .send({ email: 'nice@example.com', password: PASSWORD });
    const newCookie = sessionCookie(second);

    assert.ok(newCookie);
    assert.notEqual(newCookie, oldCookie);
    const reuse = await request(app).get('/api/auth/me').set('Cookie', oldCookie);
    assert.equal(reuse.status, 401, 'the old session id no longer works');
  });

  test('keeps sessions in the database so they survive a server restart', async () => {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM session');
    assert.ok(rows[0].n > 0);
  });

  test('/me returns the logged-in user', async () => {
    const { agent, user } = await newUser();
    const res = await agent.get('/api/auth/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, user.email);
    assert.equal(res.body.user.password, undefined);
  });

  test('/me says 401 when logged out', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
  });

  test('logout ends the session for good', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'nice@example.com', password: PASSWORD });
    const cookie = sessionCookie(login);

    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    assert.equal(out.status, 200);

    const after = await request(app).get('/api/applications').set('Cookie', cookie);
    assert.equal(after.status, 401, 'old cookie is rejected after logout');
  });

  test('logout without a session does not crash', async () => {
    const res = await request(app).post('/api/auth/logout');
    assert.equal(res.status, 200);
  });

  test('a deleted user is logged out on the next request', async () => {
    const { agent, user } = await newUser();
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    const res = await agent.get('/api/auth/me');
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
describe('Pages and general behaviour', () => {
  test('logged-out visitors go to /login', async () => {
    for (const url of ['/', '/dashboard']) {
      const res = await request(app).get(url);
      assert.equal(res.status, 302, url);
      assert.equal(res.headers.location, '/login');
    }
  });

  test('logged-in users skip /login and /register', async () => {
    const { agent } = await newUser();
    for (const url of ['/', '/login', '/register']) {
      const res = await agent.get(url);
      assert.equal(res.status, 302, url);
      assert.equal(res.headers.location, '/dashboard');
    }
    const dash = await agent.get('/dashboard');
    assert.equal(dash.status, 200);
    assert.match(dash.text, /Your applications/);
  });

  test('the dashboard and API are never cached (Back after logout shows nothing)', async () => {
    const { agent } = await newUser();
    assert.equal((await agent.get('/dashboard')).headers['cache-control'], 'no-store');
    assert.equal((await agent.get('/api/applications')).headers['cache-control'], 'no-store');
  });

  test('does not reveal that the server runs Express', async () => {
    const res = await request(app).get('/login');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('serves the CSS, JavaScript and favicon', async () => {
    for (const file of ['/css/styles.css', '/js/api.js', '/js/auth.js', '/js/dashboard.js', '/favicon.svg']) {
      const res = await request(app).get(file);
      assert.equal(res.status, 200, file);
    }
  });

  test('unknown pages get the 404 page, unknown API routes get JSON', async () => {
    const pageRes = await request(app).get('/no-such-page');
    assert.equal(pageRes.status, 404);
    assert.match(pageRes.text, /doesn't exist/);

    const apiRes = await request(app).get('/api/nope');
    assert.equal(apiRes.status, 404);
    assert.equal(apiRes.body.error, 'Not found.');
  });

  test('broken JSON gets a 400, not a crash', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('Content-Type', 'application/json').send('{bad json');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /valid JSON/);
  });

  test('oversized requests get a 413', async () => {
    const { agent } = await newUser();
    const res = await agent.post('/api/applications')
      .send(sampleApplication({ notes: 'a'.repeat(60 * 1024) }));
    assert.equal(res.status, 413);
  });

  test('HTML pages are served as HTML', async () => {
    const res = await request(app).get('/login');
    assert.match(res.headers['content-type'], /text\/html/);
  });
});

// ---------------------------------------------------------------------------
describe('Applications need a login', () => {
  const routes = [
    ['get', '/api/applications'],
    ['get', '/api/applications/summary'],
    ['get', '/api/applications/1'],
    ['post', '/api/applications'],
    ['put', '/api/applications/1'],
    ['patch', '/api/applications/1/status'],
    ['patch', '/api/applications/1/notes'],
    ['delete', '/api/applications/1'],
  ];
  for (const [method, url] of routes) {
    test(`${method.toUpperCase()} ${url} returns 401 when logged out`, async () => {
      const res = await request(app)[method](url).send({});
      assert.equal(res.status, 401);
    });
  }
});

// ---------------------------------------------------------------------------
describe('Create, read, update, delete', () => {
  let agent;
  let created;

  before(async () => {
    ({ agent } = await newUser());
  });

  test('adds an application and returns it', async () => {
    const res = await agent.post('/api/applications').send(sampleApplication());
    assert.equal(res.status, 201);
    created = res.body.application;
    assert.equal(created.company, 'ABA Bank');
    assert.equal(created.status, 'Applied');
    assert.equal(created.date_applied, '2026-11-03', 'date comes back exactly as sent');
    assert.ok(created.id);
    assert.ok(created.created_at);
    assert.equal(created.user_id, undefined, 'user_id is not exposed');
  });

  test('defaults status to Applied and empty link/notes to null', async () => {
    const res = await agent.post('/api/applications')
      .send({ company: 'Wing Bank', role: 'Dev', date_applied: '2026-11-01', job_url: '', notes: '   ' });
    assert.equal(res.status, 201);
    assert.equal(res.body.application.status, 'Applied');
    assert.equal(res.body.application.job_url, null);
    assert.equal(res.body.application.notes, null);
  });

  test('keeps Khmer text, emoji and line breaks intact', async () => {
    const notes = 'អ្នកជ្រើសរើស: សុខា\nSecond line 🎉';
    const res = await agent.post('/api/applications')
      .send(sampleApplication({ company: 'ធនាគារ ABA', notes }));
    assert.equal(res.status, 201);
    const fetched = await agent.get(`/api/applications/${res.body.application.id}`);
    assert.equal(fetched.body.application.company, 'ធនាគារ ABA');
    assert.equal(fetched.body.application.notes, notes);
  });

  test('stores SQL and HTML exactly as typed (no injection)', async () => {
    const company = "Robert'); DROP TABLE applications;--";
    const notes = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const res = await agent.post('/api/applications').send(sampleApplication({ company, notes }));
    assert.equal(res.status, 201);
    assert.equal(res.body.application.company, company);
    assert.equal(res.body.application.notes, notes);
    const { rows } = await pool.query("SELECT to_regclass('public.applications') AS t");
    assert.ok(rows[0].t, 'applications table still exists');
  });

  test('reads one application', async () => {
    const res = await agent.get(`/api/applications/${created.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.application.id, created.id);
  });

  test('edits every field with PUT', async () => {
    const res = await agent.put(`/api/applications/${created.id}`).send({
      company: 'ABA Bank Plc',
      role: 'Web Developer',
      date_applied: '2026-11-04',
      status: 'Interview',
      job_url: '',
      notes: 'Phone screen Friday',
    });
    assert.equal(res.status, 200);
    const app1 = res.body.application;
    assert.equal(app1.company, 'ABA Bank Plc');
    assert.equal(app1.role, 'Web Developer');
    assert.equal(app1.date_applied, '2026-11-04');
    assert.equal(app1.status, 'Interview');
    assert.equal(app1.job_url, null, 'clearing the link saves null');
    assert.equal(app1.notes, 'Phone screen Friday');
    assert.equal(app1.created_at, created.created_at, 'created_at does not change');
  });

  test('PUT runs the same checks as create', async () => {
    const res = await agent.put(`/api/applications/${created.id}`)
      .send(sampleApplication({ date_applied: '2026-02-30' }));
    assert.equal(res.status, 400);
    const unchanged = await agent.get(`/api/applications/${created.id}`);
    assert.equal(unchanged.body.application.date_applied, '2026-11-04');
  });

  test('changes only the status with PATCH /status', async () => {
    const res = await agent.patch(`/api/applications/${created.id}/status`).send({ status: 'Offer' });
    assert.equal(res.status, 200);
    assert.equal(res.body.application.status, 'Offer');
    assert.equal(res.body.application.notes, 'Phone screen Friday', 'notes untouched');
  });

  test('refuses a made-up status on PATCH /status', async () => {
    for (const status of ['Ghosted', '', 'offer', ['Offer']]) {
      const res = await agent.patch(`/api/applications/${created.id}/status`).send({ status });
      assert.equal(res.status, 400, JSON.stringify(status));
    }
  });

  test('changes only the notes with PATCH /notes', async () => {
    const res = await agent.patch(`/api/applications/${created.id}/notes`)
      .send({ notes: '  Second round next week  ' });
    assert.equal(res.status, 200);
    assert.equal(res.body.application.notes, 'Second round next week');
    assert.equal(res.body.application.status, 'Offer', 'status untouched');
  });

  test('clearing notes saves null', async () => {
    const res = await agent.patch(`/api/applications/${created.id}/notes`).send({ notes: '' });
    assert.equal(res.body.application.notes, null);
  });

  test('refuses notes over 5,000 characters', async () => {
    const res = await agent.patch(`/api/applications/${created.id}/notes`).send({ notes: 'a'.repeat(5001) });
    assert.equal(res.status, 400);
  });

  test('deletes an application, and a second delete says 404', async () => {
    const del = await agent.delete(`/api/applications/${created.id}`);
    assert.equal(del.status, 204);
    assert.equal((await agent.get(`/api/applications/${created.id}`)).status, 404);
    assert.equal((await agent.delete(`/api/applications/${created.id}`)).status, 404);
  });

  test('bad ids get a clean 404 instead of a server error', async () => {
    for (const id of ['abc', '0', '-1', '1.5', '99999999999', '1;DROP TABLE users']) {
      const url = `/api/applications/${encodeURIComponent(id)}`;
      assert.equal((await agent.get(url)).status, 404, `GET ${id}`);
      assert.equal((await agent.put(url).send(sampleApplication())).status, 404, `PUT ${id}`);
      assert.equal((await agent.patch(`${url}/status`).send({ status: 'Offer' })).status, 404, `PATCH ${id}`);
      assert.equal((await agent.delete(url)).status, 404, `DELETE ${id}`);
    }
  });

  const badCreates = [
    ['no company', { company: '' }, /Company is required/],
    ['no role', { role: '   ' }, /Role is required/],
    ['no date', { date_applied: '' }, /Date applied is required/],
    ['30 February', { date_applied: '2026-02-30' }, /real date/],
    ['year 0000', { date_applied: '0000-01-01' }, /real date/],
    ['date in another format', { date_applied: '03/11/2026' }, /real date/],
    ['unknown status', { status: 'Ghosted' }, /Status must be one of/],
    ['javascript: link', { job_url: 'javascript:alert(1)' }, /http/],
    ['company as an object', { company: { a: 1 } }, /Company is required/],
    ['company over 150 characters', { company: 'x'.repeat(151) }, /150 characters/],
  ];
  for (const [label, override, message] of badCreates) {
    test(`refuses to create with ${label}`, async () => {
      const res = await agent.post('/api/applications').send(sampleApplication(override));
      assert.equal(res.status, 400);
      assert.match(res.body.error, message);
    });
  }
});

// ---------------------------------------------------------------------------
describe('Filter, sort and summary', () => {
  let agent;

  before(async () => {
    ({ agent } = await newUser());
    const rows = [
      ['Stripe', '2026-10-20', 'Interview'],
      ['Shopify', '2026-11-02', 'Applied'],
      ['Canva', '2026-09-15', 'Rejected'],
      ['Grab', '2026-10-28', 'Offer'],
      ['Atlassian', '2026-11-08', 'Applied'],
      ['Same Day A', '2026-10-01', 'Applied'],
      ['Same Day B', '2026-10-01', 'Applied'],
    ];
    for (const [company, date_applied, status] of rows) {
      await agent.post('/api/applications').send(sampleApplication({ company, date_applied, status }));
    }
  });

  const companies = (res) => res.body.applications.map((a) => a.company);

  test('lists newest first by default', async () => {
    const res = await agent.get('/api/applications');
    assert.deepEqual(companies(res),
      ['Atlassian', 'Shopify', 'Grab', 'Stripe', 'Same Day B', 'Same Day A', 'Canva']);
  });

  test('sorts oldest first', async () => {
    const res = await agent.get('/api/applications?sort=date_asc');
    assert.deepEqual(companies(res),
      ['Canva', 'Same Day A', 'Same Day B', 'Stripe', 'Grab', 'Shopify', 'Atlassian']);
  });

  test('applications on the same day keep a stable order', async () => {
    const first = companies(await agent.get('/api/applications'));
    const second = companies(await agent.get('/api/applications'));
    assert.deepEqual(first, second);
  });

  test('unknown or tricky sort values fall back to newest first', async () => {
    for (const sort of ['bogus', '__proto__', 'constructor', 'toString', 'company; DROP TABLE users']) {
      const res = await agent.get('/api/applications').query({ sort });
      assert.equal(res.status, 200, sort);
      assert.equal(companies(res)[0], 'Atlassian', sort);
    }
  });

  test('filters by each status', async () => {
    const expected = {
      Applied: ['Atlassian', 'Shopify', 'Same Day B', 'Same Day A'],
      Interview: ['Stripe'],
      Offer: ['Grab'],
      Rejected: ['Canva'],
    };
    for (const [status, list] of Object.entries(expected)) {
      const res = await agent.get('/api/applications').query({ status });
      assert.deepEqual(companies(res), list, status);
    }
  });

  test('filter and sort work together', async () => {
    const res = await agent.get('/api/applications?status=Applied&sort=date_asc');
    assert.deepEqual(companies(res), ['Same Day A', 'Same Day B', 'Shopify', 'Atlassian']);
  });

  test('an empty status filter means all', async () => {
    const res = await agent.get('/api/applications?status=');
    assert.equal(res.body.applications.length, 7);
  });

  test('an unknown status filter is a 400, not a crash', async () => {
    for (const q of ['status=Ghosted', 'status=applied', "status=Applied'--", 'status=Applied&status=Offer']) {
      const res = await agent.get(`/api/applications?${q}`);
      assert.equal(res.status, 400, q);
    }
  });

  test('summary counts each status and the total', async () => {
    const res = await agent.get('/api/applications/summary');
    assert.deepEqual(res.body, {
      counts: { Applied: 4, Interview: 1, Offer: 1, Rejected: 1 },
      total: 7,
    });
  });

  test('summary updates after a status change and a delete', async () => {
    const list = await agent.get('/api/applications?status=Interview');
    const stripe = list.body.applications[0];
    await agent.patch(`/api/applications/${stripe.id}/status`).send({ status: 'Offer' });
    const canva = (await agent.get('/api/applications?status=Rejected')).body.applications[0];
    await agent.delete(`/api/applications/${canva.id}`);

    const res = await agent.get('/api/applications/summary');
    assert.deepEqual(res.body, {
      counts: { Applied: 4, Interview: 0, Offer: 2, Rejected: 0 },
      total: 6,
    });
  });

  test('a brand-new user sees zeros and an empty list', async () => {
    const { agent: fresh } = await newUser();
    assert.deepEqual((await fresh.get('/api/applications')).body.applications, []);
    assert.deepEqual((await fresh.get('/api/applications/summary')).body, {
      counts: { Applied: 0, Interview: 0, Offer: 0, Rejected: 0 },
      total: 0,
    });
  });
});

// ---------------------------------------------------------------------------
describe('Users can only touch their own applications', () => {
  let alice;
  let bob;
  let aliceApp;

  before(async () => {
    ({ agent: alice } = await newUser({ name: 'Alice' }));
    ({ agent: bob } = await newUser({ name: 'Bob' }));
    aliceApp = (await alice.post('/api/applications').send(sampleApplication({ company: 'Alice Co' }))).body.application;
  });

  test("Bob can't see Alice's applications in his list or summary", async () => {
    assert.deepEqual((await bob.get('/api/applications')).body.applications, []);
    assert.equal((await bob.get('/api/applications/summary')).body.total, 0);
  });

  test("Bob can't read, edit, change, annotate or delete Alice's application", async () => {
    const url = `/api/applications/${aliceApp.id}`;
    assert.equal((await bob.get(url)).status, 404);
    assert.equal((await bob.put(url).send(sampleApplication({ company: 'Hacked' }))).status, 404);
    assert.equal((await bob.patch(`${url}/status`).send({ status: 'Rejected' })).status, 404);
    assert.equal((await bob.patch(`${url}/notes`).send({ notes: 'Hacked' })).status, 404);
    assert.equal((await bob.delete(url)).status, 404);

    const still = (await alice.get(url)).body.application;
    assert.equal(still.company, 'Alice Co');
    assert.equal(still.status, 'Applied');
    assert.equal(still.notes, 'Recruiter: Sokha');
  });

  test('sending a user_id in the body does not move the application to someone else', async () => {
    const bobMe = (await bob.get('/api/auth/me')).body.user;
    const res = await alice.post('/api/applications').send(sampleApplication({ user_id: bobMe.id, company: 'Sneaky' }));
    assert.equal(res.status, 201);
    assert.deepEqual((await bob.get('/api/applications')).body.applications, []);
  });

  test('deleting a user deletes their applications too', async () => {
    const { agent, user } = await newUser();
    await agent.post('/api/applications').send(sampleApplication());
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM applications WHERE user_id = $1', [user.id]);
    assert.equal(rows[0].n, 0);
  });
});

// ---------------------------------------------------------------------------
describe('Database rules (a second line of defence)', () => {
  test('the database itself refuses an unknown status', async () => {
    const { user } = await newUser();
    await assert.rejects(
      pool.query("INSERT INTO applications (user_id, company, role, status) VALUES ($1, 'X', 'Y', 'Ghosted')", [user.id]),
      /check constraint/
    );
  });

  test('the database refuses an application without a real user', async () => {
    await assert.rejects(
      pool.query("INSERT INTO applications (user_id, company, role) VALUES (999999, 'X', 'Y')"),
      /foreign key/
    );
  });

  test('the database refuses duplicate emails', async () => {
    await assert.rejects(
      pool.query("INSERT INTO users (name, email, password) VALUES ('X', 'nice@example.com', 'x')"),
      /duplicate key/
    );
  });
});

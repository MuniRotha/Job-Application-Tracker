// Shared setup for the API tests.
// The tests wipe their database, so they refuse to run against your real one.
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Create a separate database (for example job_tracker_test) ' +
    'and add TEST_DATABASE_URL=postgres://... to your .env file.'
  );
}
if (testUrl === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must point to a different database than DATABASE_URL. The tests delete all data.');
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-for-automated-tests';

const request = require('supertest');
const { app } = require('../src/app');
const pool = require('../src/db');

const PASSWORD = 'password123';

// Create the tables if needed, then empty them.
async function resetDb() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query('TRUNCATE users, applications RESTART IDENTITY CASCADE');
  const { rows } = await pool.query("SELECT to_regclass('public.session') AS t");
  if (rows[0].t) await pool.query('DELETE FROM session');
}

async function closeDb() {
  await pool.end();
}

// A logged-in supertest agent (it keeps the session cookie between requests).
let userCounter = 0;
async function newUser(overrides = {}) {
  userCounter += 1;
  const user = {
    name: `Test User ${userCounter}`,
    email: `user${userCounter}@example.com`,
    password: PASSWORD,
    ...overrides,
  };
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send(user);
  if (res.status !== 201) {
    throw new Error(`Could not register test user: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { agent, user: { ...user, id: res.body.user.id } };
}

function sampleApplication(overrides = {}) {
  return {
    company: 'ABA Bank',
    role: 'Junior Web Developer',
    date_applied: '2026-11-03',
    status: 'Applied',
    job_url: 'https://example.com/jobs/123',
    notes: 'Recruiter: Sokha',
    ...overrides,
  };
}

// Pull the session cookie ("jat.sid=...") out of a response.
function sessionCookie(res) {
  const cookies = res.headers['set-cookie'] || [];
  const found = cookies.find((c) => c.startsWith('jat.sid='));
  return found ? found.split(';')[0] : null;
}

module.exports = {
  app,
  pool,
  request,
  resetDb,
  closeDb,
  newUser,
  sampleApplication,
  sessionCookie,
  PASSWORD,
};

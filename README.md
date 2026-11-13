# Job Application Tracker

A small web app for keeping track of a job hunt. You log each job you apply to, move it through Applied, Interview, Offer or Rejected, and keep notes on it (who you talked to, how the interview went, what salary came up).

Built with Node.js, Express and PostgreSQL. The frontend is plain HTML, CSS and JavaScript with no framework.

## Features

- Register, log in and log out. Passwords are hashed with bcrypt and logins use server-side sessions stored in PostgreSQL.
- Add, edit and delete applications: company, role, date applied, link to the job post, status and notes.
- A status bar at the top of the dashboard shows how many applications sit in each stage. Click a stage to filter the list; click it again (or "All") to clear the filter.
- Change an application's status straight from the table with the dropdown.
- Sort by date applied, newest or oldest first.
- Open the notes panel under any row to read or update its notes without opening the full edit form.
- Every query is scoped to the logged-in user, so nobody can read or change someone else's applications by guessing an id.
- Works on phones. The table turns into stacked rows on small screens.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js + Express 5 |
| Database | PostgreSQL (`pg`) |
| Auth | `express-session` + `connect-pg-simple` + `bcrypt` |
| Version control | Git + GitHub |

## Database

Two tables, one relationship: each application belongs to one user.

```
users
  id, name, email, password, created_at

applications
  id, user_id -> users.id, company, role, status,
  date_applied, job_url, notes, created_at
```

`status` is limited to `Applied`, `Interview`, `Offer` or `Rejected` by a CHECK constraint. Deleting a user deletes their applications too (`ON DELETE CASCADE`). The full schema is in [`db/schema.sql`](db/schema.sql).

`connect-pg-simple` also creates a third table called `session` the first time the server starts. That's where login sessions live, so you stay logged in after restarting the server.

## Running it locally (Windows / PowerShell)

You need [Node.js](https://nodejs.org) 18 or newer and [PostgreSQL](https://www.postgresql.org/download/windows/). The PostgreSQL installer asks you to set a password for the `postgres` user; you'll need it below.

**1. Install the packages**

```powershell
cd job-tracker
npm install
```

**2. Create the databases**

One for the app, and a separate one the tests are allowed to wipe:

```powershell
psql -U postgres -c "CREATE DATABASE job_tracker;"
psql -U postgres -c "CREATE DATABASE job_tracker_test;"
```

If PowerShell says `psql` isn't recognized, use the full path instead (change `17` to your PostgreSQL version):

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE job_tracker;"
```

**3. Set up your `.env` file**

```powershell
Copy-Item .env.example .env
```

Open `.env` and change these lines:

- `DATABASE_URL` and `TEST_DATABASE_URL`: put your postgres password in place of `yourpassword`.
- `SESSION_SECRET`: any long random string. This command prints one you can paste in:

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

**4. Create the tables**

```powershell
npm run db:init
```

**5. Start the server**

```powershell
npm run dev
```

Open http://localhost:3000, create an account and add your first application. `npm run dev` restarts the server whenever you save a file (it uses Node's built-in `--watch`). Use `npm start` to run it without that.

## Running the tests

```powershell
npm test
```

There are 108 tests and they take about 6 seconds. They run against `TEST_DATABASE_URL`, empty it first, and refuse to start if it points at the same database as `DATABASE_URL`.

- `tests/validation.test.js` checks the input rules on their own: dates, links, statuses, length limits, ids.
- `tests/api.test.js` starts the real app and calls every route with supertest. It covers:
  - register, login and logout, including bcrypt hashing and the session cookie flags
  - a new session id on every login
  - every CRUD route, filtering and sorting
  - one user trying to read, edit or delete another user's applications
  - SQL and HTML injection attempts, bad ids, broken JSON and oversized requests
  - the database's own constraints

Uses Node's built-in test runner (`node:test`) and `supertest`. No other test framework needed.

## API

All application routes need a logged-in session. They return JSON.

| Method | Route | What it does |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account and log in |
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/me` | The logged-in user |
| GET | `/api/applications?status=Interview&sort=date_desc` | List applications. Both query params are optional. `sort` is `date_desc` or `date_asc` |
| GET | `/api/applications/summary` | Count of applications in each status |
| GET | `/api/applications/:id` | One application |
| POST | `/api/applications` | Add an application |
| PUT | `/api/applications/:id` | Update every field of an application |
| PATCH | `/api/applications/:id/status` | Change only the status |
| PATCH | `/api/applications/:id/notes` | Change only the notes |
| DELETE | `/api/applications/:id` | Delete an application |

Example body for `POST /api/applications`:

```json
{
  "company": "ABA Bank",
  "role": "Junior Web Developer",
  "date_applied": "2026-11-03",
  "status": "Applied",
  "job_url": "https://example.com/jobs/123",
  "notes": "Recruiter: Sokha. First interview Thursday."
}
```

`company`, `role` and `date_applied` are required. `status` defaults to `Applied`.

## Project structure

```
job-tracker/
├── db/
│   └── schema.sql            # users + applications tables
├── scripts/
│   └── init-db.js            # runs schema.sql (npm run db:init)
├── src/
│   ├── server.js             # starts the app
│   ├── app.js                # Express app, sessions, page routes
│   ├── db.js                 # PostgreSQL connection pool
│   ├── validation.js         # input rules shared by the routes
│   ├── middleware/
│   │   └── requireAuth.js    # blocks logged-out users
│   └── routes/
│       ├── auth.js           # register, login, logout, me
│       └── applications.js   # CRUD, filter, sort, notes
├── views/                    # HTML pages (login, register, dashboard, 404)
├── public/
│   ├── css/styles.css
│   ├── js/api.js             # fetch wrapper
│   ├── js/auth.js            # login + register forms
│   ├── js/dashboard.js       # everything on the dashboard
│   └── favicon.svg
├── tests/
│   ├── helpers.js            # test database setup, logged-in test users
│   ├── validation.test.js
│   └── api.test.js
├── .env.example
└── package.json
```

## Security notes

- Passwords are hashed with bcrypt (12 rounds). The plain password is never stored or logged.
- The session id is regenerated on login, which blocks session fixation.
- The session cookie is `httpOnly` (page scripts can't read it) and `sameSite=lax` (other sites can't make logged-in POST, PUT or DELETE requests with it). In production it's also `secure`, so it only travels over HTTPS.
- All SQL uses parameterized queries (`$1`, `$2`). The sort order comes from a fixed list, never from raw user input.
- The dashboard builds the page with `textContent` instead of `innerHTML`, so anything typed into a note shows up as text and can't run as code.
- Login failures give the same message whether the email exists or not.
- Passwords are capped at 72 bytes, not 72 characters. bcrypt ignores everything after byte 72, and Khmer or accented letters take 2-3 bytes each, so without this a different password with the same start could log in.
- Every input is type-checked, so `{"company": {}}` is rejected instead of saved as `[object Object]`, and ids or sort values that don't fit cause a clean 400/404 instead of a server error.
- The dashboard and API send `Cache-Control: no-store`, so pressing Back after logging out doesn't bring your applications back from the browser cache.

## Pushing to GitHub

The project already has its commit history. Create an empty repository on GitHub (no README, no .gitignore, no license), then from the project folder:

```powershell
git remote add origin https://github.com/YOUR-USERNAME/job-application-tracker.git
git push -u origin main
```

`.env` is in `.gitignore`, so your database password and session secret stay on your machine.

## Ideas for later

- A "follow up by" date with a reminder when it passes
- Search by company or role
- Export everything to CSV
- A chart of applications per week

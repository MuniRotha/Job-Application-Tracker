-- Job Application Tracker schema (PostgreSQL)
-- Run with: npm run db:init

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100)  NOT NULL,
  email       VARCHAR(255)  NOT NULL UNIQUE,
  password    VARCHAR(255)  NOT NULL,          -- bcrypt hash, never the plain password
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applications (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company       VARCHAR(150)  NOT NULL,
  role          VARCHAR(150)  NOT NULL,
  status        VARCHAR(20)   NOT NULL DEFAULT 'Applied'
                CHECK (status IN ('Applied', 'Interview', 'Offer', 'Rejected')),
  date_applied  DATE          NOT NULL DEFAULT CURRENT_DATE,
  job_url       TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Every dashboard query filters by user, so index it.
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);

// Creates the tables from db/schema.sql. Safe to run more than once.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Database ready: users and applications tables exist.');
}

main()
  .catch((err) => {
    console.error('Could not set up the database:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

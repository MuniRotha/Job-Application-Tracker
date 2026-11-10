const { Pool, types } = require('pg');

// By default pg turns DATE columns into JS Date objects at local midnight,
// which can shift the day when converted to JSON. Keep them as 'YYYY-MM-DD'.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err.message);
});

module.exports = pool;

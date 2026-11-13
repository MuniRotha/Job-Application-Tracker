require('dotenv').config({ quiet: true });

if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const { app } = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Job Application Tracker running at http://localhost:${PORT}`);
});

const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { STATUSES, text, validateApplication, parseId } = require('../validation');

const router = express.Router();
router.use(requireAuth);

// Only these sort orders are allowed. The values are fixed SQL fragments, so
// nothing the user sends ever gets pasted into the query.
const SORTS = {
  date_desc: 'date_applied DESC, id DESC',
  date_asc: 'date_applied ASC, id ASC',
};

const COLUMNS = 'id, company, role, status, date_applied, job_url, notes, created_at';

// GET /api/applications?status=Interview&sort=date_desc
router.get('/', async (req, res) => {
  const { status, sort } = req.query;
  // Object.hasOwn stops values like ?sort=__proto__ from reaching the SQL.
  const orderBy = Object.hasOwn(SORTS, sort) ? SORTS[sort] : SORTS.date_desc;
  const params = [req.session.userId];
  let where = 'user_id = $1';

  if (status !== undefined && status !== '') {
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status filter must be one of: ${STATUSES.join(', ')}.` });
    }
    params.push(status);
    where += ` AND status = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT ${COLUMNS} FROM applications WHERE ${where} ORDER BY ${orderBy}`,
    params
  );
  res.json({ applications: result.rows });
});

// GET /api/applications/summary -> how many applications sit in each status
router.get('/summary', async (req, res) => {
  const result = await pool.query(
    'SELECT status, COUNT(*)::int AS count FROM applications WHERE user_id = $1 GROUP BY status',
    [req.session.userId]
  );
  const counts = { Applied: 0, Interview: 0, Offer: 0, Rejected: 0 };
  for (const row of result.rows) counts[row.status] = row.count;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  res.json({ counts, total });
});

// GET /api/applications/:id
router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Application not found.' });

  const result = await pool.query(
    `SELECT ${COLUMNS} FROM applications WHERE id = $1 AND user_id = $2`,
    [id, req.session.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
  res.json({ application: result.rows[0] });
});

// POST /api/applications
router.post('/', async (req, res) => {
  const { data, error } = validateApplication(req.body);
  if (error) return res.status(400).json({ error });

  const result = await pool.query(
    `INSERT INTO applications (user_id, company, role, status, date_applied, job_url, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [req.session.userId, data.company, data.role, data.status, data.date_applied, data.job_url, data.notes]
  );
  res.status(201).json({ application: result.rows[0] });
});

// PUT /api/applications/:id  -> replace all editable fields
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Application not found.' });

  const { data, error } = validateApplication(req.body);
  if (error) return res.status(400).json({ error });

  // "AND user_id = $9" means nobody can edit another user's rows,
  // even if they guess the id.
  const result = await pool.query(
    `UPDATE applications
        SET company = $1, role = $2, status = $3, date_applied = $4, job_url = $5, notes = $6
      WHERE id = $7 AND user_id = $8
      RETURNING ${COLUMNS}`,
    [data.company, data.role, data.status, data.date_applied, data.job_url, data.notes, id, req.session.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
  res.json({ application: result.rows[0] });
});

// PATCH /api/applications/:id/status  -> quick status change from the table
router.patch('/:id/status', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Application not found.' });

  const status = text(req.body.status);
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}.` });
  }

  const result = await pool.query(
    `UPDATE applications SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING ${COLUMNS}`,
    [status, id, req.session.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
  res.json({ application: result.rows[0] });
});

// PATCH /api/applications/:id/notes  -> save notes without touching other fields
router.patch('/:id/notes', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Application not found.' });

  const notes = text(req.body.notes);
  if (notes.length > 5000) {
    return res.status(400).json({ error: 'Notes must be 5,000 characters or fewer.' });
  }

  const result = await pool.query(
    `UPDATE applications SET notes = $1 WHERE id = $2 AND user_id = $3 RETURNING ${COLUMNS}`,
    [notes || null, id, req.session.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found.' });
  res.json({ application: result.rows[0] });
});

// DELETE /api/applications/:id
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Application not found.' });

  const result = await pool.query(
    'DELETE FROM applications WHERE id = $1 AND user_id = $2',
    [id, req.session.userId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Application not found.' });
  res.status(204).end();
});

module.exports = router;

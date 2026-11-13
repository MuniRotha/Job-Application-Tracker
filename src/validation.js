// Input checks shared by the routes. Kept in one file so they're easy to test.

const STATUSES = ['Applied', 'Interview', 'Offer', 'Rejected'];

// The biggest value a PostgreSQL INTEGER (SERIAL) column can hold.
const MAX_INT = 2147483647;

// Turn a request value into trimmed text. Strings and numbers are allowed;
// anything else (objects, arrays, booleans) becomes '' so it fails the
// "required" checks instead of being saved as "[object Object]".
function text(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2100) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // new Date('2026-02-30') rolls over to March 2, so compare it back.
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Check and clean the fields for a create or full update.
// Returns { data } on success or { error } with a message for the user.
function validateApplication(body = {}) {
  const company = text(body.company);
  const role = text(body.role);
  const status = body.status === undefined || body.status === null || body.status === ''
    ? 'Applied'
    : text(body.status);
  const dateApplied = text(body.date_applied);
  const jobUrl = text(body.job_url);
  const notes = text(body.notes);

  if (!company) return { error: 'Company is required.' };
  if (!role) return { error: 'Role is required.' };
  if (company.length > 150) return { error: 'Company must be 150 characters or fewer.' };
  if (role.length > 150) return { error: 'Role must be 150 characters or fewer.' };
  if (!STATUSES.includes(status)) {
    return { error: `Status must be one of: ${STATUSES.join(', ')}.` };
  }
  if (!dateApplied) return { error: 'Date applied is required.' };
  if (!isValidDate(dateApplied)) {
    return { error: 'Date applied must be a real date between 1900 and 2100 (YYYY-MM-DD).' };
  }
  if (jobUrl.length > 2000) return { error: 'Job link is too long.' };
  if (jobUrl && !isValidUrl(jobUrl)) {
    return { error: 'Job link must start with http:// or https://' };
  }
  if (notes.length > 5000) return { error: 'Notes must be 5,000 characters or fewer.' };

  return {
    data: {
      company,
      role,
      status,
      date_applied: dateApplied,
      job_url: jobUrl || null,
      notes: notes || null,
    },
  };
}

// Route ids must be whole numbers that fit in the id column.
function parseId(raw) {
  if (!/^\d+$/.test(String(raw))) return null;
  const id = Number(raw);
  return id > 0 && id <= MAX_INT ? id : null;
}

module.exports = {
  STATUSES,
  text,
  isValidDate,
  isValidUrl,
  validateApplication,
  parseId,
};

// Unit tests for the input checks. These don't need a database.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { text, isValidDate, isValidUrl, validateApplication, parseId } = require('../src/validation');

const valid = { company: 'ABA Bank', role: 'Web Developer', date_applied: '2026-11-03' };

describe('text()', () => {
  test('trims strings', () => assert.equal(text('  hi  '), 'hi'));
  test('turns numbers into strings', () => assert.equal(text(42), '42'));
  test('turns objects, arrays, booleans and null into an empty string', () => {
    for (const value of [{ a: 1 }, ['x'], true, null, undefined, NaN]) {
      assert.equal(text(value), '');
    }
  });
});

describe('isValidDate()', () => {
  test('accepts real dates', () => {
    for (const d of ['2026-11-03', '2024-02-29', '1900-01-01', '2100-12-31']) {
      assert.equal(isValidDate(d), true, d);
    }
  });
  test('rejects impossible dates', () => {
    for (const d of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-04-31']) {
      assert.equal(isValidDate(d), false, d);
    }
  });
  test('rejects years outside 1900-2100', () => {
    for (const d of ['0000-01-01', '1899-12-31', '2101-01-01']) {
      assert.equal(isValidDate(d), false, d);
    }
  });
  test('rejects other formats', () => {
    for (const d of ['03/11/2026', '2026-1-3', '2026-11-03T10:00', 'yesterday', '', 20261103]) {
      assert.equal(isValidDate(d), false, String(d));
    }
  });
});

describe('isValidUrl()', () => {
  test('accepts http and https', () => {
    assert.equal(isValidUrl('https://example.com/jobs/1'), true);
    assert.equal(isValidUrl('http://localhost:3000'), true);
  });
  test('rejects other protocols and junk', () => {
    for (const u of ['javascript:alert(1)', 'ftp://example.com', 'data:text/html,hi', 'example.com', 'https://', 'not a url']) {
      assert.equal(isValidUrl(u), false, u);
    }
  });
});

describe('validateApplication()', () => {
  test('fills in defaults', () => {
    const { data, error } = validateApplication(valid);
    assert.equal(error, undefined);
    assert.equal(data.status, 'Applied');
    assert.equal(data.job_url, null);
    assert.equal(data.notes, null);
  });

  test('trims every text field', () => {
    const { data } = validateApplication({
      company: '  ABA  ', role: ' Dev ', date_applied: ' 2026-11-03 ', job_url: ' https://x.com ', notes: '  hi  ',
    });
    assert.deepEqual(
      [data.company, data.role, data.date_applied, data.job_url, data.notes],
      ['ABA', 'Dev', '2026-11-03', 'https://x.com', 'hi']
    );
  });

  test('requires company, role and date', () => {
    assert.match(validateApplication({ ...valid, company: '   ' }).error, /Company is required/);
    assert.match(validateApplication({ ...valid, role: '' }).error, /Role is required/);
    assert.match(validateApplication({ ...valid, date_applied: '' }).error, /Date applied is required/);
  });

  test('does not save objects as "[object Object]"', () => {
    assert.match(validateApplication({ ...valid, company: { x: 1 } }).error, /Company is required/);
  });

  test('rejects unknown statuses, including different capitalisation', () => {
    for (const s of ['Ghosted', 'applied', 'OFFER']) {
      assert.match(validateApplication({ ...valid, status: s }).error, /Status must be one of/, s);
    }
  });

  test('accepts every real status', () => {
    for (const s of ['Applied', 'Interview', 'Offer', 'Rejected']) {
      assert.equal(validateApplication({ ...valid, status: s }).data.status, s);
    }
  });

  test('enforces length limits', () => {
    assert.match(validateApplication({ ...valid, company: 'a'.repeat(151) }).error, /150 characters/);
    assert.equal(validateApplication({ ...valid, company: 'a'.repeat(150) }).error, undefined);
    assert.match(validateApplication({ ...valid, role: 'a'.repeat(151) }).error, /150 characters/);
    assert.match(validateApplication({ ...valid, notes: 'a'.repeat(5001) }).error, /5,000/);
    assert.equal(validateApplication({ ...valid, notes: 'a'.repeat(5000) }).error, undefined);
    assert.match(validateApplication({ ...valid, job_url: `https://x.com/${'a'.repeat(2000)}` }).error, /too long/);
  });

  test('rejects dangerous job links', () => {
    assert.match(validateApplication({ ...valid, job_url: 'javascript:alert(1)' }).error, /http/);
  });
});

describe('parseId()', () => {
  test('accepts positive whole numbers that fit in the id column', () => {
    assert.equal(parseId('1'), 1);
    assert.equal(parseId('2147483647'), 2147483647);
  });
  test('rejects everything else', () => {
    for (const id of ['0', '-1', '1.5', '1e3', 'abc', '', ' 1', '2147483648', '99999999999']) {
      assert.equal(parseId(id), null, id);
    }
  });
});

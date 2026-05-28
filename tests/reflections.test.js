'use strict';

process.env.SUPABASE_URL         = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'fake-key';

jest.mock('../api/_auth', () => ({ verifyToken: jest.fn() }));

const { verifyToken } = require('../api/_auth');
const handler         = require('../api/reflections');
const { mockReq, mockRes } = require('./helpers/mockReqRes');

const AUTH = { authorization: 'Bearer test-token' };
const ME   = { uid: 'uid-1', email: 'user@test.com' };

function fakeFetch(ok, body) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  verifyToken.mockResolvedValue(ME);
  global.fetch = jest.fn();
});

// ── OPTIONS ───────────────────────────────────────────────────────────────────

describe('OPTIONS preflight', () => {
  test('returns 200 without requiring auth', async () => {
    verifyToken.mockResolvedValue(null);
    const res = mockRes();
    await handler(mockReq({ method: 'OPTIONS', headers: AUTH }), res);
    expect(res._status).toBe(200);
    expect(res._ended).toBe(true);
  });
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('auth guard', () => {
  test('returns 401 when token is invalid', async () => {
    verifyToken.mockResolvedValue(null);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: {}, query: { date: '2026-01-01' } }), res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: 'Unauthorized' });
  });
});

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/reflections', () => {
  test('returns 400 when date is missing', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: {} }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when date format is not YYYY-MM-DD', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: { date: '28/05/2026' } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 200 with reflection object when a record exists', async () => {
    const reflection = { grade: 'A', focus: 4, energy: 3, mood: 5, wins: 'Shipped!', fix: '', learn: '' };
    fakeFetch(true, [reflection]);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: { date: '2026-05-28' } }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual(reflection);
  });

  test('returns 200 with null when no record exists for that date', async () => {
    fakeFetch(true, []); // Supabase returns empty array → handler returns null
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: { date: '2026-05-28' } }), res);
    expect(res._status).toBe(200);
    expect(res._body).toBeNull();
  });

  test('scopes the query to the authenticated user', async () => {
    fakeFetch(true, []);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: { date: '2026-05-28' } }), res);
    expect(global.fetch.mock.calls[0][0]).toContain(`user_id=eq.${ME.uid}`);
  });
});

// ── POST (upsert) ─────────────────────────────────────────────────────────────

describe('POST /api/reflections', () => {
  const valid = {
    date: '2026-05-28', grade: 'A',
    focus: 4, energy: 3, mood: 5,
    wins: 'Great day', fix: 'Nothing', learn: 'Ship daily',
  };

  // Date validation
  test('returns 400 when date is missing', async () => {
    const { date, ...body } = valid;
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when date format is invalid', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, date: 'today' } }), res);
    expect(res._status).toBe(400);
  });

  // Grade validation
  test('returns 400 when grade is not a recognised letter', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, grade: 'S+' } }), res);
    expect(res._status).toBe(400);
  });

  test('accepts null grade (deselecting a grade)', async () => {
    fakeFetch(true, [{ ...valid, grade: null }]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, grade: null } }), res);
    expect(res._status).toBe(200);
  });

  test('accepts every valid grade value (A+, A, B, C, D, F)', async () => {
    for (const grade of ['A+', 'A', 'B', 'C', 'D', 'F']) {
      fakeFetch(true, [{ ...valid, grade }]);
      const res = mockRes();
      await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, grade } }), res);
      expect(res._status).toBe(200);
    }
  });

  // Numeric clamping
  test('clamps focus above 5 to 5', async () => {
    fakeFetch(true, [{ ...valid, focus: 5 }]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, focus: 99 } }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.focus).toBe(5);
  });

  test('clamps focus below 0 to 0', async () => {
    fakeFetch(true, [{ ...valid, focus: 0 }]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, focus: -10 } }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.focus).toBe(0);
  });

  test('clamps energy and mood by the same rules', async () => {
    fakeFetch(true, [{ ...valid, energy: 5, mood: 0 }]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, energy: 100, mood: -5 } }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.energy).toBe(5);
    expect(sent.mood).toBe(0);
  });

  // Text truncation
  test('truncates wins at 2000 characters', async () => {
    fakeFetch(true, [valid]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, wins: 'w'.repeat(3000) } }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.wins.length).toBe(2000);
  });

  test('truncates fix and learn at 2000 characters', async () => {
    fakeFetch(true, [valid]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: {
      ...valid, fix: 'f'.repeat(2500), learn: 'l'.repeat(3000),
    }}), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.fix.length).toBe(2000);
    expect(sent.learn.length).toBe(2000);
  });

  // Partial updates
  test('only includes fields that are present in the request body', async () => {
    fakeFetch(true, [{ date: '2026-05-28', grade: 'B' }]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { date: '2026-05-28', grade: 'B' } }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent).toHaveProperty('grade', 'B');
    expect(sent).not.toHaveProperty('focus');
    expect(sent).not.toHaveProperty('wins');
  });

  // Success
  test('returns 200 with the saved reflection on success', async () => {
    const saved = { ...valid, user_id: ME.uid };
    fakeFetch(true, [saved]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: valid }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual(saved);
  });

  // Error path
  test('returns 500 on Supabase error', async () => {
    fakeFetch(false, { message: 'error' });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: valid }), res);
    expect(res._status).toBe(500);
  });
});

// ── Method not allowed ────────────────────────────────────────────────────────

describe('unsupported methods', () => {
  test('returns 405 for DELETE', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'DELETE', headers: AUTH }), res);
    expect(res._status).toBe(405);
  });

  test('returns 405 for PATCH', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PATCH', headers: AUTH }), res);
    expect(res._status).toBe(405);
  });
});

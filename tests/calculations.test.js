'use strict';

process.env.SUPABASE_URL         = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'fake-key';

jest.mock('../api/_auth', () => ({ verifyToken: jest.fn() }));

const { verifyToken } = require('../api/_auth');
const handler         = require('../api/calculations');
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
  test('returns 401 when token is invalid or absent', async () => {
    verifyToken.mockResolvedValue(null);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: {} }), res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: 'Unauthorized' });
  });
});

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/calculations', () => {
  test('returns 200 with the calculations array', async () => {
    const calcs = [
      { id: 1, expression: '2 + 2',  result: '4' },
      { id: 2, expression: '10 / 2', result: '5' },
    ];
    fakeFetch(true, calcs);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual(calcs);
  });

  test('scopes the query to the authenticated user', async () => {
    fakeFetch(true, []);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH }), res);
    expect(global.fetch.mock.calls[0][0]).toContain(`user_id=eq.${ME.uid}`);
  });

  test('limits results to 20 records', async () => {
    fakeFetch(true, []);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH }), res);
    expect(global.fetch.mock.calls[0][0]).toContain('limit=20');
  });

  test('orders results by created_at descending', async () => {
    fakeFetch(true, []);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH }), res);
    expect(global.fetch.mock.calls[0][0]).toContain('order=created_at.desc');
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/calculations', () => {
  const valid = { expression: '2 + 2', result: '4' };

  test('returns 400 when expression is not a string', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { expression: 42, result: '4' } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when result is not a string', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { expression: '2+2', result: 4 } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when expression exceeds 300 characters', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { expression: 'x'.repeat(301), result: '0' } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when result exceeds 100 characters', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { expression: '2+2', result: '4'.repeat(101) } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when body is null', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: null }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when expression or result is missing entirely', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { expression: '2+2' } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 201 and ends the response on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: valid }), res);
    expect(res._status).toBe(201);
    expect(res._ended).toBe(true);
  });

  test('stores the authenticated user_id in the saved record', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: valid }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.user_id).toBe(ME.uid);
    expect(sent.expression).toBe(valid.expression);
    expect(sent.result).toBe(valid.result);
  });

  test('accepts expression exactly 300 characters long (boundary)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { expression: 'x'.repeat(300), result: '0' } }), res);
    expect(res._status).toBe(201);
  });

  test('accepts result exactly 100 characters long (boundary)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { expression: '1+1', result: '0'.repeat(100) } }), res);
    expect(res._status).toBe(201);
  });

  test('returns 500 on Supabase error', async () => {
    fakeFetch(false, { message: 'server error' });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: valid }), res);
    expect(res._status).toBe(500);
  });
});

// ── Method not allowed ────────────────────────────────────────────────────────

describe('unsupported methods', () => {
  test('returns 405 for PUT', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PUT', headers: AUTH }), res);
    expect(res._status).toBe(405);
  });

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

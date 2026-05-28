'use strict';

process.env.SUPABASE_URL         = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'fake-key';

jest.mock('../api/_auth', () => ({ verifyToken: jest.fn() }));

const { verifyToken } = require('../api/_auth');
const handler         = require('../api/tasks');
const { mockReq, mockRes } = require('./helpers/mockReqRes');

const AUTH    = { authorization: 'Bearer test-token' };
const ME      = { uid: 'uid-1', email: 'user@test.com' };

// Build a fetch response with .ok and .json()
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
  test('returns 200 without checking auth', async () => {
    verifyToken.mockResolvedValue(null);
    const res = mockRes();
    await handler(mockReq({ method: 'OPTIONS', headers: AUTH }), res);
    expect(res._status).toBe(200);
    expect(res._ended).toBe(true);
  });

  test('sets CORS headers on every request', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'OPTIONS', headers: AUTH }), res);
    expect(res.headers['Access-Control-Allow-Methods']).toMatch(/GET/);
  });
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('auth guard', () => {
  test('returns 401 when token is absent or invalid', async () => {
    verifyToken.mockResolvedValue(null);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: {}, query: { date: '2026-01-01' } }), res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: 'Unauthorized' });
  });
});

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/tasks', () => {
  test('returns 400 when date param is missing', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: {} }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when date format is not YYYY-MM-DD', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: { date: '28-05-2026' } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 200 with tasks array for a valid date', async () => {
    const tasks = [
      { task_id: 1, hour: 9, task_text: 'Stand-up', category: 'work', priority: 'normal', completed: false },
    ];
    fakeFetch(true, tasks);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: { date: '2026-05-28' } }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual(tasks);
  });

  test('scopes GET to the authenticated user', async () => {
    fakeFetch(true, []);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: { date: '2026-05-28' } }), res);
    expect(global.fetch.mock.calls[0][0]).toContain(`user_id=eq.${ME.uid}`);
  });

  test('GET heatmap returns per-day task counts for last 28 days', async () => {
    fakeFetch(true, [
      { date: '2026-05-28', completed: true  },
      { date: '2026-05-28', completed: false },
      { date: '2026-05-27', completed: true  },
    ]);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: { heatmap: '1' } }), res);
    expect(res._status).toBe(200);
    expect(res._body['2026-05-28']).toEqual({ total: 2, done: 1, pending: 1 });
    expect(res._body['2026-05-27']).toEqual({ total: 1, done: 1, pending: 0 });
  });

  test('GET heatmap returns empty object when no tasks exist', async () => {
    fakeFetch(true, []);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', headers: AUTH, query: { heatmap: '1' } }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({});
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/tasks', () => {
  const valid = { date: '2026-05-28', hour: 9, task_text: 'Write tests', category: 'work', priority: 'normal' };

  // Date validation
  test('returns 400 when date is missing', async () => {
    const { date, ...body } = valid;
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when date format is invalid', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, date: '28-05-2026' } }), res);
    expect(res._status).toBe(400);
  });

  // Hour validation
  test('returns 400 when hour is missing', async () => {
    const { hour, ...body } = valid;
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when hour is -1 (below range)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, hour: -1 } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when hour is 24 (above range)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, hour: 24 } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when hour is a float', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, hour: 9.5 } }), res);
    expect(res._status).toBe(400);
  });

  test('accepts hour 0 (midnight)', async () => {
    fakeFetch(true, [{ task_id: 1, hour: 0, task_text: 'Midnight', category: 'general', priority: 'normal', completed: false }]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, hour: 0 } }), res);
    expect(res._status).toBe(201);
  });

  test('accepts hour 23 (11 pm)', async () => {
    fakeFetch(true, [{ task_id: 2, hour: 23, task_text: 'Late', category: 'general', priority: 'normal', completed: false }]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, hour: 23 } }), res);
    expect(res._status).toBe(201);
  });

  // task_text validation
  test('returns 400 when task_text is missing', async () => {
    const { task_text, ...body } = valid;
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when task_text is whitespace only', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, task_text: '   ' } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when task_text exceeds 500 characters', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, task_text: 'a'.repeat(501) } }), res);
    expect(res._status).toBe(400);
  });

  // Category / priority validation
  test('returns 400 when category is an unrecognised string', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, category: 'unknown-cat' } }), res);
    expect(res._status).toBe(400);
  });

  test('accepts a custom category matching the c_* pattern', async () => {
    fakeFetch(true, [{ ...valid, task_id: 3, category: 'c_my_label_123' }]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, category: 'c_my_label_123' } }), res);
    expect(res._status).toBe(201);
  });

  test('returns 400 when priority is not high / normal / low', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, priority: 'urgent' } }), res);
    expect(res._status).toBe(400);
  });

  // Success
  test('returns 201 with the created task on success', async () => {
    const created = { task_id: 1, hour: 9, task_text: 'Write tests', category: 'work', priority: 'normal', completed: false };
    fakeFetch(true, [created]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: valid }), res);
    expect(res._status).toBe(201);
    expect(res._body).toEqual(created);
  });

  test('trims whitespace from task_text before saving', async () => {
    fakeFetch(true, [{ ...valid, task_id: 4, task_text: 'Trimmed' }]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: { ...valid, task_text: '  Trimmed  ' } }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.task_text).toBe('Trimmed');
  });

  test('defaults category to "general" when omitted', async () => {
    fakeFetch(true, [{ ...valid, task_id: 5, category: 'general' }]);
    const { category, ...noCategory } = valid;
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: noCategory }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.category).toBe('general');
  });

  test('defaults priority to "normal" when omitted', async () => {
    fakeFetch(true, [{ ...valid, task_id: 6, priority: 'normal' }]);
    const { priority, ...noPriority } = valid;
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: noPriority }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.priority).toBe('normal');
  });

  test('sets completed: false on newly created tasks', async () => {
    fakeFetch(true, [{ ...valid, task_id: 7, completed: false }]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: valid }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.completed).toBe(false);
  });

  // Error paths
  test('returns 409 when the hour already has a task (Supabase code 23505)', async () => {
    fakeFetch(false, { code: '23505', message: 'duplicate key' });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: valid }), res);
    expect(res._status).toBe(409);
    expect(res._body).toMatchObject({ error: 'Hour already has a task' });
  });

  test('returns 500 on any other Supabase error', async () => {
    fakeFetch(false, { code: '42P01', message: 'table not found' });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', headers: AUTH, body: valid }), res);
    expect(res._status).toBe(500);
  });
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/tasks', () => {
  const patch = (id, body) =>
    mockReq({ method: 'PATCH', headers: AUTH, query: { id }, body });

  // ID validation
  test('returns 400 when id is missing', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PATCH', headers: AUTH, query: {}, body: { task_text: 'x' } }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when id is "0"', async () => {
    const res = mockRes();
    await handler(patch('0', { task_text: 'x' }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when id is not numeric', async () => {
    const res = mockRes();
    await handler(patch('abc', { task_text: 'x' }), res);
    expect(res._status).toBe(400);
  });

  // Body validation
  test('returns 400 when body has no recognised fields', async () => {
    const res = mockRes();
    await handler(patch('1', {}), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when task_text is an empty string', async () => {
    const res = mockRes();
    await handler(patch('1', { task_text: '' }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when task_text is whitespace only', async () => {
    const res = mockRes();
    await handler(patch('1', { task_text: '   ' }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when task_text exceeds 500 characters', async () => {
    const res = mockRes();
    await handler(patch('1', { task_text: 'a'.repeat(501) }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when category is invalid', async () => {
    const res = mockRes();
    await handler(patch('1', { category: 'foo' }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when priority is invalid', async () => {
    const res = mockRes();
    await handler(patch('1', { priority: 'critical' }), res);
    expect(res._status).toBe(400);
  });

  // Success
  test('returns 200 with updated task when patching task_text', async () => {
    const updated = { task_id: 1, hour: 9, task_text: 'Updated text', category: 'work', priority: 'normal', completed: false };
    fakeFetch(true, [updated]);
    const res = mockRes();
    await handler(patch('1', { task_text: 'Updated text' }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual(updated);
  });

  test('returns 200 when marking a task complete', async () => {
    const updated = { task_id: 1, completed: true };
    fakeFetch(true, [updated]);
    const res = mockRes();
    await handler(patch('1', { completed: true }), res);
    expect(res._status).toBe(200);
    expect(res._body.completed).toBe(true);
  });

  test('returns 200 when un-completing a task (completed: false)', async () => {
    const updated = { task_id: 1, completed: false };
    fakeFetch(true, [updated]);
    const res = mockRes();
    await handler(patch('1', { completed: false }), res);
    expect(res._status).toBe(200);
    expect(res._body.completed).toBe(false);
  });

  test('coerces completed: 1 to boolean true', async () => {
    fakeFetch(true, [{ task_id: 1, completed: true }]);
    const res = mockRes();
    await handler(patch('1', { completed: 1 }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.completed).toBe(true);
  });

  test('trims whitespace from task_text before saving', async () => {
    fakeFetch(true, [{ task_id: 1, task_text: 'Clean' }]);
    const res = mockRes();
    await handler(patch('1', { task_text: '  Clean  ' }), res);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.task_text).toBe('Clean');
  });

  test('scopes the update to the authenticated user only', async () => {
    fakeFetch(true, [{ task_id: 1, task_text: 'x' }]);
    const res = mockRes();
    await handler(patch('1', { task_text: 'x' }), res);
    expect(global.fetch.mock.calls[0][0]).toContain(`user_id=eq.${ME.uid}`);
  });

  // Error path
  test('returns 500 on Supabase error', async () => {
    fakeFetch(false, { message: 'error' });
    const res = mockRes();
    await handler(patch('1', { task_text: 'x' }), res);
    expect(res._status).toBe(500);
  });
});

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/tasks', () => {
  const del = id => mockReq({ method: 'DELETE', headers: AUTH, query: { id } });

  test('returns 400 when id is missing', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'DELETE', headers: AUTH, query: {} }), res);
    expect(res._status).toBe(400);
  });

  test('returns 400 when id is "0"', async () => {
    const res = mockRes();
    await handler(del('0'), res);
    expect(res._status).toBe(400);
  });

  test('returns 204 on successful delete', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
    const res = mockRes();
    await handler(del('5'), res);
    expect(res._status).toBe(204);
    expect(res._ended).toBe(true);
  });

  test('scopes the delete to the authenticated user only', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
    const res = mockRes();
    await handler(del('5'), res);
    expect(global.fetch.mock.calls[0][0]).toContain(`user_id=eq.${ME.uid}`);
  });

  test('returns 500 on Supabase error', async () => {
    fakeFetch(false, { message: 'error' });
    const res = mockRes();
    await handler(del('5'), res);
    expect(res._status).toBe(500);
  });
});

// ── Method not allowed ────────────────────────────────────────────────────────

describe('unsupported methods', () => {
  test('returns 405 for PUT', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PUT', headers: AUTH, query: {}, body: {} }), res);
    expect(res._status).toBe(405);
  });
});

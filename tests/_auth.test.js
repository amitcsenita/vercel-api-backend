'use strict';

// Set env vars before any require so ensureInit() can JSON.parse the value
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', project_id: 'test' });
process.env.SUPABASE_URL             = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY     = 'fake-key';

// Mock firebase-admin before _auth is loaded.
// auth() uses mockReturnValue so every call returns the SAME object,
// giving us a stable reference to verifyIdToken across tests.
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential:    { cert: jest.fn(() => ({})) },
  auth:          jest.fn().mockReturnValue({ verifyIdToken: jest.fn() }),
}));

const admin = require('firebase-admin');
const { verifyToken, isAdmin } = require('../api/_auth');

// Stable reference to the verifyIdToken mock
const mockVerifyIdToken = admin.auth().verifyIdToken;

function authReq(header) {
  return { headers: { authorization: header } };
}

// ── verifyToken ───────────────────────────────────────────────────────────────

describe('verifyToken', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
  });

  test('returns null when Authorization header is absent', async () => {
    expect(await verifyToken({ headers: {} })).toBeNull();
  });

  test('returns null when Authorization header is an empty string', async () => {
    expect(await verifyToken(authReq(''))).toBeNull();
  });

  test('returns null when header does not start with "Bearer "', async () => {
    expect(await verifyToken(authReq('Token abc123'))).toBeNull();
    expect(await verifyToken(authReq('Basic abc123'))).toBeNull();
    expect(await verifyToken(authReq('bearer valid'))).toBeNull(); // case-sensitive
  });

  test('returns { uid, email } for a valid Bearer token', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-1', email: 'user@example.com' });
    const result = await verifyToken(authReq('Bearer valid-token'));
    expect(result).toEqual({ uid: 'uid-1', email: 'user@example.com' });
    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-token');
  });

  test('strips "Bearer " prefix before passing token to verifyIdToken', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u', email: 'e@e.com' });
    await verifyToken(authReq('Bearer my-token-xyz'));
    expect(mockVerifyIdToken).toHaveBeenCalledWith('my-token-xyz');
  });

  test('returns null when verifyIdToken throws (expired / invalid token)', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Token expired'));
    expect(await verifyToken(authReq('Bearer bad-token'))).toBeNull();
  });
});

// ── isAdmin ───────────────────────────────────────────────────────────────────

describe('isAdmin', () => {
  test('returns true for the designated admin email', () => {
    expect(isAdmin({ uid: 'x', email: 'amitcse.nita@gmail.com' })).toBe(true);
  });

  test('returns false for any other email', () => {
    expect(isAdmin({ uid: 'x', email: 'other@example.com' })).toBe(false);
    expect(isAdmin({ uid: 'x', email: 'AMITCSE.NITA@GMAIL.COM' })).toBe(false); // case-sensitive
  });

  test('returns false when decoded is null', () => {
    expect(isAdmin(null)).toBe(false);
  });

  test('returns false when decoded is undefined', () => {
    expect(isAdmin(undefined)).toBe(false);
  });
});

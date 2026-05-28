// Shared Firebase Admin token verification for Vercel API routes.
// Vercel does not expose this file as an endpoint because of the _ prefix.

const admin = require('firebase-admin');

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  initialized = true;
}

const ADMIN_EMAIL = 'amitcse.nita@gmail.com';

// Returns { uid, email } if token is valid, otherwise null.
async function verifyToken(req) {
  ensureInit();
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    return null;
  }
}

// Returns true only for the designated admin account.
function isAdmin(decoded) {
  return !!(decoded && decoded.email === ADMIN_EMAIL);
}

// Returns the initialized firebase-admin instance (for use in other handlers).
function getAdmin() {
  ensureInit();
  return admin;
}

module.exports = { verifyToken, isAdmin, getAdmin };

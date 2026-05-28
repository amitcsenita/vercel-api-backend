const { verifyToken } = require('./_auth');

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const ALLOWED_ORIGINS = ['https://amitcsenita.github.io', 'http://localhost'];
const VALID_GRADES    = new Set(['A+', 'A', 'B', 'C', 'D', 'F']);

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const uid = decoded.uid;

  const sbH = {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
  };

  const { date } = req.query;

  // ─── GET ────────────────────────────────────────────────────────────────────

  if (req.method === 'GET') {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Valid date required (YYYY-MM-DD)' });
    }
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/reflections?date=eq.${date}&user_id=eq.${uid}&select=*`,
      { headers: sbH }
    );
    const rows = await r.json();
    return res.status(200).json(rows[0] || null);
  }

  // ─── POST (upsert) ──────────────────────────────────────────────────────────

  if (req.method === 'POST') {
    const { date: d, grade, focus, energy, mood, wins, fix, learn } = req.body ?? {};

    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return res.status(400).json({ error: 'Valid date required (YYYY-MM-DD)' });
    }
    if (grade !== undefined && grade !== null && !VALID_GRADES.has(grade)) {
      return res.status(400).json({ error: 'Invalid grade' });
    }

    const row = { user_id: uid, date: d };
    if (grade  !== undefined) row.grade  = grade;
    if (focus  !== undefined) row.focus  = Math.max(0, Math.min(5, parseInt(focus)  || 0));
    if (energy !== undefined) row.energy = Math.max(0, Math.min(5, parseInt(energy) || 0));
    if (mood   !== undefined) row.mood   = Math.max(0, Math.min(5, parseInt(mood)   || 0));
    if (wins   !== undefined) row.wins   = String(wins).slice(0, 2000);
    if (fix    !== undefined) row.fix    = String(fix).slice(0, 2000);
    if (learn  !== undefined) row.learn  = String(learn).slice(0, 2000);

    // Upsert: insert or update on (user_id, date) conflict
    const r = await fetch(`${SUPABASE_URL}/rest/v1/reflections?on_conflict=user_id,date`, {
      method:  'POST',
      headers: { ...sbH, 'Prefer': 'return=representation,resolution=merge-duplicates' },
      body:    JSON.stringify(row),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(500).json({ error: 'Failed to save reflection', detail: err });
    }
    const rows = await r.json();
    return res.status(200).json(rows[0] || row);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

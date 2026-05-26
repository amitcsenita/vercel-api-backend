const { verifyToken }  = require('./_auth');

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const ALLOWED_ORIGINS  = ['https://amitcsenita.github.io', 'http://localhost'];

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

  const sbHeaders = {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
  };

  // GET — fetch last 20 calculations for this user
  if (req.method === 'GET') {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/calculations?user_id=eq.${uid}&select=id,expression,result&order=created_at.desc&limit=20`,
      { headers: sbHeaders }
    );
    return res.status(200).json(await r.json());
  }

  // POST — save a calculation for this user
  if (req.method === 'POST') {
    const { expression, result } = req.body ?? {};

    if (typeof expression !== 'string' || typeof result !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    if (expression.length > 300 || result.length > 100) {
      return res.status(400).json({ error: 'Input too long' });
    }

    const r = await fetch(`${SUPABASE_URL}/rest/v1/calculations`, {
      method:  'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body:    JSON.stringify({ expression, result, user_id: uid }),
    });

    if (!r.ok) return res.status(500).json({ error: 'Failed to save' });
    return res.status(201).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

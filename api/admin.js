const { verifyToken, isAdmin, getAdmin } = require('./_auth');

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const ALLOWED_ORIGINS = ['https://amitcsenita.github.io', 'http://localhost'];

const sbH = () => ({
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
});

// Look up display name + email for a list of uids via Firebase Admin.
// Returns a map: { uid -> { name, email } }
async function resolveUsers(uids) {
  if (!uids.length) return {};
  const fbAdmin = getAdmin();
  const results = await Promise.allSettled(
    uids.map(uid => fbAdmin.auth().getUser(uid))
  );
  const map = {};
  uids.forEach((uid, i) => {
    const r = results[i];
    map[uid] = r.status === 'fulfilled'
      ? { name: r.value.displayName || r.value.email || uid, email: r.value.email || '' }
      : { name: uid, email: '' };
  });
  return map;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await verifyToken(req);
  if (!decoded)          return res.status(401).json({ error: 'Unauthorized' });
  if (!isAdmin(decoded)) return res.status(403).json({ error: 'Forbidden' });

  const { resource, date } = req.query;

  // ── Summary: each user with counts + real name ───────────────────────────
  if (resource === 'summary') {
    const [calcR, taskR] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/calculations?select=user_id`, { headers: sbH() }),
      fetch(`${SUPABASE_URL}/rest/v1/tasks?select=user_id`, { headers: sbH() }),
    ]);
    const calcs = await calcR.json();
    const tasks = await taskR.json();

    const counts = {};
    for (const r of (Array.isArray(calcs) ? calcs : [])) {
      if (!r.user_id) continue;
      counts[r.user_id] = counts[r.user_id] || { calculations: 0, tasks: 0 };
      counts[r.user_id].calculations++;
    }
    for (const r of (Array.isArray(tasks) ? tasks : [])) {
      if (!r.user_id) continue;
      counts[r.user_id] = counts[r.user_id] || { calculations: 0, tasks: 0 };
      counts[r.user_id].tasks++;
    }

    const uids    = Object.keys(counts);
    const userMap = await resolveUsers(uids);

    const result = uids.map(uid => ({
      uid,
      name:         userMap[uid].name,
      email:        userMap[uid].email,
      calculations: counts[uid].calculations,
      tasks:        counts[uid].tasks,
    }));
    return res.status(200).json(result);
  }

  // ── Calculations: all rows with real user name ───────────────────────────
  if (resource === 'calculations') {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/calculations?select=id,expression,result,user_id,created_at&order=created_at.desc&limit=100`,
      { headers: sbH() }
    );
    const rows = await r.json();
    if (!Array.isArray(rows)) return res.status(200).json(rows);

    const uids    = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    const userMap = await resolveUsers(uids);

    return res.status(200).json(rows.map(row => ({
      ...row,
      user_name: row.user_id ? userMap[row.user_id]?.name : '—',
    })));
  }

  // ── Tasks: all rows for a date with real user name ───────────────────────
  if (resource === 'tasks') {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Valid date required (YYYY-MM-DD)' });
    }
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?date=eq.${date}&order=user_id.asc,hour.asc&select=task_id,hour,task_text,category,completed,user_id`,
      { headers: sbH() }
    );
    const rows = await r.json();
    if (!Array.isArray(rows)) return res.status(200).json(rows);

    const uids    = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    const userMap = await resolveUsers(uids);

    return res.status(200).json(rows.map(row => ({
      ...row,
      user_name: row.user_id ? userMap[row.user_id]?.name : '—',
    })));
  }

  return res.status(400).json({ error: 'resource must be summary, calculations, or tasks' });
};

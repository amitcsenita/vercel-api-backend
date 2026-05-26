const { verifyToken } = require('./_auth');

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const ALLOWED_ORIGINS = ['https://amitcsenita.github.io', 'http://localhost'];
const VALID_CATS      = new Set(['work', 'personal', 'health', 'general']);

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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

  const { date, id, heatmap } = req.query;

  // ─── GET ────────────────────────────────────────────────────────────────────

  if (req.method === 'GET') {

    // Heatmap: task counts per day for last 28 days, scoped to this user
    if (heatmap) {
      const start = new Date();
      start.setDate(start.getDate() - 27);
      const startStr = start.toISOString().split('T')[0];

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tasks?select=date,completed&date=gte.${startStr}&user_id=eq.${uid}`,
        { headers: sbH }
      );
      const rows = await r.json();

      const counts = {};
      for (const row of (Array.isArray(rows) ? rows : [])) {
        if (!counts[row.date]) counts[row.date] = { total: 0, done: 0, pending: 0 };
        counts[row.date].total++;
        if (row.completed) counts[row.date].done++;
        else counts[row.date].pending++;
      }
      return res.status(200).json(counts);
    }

    // Tasks for a specific date, scoped to this user
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Valid date required (YYYY-MM-DD)' });
    }

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?date=eq.${date}&user_id=eq.${uid}&order=hour.asc&select=task_id,hour,task_text,category,completed`,
      { headers: sbH }
    );
    return res.status(200).json(await r.json());
  }

  // ─── POST ───────────────────────────────────────────────────────────────────

  if (req.method === 'POST') {
    const { date: d, hour, task_text, category = 'general' } = req.body ?? {};

    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d))            return res.status(400).json({ error: 'Invalid date' });
    if (!Number.isInteger(hour) || hour < 0 || hour > 23)  return res.status(400).json({ error: 'Invalid hour' });
    if (typeof task_text !== 'string' || !task_text.trim()) return res.status(400).json({ error: 'task_text required' });
    if (task_text.length > 500)                             return res.status(400).json({ error: 'task_text too long' });
    if (!VALID_CATS.has(category))                          return res.status(400).json({ error: 'Invalid category' });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
      method:  'POST',
      headers: { ...sbH, 'Prefer': 'return=representation' },
      body:    JSON.stringify({ date: d, hour, task_text: task_text.trim(), category, completed: false, user_id: uid }),
    });

    if (!r.ok) {
      const err = await r.json();
      const status = err.code === '23505' ? 409 : 500;
      return res.status(status).json({ error: status === 409 ? 'Hour already has a task' : 'Failed to create' });
    }
    return res.status(201).json((await r.json())[0]);
  }

  // ─── PATCH ──────────────────────────────────────────────────────────────────

  if (req.method === 'PATCH') {
    const taskId = parseInt(id);
    if (!taskId || taskId < 1) return res.status(400).json({ error: 'Valid id required' });

    const { task_text, category, completed } = req.body ?? {};
    const update = {};

    if (task_text !== undefined) {
      if (typeof task_text !== 'string' || !task_text.trim() || task_text.length > 500) {
        return res.status(400).json({ error: 'Invalid task_text' });
      }
      update.task_text = task_text.trim();
    }
    if (category !== undefined) {
      if (!VALID_CATS.has(category)) return res.status(400).json({ error: 'Invalid category' });
      update.category = category;
    }
    if (completed !== undefined) update.completed = Boolean(completed);

    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });

    // user_id filter ensures users can only patch their own tasks
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tasks?task_id=eq.${taskId}&user_id=eq.${uid}`, {
      method:  'PATCH',
      headers: { ...sbH, 'Prefer': 'return=representation' },
      body:    JSON.stringify(update),
    });

    if (!r.ok) return res.status(500).json({ error: 'Failed to update' });
    return res.status(200).json((await r.json())[0]);
  }

  // ─── DELETE ─────────────────────────────────────────────────────────────────

  if (req.method === 'DELETE') {
    const taskId = parseInt(id);
    if (!taskId || taskId < 1) return res.status(400).json({ error: 'Valid id required' });

    // user_id filter ensures users can only delete their own tasks
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tasks?task_id=eq.${taskId}&user_id=eq.${uid}`, {
      method:  'DELETE',
      headers: sbH,
    });

    if (!r.ok) return res.status(500).json({ error: 'Failed to delete' });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

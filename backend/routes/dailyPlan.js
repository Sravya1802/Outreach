// The evening list: settings, tonight's roles, approve / skip.
import { Router } from 'express';
import { parseId } from '../services/safePaths.js';
import { approveAllTop, buildPlan, decide, emailPlan, getSettings, overview, saveSettings } from '../services/dailyPlan.js';

const router = Router();
const fail = (res, err) => {
  if (!err.status || err.status >= 500) console.error('[daily-plan]', err.message);
  res.status(err.status || 500).json({ error: err.message });
};

router.get('/', async (req, res) => {
  try { res.json(await overview(req.user.id)); } catch (err) { fail(res, err); }
});

router.get('/settings', async (req, res) => {
  try { res.json(await getSettings(req.user.id)); } catch (err) { fail(res, err); }
});

router.put('/settings', async (req, res) => {
  try { res.json(await saveSettings(req.user.id, req.body || {})); } catch (err) { fail(res, err); }
});

// Build today's list now instead of waiting for the evening (once per 10 minutes).
const lastBuild = new Map();
router.post('/build', async (req, res) => {
  const now = Date.now();
  if (now - (lastBuild.get(req.user.id) || 0) < 10 * 60_000) return res.status(429).json({ error: 'You can rebuild the list once every 10 minutes.' });
  lastBuild.set(req.user.id, now);
  try {
    const plan = await buildPlan(req.user.id, { force: Boolean(req.body?.rebuild) });
    res.json({ plan });
  } catch (err) { fail(res, err); }
});

router.post('/email', async (req, res) => {
  try {
    const o = await overview(req.user.id);
    if (!o.plan) return res.status(400).json({ error: 'No list yet' });
    res.json(await emailPlan(req.user.id, o.plan.id));
  } catch (err) { fail(res, err); }
});

router.post('/items/:id/decision', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try { res.json(await decide(req.user.id, id, req.body?.decision)); } catch (err) { fail(res, err); }
});

router.post('/plans/:id/approve-all', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try { res.json({ approved: await approveAllTop(req.user.id, id) }); } catch (err) { fail(res, err); }
});

export default router;

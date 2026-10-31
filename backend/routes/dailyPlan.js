// The evening list: settings, tonight's roles, approve / skip.
import { Router } from 'express';
import { parseId } from '../services/safePaths.js';
import multer from 'multer';
import { addOwnJob, approveAllTop, buildPlan, decide, emailPlan, getSettings, overview, ownResumeForItem, pickItem, saveSettings, sendReviewed } from '../services/dailyPlan.js';
import { markAskSent, referralAction, referralStats } from '../services/referralFlow.js';
import { clearConnections, connectionsSummary, importConnections } from '../services/linkedinConnections.js';

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
  // Scoring takes minutes: start it and return; the page polls the overview.
  const userId = req.user.id;
  buildPlan(userId, { force: Boolean(req.body?.rebuild) }).catch(err => console.error('[daily-plan] build failed:', err.message));
  await new Promise(r => setTimeout(r, 400));
  try { res.status(202).json({ plan: (await overview(userId)).plan }); } catch (err) { fail(res, err); }
});

router.post('/email', async (req, res) => {
  try {
    const o = await overview(req.user.id);
    if (!o.plan) return res.status(400).json({ error: 'No list yet' });
    res.json(await emailPlan(req.user.id, o.plan.id));
  } catch (err) { fail(res, err); }
});

// A job the user brings: link, company, optional title / description, and their own resume (PDF).
const ownResume = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (file.mimetype === 'application/pdf' ? cb(null, true) : cb(Object.assign(new Error('Upload your resume as a PDF'), { status: 400 }))),
}).single('resume');

router.post('/own-job', (req, res) => {
  ownResume(req, res, async (upErr) => {
    if (upErr) return fail(res, Object.assign(upErr, { status: upErr.status || 400 }));
    const b = req.body || {};
    try {
      res.json(await addOwnJob(req.user.id, {
        url: b.url, company: b.company, title: b.title, jobDescription: b.jobDescription,
        resume: req.file ? { buffer: req.file.buffer, filename: req.file.originalname } : null,
      }));
    } catch (err) { fail(res, err); }
  });
});

// App drafts / I'll draft my own / Skip (or 'none' to undo).
router.post('/items/:id/pick', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try { res.json(await pickItem(req.user.id, id, req.body?.pick)); } catch (err) { fail(res, err); }
});

// "I'll draft my own", done: the user's PDF goes out for this role.
router.post('/items/:id/own-resume', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  ownResume(req, res, async (upErr) => {
    if (upErr) return fail(res, Object.assign(upErr, { status: upErr.status || 400 }));
    try {
      res.json(await ownResumeForItem(req.user.id, id, req.file ? { buffer: req.file.buffer, filename: req.file.originalname } : null));
    } catch (err) { fail(res, err); }
  });
});

router.post('/items/:id/decision', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try { res.json(await decide(req.user.id, id, req.body?.decision, req.body?.mode)); } catch (err) { fail(res, err); }
});

// Review mode: the user read the resume and says go ahead.
router.post('/items/:id/send', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try { res.json(await sendReviewed(req.user.id, id)); } catch (err) { fail(res, err); }
});

router.post('/plans/:id/approve-all', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try { res.json({ approved: await approveAllTop(req.user.id, id) }); } catch (err) { fail(res, err); }
});

// Referral outcome for a waiting role: link | submitted | declined | apply_now | applied_myself
router.post('/items/:id/referral', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try { res.json(await referralAction(req.user.id, id, req.body || {})); } catch (err) { fail(res, err); }
});

router.get('/referral-stats', async (req, res) => {
  try { res.json(await referralStats(req.user.id)); } catch (err) { fail(res, err); }
});

// "I sent the LinkedIn note"
router.post('/asks/:id/sent', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const row = await markAskSent(req.user.id, id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) { fail(res, err); }
});

// LinkedIn connections export (Connections.csv as text)
router.get('/connections', async (req, res) => {
  try { res.json(await connectionsSummary(req.user.id)); } catch (err) { fail(res, err); }
});
router.post('/connections', async (req, res) => {
  try {
    const csv = String(req.body?.csv || '');
    if (csv.length > 8_000_000) return res.status(413).json({ error: 'That file is too big.' });
    res.json(await importConnections(req.user.id, csv));
  } catch (err) { fail(res, err); }
});
router.delete('/connections', async (req, res) => {
  try { await clearConnections(req.user.id); res.json({ ok: true }); } catch (err) { fail(res, err); }
});

export default router;

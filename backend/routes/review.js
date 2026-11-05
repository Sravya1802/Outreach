// The Review queue and Role pages: what the Claude chat runs wrote, and the
// user's revision requests, edits and approvals.
import { Router } from 'express';
import { parseId } from '../services/safePaths.js';
import {
  approveRole, editDraft, lastRun, requestRevision, reviewQueue, reviewRole, setReferralMode, versionPdf,
} from '../services/tailorPipeline.js';

const router = Router();

const fail = (res, err) => {
  if (!err.status || err.status >= 500) console.error('[review]', err.message);
  res.status(err.status || 500).json({ error: err.message });
};

// Takes the id from the path, or answers 400.
const withId = (fn) => async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try { await fn(req, res, id); } catch (err) { fail(res, err); }
};

router.get('/', async (req, res) => {
  try {
    const [roles, run] = await Promise.all([reviewQueue(req.user.id), lastRun(req.user.id)]);
    res.json({ roles, lastRun: run ?? null });
  } catch (err) { fail(res, err); }
});

router.get('/versions/:id/pdf', withId(async (req, res, id) => {
  const pdf = await versionPdf(req.user.id, id);
  if (!pdf) return res.status(404).json({ error: 'No PDF for that version' });
  res.type('application/pdf').send(pdf);
}));

router.patch('/outreach/:id', withId(async (req, res, id) => {
  await editDraft(req.user.id, id, req.body || {});
  res.json({ ok: true });
}));

router.get('/:id', withId(async (req, res, id) => {
  const role = await reviewRole(req.user.id, id);
  if (!role) return res.status(404).json({ error: 'That role isn’t in the queue.' });
  res.json(role);
}));

router.post('/:id/revision', withId(async (req, res, id) => {
  await requestRevision(req.user.id, id, req.body?.body);
  res.json({ ok: true });
}));

router.put('/:id/mode', withId(async (req, res, id) => {
  await setReferralMode(req.user.id, id, req.body?.mode);
  res.json({ ok: true });
}));

router.post('/:id/approve', withId(async (req, res, id) => {
  await approveRole(req.user.id, id);
  res.json({ ok: true });
}));

export default router;

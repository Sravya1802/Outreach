// Gmail: connect your own account (app password), send outreach from it on a
// schedule, and see replies the watcher found.
import { Router } from 'express';
import { parseId } from '../services/safePaths.js';
import { connectGmail, disconnectGmail, gmailStatus, sendToSelf } from '../services/gmail.js';
import { approveDraft, cancelScheduled, editScheduled, listOutbox, scheduleEmail } from '../services/outbox.js';
import { checkInbox, listReplies } from '../services/replyWatcher.js';
import { referralEmailMoved } from '../services/referralFlow.js';
import { run } from '../db.js';

const router = Router();
const fail = (res, err) => {
  if (!err.status || err.status >= 500) console.error('[gmail]', err.message);
  res.status(err.status || 500).json({ error: err.message });
};

router.get('/status', async (req, res) => {
  try { res.json(await gmailStatus(req.user.id)); } catch (err) { fail(res, err); }
});

router.post('/connect', async (req, res) => {
  try {
    const { email, appPassword, displayName } = req.body || {};
    res.json(await connectGmail(req.user.id, { email, appPassword, displayName }));
  } catch (err) { fail(res, err); }
});

router.patch('/settings', async (req, res) => {
  try {
    const { displayName, dailyCap } = req.body || {};
    const cap = dailyCap == null ? null : Math.max(1, Math.min(40, Math.round(Number(dailyCap)) || 20));
    await run(
      'UPDATE gmail_connections SET display_name = COALESCE($2, display_name), daily_cap = COALESCE($3, daily_cap) WHERE user_id = $1',
      [req.user.id, displayName == null ? null : String(displayName).trim().slice(0, 80), cap],
    );
    res.json(await gmailStatus(req.user.id));
  } catch (err) { fail(res, err); }
});

router.delete('/connection', async (req, res) => {
  try { await disconnectGmail(req.user.id); res.json({ ok: true }); } catch (err) { fail(res, err); }
});

router.post('/test', async (req, res) => {
  try {
    const r = await sendToSelf(req.user.id, {
      subject: '[Scout’n’Jobs] Your Gmail is connected',
      text: 'This is a test from Scout’n’Jobs, sent from your own Gmail to yourself.\n\nOutreach emails, follow-ups, your evening list and reply alerts will come from this account.',
    });
    if (r.skipped) return res.status(400).json({ error: 'Connect your Gmail first.' });
    res.json(r);
  } catch (err) { fail(res, err); }
});

router.get('/outbox', async (req, res) => {
  try { res.json({ items: await listOutbox(req.user.id) }); } catch (err) { fail(res, err); }
});

router.post('/outbox', async (req, res) => {
  try {
    const { contactId, subject, body, when } = req.body || {};
    const id = parseId(contactId);
    if (!id) return res.status(400).json({ error: 'contactId is required' });
    res.status(201).json(await scheduleEmail(req.user.id, { contactId: id, subject, body, when: when === 'now' ? 'now' : 'best' }));
  } catch (err) { fail(res, err); }
});

router.patch('/outbox/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const row = await editScheduled(req.user.id, id, req.body || {});
    if (!row) return res.status(404).json({ error: 'Only emails that haven’t gone out can be edited' });
    res.json(row);
  } catch (err) { fail(res, err); }
});

// The user's OK on a draft: it goes at the recipient's best time (or now).
router.post('/outbox/:id/approve', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const row = await approveDraft(req.user.id, id, { when: req.body?.when === 'now' ? 'now' : 'best' });
    await referralEmailMoved(req.user.id, row).catch(err => console.warn('[gmail] referral wait update failed:', err.message));
    res.json(row);
  } catch (err) { fail(res, err); }
});

router.delete('/outbox/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const row = await cancelScheduled(req.user.id, id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await referralEmailMoved(req.user.id, row).catch(err => console.warn('[gmail] referral note update failed:', err.message));
    res.json(row);
  } catch (err) { fail(res, err); }
});

router.get('/replies', async (req, res) => {
  try { res.json({ replies: await listReplies(req.user.id) }); } catch (err) { fail(res, err); }
});

// Check the inbox now instead of waiting for the next 10-minute pass.
router.post('/check', async (req, res) => {
  try { res.json(await checkInbox(req.user.id)); } catch (err) { fail(res, err); }
});

export default router;

// The Review queue and Role pages: what the Claude chat runs wrote, and the
// user's revision requests, edits and approvals.
import { Router } from 'express';
import { parseId } from '../services/safePaths.js';
import { addReferrer, listReferrers, removeReferrer } from '../services/referrers.js';
import {
  addRoleContacts, applyWithoutReferral, approveRole, keepVersion, markRoleApplied, removeRole, restoreRemovedRole, companyQueue, editDraft, findRoleContacts, lastRun, requestRevision, reviewQueue, reviewRole, runConfig, runSummary, saveRunConfig, setReferralMode, versionPdf, queueOutreachDrafts,
} from '../services/tailorPipeline.js';
import { fillLink, readyRoles } from '../services/readyToSubmit.js';
import { approveWrittenOutreach } from '../services/outreachApproval.js';

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

// Ready to submit: approved roles the app couldn't send (a CAPTCHA, a site it can't fill), for the browser extension.
router.get('/ready', async (req, res) => {
  try { res.json({ roles: await readyRoles(req.user.id) }); } catch (err) { fail(res, err); }
});

router.post('/:id/fill-link', withId(async (req, res, id) => {
  res.json(await fillLink(req.user.id, id));
}));

// Approve all: every outreach email Claude has finished writing (one role with ?role=, else all). GET says what it would do.
const roleParam = (v) => (v == null || v === '' ? null : parseId(v));
router.get('/outreach/approve-all', async (req, res) => {
  try { res.json(await approveWrittenOutreach(req.user.id, { planItemId: roleParam(req.query.role), dryRun: true })); } catch (err) { fail(res, err); }
});
router.post('/outreach/approve-all', async (req, res) => {
  try { res.json(await approveWrittenOutreach(req.user.id, { planItemId: roleParam(req.body?.role) })); } catch (err) { fail(res, err); }
});

router.get('/', async (req, res) => {
  try {
    const [roles, run] = await Promise.all([reviewQueue(req.user.id), lastRun(req.user.id)]);
    res.json({ roles, lastRun: run ?? null });
  } catch (err) { fail(res, err); }
});

router.get('/runs', async (req, res) => {
  try { res.json(await runSummary(req.user.id)); } catch (err) { fail(res, err); }
});

router.get('/company', async (req, res) => {
  try { res.json({ roles: await companyQueue(req.user.id, req.query.name) }); } catch (err) { fail(res, err); }
});

router.get('/config', async (req, res) => {
  try { res.json({ config: await runConfig(req.user.id) }); } catch (err) { fail(res, err); }
});

router.put('/config', async (req, res) => {
  try { res.json({ config: await saveRunConfig(req.user.id, req.body || {}) }); } catch (err) { fail(res, err); }
});

router.get('/referrers', async (req, res) => {
  try { res.json({ referrers: await listReferrers(req.user.id) }); } catch (err) { fail(res, err); }
});

router.post('/referrers', async (req, res) => {
  try { res.json(await addReferrer(req.user.id, req.body || {})); } catch (err) { fail(res, err); }
});

router.delete('/referrers/:id', withId(async (req, res, id) => {
  await removeReferrer(req.user.id, id);
  res.json({ ok: true });
}));

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
  res.json(await approveRole(req.user.id, id));
}));

router.post('/:id/apply-without-referral', withId(async (req, res, id) => {
  const r = await applyWithoutReferral(req.user.id, id);
  res.json({ ok: true, ...r });
}));

// Take back a change request and keep the current version (Revising → Ready).
router.post('/:id/keep-version', withId(async (req, res, id) => {
  res.json(await keepVersion(req.user.id, id));
}));

// Remove a role the user doesn't want (closed, never deleted), and undo it.
router.post('/:id/remove', withId(async (req, res, id) => {
  res.json(await removeRole(req.user.id, id));
}));
router.post('/:id/restore', withId(async (req, res, id) => {
  res.json(await restoreRemovedRole(req.user.id, id));
}));

router.post('/:id/applied', withId(async (req, res, id) => {
  res.json(await markRoleApplied(req.user.id, id));
}));

// People the user pasted (from Apollo or anywhere): saved as this role's contacts.
router.post('/:id/contacts/add', withId(async (req, res, id) => {
  res.json(await addRoleContacts(req.user.id, id, req.body?.people));
}));

// People already found here: empty rows for the next Claude run to write (the app writes no text).
router.post('/:id/queue-outreach', withId(async (req, res, id) => {
  res.json({ drafts: await queueOutreachDrafts(req.user.id, id) });
}));

router.post('/:id/contacts', withId(async (req, res, id) => {
  res.json(await findRoleContacts(req.user.id, id, { source: req.body?.source === 'apollo' ? 'apollo' : 'all' }));
}));

export default router;

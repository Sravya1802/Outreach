// The Review queue and Role pages: what the Claude chat runs wrote, and the
// user's revision requests, edits and approvals.
import { Router } from 'express';
import { parseId } from '../services/safePaths.js';
import { addReferrer, listReferrers, removeReferrer } from '../services/referrers.js';
import {
  addRoleContacts, applyWithoutReferral, approveRole, markRoleApplied, removeRole, restoreRemovedRole, companyQueue, editDraft, findRoleContacts, lastRun, requestRevision, reviewQueue, reviewRole, runConfig, runSummary, saveRunConfig, setReferralMode, templateOutreach, versionPdf,
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
  await applyWithoutReferral(req.user.id, id);
  res.json({ ok: true });
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

router.post('/:id/contacts', withId(async (req, res, id) => {
  res.json(await findRoleContacts(req.user.id, id, { source: req.body?.source === 'apollo' ? 'apollo' : 'all' }));
}));

// The role's outreach from the plain template, now (no run needed).
router.post('/:id/template-outreach', withId(async (req, res, id) => {
  res.json(await templateOutreach(req.user.id, id));
}));

export default router;

// The Scout'n'Jobs filler extension: one role's form data, answers, report
// and "submitted", authorised by the signed link from /review/:id/fill-link
// (no app sign-in in the extension). Mounted before requireAuth.
import { Router } from 'express';
import { dailyRoles, fillAnswers, fillData, fillReport, fillSubmitted, matchRole } from '../services/readyToSubmit.js';

const router = Router();

const handle = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (err) {
    if (!err.status || err.status >= 500) console.error('[fill]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
};

// The paired extension (its key in X-SnJ-Key): the morning's roles, and the role for a page opened by hand.
router.get('/daily', handle(req => dailyRoles(req.get('x-snj-key'))));
router.post('/match', handle(req => matchRole(req.get('x-snj-key'), req.body?.urls)));

router.get('/:token', handle(req => fillData(req.params.token)));
router.post('/:token/answers', handle(req => fillAnswers(req.params.token, req.body?.questions)));
router.post('/:token/report', handle(req => fillReport(req.params.token, req.body || {})));
router.post('/:token/submitted', handle(req => fillSubmitted(req.params.token)));

export default router;

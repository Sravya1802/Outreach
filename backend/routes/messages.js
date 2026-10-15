// People → Messages: companies with people, and a personalized note + email per person.
import { Router } from 'express';
import { companyList, companyPeople, writeAll, writeFor } from '../services/messages.js';

const router = Router();
const fail = (res, err) => {
  if (!err.status || err.status >= 500) console.error('[messages]', err.message);
  res.status(err.status || 500).json({ error: err.message });
};
const keyOf = (req) => String(req.params.key || '').slice(0, 120);

router.get('/companies', async (req, res) => {
  try { res.json(await companyList(req.user.id, { q: req.query.q, filter: req.query.filter, page: req.query.page })); } catch (err) { fail(res, err); }
});
router.get('/companies/:key', async (req, res) => {
  try { res.json(await companyPeople(req.user.id, keyOf(req))); } catch (err) { fail(res, err); }
});
router.post('/companies/:key/write', async (req, res) => {
  try {
    const ref = String(req.body?.ref || '');
    if (!/^[cl]:\d+$/.test(ref)) return res.status(400).json({ error: 'Bad person' });
    res.json(await writeFor(req.user.id, keyOf(req), ref));
  } catch (err) { fail(res, err); }
});
router.post('/companies/:key/write-all', async (req, res) => {
  try { res.json(await writeAll(req.user.id, keyOf(req))); } catch (err) { fail(res, err); }
});

export default router;

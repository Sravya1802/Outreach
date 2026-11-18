// People → Messages: companies with people, and any note + email saved for each person (the app writes none).
import { Router } from 'express';
import { companyList, companyPeople } from '../services/messages.js';
import { companyPlan, planCompanies } from '../services/outreachPlan.js';

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

// People → Contacts: companies, each with its planned emails and LinkedIn notes.
router.get('/plan', async (req, res) => {
  try { res.json({ companies: await planCompanies(req.user.id) }); } catch (err) { fail(res, err); }
});
router.get('/plan/:key', async (req, res) => {
  try { res.json(await companyPlan(req.user.id, keyOf(req))); } catch (err) { fail(res, err); }
});

export default router;

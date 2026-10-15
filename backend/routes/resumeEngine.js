// Resume engine: tailored resume + cover letter per evaluation, and the
// master resume as read into sections. Long runs start here and are polled.
import { Router } from 'express';
import { one } from '../db.js';
import { parseId } from '../services/safePaths.js';
import { approve, coverLetterRequested, latest, parsedMaster, start } from '../services/resumeEngine.js';

const router = Router();

const fail = (res, err) => {
  if (!err.status || err.status >= 500) console.error('[resumeEngine]', err.message);
  res.status(err.status || 500).json({ error: err.message });
};

// What the engine read from the current master resume (null until read).
router.get('/master', async (req, res) => {
  try {
    const m = await one(
      "SELECT id, filename, parsed, parsed_at, created_at FROM resume_files WHERE user_id = $1 AND kind = 'master' AND is_current",
      [req.user.id],
    );
    res.json({ file: m ? { id: m.id, filename: m.filename, created_at: m.created_at } : null, parsed: m?.parsed || null, parsedAt: m?.parsed_at || null });
  } catch (err) { fail(res, err); }
});

// The master resume read into sections, reading it now if it never was
// (one AI call, cached on the file row). Profile → Details fills from this.
router.post('/master/read', async (req, res) => {
  try {
    const { parsed } = await parsedMaster(req.user.id);
    res.json({ parsed });
  } catch (err) { fail(res, err); }
});

router.get('/evaluations/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const ev = await one('SELECT job_description FROM evaluations WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!ev) return res.status(404).json({ error: 'Evaluation not found' });
    res.json({ ...(await latest(req.user.id, id)), coverLetterRequested: coverLetterRequested(ev.job_description) });
  } catch (err) { fail(res, err); }
});

router.post('/evaluations/:id/tailor', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    res.status(202).json({ tailoring: await start(req.user.id, id, 'resume') });
  } catch (err) { fail(res, err); }
});

router.post('/evaluations/:id/cover-letter', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    res.status(202).json({ tailoring: await start(req.user.id, id, 'cover_letter') });
  } catch (err) { fail(res, err); }
});

// "Send anyway" for a resume under the ATS target.
router.post('/tailorings/:id/approve', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const row = await approve(req.user.id, id);
    if (!row) return res.status(404).json({ error: 'Nothing to approve' });
    res.json({ ok: true, ...row });
  } catch (err) { fail(res, err); }
});

export default router;

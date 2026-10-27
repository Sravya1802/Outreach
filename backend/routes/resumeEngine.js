// Resume engine: tailored resume + cover letter per evaluation, and the
// master resume as read into sections. Long runs start here and are polled.
import { Router } from 'express';
import { one, run } from '../db.js';
import { parseId } from '../services/safePaths.js';
import {
  approve, coverLetterRequested, latest, parsedMaster, start,
  templateInfo, saveTemplate, resetTemplate, listProjects, markProjectBuilt, dismissProject,
  approveSkills, confirmedSkills, removeConfirmedSkill, resumesByJob, useTailored,
} from '../services/resumeEngine.js';
import { suggestProjects, isSuggesting } from '../services/projectIdeas.js';

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

// Resumes → By job.
router.get('/jobs', async (req, res) => {
  try { res.json({ jobs: await resumesByJob(req.user.id) }); } catch (err) { fail(res, err); }
});

// Send the app's tailored resume for this role instead of the one you uploaded.
router.post('/evaluations/:id/use-tailored', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try { res.json(await useTailored(req.user.id, id)); } catch (err) { fail(res, err); }
});

// The user knows these JD skills: add them to this resume and remember them.
router.post('/tailorings/:id/skills', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const skills = Array.isArray(req.body?.skills) ? req.body.skills.filter(x => typeof x === 'string') : [];
  try {
    const t = await approveSkills(req.user.id, id, skills);
    if (!t) return res.status(404).json({ error: 'That resume isn’t finished' });
    res.json({ tailoring: t });
  } catch (err) { fail(res, err); }
});

// Skills the user confirmed they know (used by every tailoring).
router.get('/skills', async (req, res) => {
  try { res.json({ skills: await confirmedSkills(req.user.id) }); } catch (err) { fail(res, err); }
});
router.delete('/skills/:term', async (req, res) => {
  try { res.json({ skills: await removeConfirmedSkill(req.user.id, req.params.term) }); } catch (err) { fail(res, err); }
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

// The LaTeX template resumes are built in: the user's own preamble or the default.
router.get('/template', async (req, res) => {
  try { res.json(await templateInfo(req.user.id)); } catch (err) { fail(res, err); }
});

router.put('/template', async (req, res) => {
  const tex = typeof req.body?.tex === 'string' ? req.body.tex : '';
  if (!tex.trim()) return res.status(400).json({ error: 'Paste your .tex file' });
  try { res.json(await saveTemplate(req.user.id, tex)); } catch (err) { fail(res, err); }
});

router.delete('/template', async (req, res) => {
  try { res.json(await resetTemplate(req.user.id)); } catch (err) { fail(res, err); }
});

// Projects the engine suggested for weak fits: build, push, mark built.
router.get('/projects', async (req, res) => {
  try {
    const last = await one("SELECT value FROM meta WHERE user_id = $1 AND key = 'project_ideas_at'", [req.user.id]);
    const note = await one("SELECT value FROM meta WHERE user_id = $1 AND key = 'project_ideas_note'", [req.user.id]);
    res.json({ projects: await listProjects(req.user.id), suggesting: isSuggesting(req.user.id), lastRunAt: last?.value || null, note: note?.value || null });
  } catch (err) { fail(res, err); }
});

// Suggest projects from the roles on recent evening lists, now (runs in the background; poll GET /projects).
router.post('/projects/suggest', async (req, res) => {
  const userId = req.user.id;
  if (isSuggesting(userId)) return res.status(202).json({ suggesting: true });
  suggestProjects(userId, { force: true })
    .then(async (r) => {
      const note = r.skipped ? `skipped: ${r.skipped}` : `${r.created} new from ${r.roles} roles, $${r.cost}`;
      console.log(`[project-ideas] ${userId}: ${note}`);
      await run("INSERT INTO meta (user_id, key, value) VALUES ($1, 'project_ideas_note', $2) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value", [userId, r.skipped || '']).catch(() => {});
    })
    .catch(err => console.error('[project-ideas]', err.message));
  res.status(202).json({ suggesting: true });
});

router.post('/projects/:id/built', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const { repo_url: repoUrl, start: from, end: to, values } = req.body || {};
  try { res.json(await markProjectBuilt(req.user.id, id, { repoUrl, start: from, end: to, values: Array.isArray(values) ? values : [] })); } catch (err) { fail(res, err); }
});

router.post('/projects/:id/dismiss', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const p = await dismissProject(req.user.id, id);
    if (!p) return res.status(404).json({ error: 'Nothing to dismiss' });
    res.json({ project: p });
  } catch (err) { fail(res, err); }
});

export default router;

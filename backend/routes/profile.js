// Profile: the answer bank used to fill application forms. (Contact details,
// work authorization and education live in user_profile, served by
// /api/career/profile.)
import { Router } from 'express';
import { parseId } from '../services/safePaths.js';
import { deleteAnswer, listAnswers, saveAnswer, updateAnswer } from '../services/answerBank.js';

const router = Router();

const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

router.get('/answers', async (req, res) => {
  try {
    res.json({ answers: await listAnswers(req.user.id) });
  } catch (err) { fail(res, err); }
});

router.post('/answers', async (req, res) => {
  try {
    const { question, answer } = req.body || {};
    res.status(201).json(await saveAnswer(req.user.id, question, answer));
  } catch (err) { fail(res, err); }
});

router.put('/answers/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const row = await updateAnswer(req.user.id, id, req.body || {});
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) { fail(res, err); }
});

router.delete('/answers/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    if (!(await deleteAnswer(req.user.id, id))) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

export default router;

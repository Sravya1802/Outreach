// GitHub connection: start sign-in, the OAuth callback, repo list + sync.
import { Router } from 'express';
import { verifyState } from '../services/secretBox.js';
import {
  authorizeUrl, completeSignIn, disconnect, githubConfigured, githubStatus, listRepos, setRepoIncluded, syncRepos,
} from '../services/github.js';

const router = Router();
const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

function frontendUrl(query) {
  const base = (process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'https://outreach-jt.vercel.app').replace(/\/+$/, '');
  return `${base}/profile/github?${new URLSearchParams(query)}`;
}

/**
 * GET /api/github/callback — public (GitHub redirects the browser here, with
 * no app session). The signed, expiring `state` says which user started it.
 */
export async function githubCallback(req, res) {
  const { code, state, error } = req.query;
  const userId = verifyState(typeof state === 'string' ? state : '');
  if (!userId) return res.redirect(frontendUrl({ github: 'error', reason: 'The sign-in link expired. Try again.' }));
  if (error || typeof code !== 'string' || !code) {
    return res.redirect(frontendUrl({ github: 'error', reason: error === 'access_denied' ? 'You cancelled the GitHub sign-in.' : 'GitHub didn’t send a sign-in code.' }));
  }
  try {
    const login = await completeSignIn(userId, code);
    // Import in the background; the page shows "importing" until it's done.
    syncRepos(userId).catch(err => console.warn('[github] first sync failed:', err.message));
    return res.redirect(frontendUrl({ github: 'connected', login }));
  } catch (err) {
    console.warn('[github] sign-in failed:', err.message);
    return res.redirect(frontendUrl({ github: 'error', reason: 'GitHub sign-in failed. Try again.' }));
  }
}

router.get('/status', async (req, res) => {
  try { res.json(await githubStatus(req.user.id)); } catch (err) { fail(res, err); }
});

router.post('/connect', (req, res) => {
  if (!githubConfigured()) return res.status(503).json({ error: 'GitHub sign-in isn’t set up on the server yet.' });
  try { res.json({ url: authorizeUrl(req.user.id) }); } catch (err) { fail(res, err); }
});

router.get('/repos', async (req, res) => {
  try { res.json({ repos: await listRepos(req.user.id) }); } catch (err) { fail(res, err); }
});

router.post('/sync', async (req, res) => {
  try { res.json(await syncRepos(req.user.id)); } catch (err) { fail(res, err); }
});

router.patch('/repos/:repoId', async (req, res) => {
  const repoId = /^\d{1,15}$/.test(req.params.repoId) ? Number(req.params.repoId) : null;
  if (!repoId) return res.status(400).json({ error: 'Bad repo id' });
  try {
    if (!(await setRepoIncluded(req.user.id, repoId, req.body?.include))) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

router.delete('/connection', async (req, res) => {
  try { await disconnect(req.user.id); res.json({ ok: true }); } catch (err) { fail(res, err); }
});

export default router;

// ── Job-alert subscriptions (#9) ─────────────────────────────────────────────
// LinkedIn-style opt-in: a user subscribes to email alerts for newly scraped
// roles, with role-type + keyword filters and a daily/weekly cadence. Stored
// per-user in meta['job_alert_subscription']. The daily cron (server.js) fans
// out to every subscriber via runSubscriptionDigests().
import { Router } from 'express';
import { one, run } from '../db.js';
import { buildDigestData, canEmailUser, sendDigestToEmail } from '../services/dailyDigest.js';
import { marketFor, regionForMarket } from '../services/markets.js';

const router = Router();
const KEY = 'job_alert_subscription';

const DEFAULTS = {
  subscribed: false,
  email: '',
  frequency: 'daily',  // 'daily' | 'weekly'
  roleType: 'all',     // 'all' | 'intern' | 'new_grad'
  keywords: '',
};

// Alerts only ever go to the account's own (Supabase-verified) sign-in email.
// Accepting an arbitrary address let anyone use the server's Gmail to mail
// strangers every day.
function normalize(incoming = {}, accountEmail = '') {
  return {
    subscribed: !!incoming.subscribed,
    email: String(accountEmail || '').trim().slice(0, 200),
    frequency: incoming.frequency === 'weekly' ? 'weekly' : 'daily',
    roleType: ['all', 'intern', 'new_grad'].includes(incoming.roleType) ? incoming.roleType : 'all',
    keywords: String(incoming.keywords || '').slice(0, 300),
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// GET current subscription (defaults pre-filled with the user's account email).
router.get('/subscription', async (req, res) => {
  try {
    const row = await one(`SELECT value FROM meta WHERE user_id = $1 AND key = $2`, [req.user.id, KEY]);
    const cur = row?.value ? JSON.parse(row.value) : {};
    const sub = { ...DEFAULTS, ...cur, email: req.user.email || '' };
    res.json({ subscription: sub, emailConfigured: await canEmailUser(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT save subscription.
router.put('/subscription', async (req, res) => {
  try {
    const sub = normalize(req.body, req.user.email);
    if (sub.subscribed && !EMAIL_RE.test(sub.email)) {
      return res.status(400).json({ error: 'Enter a valid email address to subscribe.' });
    }
    await run(
      `INSERT INTO meta (user_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [req.user.id, KEY, JSON.stringify(sub)]
    );
    res.json({ subscription: sub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST send a test alert to the account email right now (1 per user per minute).
const lastTestAt = new Map();
router.post('/test', async (req, res) => {
  try {
    const now = Date.now();
    if (now - (lastTestAt.get(req.user.id) || 0) < 60_000) {
      return res.status(429).json({ error: 'You can send one test alert per minute.' });
    }
    if (!(await canEmailUser(req.user.id))) {
      return res.status(400).json({ error: 'Connect your Gmail in Settings so alerts can be sent from it.' });
    }
    const row = await one(`SELECT value FROM meta WHERE user_id = $1 AND key = $2`, [req.user.id, KEY]);
    const cur = row?.value ? JSON.parse(row.value) : {};
    const sub = { ...DEFAULTS, ...cur };
    const email = String(req.user.email || '').trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Your account has no email address to send to.' });
    lastTestAt.set(req.user.id, now);
    const windowDays = sub.frequency === 'weekly' ? 7 : 1;
    const region = regionForMarket(await marketFor(req.user.id));
    const data = await buildDigestData({ roleType: sub.roleType, keywords: sub.keywords, windowDays, region });
    const result = await sendDigestToEmail(email, data, { windowDays, userId: req.user.id });
    res.json({ ok: !!result.ok, to: email, total: data.total, ...result });
  } catch (err) {
    console.error('[alerts/test]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

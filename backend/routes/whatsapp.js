// WhatsApp: link your phone, choose what comes there, and the webhook Meta calls.
import { Router } from 'express';
import {
  WHATSAPP_TEMPLATES, handleWebhook, savePrefs, sendTest, signatureOk, startJoin, unlink, verifyHandshake, whatsappStatus,
} from '../services/whatsapp.js';

const router = Router();
const fail = (res, err) => {
  if (!err.status || err.status >= 500) console.error('[whatsapp]', err.message);
  res.status(err.status || 500).json({ error: err.message });
};

router.get('/status', async (req, res) => {
  try { res.json(await whatsappStatus(req.user.id)); } catch (err) { fail(res, err); }
});
router.post('/join', async (req, res) => {
  try { res.json(await startJoin(req.user.id)); } catch (err) { fail(res, err); }
});
router.patch('/prefs', async (req, res) => {
  try { res.json(await savePrefs(req.user.id, req.body || {})); } catch (err) { fail(res, err); }
});
router.delete('/link', async (req, res) => {
  try { await unlink(req.user.id); res.json({ ok: true }); } catch (err) { fail(res, err); }
});
router.post('/test', async (req, res) => {
  try { res.json(await sendTest(req.user.id)); } catch (err) { fail(res, err); }
});
// The message templates the owner registers in WhatsApp Manager.
router.get('/templates', (req, res) => {
  // A WHATSAPP_TEMPLATE_<KIND> env var renames one (Meta holds deleted names for a while).
  const templates = Object.fromEntries(Object.entries(WHATSAPP_TEMPLATES).map(([k, t]) => [k, { ...t, name: process.env[`WHATSAPP_TEMPLATE_${k.toUpperCase()}`] || t.name }]));
  res.json({ templates });
});

export default router;

// Public (no session): Meta's webhook handshake and deliveries.
export function webhookVerify(req, res) {
  const challenge = verifyHandshake(req.query || {});
  if (challenge == null) return res.sendStatus(403);
  res.type('text/plain').send(challenge);
}

export async function webhookReceive(req, res) {
  if (!signatureOk(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  res.sendStatus(200); // answer fast; Meta retries slow webhooks
  handleWebhook(req.body).catch(err => console.error('[whatsapp] webhook failed:', err.message));
}

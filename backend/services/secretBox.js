// Small crypto helpers keyed by TOKEN_ENC_KEY (64 hex chars = 32 bytes):
// - seal/open: AES-256-GCM for third-party tokens stored in Postgres.
// - signState/verifyState: tamper-proof, expiring OAuth `state` values, so a
//   public callback can trust which user started the sign-in.
import crypto from 'node:crypto';

function key(env = process.env) {
  const hex = env.TOKEN_ENC_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('TOKEN_ENC_KEY is not set (64 hex characters)');
  return Buffer.from(hex, 'hex');
}

const b64u = buf => Buffer.from(buf).toString('base64url');

/** Encrypt a string. Output: "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function seal(plain, env) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(env), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', b64u(iv), b64u(c.getAuthTag()), b64u(ct)].join('.');
}

export function open(sealed, env) {
  const [v, iv, tag, ct] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Not a sealed value');
  const d = crypto.createDecipheriv('aes-256-gcm', key(env), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

function hmac(data, env) {
  return crypto.createHmac('sha256', key(env)).update(`oauth-state:${data}`).digest('base64url');
}

/** State binding a user id to a short-lived sign-in attempt. */
export function signState(userId, { ttlMs = 10 * 60_000, now = Date.now(), env } = {}) {
  const body = b64u(JSON.stringify({ u: String(userId), n: crypto.randomBytes(9).toString('base64url'), e: now + ttlMs }));
  return `${body}.${hmac(body, env)}`;
}

/** The user id inside a valid, unexpired state, else null. */
export function verifyState(state, { now = Date.now(), env } = {}) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const expected = hmac(body, env);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof u !== 'string' || !u || typeof e !== 'number' || e < now) return null;
    return u;
  } catch {
    return null;
  }
}

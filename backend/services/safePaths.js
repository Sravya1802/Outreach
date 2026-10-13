// ── Filesystem / id guards ───────────────────────────────────────────────────
// Paths stored in the database must never be trusted blindly: a row can hold
// whatever a client managed to write into it. Every unlink/read of a stored
// path goes through isWithin() against the directory the server itself
// writes uploads to.
import path from 'node:path';

/** True when `target` resolves to `base` itself or something inside it. */
export function isWithin(base, target) {
  if (!base || !target || typeof target !== 'string') return false;
  if (target.includes('\0') || /^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return false;
  const root = path.resolve(base);
  const resolved = path.resolve(root, target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** Positive integer id from a route param / body value, else null. */
export function parseId(value) {
  const s = String(value ?? '').trim();
  if (!/^[1-9]\d{0,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

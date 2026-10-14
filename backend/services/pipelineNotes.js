// ── Pipeline notes / next step ───────────────────────────────────────────────
// Validates PATCH /career/evaluations/:id/notes. Only the keys present are
// changed; an empty string clears a field.

export const NOTES_MAX = 5000;
export const NEXT_STEP_MAX = 200;

/** body → { notes?, next_step?, next_step_at? } (null clears); throws Error with a user-facing message. */
export function parseNotesPatch(body) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};

  if ('notes' in b) {
    if (b.notes != null && typeof b.notes !== 'string') throw new Error('notes must be text');
    const v = (b.notes ?? '').trim();
    if (v.length > NOTES_MAX) throw new Error(`notes can be at most ${NOTES_MAX} characters`);
    out.notes = v || null;
  }
  if ('next_step' in b) {
    if (b.next_step != null && typeof b.next_step !== 'string') throw new Error('next_step must be text');
    const v = (b.next_step ?? '').trim();
    if (v.length > NEXT_STEP_MAX) throw new Error(`next_step can be at most ${NEXT_STEP_MAX} characters`);
    out.next_step = v || null;
  }
  if ('next_step_at' in b) {
    const v = b.next_step_at == null ? '' : String(b.next_step_at).trim();
    if (v && !isIsoDate(v)) throw new Error('next_step_at must be a date like 2026-10-20');
    out.next_step_at = v || null;
  }

  if (Object.keys(out).length === 0) throw new Error('Nothing to update: send notes, next_step or next_step_at');
  return out;
}

function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

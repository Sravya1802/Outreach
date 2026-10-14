// Answer bank: the user's saved answers to application-form questions.
// Auto-apply looks a form question up here; a miss is recorded as a pending
// question so the user answers it once and later forms reuse the answer.
import { all, one, run } from '../db.js';

const MAX_QUESTION = 1000;
const MAX_ANSWER = 8000;

const STOP = new Set(['a', 'an', 'the', 'please', 'your', 'you', 'do', 'are', 'is', 'to', 'of', 'in', 'for', 'and', 'or', 'with', 'at', 'on', 'this', 'that', 'us', 'we', 'our', 'any', 'have', 'has']);

/**
 * Canonical form of a question so the same question from different forms
 * maps to one answer: lowercased, punctuation and asterisks dropped, length
 * hints like "(150 words)" or "(optional)" removed, whitespace collapsed.
 */
export function normalizeQuestion(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/\((?:[^)]*\b(?:words?|characters?|chars?|optional|required|max|min)\b[^)]*)\)/g, ' ')
    .replace(/[*?:.!,;"'`’“”()[\]{}]/g, ' ')
    .replace(/[^a-z0-9/&+#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function tokens(key) {
  return new Set(key.split(' ').filter(w => w.length > 1 && !STOP.has(w)));
}

/** Jaccard overlap of content words: 1 = same words, 0 = nothing shared. */
export function similarity(a, b) {
  const ta = tokens(normalizeQuestion(a));
  const tb = tokens(normalizeQuestion(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Best saved answer for a question among `rows`: an exact normalized match,
 * else the closest answered question at or above `threshold`. Pure, so the
 * matching rules are testable without a database.
 */
export function pickAnswer(question, rows, threshold = 0.75) {
  const key = normalizeQuestion(question);
  if (!key) return null;
  const answered = rows.filter(r => r.status === 'answered' && r.answer && String(r.answer).trim());
  const exact = answered.find(r => r.question_key === key);
  if (exact) return exact;
  let best = null;
  let bestScore = 0;
  for (const r of answered) {
    const s = similarity(question, r.question);
    if (s > bestScore) { best = r; bestScore = s; }
  }
  return bestScore >= threshold ? best : null;
}

export async function listAnswers(userId) {
  return all(
    `SELECT id, question, answer, status, asked_by, evaluation_id, use_count, last_used_at, created_at, updated_at
       FROM application_answers WHERE user_id = $1
      ORDER BY (status = 'pending') DESC, updated_at DESC`,
    [userId],
  );
}

function clean(question, answer) {
  const q = String(question || '').trim().slice(0, MAX_QUESTION);
  const a = answer == null ? null : String(answer).trim().slice(0, MAX_ANSWER);
  return { q, a, key: normalizeQuestion(q) };
}

/** Save (or overwrite) the answer to a question. Returns the row. */
export async function saveAnswer(userId, question, answer) {
  const { q, a, key } = clean(question, answer);
  if (!key) throw Object.assign(new Error('Question is empty'), { status: 400 });
  if (!a) throw Object.assign(new Error('Answer is empty'), { status: 400 });
  return one(
    `INSERT INTO application_answers (user_id, question, question_key, answer, status)
          VALUES ($1, $2, $3, $4, 'answered')
     ON CONFLICT (user_id, question_key)
     DO UPDATE SET answer = EXCLUDED.answer, question = EXCLUDED.question, status = 'answered', updated_at = NOW()
     RETURNING id, question, answer, status, asked_by, evaluation_id, use_count, last_used_at, created_at, updated_at`,
    [userId, q, key, a],
  );
}

export async function updateAnswer(userId, id, { question, answer }) {
  const existing = await one('SELECT * FROM application_answers WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!existing) return null;
  const { q, a, key } = clean(question ?? existing.question, answer ?? existing.answer);
  if (!key) throw Object.assign(new Error('Question is empty'), { status: 400 });
  // Renaming onto a question that already exists would violate the unique key.
  const clash = await one('SELECT id FROM application_answers WHERE user_id = $1 AND question_key = $2 AND id <> $3', [userId, key, id]);
  if (clash) throw Object.assign(new Error('You already have an answer for that question'), { status: 409 });
  return one(
    `UPDATE application_answers
        SET question = $3, question_key = $4, answer = $5,
            status = CASE WHEN $5::text IS NOT NULL AND btrim($5::text) <> '' THEN 'answered' ELSE status END,
            updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING id, question, answer, status, asked_by, evaluation_id, use_count, last_used_at, created_at, updated_at`,
    [id, userId, q, key, a],
  );
}

export async function deleteAnswer(userId, id) {
  const r = await run('DELETE FROM application_answers WHERE id = $1 AND user_id = $2', [id, userId]);
  return (r?.rowCount ?? 0) > 0;
}

/**
 * Look up a form question. Returns the saved answer text, or null after
 * recording the question as pending (once) so the user sees it in Profile.
 */
export async function answerFor(userId, question, { askedBy = null, evaluationId = null } = {}) {
  const rows = await all('SELECT id, question, question_key, answer, status FROM application_answers WHERE user_id = $1', [userId]);
  const hit = pickAnswer(question, rows);
  if (hit) {
    await run('UPDATE application_answers SET use_count = use_count + 1, last_used_at = NOW() WHERE id = $1', [hit.id]);
    return hit.answer;
  }
  const { q, key } = clean(question, null);
  if (key) {
    await run(
      `INSERT INTO application_answers (user_id, question, question_key, status, asked_by, evaluation_id)
            VALUES ($1, $2, $3, 'pending', $4, $5)
       ON CONFLICT (user_id, question_key) DO NOTHING`,
      [userId, q, key, askedBy ? String(askedBy).slice(0, 200) : null, evaluationId],
    );
  }
  return null;
}

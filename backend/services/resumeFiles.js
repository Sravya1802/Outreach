/**
 * resumeFiles.js — every resume PDF in Supabase Storage plus the index row
 * (resume_files, migration 022) that says what it is and which application
 * it went with. The server keeps no resume on its own disk.
 *
 * Paths (first segment is always the user id):
 *   resumes/<user>/master/<stamp>-<name>.pdf          master, every version kept
 *   tailored-pdfs/<user>/<eval>/<name>.pdf            tailored or uploaded for one role
 *   resume-library/<user>/<archetype>/<name>.pdf      older archetype library
 */

import crypto from 'crypto';
import { all, one, query, run, tx } from '../db.js';
import { BUCKETS, putObject, getObject, objectToTemp, deleteObject, signedObjectUrl } from './resumeStorage.js';
import { marketFor } from './markets.js';

const COLUMNS = 'id, kind, filename, size_bytes, market, evaluation_id, is_current, created_at';

export function safeName(name, fallback = 'resume.pdf') {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 100);
  const clean = base.replace(/^[._]+/, '');
  if (!clean) return fallback;
  return /\.pdf$/i.test(clean) ? clean : `${clean}.pdf`;
}

/** "20261014-180200" — sorts by time and keeps master versions apart. */
export function stamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export const masterPath   = (userId, filename, now) => `${userId}/master/${stamp(now)}-${safeName(filename)}`;
export const forEvalPath  = (userId, evalId, kind, filename, now) =>
  `${userId}/${Number(evalId)}/${kind}-${stamp(now)}-${safeName(filename)}`;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function insertRow(db, { userId, kind, bucket, objectPath, filename, buffer = null, sizeBytes = null, evaluationId = null, isCurrent = false, market }) {
  const r = await db.query(
    `INSERT INTO resume_files (user_id, kind, bucket, object_path, filename, size_bytes, sha256, market, evaluation_id, is_current)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (bucket, object_path) DO UPDATE
       SET filename = EXCLUDED.filename, size_bytes = EXCLUDED.size_bytes,
           sha256 = COALESCE(EXCLUDED.sha256, resume_files.sha256)
     RETURNING ${COLUMNS}`,
    [userId, kind, bucket, objectPath, filename, buffer ? buffer.length : sizeBytes, buffer ? sha256(buffer) : null,
      market, evaluationId, isCurrent],
  );
  return r.rows[0];
}

/** Upload a new master resume; older versions stay, marked not current. */
export async function saveMaster(userId, buffer, originalName) {
  const filename = safeName(originalName);
  const objectPath = masterPath(userId, filename);
  await putObject(BUCKETS.resume, objectPath, buffer);
  const market = await marketFor(userId);
  return tx(async (db) => {
    await db.query("UPDATE resume_files SET is_current = false WHERE user_id = $1 AND kind = 'master' AND is_current", [userId]);
    return insertRow(db, { userId, kind: 'master', bucket: BUCKETS.resume, objectPath, filename, buffer, isCurrent: true, market });
  });
}

export async function currentMaster(userId) {
  return one(`SELECT ${COLUMNS} FROM resume_files WHERE user_id = $1 AND kind = 'master' AND is_current`, [userId]);
}

/**
 * Store a PDF made for (tailored) or picked for (uploaded) one evaluation and
 * make it the file that goes out with that application.
 */
export async function saveForEvaluation(userId, evalId, buffer, filename, kind) {
  if (kind !== 'tailored' && kind !== 'uploaded') throw new Error(`bad kind ${kind}`);
  const name = safeName(filename);
  const objectPath = forEvalPath(userId, evalId, kind, name);
  await putObject(BUCKETS.tailored, objectPath, buffer);
  const market = await marketFor(userId);
  return tx(async (db) => {
    const row = await insertRow(db, { userId, kind, bucket: BUCKETS.tailored, objectPath, filename: name, buffer, evaluationId: Number(evalId), market });
    // A resume the user uploaded for this role is what goes out; a later tailoring doesn't replace it.
    await db.query(
      `UPDATE evaluations SET resume_file_id = $1, pdf_path = NULL WHERE id = $2 AND user_id = $3
         AND ($4 = 'uploaded' OR NOT EXISTS (SELECT 1 FROM resume_files f WHERE f.id = evaluations.resume_file_id AND f.kind = 'uploaded'))`,
      [row.id, evalId, userId, kind],
    );
    return row;
  });
}

/** Store a cover letter for one evaluation (doesn't change which resume goes). */
export async function saveCoverLetter(userId, evalId, buffer, filename) {
  const name = safeName(filename);
  const objectPath = forEvalPath(userId, evalId, 'cover_letter', name);
  await putObject(BUCKETS.tailored, objectPath, buffer);
  const market = await marketFor(userId);
  return insertRow({ query }, { userId, kind: 'cover_letter', bucket: BUCKETS.tailored, objectPath, filename: name, buffer, evaluationId: Number(evalId), market });
}

/** Index an archetype-library PDF the first time an application uses it. */
export async function recordLibraryFile(userId, { objectPath, filename, sizeBytes }) {
  const market = await marketFor(userId);
  return insertRow({ query }, {
    userId, kind: 'library', bucket: BUCKETS.library, objectPath, filename: safeName(filename), sizeBytes, market,
  });
}

/** Remember exactly which file was submitted with an application. */
export async function markSubmittedWith(userId, evalId, fileId) {
  if (!fileId) return;
  await run('UPDATE evaluations SET applied_resume_file_id = $1 WHERE id = $2 AND user_id = $3', [fileId, evalId, userId]);
}

/** The full row (with storage location) — only if it belongs to the user. */
export async function fileForUser(userId, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return one('SELECT * FROM resume_files WHERE id = $1 AND user_id = $2', [n, userId]);
}

/**
 * Delete an earlier master version (cloud copy and row). Never the current
 * one, and never one an application was tailored from or sent with.
 */
export async function deleteMasterVersion(userId, id) {
  const file = await fileForUser(userId, id);
  if (!file || file.kind !== 'master') throw Object.assign(new Error('File not found'), { status: 404 });
  if (file.is_current) throw Object.assign(new Error('That’s your current resume. Upload a new one to replace it.'), { status: 400 });
  const used = await one(
    'SELECT company_name FROM evaluations WHERE user_id = $1 AND $2 IN (applied_resume_file_id, resume_file_id) LIMIT 1', [userId, file.id]);
  if (used) throw Object.assign(new Error(used.company_name ? `Kept: your ${used.company_name} application uses this version.` : 'Kept: an application uses this version.'), { status: 409 });
  try {
    await deleteObject(file.bucket, file.object_path);
  } catch (err) {
    if (!/\((400|404)\)|not.?found/i.test(err.message)) throw err; // already gone from storage
  }
  await run('DELETE FROM resume_files WHERE id = $1 AND user_id = $2', [file.id, userId]);
}

export const fileBytes  = (file) => getObject(file.bucket, file.object_path);
export const fileLink   = (file) => signedObjectUrl(file.bucket, file.object_path);

/** Every PDF stored for one application (tailored resumes, cover letters, and the one it was sent with), newest first. */
export async function filesForEvaluation(userId, evalId) {
  return all(
    `SELECT f.id, f.kind, f.filename, f.size_bytes, f.created_at,
            COALESCE(f.id = e.applied_resume_file_id, false) AS sent,
            COALESCE(f.id = COALESCE(e.applied_resume_file_id, e.resume_file_id), false) AS primary_file
       FROM evaluations e
       JOIN resume_files f ON f.user_id = e.user_id
        AND (f.evaluation_id = e.id OR f.id IN (e.applied_resume_file_id, e.resume_file_id))
      WHERE e.id = $1 AND e.user_id = $2
      ORDER BY primary_file DESC, f.created_at DESC`, [evalId, userId]);
}
export const fileToTemp = (file) => objectToTemp(file.bucket, file.object_path);

/**
 * What Profile → Resume shows: every master version, and every application
 * with the resume that was (or will be) sent and where the role is.
 */
export async function resumeHistory(userId) {
  const masters = await all(
    `SELECT ${COLUMNS},
            EXISTS (SELECT 1 FROM evaluations e WHERE e.user_id = f.user_id AND f.id IN (e.applied_resume_file_id, e.resume_file_id)) AS in_use
       FROM resume_files f WHERE user_id = $1 AND kind = 'master' ORDER BY created_at DESC LIMIT 50`, [userId]);
  const applications = await all(
    `SELECT e.id AS evaluation_id, e.company_name, e.job_title, e.job_url, e.apply_status, e.applied_at,
            (e.applied_resume_file_id IS NOT NULL) AS sent,
            f.id, f.kind, f.filename, f.size_bytes, f.market, f.created_at,
            sr.location, sr.region
       FROM evaluations e
       JOIN resume_files f ON f.id = COALESCE(e.applied_resume_file_id, e.resume_file_id) AND f.user_id = e.user_id
       LEFT JOIN scraped_roles sr ON sr.apply_url = e.job_url
      WHERE e.user_id = $1
      ORDER BY COALESCE(e.applied_at::text, f.created_at::text) DESC
      LIMIT 500`, [userId]);
  return { masters, applications };
}

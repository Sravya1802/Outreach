/**
 * resumeStorage.js — Supabase Storage wrapper for per-user resume files.
 *
 * Buckets (created by supabase/migrations/005_storage_buckets.sql):
 *   - resume-library/<user_id>/<archetype>/<filename>.pdf   (auto-apply fallback PDFs)
 *   - resumes/<user_id>/original.pdf                        (single canonical resume)
 *   - tailored-pdfs/<user_id>/<eval_id>/<filename>.pdf      (tailored PDFs per evaluation)
 *
 * Uses Supabase Storage REST API with the service-role key — no extra npm
 * dep required. All paths are user-scoped so two users can never collide.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Read at call time: imports run before server.js loads .env.
const supabaseUrl = () => process.env.SUPABASE_URL;
const serviceKey  = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

export const BUCKETS = {
  library:  'resume-library',
  resume:   'resumes',
  tailored: 'tailored-pdfs',
};

function assertConfigured() {
  if (!supabaseUrl() || !serviceKey()) {
    throw new Error('Resume storage not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the backend .env');
  }
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${serviceKey()}`,
    apikey: serviceKey(),
    ...extra,
  };
}

function safeArchetype(s) {
  return String(s || 'misc').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 32) || 'misc';
}

function safeFilename(s) {
  return String(s || `resume-${Date.now()}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * Upload a PDF buffer to a per-user path. Returns the storage path.
 */
async function uploadBytes(bucket, objectPath, buffer, contentType = 'application/pdf') {
  assertConfigured();
  const url = `${supabaseUrl()}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': contentType, 'x-upsert': 'true' }),
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`storage upload failed (${res.status}): ${text || res.statusText}`);
  }
  return objectPath;
}

/**
 * Download an object to a temp file. Returns the temp path (caller must
 * unlink when done — Playwright reads the file then we clean up).
 */
async function downloadBytes(bucket, objectPath) {
  assertConfigured();
  const url = `${supabaseUrl()}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`storage download failed (${res.status}): ${text || res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function downloadToTemp(bucket, objectPath, filename = '') {
  const buf = await downloadBytes(bucket, objectPath);
  // Its own folder, so the file keeps exactly the name an upload form will show.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'resume-'));
  const name = path.basename(String(filename || '')).replace(/[\0/\\]/g, '_').trim() || path.basename(objectPath);
  const tmpPath = path.join(dir, name);
  await fs.promises.writeFile(tmpPath, buf);
  return tmpPath;
}

async function listObjects(bucket, prefix) {
  assertConfigured();
  const url = `${supabaseUrl()}/storage/v1/object/list/${bucket}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix, limit: 200, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`storage list failed (${res.status}): ${text || res.statusText}`);
  }
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

async function removeObject(bucket, objectPath) {
  assertConfigured();
  const url = `${supabaseUrl()}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`;
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`storage delete failed (${res.status}): ${text || res.statusText}`);
  }
  return true;
}

// ── Library (per-user archetype PDFs used by auto-apply fallback) ────────────

export async function uploadLibraryArchetype(userId, archetype, filename, buffer) {
  const objectPath = `${userId}/${safeArchetype(archetype)}/${safeFilename(filename)}`;
  await uploadBytes(BUCKETS.library, objectPath, buffer);
  return { archetype: safeArchetype(archetype), filename: safeFilename(filename), path: objectPath };
}

export async function listLibrary(userId) {
  // List with prefix `<userId>/` — Supabase storage returns nested objects
  // when prefix ends in `/`. We then group by archetype folder.
  const items = await listObjects(BUCKETS.library, `${userId}/`).catch(() => []);
  // Items can be either folders (no metadata) or files. Recurse into archetype folders.
  const out = [];
  for (const item of items) {
    if (!item || !item.name) continue;
    // If `metadata` is null/missing, it's a folder — list inside.
    if (!item.metadata) {
      const inner = await listObjects(BUCKETS.library, `${userId}/${item.name}/`).catch(() => []);
      for (const f of inner) {
        if (!f?.name) continue;
        out.push({
          archetype: item.name,
          folder:    item.name,
          filename:  f.name,
          path:      `${userId}/${item.name}/${f.name}`,
          sizeBytes: f.metadata?.size || 0,
        });
      }
    } else {
      out.push({
        archetype: 'misc',
        folder:    'misc',
        filename:  item.name,
        path:      `${userId}/${item.name}`,
        sizeBytes: item.metadata?.size || 0,
      });
    }
  }
  return out;
}

export async function removeLibraryFile(userId, archetype, filename) {
  const objectPath = `${userId}/${safeArchetype(archetype)}/${safeFilename(filename)}`;
  return removeObject(BUCKETS.library, objectPath);
}

export async function downloadLibraryFile(userId, archetype, filename) {
  const objectPath = `${userId}/${safeArchetype(archetype)}/${safeFilename(filename)}`;
  return downloadToTemp(BUCKETS.library, objectPath);
}

// ── Single canonical resume ──────────────────────────────────────────────────

export async function uploadOriginalResume(userId, buffer) {
  const objectPath = `${userId}/original.pdf`;
  await uploadBytes(BUCKETS.resume, objectPath, buffer);
  return objectPath;
}

export async function downloadOriginalResume(userId) {
  return downloadToTemp(BUCKETS.resume, `${userId}/original.pdf`);
}

// ── Tailored PDFs (per evaluation) ───────────────────────────────────────────

export async function uploadTailoredPdf(userId, evalId, filename, buffer) {
  const objectPath = `${userId}/${Number(evalId) || 0}/${safeFilename(filename)}`;
  await uploadBytes(BUCKETS.tailored, objectPath, buffer);
  return objectPath;
}

export async function downloadTailoredPdf(userId, evalId, filename) {
  const objectPath = `${userId}/${Number(evalId) || 0}/${safeFilename(filename)}`;
  return downloadToTemp(BUCKETS.tailored, objectPath);
}

/**
 * A short-lived link to one stored object, so a browser can open the PDF
 * directly (iPad Safari blocks downloads that start after a network wait).
 */
export async function signedObjectUrl(bucket, objectPath, expiresIn = 600) {
  assertConfigured();
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/sign/${bucket}/${encodeURI(objectPath)}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`storage sign failed (${res.status}): ${text || res.statusText}`);
  }
  const { signedURL } = await res.json();
  if (!signedURL) throw new Error('storage sign failed: no URL returned');
  return `${supabaseUrl()}/storage/v1${signedURL}`;
}

export function isStorageConfigured() {
  return Boolean(supabaseUrl() && serviceKey());
}

// Generic access for resumeFiles.js, which keeps the per-file index.
export { uploadBytes as putObject, downloadBytes as getObject, downloadToTemp as objectToTemp, removeObject as deleteObject };

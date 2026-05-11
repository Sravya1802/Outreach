/**
 * resumeRegistry.js
 *
 * Reads the user's local "Common resumes" directory and maps each sub-folder
 * to a set of role keywords, so the auto-apply worker can pick the right CV
 * for a given job.
 *
 * Folder convention (user's actual layout):
 *   ~/Documents/Common resumes/
 *     AIML/         → AI, ML, LLM, deep learning roles
 *     DS/           → data science, analyst roles
 *     Devops/       → SRE, DevOps, platform, infrastructure
 *     SWE/          → software engineer, backend, systems
 *     full stack/   → full-stack, frontend + backend
 *     wellfound/    → generic fallback (startup roles)
 *
 * Path is configurable via user_profile.resume_dir.
 */

import fs from 'fs';
import path from 'path';
import { listLibrary, downloadLibraryFile, isStorageConfigured } from './resumeStorage.js';

// Role-archetype → folder name patterns (lower-case, token match).
// Order matters: the FIRST matching archetype wins when multiple keywords appear.
const ARCHETYPE_FOLDERS = [
  { archetype: 'aiml',      folderPatterns: ['aiml', 'ai', 'ml'],               keywords: ['ai engineer', 'machine learning', 'ml engineer', 'llm', 'nlp', 'deep learning', 'computer vision', 'cv engineer', 'llmops', 'mlops', 'ai researcher', 'genai', 'generative ai', 'ai scientist'] },
  { archetype: 'ds',        folderPatterns: ['ds', 'data'],                     keywords: ['data scientist', 'data analyst', 'analytics', 'business intelligence', 'data engineer'] },
  { archetype: 'devops',    folderPatterns: ['devops', 'sre', 'infra'],         keywords: ['devops', 'sre', 'site reliability', 'platform engineer', 'infrastructure', 'cloud engineer', 'kubernetes'] },
  { archetype: 'fullstack', folderPatterns: ['full stack', 'fullstack'],        keywords: ['full stack', 'fullstack', 'full-stack', 'frontend + backend', 'web developer'] },
  { archetype: 'swe',       folderPatterns: ['swe', 'software'],                keywords: ['software engineer', 'backend engineer', 'systems engineer', 'sde', 'software developer'] },
  { archetype: 'startup',   folderPatterns: ['wellfound', 'startup'],           keywords: ['founding engineer', 'early-stage', 'yc', 'seed'] },
];

function normalizeFolder(name) {
  return name.toLowerCase().replace(/[-_\s]+/g, '').trim();
}

/**
 * Scan the configured resume directory. Returns the list of available resumes,
 * each annotated with its archetype (if we can match the folder name).
 *
 *   [
 *     { archetype: 'swe', folder: 'SWE', filename: 'Resume.pdf', absPath: '...', sizeBytes: 123456 },
 *     ...
 *   ]
 */
export function scanResumes(resumeDir) {
  if (!resumeDir) return [];
  let dirs;
  try { dirs = fs.readdirSync(resumeDir, { withFileTypes: true }); } catch (_) { return []; }

  const results = [];
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const folderPath = path.join(resumeDir, entry.name);
    // Find the first .pdf in the folder — we assume one CV per folder.
    let pdf;
    try {
      pdf = fs.readdirSync(folderPath).find(f => f.toLowerCase().endsWith('.pdf'));
    } catch (_) { continue; }
    if (!pdf) continue;
    const abs = path.join(folderPath, pdf);
    const stat = fs.statSync(abs);

    // Match folder name to an archetype.
    const folderNorm = normalizeFolder(entry.name);
    const match = ARCHETYPE_FOLDERS.find(a => a.folderPatterns.some(p => folderNorm.includes(normalizeFolder(p))));

    results.push({
      archetype: match?.archetype || 'unknown',
      folder:    entry.name,
      filename:  pdf,
      absPath:   abs,
      sizeBytes: stat.size,
      mtime:     stat.mtime.toISOString(),
    });
  }
  return results;
}

/**
 * Scan the user's Supabase Storage `resume-library` bucket and return the same
 * shape as scanResumes() — but each entry's `absPath` points at a temp file
 * downloaded from storage. Caller is responsible for unlinking after use
 * (Playwright reads it once, then we clean up).
 *
 * This is the path that's ACTUALLY refreshed when a user uploads a new PDF
 * via the CareerOps Library UI (which writes to Supabase Storage, not local FS).
 *
 * Returns [] if storage isn't configured or the bucket is empty for this user.
 */
export async function scanResumesFromStorage(userId) {
  if (!userId || !isStorageConfigured()) return [];
  let items;
  try { items = await listLibrary(userId); }
  catch (_) { return []; }
  if (!items?.length) return [];

  // listLibrary returns one entry per (archetype-folder, filename). Pick the
  // first PDF per archetype — same convention as scanResumes() — and download
  // each to a temp file so Playwright can setInputFiles() against it.
  const seenArchetypes = new Set();
  const results = [];
  for (const item of items) {
    if (!item?.filename || !item.filename.toLowerCase().endsWith('.pdf')) continue;
    const folder = String(item.archetype || item.folder || 'misc');
    if (seenArchetypes.has(folder)) continue;
    seenArchetypes.add(folder);

    const folderNorm = normalizeFolder(folder);
    const match = ARCHETYPE_FOLDERS.find(a => a.folderPatterns.some(p => folderNorm.includes(normalizeFolder(p))));

    let absPath;
    try { absPath = await downloadLibraryFile(userId, folder, item.filename); }
    catch (_) { continue; }

    results.push({
      archetype: match?.archetype || folder.toLowerCase(),
      folder,
      filename:  item.filename,
      absPath,                  // temp path — caller must clean up
      sizeBytes: item.sizeBytes || 0,
      source:    'storage',     // flag so the worker can unlink after use
    });
  }
  return results;
}

/**
 * Given a job title / description, pick the best resume for it.
 * Returns the resume record (or null if no acceptable match).
 *
 * Matching logic:
 *   1. Match by keyword against ARCHETYPE_FOLDERS keywords (first-archetype-wins)
 *   2. Find the resume for that archetype
 *   3. If `strict=true` and no keyword match → return null (caller should
 *      mark the eval needs_review). If `strict=false` → score each available
 *      resume by counting keyword hits across the JD haystack and pick the
 *      highest-scoring one ("closest resume"). Falls back to 'startup' / first
 *      if every score is zero.
 */
export function pickResumeForRole(resumes, { jobTitle = '', jobDescription = '', archetypeHint = '', strict = false } = {}) {
  if (!resumes || resumes.length === 0) return null;
  const haystack = `${jobTitle} ${jobDescription} ${archetypeHint}`.toLowerCase();

  for (const a of ARCHETYPE_FOLDERS) {
    if (a.keywords.some(kw => haystack.includes(kw))) {
      const r = resumes.find(x => x.archetype === a.archetype);
      if (r) return r;
    }
  }

  if (strict) return null;

  // Non-strict fallback: score every resume by how many archetype keywords
  // its archetype contributes to the haystack. Higher score = closer match.
  // This is much more useful than the prior "always startup" default — a SWE
  // role with no exact keyword still picks the SWE resume over a random one.
  let best = null;
  let bestScore = -1;
  for (const r of resumes) {
    const a = ARCHETYPE_FOLDERS.find(x => x.archetype === r.archetype);
    if (!a) continue;
    const score = a.keywords.reduce((n, kw) => n + (haystack.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  if (best && bestScore > 0) return best;
  return resumes.find(r => r.archetype === 'startup') || resumes[0];
}

/**
 * Detect which application platform a job URL uses (Greenhouse, Lever, Ashby,
 * Workday, LinkedIn, or unknown). The auto-apply worker uses this to route to
 * the right form-filling strategy.
 */
export function detectPlatform(url = '') {
  const u = url.toLowerCase();
  if (!u) return 'unknown';
  if (u.includes('greenhouse.io') || u.includes('boards.greenhouse.io')) return 'greenhouse';
  if (u.includes('lever.co'))         return 'lever';
  if (u.includes('ashbyhq.com'))      return 'ashby';
  if (u.includes('myworkdayjobs.com') || u.includes('workday.com')) return 'workday';
  if (u.includes('linkedin.com/jobs')) return 'linkedin';
  if (u.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (u.includes('workable.com'))     return 'workable';
  if (u.includes('jobvite.com'))      return 'jobvite';
  if (u.includes('jobs.apple.com'))   return 'apple';
  if (u.includes('amazon.jobs'))      return 'amazon';
  return 'unknown';
}

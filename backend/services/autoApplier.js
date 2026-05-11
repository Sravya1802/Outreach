/**
 * autoApplier.js
 *
 * Playwright-based auto-apply worker. Reads the queue (evaluations with
 * apply_mode='auto' and apply_status='queued'), opens each job URL in a
 * headless browser, fills the form with the user's profile + picked resume,
 * and submits.
 *
 * Per user spec:
 *   - Skip captcha / login pages — leave status='in_progress' (revisit later)
 *   - Never retry a failed submit automatically (mark error, user reviews)
 *   - Uses the resume mapped to the job's role archetype via resumeRegistry
 *
 * Supported platforms today: greenhouse, lever, ashby (the 3 ATS that expose
 * structured, predictable forms). Workday/LinkedIn/custom are marked as
 * 'platform_unsupported' so the user can apply manually.
 *
 * TODO(auth): caller passes userId — every exported function takes userId as
 * the first argument. `runQueueOnce` receives userId in its options bag and
 * threads it to processOneEvaluation.
 */

import path from 'path';
import fs from 'fs';
import db, { one, all, run } from '../db.js';
import { scanResumesFromStorage, pickResumeForRole, detectPlatform } from './resumeRegistry.js';
import { validateProfileForApply } from './applyValidation.js';

// Status values we write back to evaluations.apply_status during processing.
const STATUS = {
  queued:        'queued',
  in_progress:   'in_progress',
  submitted:     'submitted',
  captcha:       'captcha_needed',
  login:         'login_needed',
  unsupported:   'platform_unsupported',
  failed:        'submit_failed',
  needs_review:  'needs_review',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getProfile(userId) {
  return (await one(
    'SELECT * FROM user_profile WHERE user_id = $1',
    [userId]
  )) || {};
}

async function setStatus(userId, evalId, status, { error = null, platform, resumeUsed, incrementAttempts = false } = {}) {
  const parts = [];
  const args  = [];
  let idx = 1;
  parts.push(`apply_status = $${idx++}`);             args.push(status);
  if (error !== null)   { parts.push(`apply_error = $${idx++}`);        args.push(error ? String(error).slice(0, 500) : null); }
  if (platform)         { parts.push(`apply_platform = $${idx++}`);     args.push(platform); }
  if (resumeUsed)       { parts.push(`apply_resume_used = $${idx++}`);  args.push(resumeUsed); }
  if (status === STATUS.submitted) { parts.push('applied_at = NOW()'); }
  if (incrementAttempts) { parts.push('apply_attempts = COALESCE(apply_attempts, 0) + 1'); }
  args.push(evalId);
  args.push(userId);
  await run(
    `UPDATE evaluations SET ${parts.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1}`,
    args
  );
}

// Safe wrapper around page.fill — ignores missing selectors, treats failures as skipped.
async function tryFill(page, selector, value) {
  if (value == null || value === '') return false;
  try {
    const loc = page.locator(selector).first();
    if (await loc.count() === 0) return false;
    await loc.waitFor({ state: 'visible', timeout: 2000 });
    await loc.fill(String(value));
    return true;
  } catch (_) { return false; }
}

async function tryClick(page, selector) {
  try {
    const loc = page.locator(selector).first();
    if (await loc.count() === 0) return false;
    await loc.waitFor({ state: 'visible', timeout: 2000 });
    await loc.click();
    return true;
  } catch (_) { return false; }
}

async function setFileInput(page, selector, filePath) {
  try {
    const loc = page.locator(selector).first();
    if (await loc.count() === 0) return false;
    await loc.setInputFiles(filePath);
    return true;
  } catch (_) { return false; }
}

// Does the page contain a captcha widget? Google reCAPTCHA + hCaptcha.
async function hasCaptcha(page) {
  try {
    const hit = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, [data-sitekey]').count();
    return hit > 0;
  } catch (_) { return false; }
}

// Does the page require a login? (sign-in form visible, no apply form yet)
async function looksLikeLogin(page) {
  try {
    const text = (await page.content()).toLowerCase();
    return /sign in|log in|password/.test(text) && !/apply for this job|submit application/.test(text);
  } catch (_) { return false; }
}

// ── Detect required form fields that were NOT auto-filled ────────────────────
// Per user ask #5 extra: many Greenhouse/Lever/Ashby forms add custom required
// questions ("Why this company?", "How did you hear about us?", demographic
// questions, work auth dropdowns). Auto-fill only handles the common fields.
// Submitting with these empty either errors out or quietly drops the
// application. Scan the form, find required-but-empty fields, flag for review
// with sample labels so the user can complete them manually.
async function detectUnfilledRequired(page) {
  try {
    return await page.evaluate(() => {
      const labelFor = (el) => {
        // Try aria-label, then <label for="id">, then nearest preceding label/legend.
        const aria = el.getAttribute('aria-label');
        if (aria && aria.trim()) return aria.trim().slice(0, 120);
        if (el.id) {
          const lbl = document.querySelector(`label[for="${el.id}"]`);
          if (lbl && lbl.textContent.trim()) return lbl.textContent.trim().slice(0, 120);
        }
        const wrap = el.closest('label, .field, .application-question, [role="group"], fieldset');
        if (wrap) {
          const txt = (wrap.querySelector('legend, label, .question, .label')?.textContent || wrap.textContent || '').trim();
          if (txt) return txt.slice(0, 120);
        }
        return el.name || el.id || '(unknown field)';
      };
      const out = [];
      // text/textarea/select required and empty
      const required = document.querySelectorAll('input[required]:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]), textarea[required], select[required]');
      for (const el of required) {
        const val = (el.value || '').trim();
        if (!val) {
          out.push({ kind: el.tagName.toLowerCase(), label: labelFor(el), name: el.name || el.id || '' });
          if (out.length >= 8) break;
        }
      }
      // Required radio groups with nothing checked
      const seenRadioGroups = new Set();
      const radios = document.querySelectorAll('input[type=radio][required], fieldset[required] input[type=radio]');
      for (const r of radios) {
        if (!r.name || seenRadioGroups.has(r.name)) continue;
        seenRadioGroups.add(r.name);
        const anyChecked = document.querySelector(`input[type=radio][name="${CSS.escape(r.name)}"]:checked`);
        if (!anyChecked) {
          out.push({ kind: 'radio-group', label: labelFor(r), name: r.name });
          if (out.length >= 8) break;
        }
      }
      // Required checkbox groups (at least one)
      const seenCheckboxGroups = new Set();
      const checkboxes = document.querySelectorAll('input[type=checkbox][required], fieldset[required] input[type=checkbox]');
      for (const c of checkboxes) {
        if (!c.name || seenCheckboxGroups.has(c.name)) continue;
        seenCheckboxGroups.add(c.name);
        const anyChecked = document.querySelector(`input[type=checkbox][name="${CSS.escape(c.name)}"]:checked`);
        if (!anyChecked) {
          out.push({ kind: 'checkbox-group', label: labelFor(c), name: c.name });
          if (out.length >= 8) break;
        }
      }
      return out;
    });
  } catch (_) { return []; }
}

// ── Platform: Greenhouse ──────────────────────────────────────────────────────
// Greenhouse ATS forms are the cleanest: standard field names (first_name,
// last_name, email, phone) and a resume file input.

async function fillGreenhouse(page, profile, resumePath) {
  await tryFill(page, 'input#first_name, input[name="first_name"], input[autocomplete="given-name"]', profile.first_name);
  await tryFill(page, 'input#last_name,  input[name="last_name"],  input[autocomplete="family-name"]', profile.last_name);
  await tryFill(page, 'input#email,      input[name="email"],      input[autocomplete="email"]',      profile.email);
  await tryFill(page, 'input#phone,      input[name="phone"],      input[autocomplete="tel"]',        profile.phone);
  // LinkedIn / portfolio
  await tryFill(page, 'input[name*="linkedin"], input[name*="urls[LinkedIn]"]', profile.linkedin_url);
  await tryFill(page, 'input[name*="github"],   input[name*="urls[Github]"],   input[name*="urls[GitHub]"]', profile.github_url);
  await tryFill(page, 'input[name*="portfolio"], input[name*="urls[Portfolio]"], input[name*="urls[Website]"]', profile.portfolio_url);
  await tryFill(page, 'input[name*="location"], input[autocomplete*="address"]', profile.location);

  // Resume upload — Greenhouse uses a hidden file input under a styled "Attach resume" button.
  if (resumePath) {
    await setFileInput(page, 'input[type="file"][id*="resume"], input[type="file"][name*="resume"], input[type="file"]', resumePath);
  }
  await page.waitForTimeout(800);
}

// ── Platform: Lever ──────────────────────────────────────────────────────────
async function fillLever(page, profile, resumePath) {
  await tryFill(page, 'input[name="name"], input#name', `${profile.first_name || ''} ${profile.last_name || ''}`.trim());
  await tryFill(page, 'input[name="email"], input#email', profile.email);
  await tryFill(page, 'input[name="phone"], input#phone', profile.phone);
  await tryFill(page, 'input[name="urls[LinkedIn]"], input[name*="linkedin"]', profile.linkedin_url);
  await tryFill(page, 'input[name="urls[GitHub]"],   input[name*="github"]',   profile.github_url);
  await tryFill(page, 'input[name="urls[Portfolio]"], input[name*="portfolio"]', profile.portfolio_url);
  await tryFill(page, 'input[name="location"], input[name*="location"]', profile.location);

  if (resumePath) {
    await setFileInput(page, 'input[type="file"][name*="resume"], input[type="file"]', resumePath);
  }
  await page.waitForTimeout(800);
}

// ── Platform: Ashby ──────────────────────────────────────────────────────────
async function fillAshby(page, profile, resumePath) {
  await tryFill(page, 'input[name="name"], input[id*="_name_"][id*="_firstName"]', `${profile.first_name || ''} ${profile.last_name || ''}`.trim());
  await tryFill(page, 'input[type="email"]', profile.email);
  await tryFill(page, 'input[type="tel"]',   profile.phone);
  await tryFill(page, 'input[id*="linkedin"], input[name*="linkedin"]', profile.linkedin_url);
  await tryFill(page, 'input[id*="github"],   input[name*="github"]',   profile.github_url);

  if (resumePath) {
    await setFileInput(page, 'input[type="file"]', resumePath);
  }
  await page.waitForTimeout(800);
}

// Per-platform submit selectors. Kept separate from the fillers so the main
// flow can scan for unfilled required fields between fill and submit.
const SUBMIT_SELECTORS = {
  greenhouse: 'button[type="submit"], input[type="submit"], button:has-text("Submit Application")',
  lever:      'button[type="submit"], .template-btn-submit, button:has-text("Submit application")',
  ashby:      'button[type="submit"], button:has-text("Submit Application"), button:has-text("Submit")',
};

// ── Main: apply to a single evaluation ───────────────────────────────────────

export async function processOneEvaluation(userId, evalId, { headless = true, dryRun = false, useLibraryResume = false } = {}) {
  if (!userId) return { ok: false, error: 'Missing userId — auto-apply requires an authenticated caller' };
  const row = await one(
    'SELECT * FROM evaluations WHERE id = $1 AND user_id = $2',
    [evalId, userId]
  );
  if (!row) return { ok: false, error: 'Evaluation not found' };
  if (!row.job_url) {
    await setStatus(userId, evalId, STATUS.failed, { error: 'No job URL', incrementAttempts: true });
    return { ok: false, error: 'No job URL to apply to' };
  }

  const platform = detectPlatform(row.job_url);
  const profile  = await getProfile(userId);
  if (!profile.auto_apply_consent) {
    await setStatus(userId, evalId, STATUS.needs_review, {
      error: 'Auto Apply requires explicit saved consent in your profile before submitting applications',
      platform,
    });
    return { ok: false, error: 'Auto Apply consent required', needsReview: true };
  }

  // Validate profile + JD compatibility (presence, email/phone format,
  // sponsorship mismatch). Anything failing → needs_review with reason.
  const profileCheck = validateProfileForApply(profile, row.job_description || '');
  if (!profileCheck.ok) {
    await setStatus(userId, evalId, STATUS.needs_review, { error: profileCheck.reason, platform });
    return { ok: false, error: profileCheck.reason, needsReview: true };
  }

  // Resume selection — three-tier:
  //   1. Per-eval override: if the user uploaded / generated a tailored PDF
  //      for this specific evaluation (evaluations.pdf_path), honor it. This
  //      is the "let me upload my own" path.
  //   2. Resume Library archetype match: pick the library PDF whose folder
  //      keywords match the JD.
  //   3. Closest-library fallback: if no archetype matches, pickResumeForRole
  //      scores every library entry against the JD and returns the highest;
  //      only mark needs_review when the library is genuinely empty.
  // Previously this was strict-library-only and paused submission on any
  // archetype miss — too aggressive, since a SWE resume can still apply to a
  // role that just doesn't trip the keyword list.
  let resume = null;
  if (row.pdf_path && fs.existsSync(row.pdf_path)) {
    resume = { archetype: 'override', filename: path.basename(row.pdf_path), absPath: row.pdf_path };
    console.log(`[autoApply] per-eval override resume "${resume.filename}" for eval ${evalId}`);
  } else {
    const libraryResumes = await scanResumesFromStorage(userId);
    resume = pickResumeForRole(libraryResumes, {
      jobTitle:       row.job_title,
      jobDescription: row.job_description || '',
      archetypeHint:  (row.report_json ? JSON.parse(row.report_json)?.archetype?.primary : '') || '',
      strict:         false,
    });
    if (resume) {
      console.log(`[autoApply] library resume "${resume.filename}" (archetype=${resume.archetype}) for eval ${evalId}`);
    } else {
      await setStatus(userId, evalId, STATUS.needs_review, {
        error: 'Your Resume Library is empty — upload at least one PDF in Auto-Apply Setup → Resume Library, or generate a tailored resume for this role.',
        platform,
      });
      return { ok: false, error: 'Resume library empty', needsReview: true };
    }
  }

  const supported = ['greenhouse', 'lever', 'ashby'];
  if (!supported.includes(platform)) {
    await setStatus(userId, evalId, STATUS.unsupported, { error: `Platform "${platform}" not yet supported for auto-apply — please apply manually`, platform, incrementAttempts: true });
    return { ok: false, platform, error: 'Platform not supported' };
  }

  await setStatus(userId, evalId, STATUS.in_progress, { platform, resumeUsed: resume.filename, incrementAttempts: true });

  // Lazy import so Playwright isn't loaded for non-auto-apply requests
  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless });
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto(row.job_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Some Greenhouse/Lever job pages have a separate "Apply" CTA on the JD page
    // that expands or navigates to the form. Try clicking it first.
    await tryClick(page, 'a#apply_button, a.postings-btn, a:has-text("Apply for this job"), button:has-text("Apply")');
    await page.waitForTimeout(1500);

    if (await hasCaptcha(page)) {
      await setStatus(userId, evalId, STATUS.captcha, { error: 'Captcha detected — leaving in progress for manual completion', platform });
      return { ok: false, platform, error: 'Captcha present' };
    }
    if (await looksLikeLogin(page)) {
      await setStatus(userId, evalId, STATUS.login, { error: 'Login required — leaving in progress for manual completion', platform });
      return { ok: false, platform, error: 'Login required' };
    }

    // Fill (no submit yet).
    if (platform === 'greenhouse') await fillGreenhouse(page, profile, resume.absPath);
    else if (platform === 'lever') await fillLever(page, profile, resume.absPath);
    else if (platform === 'ashby') await fillAshby(page, profile, resume.absPath);

    // Pre-submit scan: do not click Submit if there are required questions we
    // didn't fill. Many apply forms add custom required fields ("Why this
    // company?", "How did you hear about us?", visa/demographic questions);
    // submitting blank either errors out or quietly drops the application.
    // Flag for user review with the field labels we found.
    const unfilled = await detectUnfilledRequired(page);
    if (unfilled.length > 0) {
      const labels = unfilled.map(f => f.label).filter(Boolean).slice(0, 5).join(' | ');
      const reason = `Form has ${unfilled.length} additional required field${unfilled.length === 1 ? '' : 's'} we didn't auto-fill (${labels}). Open the URL and complete it manually, then mark as applied.`;
      console.log(`[autoApply] eval ${evalId}: ${unfilled.length} unfilled required → needs_review`);
      await setStatus(userId, evalId, STATUS.needs_review, { error: reason, platform, resumeUsed: resume.filename });
      return { ok: false, platform, error: reason, needsReview: true };
    }

    if (dryRun) {
      await setStatus(userId, evalId, STATUS.in_progress, {
        error: '(dry run) form filled and required-field scan passed; submit skipped',
        platform,
        resumeUsed: resume.filename,
      });
      return { ok: true, platform, resume: resume.filename, dryRun: true, readyToSubmit: true };
    }

    // All required filled — click submit.
    const submitted = await tryClick(page, SUBMIT_SELECTORS[platform]);
    await page.waitForTimeout(2500);

    // Heuristic confirmation — the page either navigates to a thank-you URL
    // or renders a success message.
    const url  = page.url();
    const body = (await page.content()).toLowerCase();
    const looksSubmitted = submitted && (
         url.includes('thank')
      || url.includes('success')
      || url.includes('confirmation')
      || /application.*(received|submitted|complete)/i.test(body)
      || /thanks for applying|thank you for applying/i.test(body)
    );

    if (looksSubmitted) {
      await setStatus(userId, evalId, STATUS.submitted, { platform, resumeUsed: resume.filename });
      return { ok: true, platform, resume: resume.filename };
    }
    // Not obviously confirmed — mark as in_progress with note, so user can verify.
    await setStatus(userId, evalId, STATUS.in_progress, { error: 'Submitted button clicked but confirmation unclear — verify manually', platform });
    return { ok: false, platform, error: 'Submission unconfirmed' };
  } catch (err) {
    await setStatus(userId, evalId, STATUS.failed, { error: err.message, platform });
    return { ok: false, platform, error: err.message };
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
    // Unlink temp files we downloaded from Supabase Storage. Skip FS-resident
    // and tailored PDFs — those are persistent.
    if (resume?.source === 'storage' && resume.absPath) {
      try { fs.unlinkSync(resume.absPath); } catch (_) {}
    }
  }
}

/**
 * Pull all queued evaluations and process them sequentially.
 * Returns a summary { processed, submitted, failed, skipped }.
 *
 * `userId` is required — caller (routes/careerOps.js) passes req.user.id via
 * the options bag.
 */
// Backward-compat: positional userId OR object form `{ userId }`. Both supported.
export async function runQueueOnce(userIdOrOpts, opts) {
  const o = typeof userIdOrOpts === 'object' ? userIdOrOpts : { userId: userIdOrOpts, ...(opts || {}) };
  const { headless = true, dryRun = false, limit = 10, userId, useLibraryResume = false } = o;
  if (!userId) throw new Error('runQueueOnce requires userId');
  const rows = await all(`
    SELECT id FROM evaluations
    WHERE apply_mode = 'auto'
      AND apply_status = 'queued'
      AND user_id = $1
    ORDER BY created_at ASC
    LIMIT $2
  `, [userId, limit]);

  const summary = { processed: 0, submitted: 0, failed: 0, skipped: 0, needsReview: 0, results: [] };
  for (const { id } of rows) {
    const r = await processOneEvaluation(userId, id, { headless, dryRun, useLibraryResume });
    summary.processed++;
    if (r.ok) summary.submitted++;
    else if (r.needsReview) summary.needsReview++;
    else if (r.error === 'Captcha present' || r.error === 'Login required' || r.error === 'Platform not supported') summary.skipped++;
    else summary.failed++;
    summary.results.push({ evalId: id, ...r });
  }
  return summary;
}

/**
 * nightlyPipeline.js
 * Orchestrator for the end-to-end nightly auto-apply pipeline:
 *   scan portals → evaluate new roles → fit-filter (score >= minScore) →
 *   queue → run Playwright worker → record summary.
 *
 * Called from two places:
 *   1. POST /api/career/nightly-pipeline   (manual trigger via UI)
 *   2. cron at 07:00 UTC                   (per-user iteration in server.js)
 *
 * Both paths funnel through runNightlyPipelineForUser() so behavior stays
 * identical between manual + scheduled runs.
 */

import { inAppTailoring } from './features.js';
import { one, all, run } from '../db.js';
import { evaluateJob, fetchJobFromUrl } from './jobEvaluator.js';
import { runQueueOnce } from './autoApplier.js';
import { scanGreenhouse, scanLever, scanAshby } from '../routes/careerOps.js';

const DEFAULTS = {
  enabled:  false,
  roleType: 'intern',
  minScore: 85,
  maxApps:  50,
  useLibraryResume: true,
};

export async function runNightlyPipelineForUser(userId, cfgOverrides = {}) {
  const startedAt = new Date().toISOString();
  const cfg = { ...DEFAULTS, ...cfgOverrides };

  // Every application needs the user's approval in the Review queue now.
  if (!inAppTailoring()) return { startedAt, finishedAt: new Date().toISOString(), error: 'Applications go through the Review queue now', cfg };

  // Honor the soft pause — same gate as POST /auto-apply/run. Without this the
  // 07:00 UTC cron would happily submit applications for users who paused via
  // the UI but kept consent granted.
  const profile = await one(
    'SELECT auto_apply_consent, auto_apply_paused FROM user_profile WHERE user_id = $1',
    [userId]
  );
  if (!profile?.auto_apply_consent) {
    return { startedAt, finishedAt: new Date().toISOString(), error: 'Auto Apply consent not granted', cfg };
  }
  if (profile?.auto_apply_paused) {
    return { startedAt, finishedAt: new Date().toISOString(), error: 'Auto Apply paused', cfg };
  }

  const resumeText = (await one(
    "SELECT value FROM meta WHERE key = $2 AND user_id = $1",
    [userId, 'user_resume_text']
  ))?.value;
  if (!resumeText) {
    return { startedAt, finishedAt: new Date().toISOString(), error: 'No resume uploaded for this user', cfg };
  }

  // 1. Scan
  const [gh, lv, ash] = await Promise.allSettled([
    scanGreenhouse(cfg.roleType), scanLever(cfg.roleType), scanAshby(cfg.roleType),
  ]);
  const scanned = [
    ...(gh.status  === 'fulfilled' ? gh.value  : []),
    ...(lv.status  === 'fulfilled' ? lv.value  : []),
    ...(ash.status === 'fulfilled' ? ash.value : []),
  ];
  const urls = [...new Set(scanned.map(j => j.applyUrl).filter(Boolean))];

  // 2. Skip URLs already evaluated
  let toEvaluate = urls;
  if (urls.length > 0) {
    const existing = await all(
      `SELECT job_url FROM evaluations WHERE user_id = $1 AND job_url = ANY($2::text[])`,
      [userId, urls]
    );
    const seen = new Set(existing.map(r => r.job_url));
    toEvaluate = urls.filter(u => !seen.has(u));
  }

  // 3. Evaluate in chunks of 3 (rate-limit safe). Cap to maxApps × 3.
  const evalCap = Math.min(toEvaluate.length, cfg.maxApps * 3);
  const evalBatch = toEvaluate.slice(0, evalCap);
  let evaluated = 0, fits = 0;
  for (let i = 0; i < evalBatch.length; i += 3) {
    const chunk = evalBatch.slice(i, i + 3);
    const settled = await Promise.allSettled(chunk.map(async (url) => {
      const fetched = await fetchJobFromUrl(url.trim());
      if (!fetched.text) throw new Error(`Could not fetch: ${url}`);
      const evaluation = await evaluateJob({ jobDescription: fetched.text, resumeText, jobUrl: url });
      const r = await run(`
        INSERT INTO evaluations (user_id, job_url, job_title, company_name, job_description, grade, score, report_json, source, apply_mode, apply_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'nightly_pipeline', $9, $10)
        RETURNING id
      `, [
        userId, url, evaluation.jobTitle, evaluation.companyName,
        fetched.text.slice(0, 5000), evaluation.grade, evaluation.overallScore,
        JSON.stringify(evaluation),
        evaluation.overallScore >= cfg.minScore ? 'auto' : 'manual',
        evaluation.overallScore >= cfg.minScore ? 'queued' : 'not_started',
      ]);
      return { url, evalId: r.insertId, score: evaluation.overallScore, fit: evaluation.overallScore >= cfg.minScore };
    }));
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        evaluated++;
        if (s.value.fit) fits++;
      }
    }
    if (i + 3 < evalBatch.length) await new Promise(r => setTimeout(r, 3000));
  }

  // 4. Run worker against queued items
  const runResult = await runQueueOnce({
    userId,
    headless:         true,
    limit:            cfg.maxApps,
    useLibraryResume: cfg.useLibraryResume,
  }).catch(err => ({ error: err.message }));

  const summary = {
    startedAt,
    finishedAt:  new Date().toISOString(),
    scanned:     urls.length,
    newUrls:     toEvaluate.length,
    evaluated,
    fits,
    applied:     runResult?.submitted   || 0,
    needsReview: runResult?.needsReview || 0,
    failed:      runResult?.failed      || 0,
    skipped:     runResult?.skipped     || 0,
    cfg,
    workerError: runResult?.error || null,
  };
  await run(
    `INSERT INTO meta (user_id, key, value) VALUES ($1, 'nightly_pipeline_last_run', $2)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, JSON.stringify(summary)]
  );
  return summary;
}

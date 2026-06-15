import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import logger from './logger.js';
import { validateConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
validateConfig();

import companiesRouter  from './routes/companies.js';
import contactsRouter   from './routes/contacts.js';
import emailsRouter     from './routes/emails.js';
import generateRouter   from './routes/generate.js';
import prospectsRouter  from './routes/prospects.js';
import db, { one, all, run, pingDb } from './db.js';
import jobsRouter from './routes/jobs.js';
import { runReclassifyUnclassified } from './routes/jobs.js';
import internRolesRouter from './routes/internRoles.js';
import unifiedRouter    from './routes/unified.js';
import creditsRouter    from './routes/credits.js';
import importSheetRouter from './routes/importSheet.js';
import careerOpsRouter   from './routes/careerOps.js';
import automationsRouter  from './routes/automations.js';
import ycRouter           from './routes/yc.js';
import scrapedRolesRouter from './routes/scrapedRoles.js';
import alertsRouter        from './routes/alerts.js';
import { requireAuth }    from './middleware/requireAuth.js';
import { scrapeAllSources } from './services/scraper.js';
import { scrapeAllSourcesAndPersist } from './services/multiSourceScraper.js';
import { runSubscriptionDigests } from './services/dailyDigest.js';
import { mailerConfigured } from './services/mailer.js';
import { importStartupSheet } from './services/startupSheet.js';
import { checkAllCredits }   from './services/creditChecker.js';

const app = express();

// ── CORS — allow local dev + configured production frontend origin(s) ──────
// Single origin: set FRONTEND_ORIGIN=https://outreach-jt.vercel.app
// Multiple origins (e.g. preview URLs): set CORS_ORIGINS="https://a.vercel.app,https://b.vercel.app"
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
const CORS_ORIGINS = [...new Set([
  ...DEFAULT_ORIGINS,
  ...envOrigins,
  ...(FRONTEND_ORIGIN ? [FRONTEND_ORIGIN] : []),
])];
// Behind nginx — trust the X-Forwarded-For header so express-rate-limit can
// identify clients by their real IP and Express returns the right req.ip /
// req.protocol. Without this, rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// every minute and may misclassify all clients as the proxy.
app.set('trust proxy', 1);

app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.use('/api', rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));

// ── Public endpoints ─────────────────────────────────────────────────────────
// /api/health is intentionally unauthenticated — monitoring, pm2 keep-alive,
// and nginx health checks all hit it. Declared before requireAuth.
app.get('/api/health', (req, res) => {
  res.json({
    status:       'ok',
    ai_provider:  process.env.AI_PROVIDER || 'gemini',
    has_gemini:   !!process.env.GEMINI_API_KEY   && process.env.GEMINI_API_KEY   !== 'your_gemini_key_here',
    has_openai:   !!process.env.OPENAI_API_KEY,
    has_apify:    !!process.env.APIFY_API_TOKEN  && process.env.APIFY_API_TOKEN  !== 'your_apify_token_here',
    has_apollo:   !!process.env.APOLLO_API_KEY   && process.env.APOLLO_API_KEY   !== 'your_apollo_key_here',
    has_serper:   !!process.env.SERPER_API_KEY,
    has_hunter:   !!process.env.HUNTER_API_KEY,
    has_prospeo:  !!process.env.PROSPEO_API_KEY,
    has_linkedin: !!process.env.LINKEDIN_SESSION_COOKIE && process.env.LINKEDIN_SESSION_COOKIE !== 'your_li_at_cookie_here',
    auth_mode:    process.env.AUTH_MODE || 'enforce',
    nightly_cron_disabled: !!process.env.NIGHTLY_CRON_DISABLED,
  });
});

// ── Auth middleware for everything else under /api ──────────────────────────
// Controlled by AUTH_MODE env var. See backend/middleware/requireAuth.js.
app.use('/api', requireAuth);

app.use('/api/companies',  companiesRouter);
app.use('/api/contacts',   contactsRouter);
app.use('/api/emails',     emailsRouter);
app.use('/api/generate',   generateRouter);
app.use('/api/prospects',  prospectsRouter);
app.use('/api/jobs',       jobsRouter);
app.use('/api/jobs',       internRolesRouter);
app.use('/api/unified',    unifiedRouter);
app.use('/api/credits',    creditsRouter);
app.use('/api/jobs',       importSheetRouter);
app.use('/api/career',    careerOpsRouter);
app.use('/api/automations', automationsRouter);
app.use('/api/yc',         ycRouter);
app.use('/api/scraped-roles', scrapedRolesRouter);
app.use('/api/alerts',     alertsRouter);

// ── Manual refresh endpoint (SSE) ────────────────────────────────────────────
app.post('/api/jobs/refresh-all', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });

  function emit(event, data) {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    emit('progress', { message: 'Starting full refresh...' });
    await runDailyRefresh(req.user.id, msg => emit('progress', { message: msg }));
    emit('complete', { message: 'Refresh complete!' });
    if (!closed) res.end();
  } catch (err) {
    emit('error', { error: err.message });
    if (!closed) res.end();
  }
});

// ── Last refresh time endpoint ────────────────────────────────────────────────
app.get('/api/jobs/last-refresh', async (req, res) => {
  try {
    const row = await one(
      "SELECT value FROM meta WHERE key = 'lastRefresh' AND user_id = $1",
      [req.user.id]
    );
    res.json({ lastRefresh: row?.value || null });
  } catch (err) {
    res.json({ lastRefresh: null });
  }
});

// ── Stats endpoint ────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    // Was 10 sequential one-counter-per-query SELECTs (~10 round-trips
    // worth of latency, each scanning the same tables independently).
    // Collapsed to 6 queries running in parallel: each table scanned at
    // most once with COUNT(*) FILTER clauses doing the per-status math
    // in-aggregate.
    const [jobsAgg, jcAgg, outreachAgg, srcAgg, appsRow, metaRow] = await Promise.all([
      one(`SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE yc_batch IS NOT NULL AND yc_batch != '')::int AS yc_imported
           FROM jobs WHERE user_id = $1`, [req.user.id]),
      one(`SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE email IS NOT NULL AND email != '')::int AS with_email,
             COUNT(*) FILTER (WHERE linkedin_url IS NOT NULL AND linkedin_url != '')::int AS with_linkedin
           FROM job_contacts WHERE user_id = $1`, [req.user.id]),
      one(`SELECT
             COUNT(*) FILTER (WHERE status = 'sent')::int    AS sent,
             COUNT(*) FILTER (WHERE status = 'replied')::int AS replied
           FROM outreach WHERE user_id = $1`, [req.user.id]),
      // Source-distinct count needs LATERAL unnest — keep separate but
      // still parallel.
      one(`SELECT COUNT(DISTINCT trim(src))::int AS n
           FROM jobs
           CROSS JOIN LATERAL unnest(string_to_array(source, ',')) AS s(src)
           WHERE source IS NOT NULL AND source != '' AND trim(s.src) != '' AND user_id = $1`, [req.user.id]),
      one(`SELECT COUNT(*)::int AS n FROM company_applications
             WHERE status != 'interested' AND user_id = $1`, [req.user.id]).catch(() => null),
      one("SELECT value FROM meta WHERE user_id = $1 AND key = 'last_scrape_summary'", [req.user.id]).catch(() => null),
    ]);

    const totalSent    = outreachAgg?.sent    || 0;
    const totalReplied = outreachAgg?.replied || 0;
    let lastScrape = null;
    if (metaRow?.value) {
      try { lastScrape = JSON.parse(metaRow.value); } catch (_) {}
    }

    res.json({
      totalCompanies:        jobsAgg?.total       || 0,
      totalContacts:         jcAgg?.total         || 0,
      contactsWithEmail:     jcAgg?.with_email    || 0,
      totalLinkedInContacts: jcAgg?.with_linkedin || 0,
      totalSent,
      responseRate: totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0,
      activeSources:    srcAgg?.n              || 0,
      ycImported:       jobsAgg?.yc_imported    || 0,
      totalApplications: appsRow?.n             || 0,
      lastScrape,
    });
  } catch (err) {
    console.error('[stats]', err);
    res.json({ totalCompanies: 0, totalContacts: 0, contactsWithEmail: 0, totalLinkedInContacts: 0, totalSent: 0, responseRate: 0, activeSources: 0 });
  }
});

// ── Job Dashboard aggregate metrics ───────────────────────────────────────────
app.get('/api/dashboard/job-metrics', async (req, res) => {
  try {
    const uid = req.user.id;
    // Previously 18 separate COUNT queries scanning the same tables over and
    // over (~N × index-scan per page load). Collapsed to 3 aggregate queries
    // using FILTER clauses — one per tracked table.
    const [jcAgg, evalAgg, jobsAgg, gradeDistRows, topOutreachCompanies, recentEvals, recentApplied] = await Promise.all([
      // job_contacts: 6 counters rolled into one scan.
      one(`SELECT
             COUNT(*)::int                                                           AS total,
             COUNT(*) FILTER (WHERE email IS NOT NULL AND email != '')::int           AS with_email,
             COUNT(*) FILTER (WHERE linkedin_url IS NOT NULL AND linkedin_url != '')::int AS with_linkedin,
             COUNT(*) FILTER (WHERE generated_subject IS NOT NULL OR generated_dm IS NOT NULL)::int AS outreach_generated,
             COUNT(*) FILTER (WHERE status IN ('sent','dm_sent','email_sent'))::int  AS outreach_sent,
             COUNT(*) FILTER (WHERE status = 'replied')::int                          AS outreach_replied
           FROM job_contacts WHERE user_id = $1`, [uid]),
      // evaluations: 10 counters rolled into one scan.
      one(`SELECT
             COUNT(*)::int                                                                                    AS total,
             COUNT(*) FILTER (WHERE apply_status IS NULL OR apply_status = 'not_started')::int                AS funnel_evaluated,
             COUNT(*) FILTER (WHERE apply_status IN ('opened','queued','submitted'))::int                     AS funnel_applied,
             COUNT(*) FILTER (WHERE apply_status = 'submitted')::int                                          AS funnel_submitted,
             COUNT(*) FILTER (WHERE apply_status = 'responded')::int                                          AS funnel_responded,
             COUNT(*) FILTER (WHERE apply_status = 'interview')::int                                          AS funnel_interview,
             COUNT(*) FILTER (WHERE apply_status = 'offer')::int                                              AS funnel_offer,
             COUNT(*) FILTER (WHERE apply_status = 'rejected')::int                                           AS funnel_rejected,
             COUNT(*) FILTER (WHERE apply_mode = 'manual' AND apply_status IS NOT NULL AND apply_status != 'not_started')::int AS mode_manual,
             COUNT(*) FILTER (WHERE apply_mode = 'auto'   AND apply_status IS NOT NULL AND apply_status != 'not_started')::int AS mode_auto
           FROM evaluations WHERE user_id = $1`, [uid]),
      // jobs: just total companies (1 counter, kept separate since jobs table
      // is by far the largest and we don't want to pollute its scan with
      // unrelated filters).
      one("SELECT COUNT(*)::int AS total FROM jobs WHERE user_id = $1", [uid]),
      all("SELECT grade, COUNT(*)::int AS n FROM evaluations WHERE grade IS NOT NULL AND user_id = $1 GROUP BY grade", [uid]),
      // "Where your outreach effort went" — UNIONs activity from THREE
      // sources so a company appearing in any of them shows up:
      //   1. jobs + job_contacts → contacts found / outreach sent / replies
      //   2. evaluations.company_name → CareerOps work (URL-evaluated roles
      //      whose company doesn't have a matching jobs row)
      //   3. company_applications → explicitly-tracked applications
      // Companies are matched case-insensitively across sources, then ranked
      // by total activity (sent + replied weighted heaviest, then evals,
      // then contacts).
      all(`
        WITH activity AS (
          SELECT
            LOWER(TRIM(j.name)) AS k,
            j.name AS name, j.category AS category,
            COUNT(jc.id)::int AS contact_count,
            SUM(CASE WHEN jc.email IS NOT NULL AND jc.email != '' THEN 1 ELSE 0 END)::int AS email_count,
            SUM(CASE WHEN jc.status IN ('sent','dm_sent','email_sent') THEN 1 ELSE 0 END)::int AS sent_count,
            SUM(CASE WHEN jc.status = 'replied' THEN 1 ELSE 0 END)::int AS replied_count,
            0::int AS eval_count,
            0::int AS app_count
          FROM jobs j LEFT JOIN job_contacts jc ON jc.job_id = j.id AND jc.user_id = $1
          WHERE j.user_id = $1
          GROUP BY j.id, j.name, j.category

          UNION ALL

          SELECT
            LOWER(TRIM(e.company_name)) AS k,
            MAX(e.company_name) AS name, NULL AS category,
            0, 0, 0, 0,
            COUNT(*)::int AS eval_count,
            0
          FROM evaluations e
          WHERE e.user_id = $1 AND e.company_name IS NOT NULL AND e.company_name != ''
          GROUP BY LOWER(TRIM(e.company_name))

          UNION ALL

          SELECT
            LOWER(TRIM(j.name)) AS k,
            j.name AS name, j.category AS category,
            0, 0, 0, 0, 0,
            COUNT(ca.id)::int AS app_count
          FROM company_applications ca JOIN jobs j ON j.id = ca.company_id AND j.user_id = $1
          WHERE ca.user_id = $1
          GROUP BY j.id, j.name, j.category
        )
        SELECT
          MAX(name) AS name,
          MAX(category) AS category,
          SUM(contact_count)::int  AS contact_count,
          SUM(email_count)::int    AS email_count,
          SUM(sent_count)::int     AS sent_count,
          SUM(replied_count)::int  AS replied_count,
          SUM(eval_count)::int     AS eval_count,
          SUM(app_count)::int      AS app_count
        FROM activity
        WHERE k IS NOT NULL AND k <> ''
        GROUP BY k
        HAVING SUM(contact_count) + SUM(eval_count) + SUM(app_count) > 0
        ORDER BY
          (SUM(replied_count)*20 + SUM(sent_count)*10 + SUM(app_count)*5 + SUM(eval_count)*3 + SUM(contact_count)) DESC,
          MAX(name)
        LIMIT 15
      `, [uid]),
      all(`
        -- DISTINCT ON (job_url) keeps only the most recent evaluation per
        -- unique posting; otherwise repeated Track actions surface the same
        -- role (e.g. "Intern as Software Developer" × 3) on the dashboard.
        -- Rows without a job_url fall back to evaluation id so untracked
        -- evaluations still show.
        SELECT * FROM (
          SELECT DISTINCT ON (COALESCE(NULLIF(job_url, ''), id::text))
            'evaluation' AS kind, id, company_name, job_title, grade, created_at,
            COALESCE(NULLIF(job_url, ''), id::text) AS dedup_key
          FROM evaluations WHERE user_id = $1
          ORDER BY COALESCE(NULLIF(job_url, ''), id::text), created_at DESC
        ) deduped ORDER BY created_at DESC LIMIT 10
      `, [uid]),
      all(`
        SELECT 'applied' AS kind, id, company_name, job_title, apply_status, applied_at
        FROM evaluations WHERE applied_at IS NOT NULL AND user_id = $1 ORDER BY applied_at DESC LIMIT 10
      `, [uid]),
    ]);

    // Unpack into the same shape downstream code expects.
    const totalCompaniesR      = { n: jobsAgg?.total      || 0 };
    const totalEvaluationsR    = { n: evalAgg?.total      || 0 };
    const totalContactsR       = { n: jcAgg?.total        || 0 };
    const contactsWithEmailR   = { n: jcAgg?.with_email   || 0 };
    const contactsWithLinkedInR= { n: jcAgg?.with_linkedin || 0 };
    const outreachGeneratedR   = { n: jcAgg?.outreach_generated || 0 };
    const outreachSentR        = { n: jcAgg?.outreach_sent || 0 };
    const outreachRepliedR     = { n: jcAgg?.outreach_replied || 0 };
    const funnelEvaluatedR     = { n: evalAgg?.funnel_evaluated || 0 };
    const funnelAppliedR       = { n: evalAgg?.funnel_applied   || 0 };
    const funnelSubmittedR     = { n: evalAgg?.funnel_submitted || 0 };
    const funnelRespondedR     = { n: evalAgg?.funnel_responded || 0 };
    const funnelInterviewR     = { n: evalAgg?.funnel_interview || 0 };
    const funnelOfferR         = { n: evalAgg?.funnel_offer     || 0 };
    const funnelRejectedR      = { n: evalAgg?.funnel_rejected  || 0 };
    const modeManualR          = { n: evalAgg?.mode_manual      || 0 };
    const modeAutoR            = { n: evalAgg?.mode_auto        || 0 };

    const appFunnel = {
      evaluated: funnelEvaluatedR?.n || 0,
      applied:   funnelAppliedR?.n || 0,
      submitted: funnelSubmittedR?.n || 0,
      responded: funnelRespondedR?.n || 0,
      interview: funnelInterviewR?.n || 0,
      offer:     funnelOfferR?.n || 0,
      rejected:  funnelRejectedR?.n || 0,
    };
    const applyModes = {
      manual: modeManualR?.n || 0,
      auto:   modeAutoR?.n || 0,
    };
    const gradeDist = (gradeDistRows || []).reduce(
      (acc, r) => { acc[r.grade] = r.n; return acc; },
      { A: 0, B: 0, C: 0, D: 0, F: 0 }
    );

    const outreachSent = outreachSentR?.n || 0;
    const outreachReplied = outreachRepliedR?.n || 0;
    const totalEvaluations = totalEvaluationsR?.n || 0;
    const responseRate = outreachSent > 0 ? Math.round((outreachReplied / outreachSent) * 100) : 0;
    const applyRate    = totalEvaluations > 0 ? Math.round((appFunnel.applied / totalEvaluations) * 100) : 0;

    res.json({
      summary: {
        totalCompanies: totalCompaniesR?.n || 0,
        totalEvaluations,
        totalContacts: totalContactsR?.n || 0,
        contactsWithEmail: contactsWithEmailR?.n || 0,
        contactsWithLinkedIn: contactsWithLinkedInR?.n || 0,
        outreachGenerated: outreachGeneratedR?.n || 0,
        outreachSent,
        outreachReplied,
        responseRate,
        applyRate,
      },
      applyFunnel: appFunnel,
      applyModes,
      gradeDist,
      topOutreachCompanies,
      recentEvals,
      recentApplied,
    });
  } catch (err) {
    console.error('[job-metrics]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Activity feed endpoint ────────────────────────────────────────────────────
app.get('/api/activity', async (req, res) => {
  try {
    const rows = await all(
      'SELECT * FROM activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [req.user.id]
    );
    res.json({ activity: rows });
  } catch (err) {
    res.json({ activity: [] });
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message });
});

// ── Daily refresh logic ───────────────────────────────────────────────────────
// userId scopes the per-user state reads/writes (subcategory list, meta upsert,
// startup-sheet import). Cron passes null for now — see TODO below.
async function runDailyRefresh(userId, onProgress = null) {
  function log(msg) {
    console.log('[DailyRefresh]', msg);
    if (onProgress) onProgress(msg);
  }

  log('Daily refresh starting — ' + new Date().toISOString());

  // 1. Re-scrape previously-scraped subcategories
  try {
    // TODO(auth): source of userId — cron has none; when userId is null we
    // fall back to a union across all users' jobs so the scraper still picks
    // up representative subcategories. Once a multi-tenant scheduler exists
    // this should iterate per user instead.
    const subs = userId
      ? await all(`
          SELECT category, subcategory, COUNT(*)::int AS count
          FROM jobs
          WHERE source NOT IN ('startup_sheet') AND subcategory IS NOT NULL AND user_id = $1
          GROUP BY category, subcategory
          HAVING COUNT(*) > 2
          LIMIT 20
        `, [userId])
      : await all(`
          SELECT category, subcategory, COUNT(*)::int AS count
          FROM jobs
          WHERE source NOT IN ('startup_sheet') AND subcategory IS NOT NULL
          GROUP BY category, subcategory
          HAVING COUNT(*) > 2
          LIMIT 20
        `);

    log(`Refreshing ${subs.length} subcategories...`);
    for (const sub of subs) {
      try {
        log(`Scraping: ${sub.category} > ${sub.subcategory}`);
        await scrapeAllSources(sub.subcategory, sub.category);
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        log(`Failed: ${sub.subcategory} — ${err.message}`);
      }
    }
  } catch (err) {
    log('Subcategory refresh failed: ' + err.message);
  }

  // 2. Re-import startup sheet
  if (process.env.STARTUP_SHEET_URL && userId) {
    try {
      log('Refreshing startup sheet...');
      await importStartupSheet(userId, msg => log(msg));
    } catch (err) {
      log('Startup sheet refresh failed: ' + err.message);
    }
  } else if (process.env.STARTUP_SHEET_URL) {
    // TODO(auth): source of userId — cron-triggered refresh skips the startup
    // sheet import until we have a way to attribute new rows to a user.
    log('Skipping startup sheet refresh: no userId in cron context');
  }

  // 3. Reclassify unclassified companies (per-user only)
  if (userId) {
    try {
      log('Reclassifying unclassified companies...');
      await runReclassifyUnclassified(userId);
    } catch (err) {
      log('Reclassify failed: ' + err.message);
    }
  } else {
    log('Skipping reclassify: no userId in cron context');
  }

  // 4. Refresh credit status cache
  try {
    await checkAllCredits(true);
    log('Credit status refreshed');
  } catch (err) {
    log('Credit check failed: ' + err.message);
  }

  // 5. Record last refresh time (upsert) — user-scoped meta key
  if (userId) {
    await run(
      "INSERT INTO meta (key, value, user_id) VALUES ('lastRefresh', $1, $2) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value",
      [new Date().toISOString(), userId],
    );
  }
  log('Daily refresh complete — ' + new Date().toISOString());
}

// ── Cron: run every day at 6 AM UTC ──────────────────────────────────────────
// TODO(auth): source of userId — the cron has no request context. For now we
// call runDailyRefresh(null) which skips per-user writes; a multi-tenant
// scheduler should iterate over active users and invoke this once per user.
cron.schedule('0 6 * * *', () => {
  if (process.env.NIGHTLY_CRON_DISABLED) {
    console.log('[Cron] Daily refresh skipped — NIGHTLY_CRON_DISABLED is set');
    return;
  }
  runDailyRefresh(null).catch(err => console.error('[Cron] Daily refresh FAILED:', err.message));
});

// ── Cron: daily multi-source scraped-roles refresh (06:15 UTC) ───────────────
// Hits every supported source (Greenhouse / Lever / Ashby / LinkedIn /
// Wellfound / ai_jobs / Jobspresso / Remote Rocketship / InternshipDaily) and
// upserts into public.scraped_roles. Shared across all users; kill switch
// `MULTI_SCRAPE_DISABLED` (separate from NIGHTLY_CRON_DISABLED so you can
// pause auto-apply without losing fresh role discovery).
cron.schedule('15 6 * * *', async () => {
  if (process.env.MULTI_SCRAPE_DISABLED) {
    console.log('[multi-scrape] skipped — MULTI_SCRAPE_DISABLED is set');
    return;
  }
  if (process.env.NIGHTLY_CRON_DISABLED) {
    console.log('[multi-scrape] skipped — NIGHTLY_CRON_DISABLED is set');
    return;
  }
  try {
    console.log('[multi-scrape] starting daily multi-source role scrape');
    const summary = await scrapeAllSourcesAndPersist();
    const perSrc = Object.entries(summary.perSource)
      .map(([k, v]) => `${k}=intern:${v.intern}/grad:${v.new_grad}`)
      .join(' ');
    console.log(`[multi-scrape] done — total=${summary.total} ${perSrc}`);
    if (Object.keys(summary.errors).length) {
      console.warn(`[multi-scrape] errors: ${JSON.stringify(summary.errors).slice(0, 500)}`);
    }
  } catch (err) {
    console.error('[multi-scrape] dispatcher failed:', err.message);
  }
});

// ── Cron: nightly auto-apply pipeline at 07:00 UTC (≈2am Central) ────────────
// Runs scan → evaluate → fit-filter (score ≥ minScore) → queue → submit for
// every user who has nightly_pipeline_settings.enabled=true. Honors per-user
// settings: roleType, minScore, maxApps, useLibraryResume. The pipeline body
// lives in routes/careerOps.js but the cron context has no req object, so we
// call the underlying services directly via runNightlyPipelineForUser
// (imported at top of file). Skipped silently if user has no resume or no
// settings row at all.
import { runNightlyPipelineForUser } from './services/nightlyPipeline.js';
cron.schedule('0 7 * * *', async () => {
  if (process.env.NIGHTLY_CRON_DISABLED) {
    console.log('[nightly-cron] skipped — NIGHTLY_CRON_DISABLED is set');
    return;
  }
  try {
    const users = await all(
      `SELECT user_id, value FROM meta WHERE key = 'nightly_pipeline_settings'`
    );
    for (const u of users) {
      try {
        const cfg = u.value ? JSON.parse(u.value) : {};
        if (!cfg.enabled) continue;
        console.log(`[nightly-cron] starting pipeline for user ${u.user_id}`);
        const summary = await runNightlyPipelineForUser(u.user_id, cfg);
        console.log(`[nightly-cron] user ${u.user_id} — applied=${summary.applied} fits=${summary.fits} needsReview=${summary.needsReview}`);
      } catch (e) { console.error(`[nightly-cron] user ${u.user_id} failed:`, e.message); }
    }
  } catch (err) { console.error('[nightly-cron] dispatcher failed:', err.message); }
});

// ── Cron: job-alert digests at 08:00 UTC (after the 06:15 scrape) ────────────
// Fans out to every subscriber (meta['job_alert_subscription']). Daily subs get
// a 24h window every day; weekly subs get a 7d window on Mondays only.
// Skipped when email isn't configured or DIGEST_CRON_DISABLED is set.
cron.schedule('0 8 * * *', async () => {
  if (process.env.DIGEST_CRON_DISABLED) {
    console.log('[digest-cron] skipped — DIGEST_CRON_DISABLED is set');
    return;
  }
  if (!mailerConfigured()) {
    console.log('[digest-cron] skipped — email not configured (GMAIL_USER / GMAIL_APP_PASSWORD)');
    return;
  }
  try {
    const daily = await runSubscriptionDigests({ weekly: false });
    let weekly = null;
    if (new Date().getUTCDay() === 1) weekly = await runSubscriptionDigests({ weekly: true }); // Mondays
    console.log(`[digest-cron] daily ${JSON.stringify(daily)}${weekly ? ` · weekly ${JSON.stringify(weekly)}` : ''}`);
  } catch (err) {
    console.error('[digest-cron] failed:', err.message);
  }
});

// ── DB wipe on start (one-shot, auto-disables itself) ────────────────────────
// NOTE: wipe is a dev-only bootstrap; it intentionally clears all rows across
// all users and is gated by WIPE_DB_ON_START=true.
async function maybeWipeDb() {
  if (process.env.WIPE_DB_ON_START !== 'true') return;
  try {
    await run('DELETE FROM job_contacts');
    await run('DELETE FROM jobs');
    await run('DELETE FROM prospects');
    await run('DELETE FROM contacts');
    await run('DELETE FROM outreach');
    await run('DELETE FROM companies');
    await run('DELETE FROM meta');
    console.log('[WIPE_DB] All tables wiped.');
    // Flip the flag to false so it never runs again on next restart
    const envPath = path.join(__dirname, '..', '.env');
    const fs = await import('fs');
    const content = fs.default.readFileSync(envPath, 'utf8');
    fs.default.writeFileSync(envPath, content.replace(/^WIPE_DB_ON_START=true/m, 'WIPE_DB_ON_START=false'));
    console.log('[WIPE_DB] Flag auto-disabled in .env');
  } catch (err) {
    console.error('[WIPE_DB] Failed:', err.message);
  }
}

const PORT = process.env.PORT || 3001;

async function startup() {
  await pingDb();
  await maybeWipeDb();

  app.listen(PORT, () => {
    console.log(`Backend on port ${PORT}`);
    // Per-user reclassification now runs on demand via /api/jobs/reclassify-unclassified
    // and as part of the daily refresh job (when a userId is supplied). The previous
    // global startup pass mutated all users' jobs, so it has been removed.
  });
}

startup().catch(err => {
  console.error('[startup] FATAL:', err);
  process.exit(1);
});

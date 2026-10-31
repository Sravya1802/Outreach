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
// The .env file is the source of truth. override: a process manager can hold a
// stale copy of a variable from when it was first started (pm2 kept a revoked
// OpenAI key this way), and dotenv would otherwise keep that old value.
config({ path: path.join(__dirname, '..', '.env'), override: true });
validateConfig();

import companiesRouter  from './routes/companies.js';
import generateRouter   from './routes/generate.js';
import prospectsRouter  from './routes/prospects.js';
import db, { one, all, run, pingDb } from './db.js';
import jobsRouter from './routes/jobs.js';
import internRolesRouter from './routes/internRoles.js';
import unifiedRouter    from './routes/unified.js';
import creditsRouter    from './routes/credits.js';
import importSheetRouter from './routes/importSheet.js';
import careerOpsRouter   from './routes/careerOps.js';
import automationsRouter  from './routes/automations.js';
import ycRouter           from './routes/yc.js';
import scrapedRolesRouter from './routes/scrapedRoles.js';
import alertsRouter        from './routes/alerts.js';
import profileRouter from './routes/profile.js';
import githubRouter, { githubCallback } from './routes/github.js';
import whatsappRouter, { webhookVerify as whatsappWebhookVerify, webhookReceive as whatsappWebhookReceive } from './routes/whatsapp.js';
import resumeEngineRouter from './routes/resumeEngine.js';
import gmailRouter from './routes/gmail.js';
import dailyPlanRouter from './routes/dailyPlan.js';
import messagesRouter from './routes/messages.js';
import trackerRouter from './routes/tracker.js';
import { addMissingNotes } from './services/referralFlow.js';
import { buildPlan, getSettings as getPlanSettings, localDate, tick as dailyPlanTick } from './services/dailyPlan.js';
import { pumpBatches as pumpResumeBatches } from './services/resumeEngine.js';
import { suggestProjectsForAll } from './services/projectIdeas.js';
import { retryWaiting as retryWhatsapp } from './services/whatsapp.js';
import { runOutbox } from './services/outbox.js';
import { checkAllInboxes } from './services/replyWatcher.js';
import { marketFor, regionForMarket } from './services/markets.js';
import { requestContext } from './services/requestContext.js';
import { requireAuth }    from './middleware/requireAuth.js';
import { installAsyncSafety } from './middleware/asyncSafe.js';
import { APPLIED, RESPONDED, INTERVIEW, IN_FLIGHT, FAILED, OUTREACH_SENT, OUTREACH_REPLIED, sqlList } from './services/applyStatus.js';
import { scrapeAllSources } from './services/scraper.js';
import { scrapeAllSourcesAndPersist, syncSpeedyApply } from './services/multiSourceScraper.js';
import { enrichPostedPay } from './services/payEnricher.js';
import { runSubscriptionDigests } from './services/dailyDigest.js';
import { mailerConfigured } from './services/mailer.js';

const app = express();

// ── CORS — allow local dev + configured production frontend origin(s) ──────
// Single origin: set FRONTEND_ORIGIN=https://scoutnjobs.vercel.app
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
// Keep the raw body for webhooks that sign it (WhatsApp).
app.use(express.json({ limit: '10mb', verify: (req, _res, buf) => { if (req.originalUrl?.startsWith('/api/whatsapp/webhook')) req.rawBody = buf; } }));

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
    has_groq:     !!process.env.GROQ_API_KEY,
    has_anthropic: !!process.env.ANTHROPIC_API_KEY,
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

// GitHub's OAuth redirect lands with no app session; the signed `state`
// parameter identifies the user instead.
app.get('/api/github/callback', githubCallback);
app.get('/api/whatsapp/webhook', whatsappWebhookVerify);
app.post('/api/whatsapp/webhook', whatsappWebhookReceive);

// ── Auth middleware for everything else under /api ──────────────────────────
// Controlled by AUTH_MODE env var. See backend/middleware/requireAuth.js.
app.use('/api', requireAuth);
// The signed-in user rides along with the request, so AI calls deep in any
// service are metered against the right account (services/llm.js).
app.use('/api', requestContext);

app.use('/api/companies',  companiesRouter);
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
app.use('/api/profile',    profileRouter);
app.use('/api/github',     githubRouter);
app.use('/api/resume-engine', resumeEngineRouter);
app.use('/api/gmail', gmailRouter);
app.use('/api/daily-plan', dailyPlanRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/tracker', trackerRouter);


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
      // Sent / replied live in the active pipeline tables (job_contacts +
      // prospects), NOT the legacy `outreach` table — reading outreach made
      // these read ~0 on the dashboard (#1a).
      one(`SELECT
             ((SELECT COUNT(*) FROM job_contacts WHERE status IN ${sqlList(OUTREACH_SENT)} AND user_id = $1) +
              (SELECT COUNT(*) FROM prospects    WHERE status IN ${sqlList(OUTREACH_SENT)} AND user_id = $1))::int AS sent,
             ((SELECT COUNT(*) FROM job_contacts WHERE status IN ${sqlList(OUTREACH_REPLIED)} AND user_id = $1) +
              (SELECT COUNT(*) FROM prospects    WHERE status IN ${sqlList(OUTREACH_REPLIED)} AND user_id = $1))::int AS replied`, [req.user.id]),
      // Source-distinct count needs LATERAL unnest — keep separate but
      // still parallel.
      one(`SELECT COUNT(DISTINCT trim(src))::int AS n
           FROM jobs
           CROSS JOIN LATERAL unnest(string_to_array(source, ',')) AS s(src)
           WHERE source IS NOT NULL AND source != '' AND trim(s.src) != '' AND user_id = $1`, [req.user.id]),
      // "Evaluated" = roles actually scored (the evaluations table that feeds
      // the auto-apply queue), not the separate company_applications tracker —
      // that's why it read 0 despite items being queued (#1a).
      one(`SELECT COUNT(*)::int AS n FROM evaluations WHERE user_id = $1`, [req.user.id]).catch(() => null),
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
             COUNT(*) FILTER (WHERE status IN ${sqlList(OUTREACH_SENT)})::int    AS outreach_sent,
             COUNT(*) FILTER (WHERE status IN ${sqlList(OUTREACH_REPLIED)})::int AS outreach_replied
           FROM job_contacts WHERE user_id = $1`, [uid]),
      // evaluations: 10 counters rolled into one scan.
      one(`SELECT
             COUNT(*)::int                                                                                    AS total,
             COUNT(*)::int                                                                                    AS funnel_evaluated,
             -- "Applied" = actually sent to the employer; queued/opened rows are in flight, not applied.
             COUNT(*) FILTER (WHERE apply_status IN ${sqlList(APPLIED)})::int   AS funnel_applied,
             COUNT(*) FILTER (WHERE apply_status IN ${sqlList(APPLIED)})::int   AS funnel_submitted,
             COUNT(*) FILTER (WHERE apply_status IN ${sqlList(IN_FLIGHT)})::int AS funnel_in_flight,
             COUNT(*) FILTER (WHERE apply_status IN ${sqlList(FAILED)})::int    AS funnel_failed,
             COUNT(*) FILTER (WHERE apply_status IN ${sqlList(RESPONDED)})::int AS funnel_responded,
             COUNT(*) FILTER (WHERE apply_status IN ${sqlList(INTERVIEW)})::int AS funnel_interview,
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
            'evaluation' AS kind, id, company_name, job_title, grade, apply_status, created_at,
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
      inFlight:  evalAgg?.funnel_in_flight || 0,
      failed:    evalAgg?.funnel_failed || 0,
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

// ── Daily updates — fresh scraped roles (last 24h) + career-ops activity (#1e) ─
app.get('/api/dashboard/daily-updates', async (req, res) => {
  try {
    const uid = req.user.id;
    const region = regionForMarket(await marketFor(uid));
    // scraped_roles is a shared catalog (no user_id). "Today" = scraped in last 24h,
    // in the user's own market.
    let internToday = 0, newGradToday = 0, internRecent = [], newGradRecent = [];
    try {
      const counts = await all(`
        SELECT role_type, COUNT(*)::int AS n
        FROM scraped_roles
        WHERE is_active = 1 AND region = $1 AND scraped_at > NOW() - INTERVAL '1 day'
        GROUP BY role_type
      `, [region]);
      for (const r of counts) {
        if (r.role_type === 'new_grad') newGradToday = r.n; else internToday = r.n;
      }
      // Fetch the recent list PER role type — a shared LIMIT got crowded out by
      // whichever type was scraped last, leaving the other card empty despite a
      // non-zero count.
      [internRecent, newGradRecent] = await Promise.all([
        all(`SELECT title, company_name, apply_url FROM scraped_roles
             WHERE is_active = 1 AND role_type = 'intern'   AND region = $1 AND scraped_at > NOW() - INTERVAL '1 day'
             ORDER BY scraped_at DESC LIMIT 5`, [region]),
        all(`SELECT title, company_name, apply_url FROM scraped_roles
             WHERE is_active = 1 AND role_type = 'new_grad' AND region = $1 AND scraped_at > NOW() - INTERVAL '1 day'
             ORDER BY scraped_at DESC LIMIT 5`, [region]),
      ]);
    } catch (_) {}

    // Career-ops activity (per-user).
    let careerOps = { evaluatedToday: 0, queued: 0, totalEvaluations: 0 };
    try {
      const c = await one(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')::int            AS evaluated_today,
          COUNT(*) FILTER (WHERE apply_mode = 'auto' AND apply_status = 'queued')::int  AS queued,
          COUNT(*)::int                                                                 AS total
        FROM evaluations WHERE user_id = $1
      `, [uid]);
      if (c) careerOps = { evaluatedToday: c.evaluated_today || 0, queued: c.queued || 0, totalEvaluations: c.total || 0 };
    } catch (_) {}

    res.json({
      intern:  { today: internToday,  recent: internRecent },
      newGrad: { today: newGradToday, recent: newGradRecent },
      careerOps,
    });
  } catch (err) {
    console.error('[daily-updates]', err);
    res.json({ intern: { today: 0, recent: [] }, newGrad: { today: 0, recent: [] }, careerOps: { evaluatedToday: 0, queued: 0, totalEvaluations: 0 } });
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

// Every route above is registered by now: make rejected async handlers reach
// the error handler below instead of crashing the process.
installAsyncSafety(app);

// Unknown API routes get JSON (and a log line) instead of Express's HTML page.
app.use('/api', (req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl.split('?')[0]}`);
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

app.use((err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.originalUrl.split('?')[0]}:`, err.stack || err);
  if (res.headersSent) return res.end(); // e.g. mid-SSE stream
  // Multer upload limits / filters are client errors, not 500s.
  const status = err.status || err.statusCode || (err.name === 'MulterError' ? 400 : 500);
  res.status(status).json({ error: err.message || 'Internal error' });
});

// Last-resort logging. A rejection is logged and the process keeps serving;
// an uncaught exception leaves state unknown, so log and let pm2 restart us.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.stack || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack || err);
  process.exit(1);
});

// The old 06:00 "daily refresh" cron re-ran every Apify scraper for up to 20
// categories pooled across all users and threw the results away (cron has no
// user to save them for) — ~100 paid actor runs a day for nothing. Removed;
// role discovery is the 06:15 multi-source scrape below.

// Crons run in UTC regardless of the VM's timezone, and a run that's still
// going when the next one fires is skipped rather than doubled.
const CRON_OPTS = { timezone: 'Etc/UTC', noOverlap: true };

// Outreach email: send what's due every 2 minutes; read replies every 10.
cron.schedule('*/2 * * * *', async () => {
  try {
    const r = await runOutbox();
    if (r.sent) console.log(`[outbox] sent ${r.sent} of ${r.due} due`);
  } catch (err) { console.error('[outbox] pass failed:', err.message); }
}, CRON_OPTS);
// Daily plan: build lists an hour before each user's list time, email at list time, move approved roles on.
cron.schedule('*/5 * * * *', async () => {
  try {
    const r = await dailyPlanTick();
    if (r.built || r.emailed) console.log(`[daily-plan] built ${r.built}, emailed ${r.emailed}`);
  } catch (err) { console.error('[daily-plan] tick failed:', err.message); }
}, CRON_OPTS);
// Nightly resumes: send queued ones to Anthropic's batch API, pick up the finished ones.
cron.schedule('*/5 * * * *', async () => {
  try {
    const r = await pumpResumeBatches();
    if (r.collected || r.submitted || r.rechecked || r.raised) console.log(`[resume-batch] collected ${r.collected}, submitted ${r.submitted}, rechecked ${r.rechecked}, raised over the bar ${r.raised}`);
  } catch (err) { console.error('[resume-batch] pass failed:', err.message); }
}, CRON_OPTS);
// Projects to build, from the roles on each user's recent lists: Sundays, 9 AM Central.
cron.schedule('0 14 * * 0', async () => {
  try {
    const r = await suggestProjectsForAll();
    console.log(`[project-ideas] weekly: ${r.created} suggestions for ${r.users} users`);
  } catch (err) { console.error('[project-ideas] weekly failed:', err.message); }
}, CRON_OPTS);
// WhatsApp messages waiting on a template's approval: retried every 30 minutes for 3 days.
cron.schedule('*/30 * * * *', async () => {
  try {
    const r = await retryWhatsapp();
    if (r.sent) console.log(`[whatsapp] sent ${r.sent} waiting message(s)`);
  } catch (err) { console.error('[whatsapp] retry failed:', err.message); }
}, CRON_OPTS);
cron.schedule('*/10 * * * *', async () => {
  try {
    const r = await checkAllInboxes();
    if (r.events) console.log(`[replies] ${r.events} new across ${r.checked} inboxes`);
  } catch (err) { console.error('[replies] pass failed:', err.message); }
}, CRON_OPTS);

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
  await logPayEnrichment();
}, CRON_OPTS);

// Posted pay for new roles on Greenhouse / Ashby / Lever (public board APIs).
async function logPayEnrichment() {
  try {
    const r = await enrichPostedPay();
    console.log(`[details] ${r.boards} boards + ${r.postings} postings, checked ${r.checked}: pay ${r.pay}, sponsorship ${JSON.stringify(r.sponsorship)}${r.failed ? `, ${r.failed} failed` : ''}`);
  } catch (err) {
    console.error('[details] failed:', err.message);
  }
}

// ── Cron: SpeedyApply lists at 12:30 UTC ─────────────────────────────────────
// github.com/speedyapply regenerates its SWE + AI college-jobs lists daily at
// 12:00 UTC; pull them right after so the catalog has today's list.
cron.schedule('30 12 * * *', async () => {
  if (process.env.MULTI_SCRAPE_DISABLED || process.env.NIGHTLY_CRON_DISABLED) return;
  try {
    const r = await syncSpeedyApply();
    console.log(`[speedyapply-cron] ${r.repos.join(', ')} — parsed=${r.parsed} kept=${r.kept} written=${r.written}${r.files.some(f => f.error) ? ` errors=${JSON.stringify(r.files.filter(f => f.error))}` : ''}`);
  } catch (err) {
    console.error('[speedyapply-cron] failed:', err.message);
  }
  await logPayEnrichment();
}, CRON_OPTS);

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
}, CRON_OPTS);

// ── Cron: job-alert digests at 13:00 UTC (after the 12:30 SpeedyApply sync) ───
// Fans out to every subscriber (meta['job_alert_subscription']). Daily subs get
// a 24h window every day; weekly subs get a 7d window on Mondays only.
// Skipped when email isn't configured or DIGEST_CRON_DISABLED is set.
cron.schedule('0 13 * * *', async () => {
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
}, CRON_OPTS);

const PORT = process.env.PORT || 3001;

// A list build runs in this process, so a restart (every deploy) kills it and
// leaves the plan on 'building' with nothing left to finish it. Mark those failed
// (the page then offers Rebuild) and start today's over.
async function resumeInterruptedPlans() {
  const { rows } = await run(
    "UPDATE daily_plans SET status = 'failed', error = 'Interrupted by a server restart' WHERE status = 'building' RETURNING user_id, plan_date",
  );
  for (const p of rows) {
    try {
      const today = localDate((await getPlanSettings(p.user_id)).timezone);
      if (String(p.plan_date).slice(0, 10) !== today) continue;
      console.log(`[daily-plan] resuming interrupted build ${String(p.user_id).slice(0, 8)} ${today}`);
      await buildPlan(p.user_id);
    } catch (err) { console.error('[daily-plan] resume failed:', err.message); }
  }
}

async function startup() {
  await pingDb();
  resumeInterruptedPlans().catch(err => console.error('[daily-plan] resume pass failed:', err.message));
  // People emailed before LinkedIn notes were kept get theirs (template, once).
  addMissingNotes()
    .then(n => { if (n) console.log(`[referrals] added LinkedIn notes for ${n} emailed people`); })
    .catch(err => console.error('[referrals] note backfill failed:', err.message));

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

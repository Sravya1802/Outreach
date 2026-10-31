/**
 * /api/scraped-roles — read the global daily-scraped role catalog.
 *
 * GET    /api/scraped-roles?role_type=intern&source=&search=&year=2027[-or-unstated]&page=&pageSize=
 * POST   /api/scraped-roles/:id/track          — queue this role for the user (manual)
 * POST   /api/scraped-roles/:id/auto-apply     — queue this role for auto-apply
 * POST   /api/scraped-roles/refresh            — admin-only: trigger the cron pipeline now
 *
 * The catalog is shared across all users (no user_id on scraped_roles). The
 * "track" / "auto-apply" actions create per-user evaluations rows pointing at
 * the role's apply_url, mirroring the same flow as Companies → Auto-Apply.
 */

import { Router } from 'express';
import { all, one, run } from '../db.js';
import { scrapeAllSourcesAndPersist } from '../services/multiSourceScraper.js';
import { parseYearFilter, yearCondition, YEARS_SELECT } from '../services/gradYear.js';

const router = Router();

// Defensive filter — historical rows from before the scraper-side
// isEnglishTitle() check still live in scraped_roles. Drop anything whose
// title or company name contains CJK / Arabic / Cyrillic / Devanagari /
// Thai / Hangul characters at response time so the user never sees them.
const NON_LATIN_RE = /[Ѐ-ԯ؀-ۿऀ-ॿ฀-๿぀-ヿ㐀-䶿一-鿿가-힯]/;
function isEnglishRow(r) {
  const t = r.title || '';
  const c = r.company_name || '';
  if (!t) return false;
  if (NON_LATIN_RE.test(t)) return false;
  if (NON_LATIN_RE.test(c)) return false;
  return true;
}

// ── GET /api/scraped-roles ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const role_type = req.query.role_type === 'new_grad' ? 'new_grad' : 'intern';
    const source    = typeof req.query.source === 'string' ? req.query.source.slice(0, 40) : '';
    const tier      = ['faang', 'quant', 'other'].includes(req.query.tier) ? req.query.tier : '';
    const region    = ['intl', 'india'].includes(req.query.region) ? req.query.region : 'usa';
    const field     = ['swe', 'ai'].includes(req.query.field) ? req.query.field : '';
    const search    = typeof req.query.search === 'string' ? req.query.search.slice(0, 200).trim() : '';
    const hasPay    = req.query.pay === '1';
    // visa: sponsors = says it sponsors; open = hides "no sponsorship" and
    // "citizens only" (keeps roles that don't say); citizens = US citizens only.
    const visa      = ['sponsors', 'open', 'citizens'].includes(req.query.visa) ? req.query.visa : '';
    // year: 2027 = the posting names 2027 (title, or graduating/start in the description);
    // 2027-or-unstated also keeps roles that name no year (hides only other years).
    const year      = parseYearFilter(req.query.year);
    const page      = Math.max(0, Number(req.query.page) || 0);
    const pageSize  = Math.min(200, Math.max(10, Number(req.query.pageSize) || 50));

    const where = ['is_active = 1', 'role_type = $1', 'region = $2'];
    const params = [role_type, region];
    let p = 3;
    if (source) { where.push(`source = $${p++}`); params.push(source); }
    if (tier)   { where.push(`tier = $${p++}`);   params.push(tier); }
    if (field)  { where.push(`$${p++} = ANY(tracks)`); params.push(field); }
    if (hasPay) where.push('salary_range IS NOT NULL');
    if (visa === 'sponsors') where.push("sponsorship = 'sponsors'");
    if (visa === 'open') where.push("(sponsorship IS NULL OR sponsorship = 'sponsors')");
    if (visa === 'citizens') where.push("sponsorship = 'citizens_only'");
    const byYear = yearCondition(year, p);
    if (byYear) { where.push(byYear.sql); params.push(...byYear.params); p += byYear.params.length; }
    if (search) {
      where.push(`(title ILIKE $${p} OR company_name ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }

    const sql = `
      SELECT r.id, r.role_type, r.region, r.tracks, r.title, r.company_name, r.company_url, r.location, r.apply_url, r.source, r.tier,
             r.salary_range, r.posted_at, r.scraped_at, r.sponsorship, r.sponsorship_quote, (r.jd_checked_at IS NOT NULL) AS jd_read,
             ${YEARS_SELECT},
             -- The same job listed by another source (matched on company + title).
             ARRAY(
               SELECT DISTINCT o.source FROM scraped_roles o
                WHERE o.is_active = 1 AND o.id <> r.id AND o.source <> r.source AND o.role_type = r.role_type
                  AND lower(o.company_name) = lower(r.company_name)
                  AND regexp_replace(lower(o.title), '[^a-z0-9]+', '', 'g') = regexp_replace(lower(r.title), '[^a-z0-9]+', '', 'g')
             ) AS also_on
      FROM scraped_roles r
      WHERE ${where.join(' AND ')}
      -- Newest day first; within a day, SpeedyApply's curated lists lead.
      ORDER BY date_trunc('day', COALESCE(r.posted_at, r.scraped_at)) DESC, (r.source = 'speedyapply') DESC, COALESCE(r.posted_at, r.scraped_at) DESC
      LIMIT $${p++} OFFSET $${p++}
    `;
    params.push(pageSize, page * pageSize);
    const rawRows = await all(sql, params);
    const rows = rawRows.filter(isEnglishRow);
    const droppedNonEnglish = rawRows.length - rows.length;

    // Total count for pagination — same WHERE, no LIMIT, but also exclude
    // non-Latin titles (Postgres regex) so the count matches the filtered list.
    const countSql = `SELECT COUNT(*)::int AS n FROM scraped_roles
                      WHERE ${where.join(' AND ')}
                        AND title !~ '[\\u0400-\\u04FF\\u0500-\\u052F\\u0600-\\u06FF\\u0900-\\u097F\\u0E00-\\u0E7F\\u3040-\\u309F\\u30A0-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF]'`;
    const total = (await one(countSql, params.slice(0, p - 3)))?.n || 0;

    // Per-user "already tracked" flags so the UI can show the right CTA.
    let trackedSet = new Set();
    let queuedSet  = new Set();
    if (rows.length && req.user?.id) {
      const urls = rows.map(r => r.apply_url);
      const evRows = await all(
        `SELECT job_url, apply_mode, apply_status
           FROM evaluations
          WHERE user_id = $1
            AND job_url = ANY($2::text[])`,
        [req.user.id, urls]
      );
      for (const ev of evRows) {
        if (ev.apply_mode === 'auto' || ev.apply_status === 'queued') queuedSet.add(ev.job_url);
        else trackedSet.add(ev.job_url);
      }
    }

    res.json({
      role_type,
      page,
      pageSize,
      total,
      rows: rows.map(r => ({
        ...r,
        tracked:   trackedSet.has(r.apply_url),
        autoQueued: queuedSet.has(r.apply_url),
      })),
    });
  } catch (err) {
    console.error('[scraped-roles list]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/scraped-roles/sources ────────────────────────────────────────────
//    Returns per-source counts so the UI can show source pills with numbers.
router.get('/sources', async (req, res) => {
  try {
    const rows = await all(
      `SELECT source, role_type, region, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE 'swe' = ANY(tracks))::int AS swe,
              COUNT(*) FILTER (WHERE 'ai'  = ANY(tracks))::int AS ai
         FROM scraped_roles
        WHERE is_active = 1
        GROUP BY source, role_type, region
        ORDER BY source`
    );
    res.json({ sources: rows });
  } catch (err) {
    console.error('[scraped-roles sources]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── helpers: load + upsert evaluation row for this user ─────────────────────

async function loadRoleOrFail(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid role id' });
    return null;
  }
  const role = await one(
    'SELECT * FROM scraped_roles WHERE id = $1 AND is_active = 1',
    [id]
  );
  if (!role) {
    res.status(404).json({ error: 'Role not found or no longer active' });
    return null;
  }
  return role;
}

async function upsertEvaluationFromRole(userId, role, { applyMode, applyStatus }) {
  // Reuse an existing evaluation for this URL if the user has one — same dedup
  // pattern auto-apply-direct uses (careerOps.js).
  const existing = await one(
    'SELECT id, apply_status, apply_mode FROM evaluations WHERE user_id = $1 AND job_url = $2',
    [userId, role.apply_url]
  );
  if (existing) {
    // Promote: if the user clicks Auto-Apply on something they only tracked,
    // upgrade apply_mode + status. Don't downgrade a submitted row.
    if (existing.apply_status === 'submitted') return { id: existing.id, alreadySubmitted: true };
    await run(
      `UPDATE evaluations
          SET apply_mode = $1,
              apply_status = $2
        WHERE id = $3 AND user_id = $4`,
      [applyMode, applyStatus, existing.id, userId]
    );
    return { id: existing.id, reused: true };
  }
  const r = await one(
    `INSERT INTO evaluations
       (user_id, job_url, job_title, company_name, apply_mode, apply_status, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      userId,
      role.apply_url,
      String(role.title).slice(0, 500),
      String(role.company_name).slice(0, 200),
      applyMode,
      applyStatus,
      `scraped:${role.source}`,
    ]
  );
  return { id: r?.id, created: true };
}

// ── POST /api/scraped-roles/:id/track ─────────────────────────────────────────
router.post('/:id/track', async (req, res) => {
  try {
    const role = await loadRoleOrFail(req, res);
    if (!role) return;
    const out = await upsertEvaluationFromRole(req.user.id, role, {
      applyMode:   'manual',
      applyStatus: 'not_started',
    });
    res.json({ ok: true, evaluation: out, role: { id: role.id, title: role.title, company: role.company_name } });
  } catch (err) {
    console.error('[scraped-roles track]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/scraped-roles/:id/auto-apply ────────────────────────────────────
router.post('/:id/auto-apply', async (req, res) => {
  try {
    const role = await loadRoleOrFail(req, res);
    if (!role) return;
    const profile = await one(
      'SELECT auto_apply_consent, auto_apply_paused FROM user_profile WHERE user_id = $1',
      [req.user.id]
    );
    if (!profile?.auto_apply_consent) {
      return res.status(400).json({
        error: 'Auto Apply requires explicit consent in the profile before queueing.',
      });
    }
    if (profile?.auto_apply_paused) {
      return res.status(409).json({
        error: 'Auto Apply is paused. Resume it from the profile to queue this role.',
      });
    }
    const out = await upsertEvaluationFromRole(req.user.id, role, {
      applyMode:   'auto',
      applyStatus: 'queued',
    });
    res.json({ ok: true, evaluation: out, role: { id: role.id, title: role.title, company: role.company_name } });
  } catch (err) {
    console.error('[scraped-roles auto-apply]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/scraped-roles/refresh ───────────────────────────────────────────
//    Manual trigger of the shared catalog scrape. The catalog is shared by
//    every account and the scrape spends Apify credit and ~10 minutes, so:
//    one run at a time, at most every REFRESH_COOLDOWN_H hours (any user),
//    started in the background (202) instead of holding the request open.
const REFRESH_COOLDOWN_H = Number(process.env.CATALOG_REFRESH_COOLDOWN_H || 6);
let refreshRunning = false;
let lastManualRefreshAt = 0;

router.get('/refresh-status', async (req, res) => {
  const last = await one('SELECT MAX(scraped_at) AS at FROM scraped_roles');
  res.json({ running: refreshRunning, lastScrapedAt: last?.at || null, cooldownHours: REFRESH_COOLDOWN_H });
});

router.post('/refresh', async (req, res) => {
  if (process.env.MULTI_SCRAPE_DISABLED) {
    return res.status(503).json({ error: 'Catalog refresh is disabled on this server.' });
  }
  if (refreshRunning) return res.status(409).json({ error: 'A catalog refresh is already running — new roles appear as it finishes.', running: true });
  const last = await one('SELECT MAX(scraped_at) AS at FROM scraped_roles');
  const lastAt = Math.max(lastManualRefreshAt, last?.at ? new Date(last.at).getTime() : 0);
  const waitMs = lastAt + REFRESH_COOLDOWN_H * 3_600_000 - Date.now();
  if (waitMs > 0) {
    return res.status(429).json({ error: `The catalog was refreshed recently — next refresh available in ${Math.ceil(waitMs / 3_600_000)}h (it also refreshes every morning at 06:15 UTC).` });
  }
  refreshRunning = true;
  lastManualRefreshAt = Date.now();
  console.log(`[scraped-roles refresh] manual trigger by user ${req.user?.id}`);
  scrapeAllSourcesAndPersist()
    .then(summary => console.log(`[scraped-roles refresh] done — total=${summary?.total}`))
    .catch(err => console.error('[scraped-roles refresh]', err))
    .finally(() => { refreshRunning = false; });
  res.status(202).json({ ok: true, started: true, message: 'Refreshing the catalog — this takes about 10 minutes.' });
});

export default router;

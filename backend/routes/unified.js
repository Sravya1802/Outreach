import { Router } from 'express';
import { one, all } from '../db.js';

const router = Router();

// ── Merged company list (jobs table + prospect-only companies) ────────────────

// ── Category counts (lightweight — for category card badges) ─────────────────

router.get('/category-counts', async (req, res) => {
  try {
    const rows = await all(`
      SELECT COALESCE(NULLIF(category,''), 'Unclassified') AS category, COUNT(*)::int AS count
      FROM jobs
      WHERE user_id = $1
      GROUP BY COALESCE(NULLIF(category,''), 'Unclassified')
      ORDER BY count DESC
    `, [req.user.id]);
    res.json({ counts: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── City counts for location filter pills ─────────────────────────────────────

router.get('/city-counts', async (req, res) => {
  try {
    const { category, subcategory } = req.query;
    let where = "city IS NOT NULL AND city != '' AND user_id = $1";
    const params = [req.user.id];
    let i = 2;
    if (subcategory)                         { where += ` AND subcategory = $${i++}`; params.push(subcategory); }
    else if (category && category !== 'All') { where += ` AND category = $${i++}`;    params.push(category); }

    const rows = await all(`
      SELECT city, state, COUNT(*)::int AS count
      FROM jobs
      WHERE ${where}
      GROUP BY city, state
      ORDER BY count DESC
      LIMIT 30
    `, params);
    res.json({ cities: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/companies', async (req, res) => {
  try {
    const { category, subcategory, search, page: pageStr, pageSize: pageSizeStr, cities: citiesStr, includeRemote, source, status, sort } = req.query;
    const page     = Math.max(0, parseInt(pageStr, 10) || 0);
    const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeStr, 10) || 50));
    const offset   = page * pageSize;
    const cityList = citiesStr ? citiesStr.split(',').map(c => c.trim()).filter(Boolean) : [];
    const withRemote = includeRemote === 'true' || includeRemote === '1';

    let where = 'user_id = $1';
    const params = [req.user.id];
    let i = 2;
    if (subcategory)                          { where += ` AND subcategory = $${i++}`; params.push(subcategory); }
    else if (category && category !== 'All')  { where += ` AND category = $${i++}`;    params.push(category); }
    if (search) { where += ` AND name ILIKE $${i++}`; params.push(`%${search}%`); }
    if (source) { where += ` AND source ILIKE $${i++}`; params.push(`%${source}%`); }
    if (status) { where += ` AND status = $${i++}`; params.push(status); }
    if (cityList.length > 0) {
      const placeholders = cityList.map(() => `$${i++}`).join(',');
      if (withRemote) {
        where += ` AND (city IN (${placeholders}) OR city = 'Remote')`;
      } else {
        where += ` AND city IN (${placeholders})`;
      }
      params.push(...cityList);
    }

    // Total count (for hasMore)
    const totalRow = await one(`SELECT COUNT(*)::int AS total FROM jobs j WHERE ${where}`, params);
    const jobTotal = totalRow?.total || 0;

    // Companies from jobs table — paginated
    // Note: `where` uses the jobs table column `user_id`; for `j` alias we need
    // j.user_id. Prepend the alias for the job rows query below.
    const whereJobAlias = where.replace(/\buser_id\b/g, 'j.user_id');
    const userIdParamIdx = 1; // req.user.id is params[0]

    const SORT_CLAUSES = {
      hiring:   'j.is_hiring DESC NULLS LAST, j.pay DESC NULLS LAST',
      contacts: `(
        (SELECT COUNT(*)::int FROM job_contacts WHERE job_id = j.id AND user_id = $${userIdParamIdx}) +
        (SELECT COUNT(*)::int FROM prospects   WHERE company_name = j.name AND user_id = $${userIdParamIdx})
      ) DESC, j.is_hiring DESC NULLS LAST`,
      recent:   'j.created_at DESC NULLS LAST, j.id DESC',
      az:       'j.name ASC',
      za:       'j.name DESC',
    };
    const orderBy = SORT_CLAUSES[sort] || SORT_CLAUSES.hiring;
    const jobRows = await all(`
      SELECT
        'job'                AS source,
        j.id                 AS id,
        j.id                 AS job_id,
        j.name,
        j.category,
        j.subcategory,
        j.status,
        COALESCE(j.confidence, 0)  AS confidence,
        j.classified_at,
        j.pay                AS pay_per_hour,
        j.location,
        j.url                AS careers_url,
        j.domain,
        COALESCE(j.is_hiring, 0)   AS is_hiring,
        j.linkedin_company_url,
        j.city,
        j.state,
        j.country,
        j.intern_roles_count,
        j.intern_roles_checked_at,
        (SELECT COUNT(*)::int FROM job_contacts WHERE job_id = j.id AND source = 'linkedin' AND user_id = $${userIdParamIdx}) AS linkedin_count,
        (SELECT COUNT(*)::int FROM job_contacts WHERE job_id = j.id AND source = 'hunter' AND user_id = $${userIdParamIdx})   AS email_count,
        (SELECT COUNT(*)::int FROM prospects WHERE company_name = j.name AND user_id = $${userIdParamIdx})                    AS prospects_count
      FROM jobs j
      WHERE ${whereJobAlias}
      ORDER BY ${orderBy}
      LIMIT $${i++} OFFSET $${i++}
    `, [...params, pageSize, offset]);

    // Prospect-only companies — only included on page 0 when no category filter
    let prospectRows = [];
    if (page === 0 && !category && !subcategory) {
      let prospectSql = `
        SELECT
          'prospect'       AS source,
          NULL             AS id,
          NULL             AS job_id,
          p.company_name   AS name,
          p.company_type   AS category,
          NULL             AS subcategory,
          NULL             AS status,
          0                AS confidence,
          NULL             AS classified_at,
          0                AS pay_per_hour,
          NULL             AS location,
          NULL             AS careers_url,
          NULL             AS domain,
          0                AS is_hiring,
          NULL             AS linkedin_company_url,
          NULL             AS intern_roles_count,
          NULL             AS intern_roles_checked_at,
          0                AS linkedin_count,
          0                AS email_count,
          COUNT(*)::int    AS prospects_count
        FROM prospects p
        WHERE p.user_id = $1
          AND p.company_name NOT IN (SELECT name FROM jobs WHERE user_id = $1)
      `;
      const prospectParams = [req.user.id];
      if (search) {
        prospectSql += ` AND p.company_name ILIKE $2`;
        prospectParams.push(`%${search}%`);
      }
      prospectSql += ` GROUP BY p.company_name, p.company_type`;
      prospectRows = await all(prospectSql, prospectParams);
    }

    const companies = [...jobRows, ...prospectRows].map(c => ({
      ...c,
      total_contacts: (c.linkedin_count || 0) + (c.email_count || 0) + (c.prospects_count || 0),
    }));

    const hasMore = (offset + jobRows.length) < jobTotal;

    res.json({ companies, total: jobTotal + prospectRows.length, page, pageSize, hasMore });
  } catch (err) {
    console.error('unified/companies error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── All contacts for a company (both tables) ──────────────────────────────────

router.get('/contacts/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);

    // job_contacts (LinkedIn search + Hunter.io)
    const job = await one(
      'SELECT id FROM jobs WHERE name = $1 AND user_id = $2',
      [name, req.user.id]
    );
    const jobContacts = job
      ? await all(
          'SELECT * FROM job_contacts WHERE job_id = $1 AND user_id = $2 ORDER BY source, created_at DESC',
          [job.id, req.user.id]
        )
      : [];

    // prospects (auto-discovered people)
    const prospectRows = await all(
      'SELECT * FROM prospects WHERE company_name = $1 AND user_id = $2 ORDER BY created_at DESC',
      [name, req.user.id]
    );

    // Normalize into a single contacts array that the frontend expects
    const contacts = [
      ...jobContacts.map(c => ({ ...c, type: 'job_contact' })),
      ...prospectRows.map(c => ({ ...c, type: 'prospect' })),
    ];

    res.json({ job_id: job?.id || null, contacts });
  } catch (err) {
    console.error('unified/contacts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard stats + outreach pipeline ──────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const [stats, prospectRows, jobRows] = await Promise.all([
      one(`
        SELECT
          (SELECT COUNT(*)::int FROM prospects   WHERE user_id = $1) +
          (SELECT COUNT(*)::int FROM job_contacts WHERE user_id = $1) AS total,

          (SELECT COUNT(*)::int FROM prospects   WHERE status = 'generated' AND user_id = $1) +
          (SELECT COUNT(*)::int FROM job_contacts WHERE status = 'generated' AND user_id = $1) AS generated,

          (SELECT COUNT(*)::int FROM prospects   WHERE status IN ('sent','email_sent') AND user_id = $1) +
          (SELECT COUNT(*)::int FROM job_contacts WHERE status IN ('sent','email_sent') AND user_id = $1) AS sent,

          (SELECT COUNT(*)::int FROM prospects   WHERE status = 'dm_sent' AND user_id = $1) +
          (SELECT COUNT(*)::int FROM job_contacts WHERE status = 'dm_sent' AND user_id = $1) AS dm_sent,

          (SELECT COUNT(*)::int FROM prospects   WHERE status = 'replied' AND user_id = $1) +
          (SELECT COUNT(*)::int FROM job_contacts WHERE status = 'replied' AND user_id = $1) AS replied,

          (SELECT COUNT(*)::int FROM prospects   WHERE status IN ('closed','skip') AND user_id = $1) +
          (SELECT COUNT(*)::int FROM job_contacts WHERE status IN ('closed','skip') AND user_id = $1) AS closed,

          (SELECT COUNT(*)::int FROM prospects   WHERE user_id = $1 AND ((email_subject IS NOT NULL AND email_subject != '') OR (linkedin_dm IS NOT NULL AND linkedin_dm != ''))) +
          (SELECT COUNT(*)::int FROM job_contacts WHERE user_id = $1 AND ((generated_subject IS NOT NULL AND generated_subject != '') OR (generated_dm IS NOT NULL AND generated_dm != ''))) AS has_content
      `, [req.user.id]),
      all(`
        SELECT
          'prospect' AS row_type,
          p.id,
          p.name,
          p.title,
          p.email,
          p.linkedin_url,
          p.linkedin_dm  AS generated_dm,
          p.email_subject AS generated_subject,
          p.email_body    AS generated_body,
          p.status,
          p.company_name  AS company,
          NULL            AS company_category,
          p.updated_at    AS activity_at
        FROM prospects p
        WHERE p.user_id = $1
        ORDER BY p.company_name, p.updated_at DESC
      `, [req.user.id]),
      all(`
        SELECT
          'job_contact' AS row_type,
          jc.id,
          jc.name,
          jc.title,
          jc.email,
          jc.linkedin_url,
          jc.generated_dm,
          jc.generated_subject,
          jc.generated_body,
          jc.status,
          j.name     AS company,
          j.category AS company_category,
          jc.created_at AS activity_at
        FROM job_contacts jc
        JOIN jobs j ON j.id = jc.job_id AND j.user_id = $1
        WHERE jc.user_id = $1
        ORDER BY j.name, jc.created_at DESC
      `, [req.user.id]),
    ]);

    // Group by company
    const byCompany = {};
    for (const row of [...prospectRows, ...jobRows]) {
      if (!byCompany[row.company]) byCompany[row.company] = { company: row.company, category: row.company_category, people: [] };
      byCompany[row.company].people.push(row);
    }

    res.json({ stats, companies: Object.values(byCompany).sort((a, b) => a.company.localeCompare(b.company)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/unified/all-contacts — all contacts across all companies ──────────
router.get('/all-contacts', async (req, res) => {
  try {
    const { limit = 200, hasEmail, noEmail } = req.query;
    let where = 'WHERE jc.user_id = $1';
    if (hasEmail === 'true') where += " AND jc.email IS NOT NULL AND jc.email != ''";
    else if (noEmail === 'true') where += " AND (jc.email IS NULL OR jc.email = '')";
    const rows = await all(`
      SELECT jc.id, jc.name, jc.title, jc.email, jc.email_status, jc.linkedin_url,
             jc.status, jc.job_id, j.name as company_name, j.category
      FROM job_contacts jc
      LEFT JOIN jobs j ON j.id = jc.job_id AND j.user_id = $1
      ${where}
      ORDER BY jc.created_at DESC
      LIMIT $2
    `, [req.user.id, Number(limit)]);
    const totalRow = await one(
      `SELECT COUNT(*)::int AS n FROM job_contacts jc ${where}`,
      [req.user.id]
    );
    res.json({ contacts: rows, total: totalRow?.n || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

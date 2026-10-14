import { Router } from 'express';
import { one, run, tx } from '../db.js';
import { getYCHiringCompanies, filterYCCompanies, findYCCompany, ycToJobRow } from '../services/yc.js';
import { ApifyClient } from 'apify-client';

const router = Router();

/**
 * Insert YC companies as jobs rows in chunks (one multi-row INSERT per 200)
 * instead of one round-trip per company — the DB is in another region, so
 * row-by-row imports of ~1,500 companies took minutes.
 * @returns {Promise<{ imported: number, skipped: number }>}
 */
async function insertYcCompanies(client, companies, userId) {
  let imported = 0;
  const seen = new Set();
  const unique = companies.filter(c => { const k = String(c.name || '').toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const values = [];
    const params = [];
    chunk.forEach((c, j) => {
      const r = ycToJobRow(c);
      const b = j * 9;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, 'yc', $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`);
      params.push(r.name, r.role, r.location, r.careersUrl, c.slug, r.category, r.subcategory, c.batch || null, userId);
    });
    const result = await client.query(`
      INSERT INTO jobs (name, roles, location, source, url, tag, category, subcategory, yc_batch, user_id)
      VALUES ${values.join(', ')}
      ON CONFLICT (user_id, name) DO NOTHING
    `, params);
    imported += result.rowCount || 0;
  }
  return { imported, skipped: companies.length - imported };
}

function getApifyClient() {
  return new ApifyClient({ token: process.env.APIFY_API_TOKEN || '' });
}

// GET /api/yc/companies — filtered list from cache
router.get('/companies', async (req, res) => {
  try {
    const companies = await getYCHiringCompanies();
    const { location, industry, maxTeamSize, minTeamSize, batch, search, page = 0, pageSize = 50 } = req.query;

    const filtered = filterYCCompanies(companies, {
      location,
      industry,
      maxTeamSize: maxTeamSize ? Number(maxTeamSize) : null,
      minTeamSize: minTeamSize ? Number(minTeamSize) : null,
      batch,
      search,
    });

    const total   = filtered.length;
    const pg      = Number(page);
    const ps      = Number(pageSize);
    const slice   = filtered.slice(pg * ps, pg * ps + ps);
    const hasMore = (pg + 1) * ps < total;

    const batches    = [...new Set(companies.map(c => c.batch).filter(Boolean))].sort().reverse();
    const industries = [...new Set(companies.map(c => c.industry).filter(Boolean))].sort();

    res.json({ companies: slice, total, hasMore, page: pg, batches, industries });
  } catch (err) {
    console.error('[yc] list error:', err.message);
    res.status(500).json({ error: err.message, companies: [], total: 0 });
  }
});

// GET /api/yc/companies/:slug — single company detail + optional WaaS scrape
router.get('/companies/:slug', async (req, res) => {
  try {
    const companies = await getYCHiringCompanies();
    const company   = companies.find(c => c.slug === req.params.slug);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    let jobs = [];
    const apifyToken = process.env.APIFY_API_TOKEN || '';
    if (apifyToken && apifyToken.length > 10 && req.query.fetchJobs === 'true') {
      try {
        const client = getApifyClient();
        const runRes = await client.actor('apify/rag-web-browser').call({
          startUrls: [{ url: `https://www.workatastartup.com/companies/${company.slug}` }],
          maxCrawlDepth: 0,
          maxCrawlPages: 1,
          outputFormats: ['text'],
        }, { waitForFinish: 60 });
        const { items } = await client.dataset(runRes.defaultDatasetId).listItems();
        const text = items[0]?.text || '';
        const lines = text.split('\n');
        for (const line of lines) {
          const m = line.match(/^(Software|ML|Machine Learning|Data|Frontend|Backend|Full Stack|iOS|Android|Infrastructure|Platform|Security|DevOps|SRE)[^\n]{3,60}(Intern|Engineer|Developer)/i);
          if (m) {
            const title = line.trim().slice(0, 80);
            jobs.push({ title, location: company.all_locations || 'Unknown', apply_url: `https://www.workatastartup.com/companies/${company.slug}` });
          }
        }
      } catch (err) {
        console.log(`[yc] WaaS job fetch failed for ${company.slug}: ${err.message}`);
      }
    }

    res.json({ company, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/yc/import — import selected companies into jobs table
router.post('/import', async (req, res) => {
  try {
    const { slugs = [] } = req.body;
    console.log(`[yc] Import request for slugs:`, slugs);
    if (!slugs.length) return res.json({ imported: 0, skipped: 0, companies: [] });

    const allCompanies = await getYCHiringCompanies();
    const toImport     = allCompanies.filter(c => slugs.includes(c.slug));
    console.log(`[yc] Filtered to import: ${toImport.length} companies`);

    let imported = 0, skipped = 0;
    const importedRows = [];

    await tx(async (client) => {
      for (const c of toImport) {
        const r = ycToJobRow(c);
        const result = await client.query(`
          INSERT INTO jobs (name, roles, location, source, url, tag, category, subcategory, yc_batch, description, website, team_size, user_id)
          VALUES ($1, $2, $3, 'yc', $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (user_id, name) DO NOTHING
          RETURNING id, name
        `, [
          r.name, r.role, r.location, r.careersUrl, c.slug,
          r.category, r.subcategory,
          c.batch || null,
          c.one_liner || c.long_description?.slice(0, 300) || null,
          c.website || null,
          c.team_size || null,
          req.user.id,
        ]);
        if (result.rowCount > 0) {
          imported++;
          importedRows.push(result.rows[0]);
          console.log(`[yc] Inserted ${r.name} with id ${result.rows[0].id}`);
        } else {
          // Already exists — get its id
          const existing = await client.query(
            "SELECT id, name FROM jobs WHERE name = $1 AND user_id = $2",
            [r.name, req.user.id]
          );
          if (existing.rows[0]) {
            importedRows.push(existing.rows[0]);
            console.log(`[yc] ${r.name} already exists with id ${existing.rows[0].id}`);
          }
          skipped++;
        }
      }
    });

    try {
      await run(
        "INSERT INTO activity_log (action, details, user_id) VALUES ('yc_import', $1, $2)",
        [`Imported ${imported} YC companies`, req.user.id]
      );
    } catch (_) {}

    const first = importedRows[0] || null;
    res.json({ imported, skipped, id: first?.id, name: first?.name, companies: importedRows });
  } catch (err) {
    console.error('[yc] import error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/yc/import-all — bulk import all filtered companies
router.post('/import-all', async (req, res) => {
  try {
    const filters = req.body?.filters || {};
    const companies = await getYCHiringCompanies();
    const toImport  = filterYCCompanies(companies, filters);

    const { imported, skipped } = await tx(client => insertYcCompanies(client, toImport, req.user.id));

    try {
      await run(
        "INSERT INTO activity_log (action, details, user_id) VALUES ('yc_import_all', $1, $2)",
        [`Bulk imported ${imported} YC companies (${skipped} skipped)`, req.user.id]
      );
    } catch (_) {}

    res.json({ imported, skipped, total: toImport.length });
  } catch (err) {
    console.error('[yc] import-all error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/yc/scrape-waas — scrape WaaS intern listings (uses free YC API)
router.post('/scrape-waas', async (req, res) => {
  try {
    const companies = await getYCHiringCompanies();
    const usFilter  = filterYCCompanies(companies, { location: 'us' });

    const { imported, skipped } = await tx(client => insertYcCompanies(client, usFilter.slice(0, 500), req.user.id));

    try {
      await run(
        "INSERT INTO activity_log (action, details, user_id) VALUES ('yc_waas_scrape', $1, $2)",
        [`Scraped WaaS: ${imported} new YC companies imported`, req.user.id]
      );
    } catch (_) {}

    res.json({ imported, skipped, total: usFilter.length, source: 'yc-oss-api' });
  } catch (err) {
    console.error('[yc] scrape-waas error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;

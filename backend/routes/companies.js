import { Router } from 'express';
import { one, all, run, tx } from '../db.js';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import * as apify from '../services/apify.js';
import { findYCCompany } from '../services/yc.js';
import { ApifyClient } from 'apify-client';
import { requireOwnedCompany } from '../middleware/ownedCompany.js';
import { isWithin } from '../services/safePaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESUME_DIR = path.join(__dirname, '..', 'data', 'resumes');
fs.mkdirSync(RESUME_DIR, { recursive: true });

const resumeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // <user>/<company> — id is validated by requireOwnedCompany before multer runs.
    const dir = path.join(RESUME_DIR, req.user.id, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const resumeUpload = multer({
  storage: resumeStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.pdf', '.docx'].includes(ext));
  },
});

function getApifyClient() {
  return new ApifyClient({ token: process.env.APIFY_API_TOKEN || '' });
}

const router = Router();

// POST /api/companies/:id/career-ops/resume — upload resume for company Career Ops
router.post('/:id/career-ops/resume', requireOwnedCompany('id'), resumeUpload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No resume uploaded' });

    // Parse PDF text and store globally in meta so score-fit can access it
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === '.pdf') {
      try {
        const { PDFParse } = await import('pdf-parse');
        const pdfBuffer = fs.readFileSync(req.file.path);
        const parser = new PDFParse({ verbosity: -1, data: pdfBuffer });
        await parser.load();
        const result = await parser.getText();
        const rawText = result?.pages ? result.pages.map(p => p.text || '').join('\n') : String(result || '');
        const text = rawText.trim();
        if (text && text.length > 50) {
          const upsertSql = "INSERT INTO meta (key, value, user_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value";
          await run(upsertSql, ['user_resume_text', text, req.user.id]);
          await run(upsertSql, ['user_resume_name', req.file.originalname, req.user.id]);
          await run(upsertSql, ['user_resume_date', new Date().toISOString(), req.user.id]);
          console.log(`[companies] Parsed resume text: ${text.length} chars`);
        }
      } catch (parseErr) {
        console.error('[companies] PDF parse failed (non-fatal):', parseErr.message);
      }
    }

    await run(`
      INSERT INTO company_applications (company_id, status, resume_path, resume_original_name, resume_size, updated_at, user_id)
      VALUES ($1, 'interested', $2, $3, $4, NOW(), $5)
      ON CONFLICT(user_id, company_id) DO UPDATE SET
        resume_path = EXCLUDED.resume_path,
        resume_original_name = EXCLUDED.resume_original_name,
        resume_size = EXCLUDED.resume_size,
        updated_at = NOW()
    `, [req.params.id, req.file.path, req.file.originalname, req.file.size, req.user.id]);

    const app = await one('SELECT * FROM company_applications WHERE company_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ resume: { original_name: app.resume_original_name, size: app.resume_size, resume_path: app.resume_path }, application: app });
  } catch (err) {
    console.error('[companies] career-ops resume upload failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/companies/:id/career-ops/resume/from-library
// Pick a resume from the user's storage library instead of uploading. Records
// resume_path with the `storage://` prefix so the auto-apply worker knows to
// download from Supabase Storage at run time.
router.post('/:id/career-ops/resume/from-library', async (req, res) => {
  try {
    const { archetype, filename } = req.body || {};
    if (!archetype || !filename) return res.status(400).json({ error: 'archetype + filename required' });
    const safeArch = String(archetype).toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 32) || 'misc';
    const safeFile = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    // resume_path format: storage://library/<userId>/<archetype>/<filename>
    // The autoApplier detects the storage:// prefix and downloads to a temp
    // file before handing the path to Playwright.
    const storagePath = `storage://library/${req.user.id}/${safeArch}/${safeFile}`;
    await run(`
      INSERT INTO company_applications (company_id, status, resume_path, resume_original_name, resume_size, updated_at, user_id)
      VALUES ($1, 'interested', $2, $3, NULL, NOW(), $4)
      ON CONFLICT(user_id, company_id) DO UPDATE SET
        resume_path = EXCLUDED.resume_path,
        resume_original_name = EXCLUDED.resume_original_name,
        resume_size = NULL,
        updated_at = NOW()
    `, [req.params.id, storagePath, safeFile, req.user.id]);
    const app = await one('SELECT * FROM company_applications WHERE company_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true, resume: { original_name: app.resume_original_name, archetype: safeArch, source: 'library', resume_path: app.resume_path }, application: app });
  } catch (err) {
    console.error('[companies] career-ops resume from-library failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/companies/:id/career-ops/resume
router.delete('/:id/career-ops/resume', async (req, res) => {
  try {
    const row = await one('SELECT * FROM company_applications WHERE company_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!row?.resume_path) return res.status(404).json({ error: 'Resume not found' });
    // Skip filesystem unlink for storage:// paths — those reference Supabase
    // Storage objects which the user manages via the library UI.
    // Only delete files the server itself wrote; a stored path is never trusted.
    if (isWithin(RESUME_DIR, row.resume_path)) {
      try { fs.unlinkSync(row.resume_path); } catch (_) {}
    }
    await run(`
      UPDATE company_applications SET resume_path = NULL, resume_original_name = NULL, resume_size = NULL, updated_at = NOW()
      WHERE company_id = $1 AND user_id = $2
    `, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[companies] career-ops resume delete failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Categories sorted by count
router.get('/categories', async (req, res) => {
  try {
    const rows = await all(`
      SELECT category as name, COUNT(*)::int as count
      FROM jobs
      WHERE user_id = $1 AND category IS NOT NULL AND category != 'Unclassified' AND category != ''
      GROUP BY category
      ORDER BY count DESC
    `, [req.user.id]);
    res.json({ categories: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all companies
router.get('/', async (req, res) => {
  try {
    const { source, status, search, limit = 200, offset = 0 } = req.query;
    let sql = 'SELECT * FROM companies WHERE user_id = $1';
    const params = [req.user.id];
    let i = 2;
    if (source) { sql += ` AND source = $${i++}`; params.push(source); }
    if (status) { sql += ` AND status = $${i++}`; params.push(status); }
    if (search) {
      sql += ` AND (name ILIKE $${i} OR role ILIKE $${i+1})`;
      i += 2;
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`;
    params.push(Number(limit), Number(offset));

    const companies = await all(sql, params);
    res.json(companies);
  } catch (err) {
    console.error('List companies error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Search a company by name — multi-source lookup
router.post('/search-by-name', async (req, res) => {
  try {
    const { companyName } = req.body;
    if (!companyName?.trim()) return res.status(400).json({ error: 'companyName required' });
    const name = companyName.trim();

    const existing = await one("SELECT * FROM jobs WHERE user_id = $1 AND name ILIKE $2 LIMIT 1", [req.user.id, `%${name}%`]);
    const already_existed = !!existing;

    let ycData    = null;
    let roles     = [];
    let website   = null;
    let description = null;
    let location  = null;
    let teamSize  = null;

    try {
      ycData = await findYCCompany(name);
      if (ycData) {
        website     = ycData.website;
        description = ycData.one_liner || ycData.long_description;
        location    = ycData.all_locations;
        teamSize    = ycData.team_size;
        console.log(`[company-search] Found in YC: ${ycData.name} (${ycData.batch})`);
      }
    } catch (err) {
      console.log(`[company-search] YC lookup failed: ${err.message}`);
    }

    const serperKey = (process.env.SERPER_API_KEY || '').trim();
    if (serperKey && serperKey.length > 10) {
      try {
        const q1 = `"${name}" intern OR internship software engineer 2026 site:greenhouse.io OR site:lever.co OR site:jobs.lever.co OR site:boards.greenhouse.io`;
        const r1 = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: q1, num: 10 }),
          signal: AbortSignal.timeout(10000),
        });
        if (r1.ok) {
          const d1 = await r1.json();
          for (const item of (d1.organic || [])) {
            if (!item.link || !item.title) continue;
            const title = item.title.split(/[-–|]/)[0].trim();
            if (title.toLowerCase().includes(name.toLowerCase().slice(0, 5)) ||
                item.link.includes(name.toLowerCase().replace(/\s+/g, ''))) {
              roles.push({ title, location: item.snippet?.match(/\b([A-Z][a-z]+,\s*[A-Z]{2}|Remote)\b/)?.[1] || 'USA', apply_url: item.link });
            }
          }
        }
      } catch (err) {
        console.log(`[company-search] Serper role search failed: ${err.message}`);
      }
    }

    if (ycData?.slug && roles.length < 3) {
      try {
        const waasUrl = `https://www.workatastartup.com/companies/${ycData.slug}`;
        const apifyToken = process.env.APIFY_API_TOKEN || '';
        if (apifyToken && apifyToken.length > 10) {
          const client = getApifyClient();
          const runRes = await client.actor('apify/rag-web-browser').call({
            startUrls: [{ url: waasUrl }],
            maxCrawlDepth: 0, maxCrawlPages: 1, outputFormats: ['text'],
          }, { waitForFinish: 60 });
          const { items } = await client.dataset(runRes.defaultDatasetId).listItems();
          const text = items[0]?.text || '';
          for (const line of text.split('\n')) {
            const m = line.match(/^(Software|ML|Data|Frontend|Backend|Full Stack|iOS|Android|Infrastructure|Platform)[^\n]{3,60}(Intern|Engineer|Developer)/i);
            if (m && roles.length < 10) {
              roles.push({ title: line.trim().slice(0, 80), location: location || 'USA', apply_url: waasUrl });
            }
          }
        }
      } catch (err) {
        console.log(`[company-search] WaaS scrape failed: ${err.message}`);
      }
    }

    if (!already_existed) {
      try {
        const roleText = roles.length > 0 ? roles[0].title : 'Software Engineer Intern';
        const applyUrl = roles.length > 0 ? roles[0].apply_url
          : ycData ? `https://www.workatastartup.com/companies/${ycData.slug}`
          : website || '';
        const category = ycData ? mapYCIndustry(ycData.industry) : 'Startups';
        const stage    = ycData?.batch || (ycData ? 'YC' : 'startup');

        await run(`
          INSERT INTO jobs (name, roles, location, source, url, tag, category, user_id)
          VALUES ($1, $2, $3, 'manual_search', $4, $5, $6, $7)
          ON CONFLICT (user_id, name) DO NOTHING
        `, [name, roleText, location || 'USA', applyUrl, name.toLowerCase().replace(/\s+/g, '-'), category, req.user.id]);

        // Insert additional roles — but jobs table has UNIQUE(name), so only the first
        // unique name goes in. These are just role variations of the same company name
        // → noop via ON CONFLICT.
        for (const role of roles.slice(1, 5)) {
          try {
            await run(`INSERT INTO jobs (name, roles, location, source, url, tag, category, user_id) VALUES ($1, $2, $3, 'manual_search', $4, $5, $6, $7) ON CONFLICT (user_id, name) DO NOTHING`,
              [name, role.title, role.location || 'USA', role.apply_url, name.toLowerCase().replace(/\s+/g, '-'), category, req.user.id]);
          } catch (_) {}
        }

        await run("INSERT INTO activity_log (action, details, user_id) VALUES ('company_search', $1, $2)",
          [`Searched and added: ${name}`, req.user.id]);
      } catch (err) {
        console.log(`[company-search] DB insert failed: ${err.message}`);
      }
    }

    res.json({
      company: {
        name:      ycData?.name || name,
        website, description,
        industry:  ycData?.industry || null,
        stage:     ycData?.batch || null,
        team_size: teamSize,
        location,
        yc_batch:  ycData?.batch || null,
        slug:      ycData?.slug || null,
        tags:      ycData?.tags || [],
        waas_url:  ycData ? `https://www.workatastartup.com/companies/${ycData.slug}` : null,
      },
      roles,
      already_existed,
    });
  } catch (err) {
    console.error('[company-search] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function mapYCIndustry(industry) {
  if (!industry) return 'Startups';
  const i = industry.toLowerCase();
  if (/fintech|finance|banking/.test(i)) return 'Finance & Investing';
  if (/health|medical|bio|pharma/.test(i)) return 'Healthcare & Life Sciences';
  if (/ai|machine learning|artificial intelligence|ml/.test(i)) return 'AI & Research';
  if (/education|edtech/.test(i)) return 'Education';
  if (/energy|climate/.test(i)) return 'Energy & Climate';
  if (/b2b|enterprise|saas|software/.test(i)) return 'Tech & Software';
  if (/hardware|robotics/.test(i)) return 'Hardware & Semiconductors';
  return 'Startups';
}

function normalizeLegacyCompanyResult(item) {
  const company = (item?.company || item?.name || item?.companyName || '').trim();
  if (!company) return null;
  return {
    company,
    role:      item.role || item.jobTitle || item.title || 'Software Engineering Intern',
    location:  item.location || 'USA',
    stage:     item.stage || null,
    source:    item.source || 'scrape',
    apply_url: item.apply_url || item.careersUrl || item.url || '',
    posted_at: item.posted_at || null,
  };
}

// Scrape ALL sources in parallel
router.post('/scrape', async (req, res) => {
  try {
    const query = req.body.query || 'software engineer intern 2026';

    const [linkedin, wellfound, google, github, yc] = await Promise.allSettled([
      apify.scrapeLinkedInJobs(query),
      apify.scrapeWellfound(),
      apify.scrapeGoogleJobs(query),
      apify.scrapeGitHubInternships(),
      apify.scrapeYCStartups(),
    ]);

    const allResults = [
      ...(linkedin.status === 'fulfilled' ? linkedin.value : []),
      ...(wellfound.status === 'fulfilled' ? wellfound.value : []),
      ...(google.status === 'fulfilled' ? google.value : []),
      ...(github.status === 'fulfilled' ? github.value : []),
      ...(yc.status === 'fulfilled' ? yc.value : []),
    ].map(normalizeLegacyCompanyResult).filter(Boolean);

    let inserted = 0;
    await tx(async (client) => {
      for (const item of allResults) {
        const r = await client.query(`
          INSERT INTO companies (name, role, location, stage, source, apply_url, posted_at, user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (user_id, name, role) DO NOTHING
        `, [item.company, item.role, item.location, item.stage, item.source, item.apply_url, item.posted_at, req.user.id]);
        if (r.rowCount > 0) inserted++;
      }
    });

    res.json({
      inserted,
      skipped: allResults.length - inserted,
      total: allResults.length,
      sources: {
        linkedin: linkedin.status === 'fulfilled' ? linkedin.value.length : 0,
        wellfound: wellfound.status === 'fulfilled' ? wellfound.value.length : 0,
        google: google.status === 'fulfilled' ? google.value.length : 0,
        github: github.status === 'fulfilled' ? github.value.length : 0,
        yc: yc.status === 'fulfilled' ? yc.value.length : 0,
      },
    });
  } catch (err) {
    console.error('Scrape all error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Scrape single source
router.post('/scrape/:src', async (req, res) => {
  try {
    const { src } = req.params;
    const query = req.body.query || 'software engineer intern 2026';
    let results = [];

    switch (src) {
      case 'linkedin':    results = await apify.scrapeLinkedInJobs(query); break;
      case 'wellfound':   results = await apify.scrapeWellfound(); break;
      case 'google':                                                          // frontend uses 'google_jobs' — accept both
      case 'google_jobs': results = await apify.scrapeGoogleJobs(query); break;
      case 'github':      results = await apify.scrapeGitHubInternships(); break;
      case 'yc':          results = await apify.scrapeYCStartups(); break;
      default: return res.status(400).json({ error: `Unknown source: ${src}` });
    }

    const cleaned = results.map(normalizeLegacyCompanyResult).filter(Boolean);

    let inserted = 0;
    await tx(async (client) => {
      for (const item of cleaned) {
        const r = await client.query(`
          INSERT INTO companies (name, role, location, stage, source, apply_url, posted_at, user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (user_id, name, role) DO NOTHING
        `, [item.company, item.role, item.location, item.stage, item.source, item.apply_url, item.posted_at, req.user.id]);
        if (r.rowCount > 0) inserted++;
      }
    });

    res.json({ inserted, skipped: cleaned.length - inserted, total: cleaned.length, rawTotal: results.length });
  } catch (err) {
    console.error(`Scrape ${req.params.src} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update company status
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });

    const r = await run('UPDATE companies SET status = $1 WHERE id = $2 AND user_id = $3', [status, req.params.id, req.user.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Company not found' });

    res.json({ success: true });
  } catch (err) {
    console.error('Update status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete company
router.delete('/:id', async (req, res) => {
  try {
    const r = await run('DELETE FROM companies WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Company not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete company error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;

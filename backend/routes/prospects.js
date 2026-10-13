import { Router } from 'express';
import { one, all, run, tx } from '../db.js';
import * as apollo from '../services/apollo.js';
import * as apify from '../services/apify.js';
import { generateOutreach } from '../services/ai.js';
import { loadSenderProfile } from '../services/senderProfile.js';

const router = Router();

// ── Curated target companies ────────────────────────────────────────────────

const STARTUP_COMPANIES = [
  'Perplexity AI', 'Together AI', 'Anyscale', 'Modal', 'Character AI',
  'LangChain', 'Weights & Biases', 'Scale AI', 'Hugging Face', 'Replicate',
  'Cursor', 'Replit', 'Supabase', 'Neon', 'PlanetScale',
  'Temporal', 'Buf', 'Redpanda', 'Fly.io', 'Railway',
  'Linear', 'Loom', 'Coda', 'Superhuman', 'Superblocks',
  'Ramp', 'Brex', 'Mercury', 'Pilot', 'Deel',
  'Retool', 'Render', 'Clerk', 'Doppler', 'WorkOS',
];

const MIDCAP_COMPANIES = [
  'Stripe', 'Databricks', 'Cloudflare', 'Confluent', 'Sentry',
  'Airtable', 'MongoDB', 'Elastic', 'Amplitude', 'Mixpanel',
  'Notion', 'Figma', 'Vercel', 'Twilio', 'Datadog',
  'PagerDuty', 'Okta', 'Zendesk', 'Intercom', 'HubSpot',
  'HashiCorp', 'Segment', 'Netlify', 'LaunchDarkly', 'Postman',
];

const STARTUP_TITLES = ['founder','co-founder','ceo','cto','head of engineering','vp of engineering'];
const MIDCAP_TITLES  = ['vp of engineering','director of engineering','head of engineering','engineering manager','vp product','technical recruiter'];

// ── Routes ──────────────────────────────────────────────────────────────────

// List all prospects (with filters)
router.get('/', async (req, res) => {
  try {
    const { type, status, search } = req.query;
    let sql = 'SELECT * FROM prospects WHERE user_id = $1';
    const params = [req.user.id];
    let i = 2;
    if (type)   { sql += ` AND company_type = $${i++}`; params.push(type); }
    if (status) { sql += ` AND status = $${i++}`;        params.push(status); }
    if (search) {
      sql += ` AND (name ILIKE $${i} OR company_name ILIKE $${i+1} OR title ILIKE $${i+2})`;
      i += 3;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY created_at DESC';
    res.json(await all(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats for the dashboard header
router.get('/stats', async (req, res) => {
  try {
    const [t, v, g, s, r] = await Promise.all([
      one("SELECT COUNT(*)::int AS n FROM prospects WHERE user_id = $1", [req.user.id]),
      one("SELECT COUNT(*)::int AS n FROM prospects WHERE email_status IN ('verified','likely') AND user_id = $1", [req.user.id]),
      one("SELECT COUNT(*)::int AS n FROM prospects WHERE status = 'generated' AND user_id = $1", [req.user.id]),
      one("SELECT COUNT(*)::int AS n FROM prospects WHERE status = 'sent' AND user_id = $1", [req.user.id]),
      one("SELECT COUNT(*)::int AS n FROM prospects WHERE status = 'replied' AND user_id = $1", [req.user.id]),
    ]);
    res.json({
      total: t?.n || 0,
      verified: v?.n || 0,
      generated: g?.n || 0,
      sent: s?.n || 0,
      replied: r?.n || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-discover prospects for a company type
router.post('/discover', async (req, res) => {
  const { mode = 'startup', limit = 10 } = req.body;
  const companies = mode === 'startup' ? STARTUP_COMPANIES : MIDCAP_COMPANIES;
  const titles    = mode === 'startup' ? STARTUP_TITLES : MIDCAP_TITLES;
  const batch     = companies.slice(0, Number(limit));

  const results = { added: 0, skipped: 0, companies: [] };

  for (const companyName of batch) {
    const existingRow = await one(
      "SELECT COUNT(*)::int AS n FROM prospects WHERE company_name = $1 AND user_id = $2",
      [companyName, req.user.id]
    );
    const existing = existingRow?.n || 0;
    if (existing > 0) {
      results.skipped++;
      results.companies.push({ company: companyName, status: 'already_exists', count: existing });
      continue;
    }

    let people = [];
    try {
      const apolloRes = await apollo.searchPeople(companyName, titles);
      people.push(...apolloRes.map(p => ({
        name: p.name, title: p.title, linkedin_url: p.linkedin_url,
        email: p.email, email_status: p.email_status,
      })));
    } catch (err) {
      console.error(`Apollo failed for ${companyName}:`, err.message);
    }

    if (people.length === 0) {
      try {
        const apifyRes = await apify.findLinkedInDecisionMakers(companyName, mode);
        people.push(...apifyRes.map(p => ({
          name: p.name, title: p.title, linkedin_url: p.linkedin_url,
          email: '', email_status: 'unknown',
        })));
      } catch (err) {
        console.error(`Apify failed for ${companyName}:`, err.message);
      }
    }

    let saved = 0;
    await tx(async (client) => {
      for (const p of people.slice(0, 3)) {
        if (!p.name || p.name === 'Unknown') continue;
        const r = await client.query(`
          INSERT INTO prospects (name, title, linkedin_url, email, email_status, company_name, company_type, user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (user_id, name, company_name) DO NOTHING
        `, [p.name, p.title, p.linkedin_url, p.email || null, p.email_status || 'unknown', companyName, mode, req.user.id]);
        if (r.rowCount > 0) { results.added++; saved++; }
      }
    });

    results.companies.push({ company: companyName, status: 'done', count: saved });
    console.log(`${companyName}: ${saved} prospects saved`);
  }

  res.json(results);
});

// Add a single company manually
router.post('/add-company', async (req, res) => {
  try {
    const { companyName, companyType = 'startup' } = req.body;
    if (!companyName) return res.status(400).json({ error: 'companyName required' });

    const titles = companyType === 'startup' ? STARTUP_TITLES : MIDCAP_TITLES;
    let people = [];

    try {
      const apolloRes = await apollo.searchPeople(companyName, titles);
      people.push(...apolloRes);
    } catch (err) { console.error('Apollo:', err.message); }

    if (people.length === 0) {
      try {
        const apifyRes = await apify.findLinkedInDecisionMakers(companyName, companyType);
        people.push(...apifyRes);
      } catch (err) { console.error('Apify:', err.message); }
    }

    let added = 0;
    await tx(async (client) => {
      for (const p of people) {
        if (!p.name || p.name === 'Unknown') continue;
        const r = await client.query(`
          INSERT INTO prospects (name, title, linkedin_url, email, email_status, company_name, company_type, user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (user_id, name, company_name) DO NOTHING
        `, [p.name, p.title || '', p.linkedin_url || null, p.email || null, p.email_status || 'unknown', companyName, companyType, req.user.id]);
        if (r.rowCount > 0) added++;
      }
    });

    const saved = await all(
      'SELECT * FROM prospects WHERE company_name = $1 AND user_id = $2',
      [companyName, req.user.id]
    );
    res.json({ added, people: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate cold email + LinkedIn DM for a prospect
router.post('/:id/generate', async (req, res) => {
  try {
    const prospect = await one(
      'SELECT * FROM prospects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

    const { extraContext = '' } = req.body;
    const params = {
      recipientName:  prospect.name,
      recipientTitle: prospect.title,
      companyName:    prospect.company_name,
      companyStage:   prospect.company_type,
      extraContext,
      sender:         await loadSenderProfile(req.user.id),
    };

    const [email, linkedin] = await Promise.all([
      generateOutreach({ ...params, type: 'cold_email' }),
      generateOutreach({ ...params, type: 'linkedin' }),
    ]);

    await run(`
      UPDATE prospects
      SET email_subject = $1, email_body = $2, linkedin_dm = $3, status = 'generated', updated_at = NOW()
      WHERE id = $4 AND user_id = $5
    `, [email.subject, email.body, linkedin.message || linkedin.body, prospect.id, req.user.id]);

    res.json({ email, linkedin });
  } catch (err) {
    console.error('Generate prospect outreach error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Find / verify email for a prospect
router.post('/:id/find-email', async (req, res) => {
  try {
    const prospect = await one(
      'SELECT * FROM prospects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

    if (prospect.linkedin_url) {
      try {
        const enriched = await apollo.enrichPerson(prospect.linkedin_url);
        if (enriched.email) {
          await run(
            "UPDATE prospects SET email = $1, email_status = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4",
            [enriched.email, enriched.email_status, prospect.id, req.user.id]
          );
          return res.json({ email: enriched.email, email_status: enriched.email_status });
        }
      } catch (err) { console.error('Enrich failed:', err.message); }
    }

    const nameParts = prospect.name.toLowerCase().split(/\s+/);
    const first = nameParts[0] || '';
    const last  = nameParts[nameParts.length - 1] || '';
    let domain  = '';
    try { domain = await apollo.getCompanyDomain(prospect.company_name); } catch {}
    if (!domain) domain = prospect.company_name.toLowerCase().replace(/[^a-z0-9]/g,'') + '.com';

    const patterns = [
      `${first}.${last}@${domain}`,
      `${first}@${domain}`,
      `${first[0]}${last}@${domain}`,
      `${first}${last}@${domain}`,
      `${first}_${last}@${domain}`,
    ];

    res.json({ email: null, patterns, domain, note: 'No verified email found — use patterns below' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify existing email
router.post('/:id/verify-email', async (req, res) => {
  try {
    const prospect = await one(
      'SELECT * FROM prospects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!prospect?.email) return res.status(400).json({ error: 'No email to verify' });

    const result = await apollo.verifyEmail(prospect.email);
    await run(
      "UPDATE prospects SET email_status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
      [result.status, prospect.id, req.user.id]
    );

    res.json({ email: prospect.email, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update status / notes
router.put('/:id', async (req, res) => {
  try {
    const { status, notes, email, email_subject, email_body, linkedin_dm } = req.body;
    const prospect = await one(
      'SELECT * FROM prospects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!prospect) return res.status(404).json({ error: 'Not found' });

    await run(`
      UPDATE prospects SET
        status        = COALESCE($1, status),
        notes         = COALESCE($2, notes),
        email         = COALESCE($3, email),
        email_subject = COALESCE($4, email_subject),
        email_body    = COALESCE($5, email_body),
        linkedin_dm   = COALESCE($6, linkedin_dm),
        updated_at    = NOW()
      WHERE id = $7 AND user_id = $8
    `, [status || null, notes || null, email || null, email_subject || null, email_body || null, linkedin_dm || null, prospect.id, req.user.id]);

    res.json(await one(
      'SELECT * FROM prospects WHERE id = $1 AND user_id = $2',
      [prospect.id, req.user.id]
    ));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a prospect
router.delete('/:id', async (req, res) => {
  try {
    await run(
      'DELETE FROM prospects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

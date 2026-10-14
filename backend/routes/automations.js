/**
 * automations.js
 * Job Automations: LinkedIn Finder, AI Search, Auto-Apply, Scheduled Runs.
 */

import { Router } from 'express';
import { one, run } from '../db.js';
import { complete } from '../services/llm.js';
import { scrapeAllSources } from '../services/scraper.js';

const router = Router();

// ── Automation log helpers ────────────────────────────────────────────────────
async function logEntry(automationId, message, userId) {
  const ts = new Date().toTimeString().slice(0, 8);
  try {
    const cur = (await one(
      "SELECT value FROM meta WHERE key = $1 AND user_id = $2",
      [`log_${automationId}`, userId]
    ))?.value;
    const prev = cur ? JSON.parse(cur) : [];
    prev.unshift({ ts: new Date().toISOString(), msg: message });
    if (prev.length > 200) prev.length = 200;
    await run(
      "INSERT INTO meta (key, value, user_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value",
      [`log_${automationId}`, JSON.stringify(prev), userId]
    );
  } catch (_) {}
  console.log(`[auto:${automationId}]`, message);
}

// ── GET /api/automations/logs/:id ─────────────────────────────────────────────
router.get('/logs/:id', async (req, res) => {
  try {
    const row = await one(
      "SELECT value FROM meta WHERE key = $1 AND user_id = $2",
      [`log_${req.params.id}`, req.user.id]
    );
    res.json(row?.value ? JSON.parse(row.value) : []);
  } catch (err) {
    res.json([]);
  }
});

// ── GET /api/automations/scheduled ───────────────────────────────────────────
router.get('/scheduled', async (req, res) => {
  try {
    const row = await one(
      "SELECT value FROM meta WHERE key = 'scheduled_automations' AND user_id = $1",
      [req.user.id]
    );
    res.json(row?.value ? JSON.parse(row.value) : []);
  } catch (err) { res.json([]); }
});

// ── POST /api/automations/scheduled ──────────────────────────────────────────
router.post('/scheduled', async (req, res) => {
  try {
    const { automationId, label, cronTime, params } = req.body;
    const row = await one(
      "SELECT value FROM meta WHERE key = 'scheduled_automations' AND user_id = $1",
      [req.user.id]
    );
    const list = row?.value ? JSON.parse(row.value) : [];
    const existing = list.findIndex(s => s.automationId === automationId);
    const entry = { automationId, label, cronTime, params, createdAt: new Date().toISOString(), lastRun: null, lastResult: null };
    if (existing >= 0) list[existing] = entry;
    else list.push(entry);
    await run(
      "INSERT INTO meta (key, value, user_id) VALUES ('scheduled_automations', $1, $2) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value",
      [JSON.stringify(list), req.user.id]
    );
    res.json({ ok: true, list });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/automations/scheduled/:id ────────────────────────────────────
router.delete('/scheduled/:id', async (req, res) => {
  try {
    const row = await one(
      "SELECT value FROM meta WHERE key = 'scheduled_automations' AND user_id = $1",
      [req.user.id]
    );
    const list = row?.value ? JSON.parse(row.value) : [];
    const filtered = list.filter(s => s.automationId !== req.params.id);
    await run(
      "INSERT INTO meta (key, value, user_id) VALUES ('scheduled_automations', $1, $2) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value",
      [JSON.stringify(filtered), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/automations/linkedin-finder ─────────────────────────────────────
router.post('/linkedin-finder', async (req, res) => {
  const { jobTitle = 'Software Engineer Intern', location = 'United States', jobType = 'intern' } = req.body;

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

  const id = 'linkedin-finder';
  try {
    await logEntry(id, `Starting LinkedIn Job Finder — "${jobTitle}" in ${location}`, req.user.id);
    emit('log', { msg: `Searching LinkedIn for "${jobTitle}" in ${location}…` });

    const query = `${jobTitle} ${jobType}`.trim();
    const { results } = await scrapeAllSources(query, 'Tech & Software');

    await logEntry(id, `Found ${results.length} results for "${query}"`, req.user.id);
    emit('log', { msg: `Found ${results.length} results` });

    const jobs = results.slice(0, 50).map(r => ({
      title: r.role || jobTitle,
      company: r.name,
      location: r.location || location,
      postedAt: null,
      applyUrl: r.careersUrl || '',
      source: 'linkedin_finder',
    }));

    await logEntry(id, `Returning ${jobs.length} jobs to UI`, req.user.id);
    emit('results', { jobs, total: jobs.length });
    emit('done', { msg: `Done — ${jobs.length} jobs found` });
    if (!closed) res.end();
  } catch (err) {
    await logEntry(id, `Error: ${err.message}`, req.user.id);
    emit('error', { error: err.message });
    if (!closed) res.end();
  }
});

// ── POST /api/automations/ai-search ──────────────────────────────────────────
router.post('/ai-search', async (req, res) => {
  const { description, salaryMin, salaryMax, remote } = req.body;

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

  const id = 'ai-search';
  try {
    emit('log', { msg: 'Generating optimized search queries from your description…' });
    await logEntry(id, `AI search started: "${description}"`, req.user.id);

    const queryPrompt = `Generate 4 optimized job search queries based on this description: "${description}"
    ${salaryMin ? `Salary range: $${salaryMin}k-$${salaryMax}k` : ''}
    ${remote ? 'Preference: Remote' : ''}

    Return ONLY a JSON array of 4 search query strings, no explanation. Example:
    ["ML engineering intern NYC AI startup", "machine learning intern new york", "AI engineer intern fintech", "data science intern startup NYC"]`;

    let queries = [];
    try {
      const { text } = await complete({ task: 'score', user: queryPrompt, maxTokens: 800 });
      const raw = text.replace(/```json?/g, '').replace(/```/g, '').trim();
      queries = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
      if (!Array.isArray(queries) || !queries.length) throw new Error('no queries');
    } catch (_) {
      queries = [description, `${description} intern`, `${description} entry level`];
    }

    emit('log', { msg: `Generated ${queries.length} search queries — running across all sources…` });
    await logEntry(id, `Generated queries: ${queries.join(' | ')}`, req.user.id);

    const allJobs = [];
    for (const q of queries.slice(0, 3)) {
      if (closed) break;
      try {
        emit('log', { msg: `Searching: "${q}"` });
        await logEntry(id, `Searching: "${q}"`, req.user.id);
        const { results } = await scrapeAllSources(q, 'Tech & Software');
        const jobs = results.slice(0, 20).map(r => ({
          title: r.role || q,
          company: r.name,
          location: r.location || 'USA',
          applyUrl: r.careersUrl || '',
          source: 'ai_search',
          query: q,
        }));
        allJobs.push(...jobs);
        emit('log', { msg: `"${q}" → ${jobs.length} results` });
      } catch (err) {
        emit('log', { msg: `"${q}" failed: ${err.message}` });
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    const seen = new Set();
    const unique = allJobs.filter(j => {
      if (seen.has(j.company.toLowerCase())) return false;
      seen.add(j.company.toLowerCase());
      return true;
    });

    await logEntry(id, `AI search complete — ${unique.length} unique results`, req.user.id);
    emit('results', { jobs: unique, total: unique.length });
    emit('done', { msg: `Done — ${unique.length} unique jobs found` });
    if (!closed) res.end();
  } catch (err) {
    await logEntry(id, `Error: ${err.message}`, req.user.id);
    emit('error', { error: err.message });
    if (!closed) res.end();
  }
});

// ── POST /api/automations/auto-apply — DEPRECATED ───────────────────────────
// This legacy flow bypassed the consent gate, profile validation, sponsorship
// check, and supported-ATS guards that the newer Career Ops auto-apply path
// enforces. It also included a LinkedIn Easy Apply submitter that could submit
// applications without those safeguards. Disabled to prevent silent submissions.
//
// Use POST /api/career/auto-apply/run (queue-driven) instead, which calls
// processOneEvaluation() with the full safety pipeline.
router.post('/auto-apply', (req, res) => {
  res.status(410).json({
    error: 'Endpoint removed. Use the Career Ops auto-apply queue (/api/career/auto-apply/run), which enforces consent and safety gates.',
  });
});

export default router;

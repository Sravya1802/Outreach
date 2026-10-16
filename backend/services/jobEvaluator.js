/**
 * jobEvaluator.js
 * Evaluates a job description against a resume using the santifer/career-ops
 * `oferta` mode (A-G blocks, archetype detection, 1-5 score).
 *
 * Prompts are loaded verbatim from backend/career-ops-src/modes/ at runtime.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { complete } from './llm.js';
import { safeFetch, UnsafeUrlError } from './safeFetch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODES_DIR = path.join(__dirname, '..', 'career-ops-src', 'modes');

// Load santifer's canonical mode files once at module load.
// Prefer the English-translated versions (*.en.md); fall back to the original
// Spanish files if the English ones haven't been generated yet.
function loadMode(name) {
  const en = path.join(MODES_DIR, `${name}.en.md`);
  if (fs.existsSync(en)) return fs.readFileSync(en, 'utf8');
  return fs.readFileSync(path.join(MODES_DIR, `${name}.md`), 'utf8');
}
const OFERTA_MD = loadMode('oferta');
const SHARED_MD = loadMode('_shared');

// ── AI call ───────────────────────────────────────────────────────────────────
//
// Provider preference for evaluation quality (when Anthropic is unavailable):
//   1. OpenAI gpt-4o — strong reasoning, JSON mode, ~$0.05 per eval
//   2. Gemini 2.5 Pro — comparable reasoning, ~$0.04 per eval
//   3. Anthropic (claude.js CLAUDE_MODEL) with prompt caching — only if user provides key
//
// We prefer the FULL gpt-4o (not -mini) here because the verdict / top-3 gaps /
// calibrated probability schema needs real reasoning depth — mini is too
// shallow and produces hedged, generic output. Same reason 2.5 Pro over Flash.

// Evaluations run on the "evaluate" route (services/llm.js): Groq gpt-oss,
// OpenAI as backup, metered and capped there. JSON mode; the long rubric
// system prompt is the stable prefix, so providers can cache it.
async function callAI({ system, user }) {
  const r = await complete({ task: 'evaluate', system, user, json: true, maxTokens: 12000, timeoutMs: 120_000 });
  return r.text;
}

// ── Fetch job page content from URL ──────────────────────────────────────────

// Workday job pages are JavaScript-rendered SPAs — plain fetch() returns an
// empty HTML shell. Workday exposes a public JSON API for every posting
// though, so we can detour through that and skip the SPA entirely.
//
// URL pattern  → API endpoint:
//   https://<tenant>.<wd>.myworkdayjobs.com/[en-US/]<site>/job/<loc>/<slug>_<jobReqId>
//   →  https://<tenant>.<wd>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/job/<loc>/<slug>_<jobReqId>
//
// The CXS API echoes the entire public path after /job/, not just the
// jobReqId. Strip the optional /en-US/ locale prefix and inject /wday/cxs/.
function workdayApiUrl(jobUrl) {
  try {
    const u = new URL(jobUrl);
    if (!/myworkdayjobs\.com$/i.test(u.hostname)) return null;
    const tenant = u.hostname.split('.')[0];
    const parts = u.pathname.split('/').filter(Boolean);
    // Drop a leading /en-US (or any /xx-XX) locale prefix.
    const startIdx = /^[a-z]{2}-[a-z]{2}$/i.test(parts[0]) ? 1 : 0;
    const tail = parts.slice(startIdx);
    if (tail.length < 3) return null;
    const site = tail[0];
    if (tail[1] !== 'job') return null;
    // Re-stitch /job/<everything-after> verbatim.
    const jobPath = '/' + tail.slice(1).join('/');
    if (!tenant || !site) return null;
    return `${u.protocol}//${u.hostname}/wday/cxs/${tenant}/${site}${jobPath}`;
  } catch { return null; }
}

// Returns { text } on success, or { error: 'message' } when we can confidently
// describe what went wrong (e.g. the role was closed). null = unknown failure
// so the caller falls through to plain HTML fetch.
async function fetchWorkdayJD(jobUrl) {
  const api = workdayApiUrl(jobUrl);
  if (!api) return null;
  const u = new URL(jobUrl);
  const tenant = u.hostname.split('.')[0];
  const parts  = u.pathname.split('/').filter(Boolean);
  const startIdx = /^[a-z]{2}-[a-z]{2}$/i.test(parts[0]) ? 1 : 0;
  const tail = parts.slice(startIdx);
  const site = tail[0];
  // Extract the jobReqId from the slug — it's the trailing token after the
  // last underscore in the URL slug (e.g. "_R-1089"). Used as a fallback
  // search term when the direct CXS path 404s because the URL location
  // segment doesn't match Workday's canonical form (e.g. "San-Jose-CA" vs
  // "San-Jose---California" with triple dashes).
  const slug = tail[tail.length - 1] || '';
  const jobReqId = (slug.match(/_([A-Z0-9-]+)$/i) || [])[1] || '';

  // Helper: given a CXS URL, try GET it and parse the description.
  async function fetchAndParse(apiUrl) {
    const res = await fetch(apiUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 ScoutnJobs/1.0' },
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) return { status: res.status };
    const data = await res.json().catch(() => null);
    if (!data) return { status: 'parse_error' };
    const info = data?.jobPostingInfo || data;
    const partsArr = [
      info?.title,
      info?.jobDescription,
      info?.jobRequisitionLocation?.descriptor,
      info?.timeType,
    ].filter(Boolean);
    if (!partsArr.length) return { status: 'empty' };
    const { load } = await import('cheerio');
    const $ = load(`<div>${partsArr.join('\n\n')}</div>`);
    const text = $('div').text().replace(/\s{3,}/g, '\n\n').trim().slice(0, 8000);
    return text.length > 200 ? { text } : { status: 'short' };
  }

  try {
    // Path 1: try the direct URL we built from the path.
    const direct = await fetchAndParse(api);
    if (direct.text) return direct.text;

    // Path 2: 404 — try Workday's CXS jobs search by jobReqId, then GET the
    // canonical externalPath. Catches URL-slug mismatches.
    if (direct.status === 404 && jobReqId && tenant && site) {
      const searchUrl = `${u.protocol}//${u.hostname}/wday/cxs/${tenant}/${site}/jobs`;
      const searchRes = await fetch(searchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 ScoutnJobs/1.0' },
        body: JSON.stringify({ searchText: jobReqId, limit: 5, offset: 0 }),
        signal: AbortSignal.timeout(10000),
      });
      if (searchRes.ok) {
        const sdata = await searchRes.json().catch(() => null);
        const total = sdata?.total ?? 0;
        const match = (sdata?.jobPostings || []).find(p =>
          (p.bulletFields || []).includes(jobReqId) ||
          (p.externalPath || '').endsWith(`_${jobReqId}`)
        );
        if (match?.externalPath) {
          const canonical = `${u.protocol}//${u.hostname}/wday/cxs/${tenant}/${site}${match.externalPath}`;
          const second = await fetchAndParse(canonical);
          if (second.text) return second.text;
        }
        // No match found AND total is 0: posting almost certainly removed.
        if (total === 0) {
          return { error: 'This Workday posting appears to be closed or removed (no matching job in their public API). The job page may still load in a browser but the data is gone.' };
        }
      }
    }

    return null;
  } catch { return null; }
}

// Ashby pages are React SPAs — plain fetch returns ~46 chars of HTML shell.
// Ashby's public job-board API returns descriptionPlain for every listed job.
//   URL: https://jobs.ashbyhq.com/<org>/<jobId>[/application]?...
//   API: https://api.ashbyhq.com/posting-api/job-board/<org>?includeCompensation=true
// We pull the whole board (small JSON, single request) and filter by jobId.
async function fetchAshbyJD(jobUrl) {
  try {
    const u = new URL(jobUrl);
    if (!/jobs\.ashbyhq\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const org = parts[0];
    const jobId = parts[1];
    if (!org || !jobId) return null;
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 ScoutnJobs/1.0' },
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const job = (data?.jobs || []).find(j => j.id === jobId);
    if (!job) return null;
    const text = [
      job.title,
      job.location,
      job.employmentType,
      job.descriptionPlain,
    ].filter(Boolean).join('\n\n').replace(/\s{3,}/g, '\n\n').trim().slice(0, 8000);
    return text.length > 200 ? text : null;
  } catch { return null; }
}

// Greenhouse boards expose every posting via a public JSON API.
//   URL: https://boards.greenhouse.io/<board>/jobs/<id>
//        https://job-boards.greenhouse.io/<board>/jobs/<id>
//   API: https://boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>?content=true
async function fetchGreenhouseJD(jobUrl) {
  try {
    const u = new URL(jobUrl);
    if (!/^(boards|job-boards)\.greenhouse\.io$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (!m) return null;
    const [, board, id] = m;
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}?content=true`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 ScoutnJobs/1.0' },
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const { load } = await import('cheerio');
    const $ = load(`<div>${data?.content || ''}</div>`);
    const text = [
      data?.title,
      data?.location?.name,
      $('div').text().replace(/&nbsp;/g, ' '),
    ].filter(Boolean).join('\n\n').replace(/\s{3,}/g, '\n\n').trim().slice(0, 8000);
    return text.length > 200 ? text : null;
  } catch { return null; }
}

// Lever postings expose a public JSON API.
//   URL: https://jobs.lever.co/<org>/<id>[/apply]
//   API: https://api.lever.co/v0/postings/<org>/<id>?mode=json
async function fetchLeverJD(jobUrl) {
  try {
    const u = new URL(jobUrl);
    if (!/jobs\.lever\.co$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)/);
    if (!m) return null;
    const [, org, id] = m;
    const res = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(org)}/${encodeURIComponent(id)}?mode=json`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 ScoutnJobs/1.0' },
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const { load } = await import('cheerio');
    const lists = (data?.lists || []).map(l => `${l.text || ''}\n${(l.content || '').replace(/<[^>]+>/g, '')}`).join('\n\n');
    const $ = load(`<div>${data?.descriptionPlain || data?.description || ''}</div>`);
    const text = [
      data?.text,
      data?.categories?.location,
      data?.categories?.commitment,
      $('div').text(),
      lists,
    ].filter(Boolean).join('\n\n').replace(/\s{3,}/g, '\n\n').trim().slice(0, 8000);
    return text.length > 200 ? text : null;
  } catch { return null; }
}

export async function fetchJobFromUrl(url) {
  // Try host-specific JSON APIs first — saves us from wasted plain-HTML
  // fetches against React/SPA boards that only return an empty shell.
  if (/myworkdayjobs\.com/i.test(url)) {
    const wd = await fetchWorkdayJD(url);
    if (typeof wd === 'string' && wd.length) return { text: wd, url, source: 'workday-api' };
    if (wd && typeof wd === 'object' && wd.error) {
      return { text: null, url, error: wd.error };
    }
  }
  if (/jobs\.ashbyhq\.com/i.test(url)) {
    const t = await fetchAshbyJD(url);
    if (t) return { text: t, url, source: 'ashby-api' };
  }
  if (/(boards|job-boards)\.greenhouse\.io/i.test(url)) {
    const t = await fetchGreenhouseJD(url);
    if (t) return { text: t, url, source: 'greenhouse-api' };
  }
  if (/jobs\.lever\.co/i.test(url)) {
    const t = await fetchLeverJD(url);
    if (t) return { text: t, url, source: 'lever-api' };
  }

  try {
    // cheerio v1.x ESM exports `load` as a named export, not default.
    // `{ default: cheerio }` resolves to undefined → `cheerio.load(...)` throws
    // "Cannot read properties of undefined (reading 'load')".
    const { load } = await import('cheerio');
    let fetched;
    try {
      fetched = await safeFetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        timeoutMs: 10000,
      });
    } catch (err) {
      if (err instanceof UnsafeUrlError) return { text: null, url, error: `${err.message} — paste the job description instead` };
      throw err;
    }
    const { res } = fetched;
    if (!res.ok) {
      return { text: null, url, error: `HTTP ${res.status} ${res.statusText} — site blocked the fetch (try Paste JD instead)` };
    }
    const html = await fetched.text();
    const $ = load(html);

    $('script, style, nav, footer, header, iframe, .cookie-banner').remove();

    const selectors = [
      '[class*="job-description"]', '[class*="JobDescription"]',
      '[class*="posting-content"]', '[class*="description"]',
      'article', 'main', '.content', '#content',
    ];
    let text = '';
    for (const sel of selectors) {
      const el = $(sel).first();
      if (el.length && el.text().trim().length > 200) {
        text = el.text().trim();
        break;
      }
    }
    if (!text) text = $('body').text().trim();

    text = text.replace(/\s{3,}/g, '\n\n').slice(0, 8000);

    // Pages that are JS-rendered (Workday, Greenhouse-iframe, some Lever
    // boards) return an HTML shell with ~empty body — call that out instead
    // of bubbling `undefined` through to the UI.
    if (text.length < 200) {
      return {
        text: null,
        url,
        error: `Page returned only ${text.length} chars of text — likely a JavaScript-rendered SPA. Use the Paste JD tab instead.`,
      };
    }
    return { text, url };
  } catch (err) {
    console.error('[jobEvaluator] fetchJobFromUrl failed:', err.message);
    return { text: null, url, error: err.message || 'fetch failed' };
  }
}

// ── Main evaluation ───────────────────────────────────────────────────────────
//
// Implements santifer/career-ops `oferta` mode: Paso 0 archetype + blocks A-G.
// The AI is instructed to follow oferta.md / _shared.md verbatim, but to return
// the result as structured JSON so the web UI can render it.

export async function evaluateJob({ jobDescription, resumeText, jobUrl = null }) {
  if (!resumeText) throw new Error('No resume uploaded. Please upload your resume first.');
  if (!jobDescription || jobDescription.trim().length < 50) throw new Error('Job description is too short to evaluate.');

  // System message — static rubric, gets prompt-cached on Anthropic for ~90%
  // cost reduction across evaluations. Don't interpolate per-call data here.
  const system = `You are a senior career strategist running an evaluation. Your job is to be the brutally honest, calibrated friend who has read both the JD and CV closely and tells the candidate exactly where they stand and what to fix.

# Output style — match this voice exactly

The output is rendered in a web UI but read like a Slack DM from a strategist friend. The candidate has used Claude.ai before by pasting JD + CV into a chat — your output must feel at least as sharp as that.

✅ DO:
- Lead with a verdict: "No, not for X" / "Strong fit, apply now" / "Marginal — only if you tailor". Be decisive.
- Identify the buried match. If the CV has a bullet that mirrors the JD perfectly but is underleveraged, call that out specifically. ("Your X role is a near-perfect Y mirror, but your resume buries it as just 'general ML candidate'.")
- Top-3 gaps: surgical, JD-quoting, with concrete fixes. ("JD explicitly names X, Y, Z — none in your skills section. ATS will dock you.")
- Calibrated probability: give numerical interview odds as-is and properly-tailored. ("As-is: ~35-45%. Properly tailored: ~65-75%.")
- Tactical specifics: "swap FinPath for an LLM-based medical record entity extractor" beats "consider stronger projects."
- Quote JD phrases verbatim. Quote CV lines verbatim. Never paraphrase what they said.

❌ DO NOT:
- Hedge with "shows strong potential", "demonstrates passion", "could benefit from".
- Rate everything 4/5 to be polite — calibrate honestly. C and D grades exist.
- Generalize ("technical skills look good"). Always cite specifics.
- Invent CV content. If a JD requirement isn't in the CV, status = "gap".
- Use corporate language ("synergy", "leverage", "passionate", "rockstar").

# Quality bar

Every score, every assessment, every flag must be JUSTIFIABLE by quoting evidence. The UI exposes a "Why?" expander on every verdict — what you write in reasoning/finding/why fields is what users see when they click it. Generic prose there fails the bar. If you can't explain WHY in one specific sentence, lower your confidence and say "unknown".

# Output format

Return ONLY a single valid JSON object matching the schema in the user message. No markdown wrapper, no code fences, no preamble. Inside string fields you may use inline markdown (bold, lists). Every numeric score is a float to one decimal.

================ SYSTEM CONTEXT (_shared.md) ================
${SHARED_MD}

================ OFERTA MODE (oferta.md) ================
${OFERTA_MD}`;

  // User message — per-call payload (CV + JD + schema). Not cached.
  const user = `CANDIDATE
Target: internship / new-grad roles (the candidate's name and background are in the CV below)

CV (verbatim — cite exact lines, do NOT invent content not present here):
"""
${resumeText.slice(0, 8000)}
"""

JOB${jobUrl ? `\nURL: ${jobUrl}` : ''}
JD (verbatim):
"""
${jobDescription.slice(0, 6000)}
"""

OUTPUT SCHEMA (return ONLY this JSON object, populated from the CV+JD above):
{
  "jobTitle": "string — exact role title from JD",
  "companyName": "string — company name from JD",
  "verdict": {
    "headline": "ONE sentence, decisive. Examples: 'No, not for Tempus.' / 'Strong fit, apply this week.' / 'Marginal — only if you rewrite the summary first.'",
    "oneLineWhy": "ONE sentence explaining the verdict in plain language. No hedge. Quote 1-2 JD/CV phrases that drive it.",
    "buriedMatch": "string or null — if the CV has experience that perfectly mirrors the JD but is currently underleveraged or hidden in generic phrasing, name it specifically and quote how the CV currently frames it. null if no such buried match.",
    "interviewOdds": {
      "asIs": "string — calibrated probability range, e.g. '~35-45%'",
      "properlyTailored": "string — calibrated probability after taking the cvChanges below, e.g. '~65-75%'",
      "reasoning": "1-2 sentences justifying both numbers"
    }
  },
  "topGaps": [
    {"gap": "ONE specific gap, JD-quoting", "fix": "concrete tactical fix — what to add/rewrite/swap, quoting the exact CV section affected", "severity": "blocker | high | medium"}
  ],
  "archetype": {
    "primary": "AI Platform / LLMOps | Agentic / Automation | Technical AI PM | AI Solutions Architect | AI Forward Deployed | AI Transformation | Other",
    "secondary": "string or null — only if hybrid",
    "reasoning": "2-3 sentences. Quote 2-3 specific JD phrases that signal this archetype."
  },
  "globalScore": <float 1.0-5.0, one decimal>,
  "scoreBreakdown": {
    "cvMatch": <float 1-5>,
    "northStar": <float 1-5>,
    "comp": <float 1-5>,
    "culture": <float 1-5>,
    "redFlags": <float 1-5, lower = more red flags>
  },
  "recommendation": "Strong match — apply immediately | Good match — worth applying | Decent but not ideal | Recommend against applying",
  "blockA_roleSummary": {
    "archetypeDetected": "echoes archetype.primary",
    "domain": "platform | agentic | LLMOps | ML | enterprise | other",
    "function": "build | consult | manage | deploy | other",
    "seniority": "intern | new-grad | junior | mid | senior | staff | unknown",
    "remote": "full | hybrid | onsite | unknown",
    "teamSize": "string or 'not mentioned'",
    "tldr": "1 sentence — what this role actually does day-to-day"
  },
  "blockB_cvMatch": {
    "requirements": [
      {"requirement": "exact JD phrase", "cvEvidence": "exact CV line OR 'none'", "status": "match | partial | gap", "reasoning": "1 sentence — why this status, what's the gap if any"}
    ],
    "gaps": [
      {"gap": "missing skill/experience", "severity": "hard blocker | nice-to-have", "adjacentExperience": "closest CV experience or null", "mitigation": "concrete plan — cover-letter phrasing, quick project, story to tell"}
    ]
  },
  "blockC_levelAndStrategy": {
    "jdLevel": "level detected in JD with the phrase that signaled it",
    "candidateNaturalLevel": "candidate's natural level for this archetype, with reasoning",
    "sellSeniorPlan": ["concrete tactic 1 — quote a CV line", "tactic 2", "tactic 3"],
    "ifDownleveledPlan": ["accept-if condition 1", "negotiation lever 2"]
  },
  "blockD_compAndDemand": {
    "salaryRange": "e.g. $X–$Y based on Levels.fia/Glassdoor for this role+location, OR 'unknown — no public data'",
    "companyCompReputation": "1-2 sentences — known comp positioning vs market",
    "roleDemandTrend": "rising | steady | declining | unknown",
    "reasoning": "2-3 sentences — what signals informed the trend",
    "sources": ["source 1", "source 2"]
  },
  "blockE_personalization": {
    "cvChanges": [
      {"section": "Summary | Experience | Skills | Projects", "currentState": "quote current CV text", "proposedChange": "exact rewrite", "why": "which JD requirement this serves"}
    ],
    "linkedinChanges": ["specific change 1 with rationale", "change 2"]
  },
  "blockF_interviewPrep": {
    "starStories": [
      {"jdRequirement": "exact JD requirement", "situation": "S — quote CV", "task": "T", "action": "A", "result": "R with metrics if available", "reflection": "what was learned / would do differently"}
    ],
    "caseStudyRecommendation": "which CV project to present, in what framing, and which JD bullets it answers",
    "redFlagQuestions": [
      {"question": "likely tough interview question this CV invites", "answer": "how to respond, with specific framing"}
    ]
  },
  "blockG_legitimacy": {
    "assessment": "High Confidence | Proceed with Caution | Suspicious",
    "signals": [
      {"signal": "Posting freshness | Description quality | Company hiring signals | Reposting | Role market context", "finding": "specific observation with detail — what made you draw this conclusion", "weight": "Positive | Neutral | Concerning"}
    ],
    "contextNotes": "1-2 sentences — caveats, niche role, evergreen posting, ghost-job indicators"
  },
  "atsKeywords": ["15-20 exact keywords pulled from the JD that the candidate's CV should mirror — prioritize multi-word technical phrases over single common words"]
}

Hard rules:
- verdict.headline: ONE decisive sentence. No "could be a fit if conditions are met" — pick a side.
- topGaps: EXACTLY the 3 most important gaps, ranked by impact on interview odds. Not 2, not 5. Three.
- interviewOdds: numerical ranges (e.g. "30-40%"), not vague words. Be calibrated — if the CV has a near-perfect match, properlyTailored should be 65%+; if it's a stretch, asIs should be <25%.
- buriedMatch: if you find one, this is THE single highest-leverage observation. Be specific and quote both the JD requirement AND how the CV currently buries it.
- globalScore: 4.5+ Strong / 4.0-4.4 Good / 3.5-3.9 Decent / <3.5 Against. Use one decimal.
- Never invent CV content. Quote only what appears in the CV above. If a JD requirement has no CV match, status = "gap" — don't stretch.
- Never invent salary numbers. If the JD doesn't list comp and you don't have public data, say "unknown — no public data".
- Block G "Suspicious" requires ≥2 concerning signals with concrete findings. With thin data default to "Proceed with Caution".
- Every "reasoning" / "finding" / "why" field must be specific and cite source phrases. Generic answers fail review.
- Return ONLY the JSON object — no preamble, no code fences, no trailing prose.`;

  const raw = await callAI({ system, user });

  let evaluation;
  try {
    const cleaned = raw.replace(/^```json?\s*/m, '').replace(/^```\s*/m, '').replace(/```\s*$/m, '').trim();
    evaluation = JSON.parse(cleaned);
  } catch (err) {
    console.error('[jobEvaluator] JSON parse failed, raw:', raw.slice(0, 500));
    throw new Error('AI returned malformed evaluation. Please try again.');
  }

  // Back-compat fields expected by existing callers (careerOps.js, resumeGenerator.js).
  const globalScore = Number(evaluation.globalScore) || 0;
  evaluation.overallScore = Math.round(globalScore * 20); // 1-5 → 1-100
  evaluation.grade =
    globalScore >= 4.5 ? 'A' :
    globalScore >= 4.0 ? 'B' :
    globalScore >= 3.5 ? 'C' :
    globalScore >= 2.5 ? 'D' : 'F';

  return evaluation;
}

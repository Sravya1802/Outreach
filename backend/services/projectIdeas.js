/**
 * projectIdeas.js — projects to build, suggested from the roles on the
 * user's evening lists rather than one resume at a time:
 *
 *   1. the last two weeks of listed roles (top and worth tiers) with a real
 *      job description
 *   2. each role's ATS keywords (Groq, the same extraction tailoring uses)
 *   3. the hard skills those roles ask for that the master resume, included
 *      GitHub repos and built projects don't show, counted across roles
 *   4. one Opus call: 2–3 projects that would close the most common gaps,
 *      each with what it adds, bullets as they'd read on the resume and a
 *      build plan
 *
 * Runs weekly (server.js) and when the user asks. Suggestions wait on
 * Profile → Projects; once built (public repo + dates) every later resume can
 * use them.
 */

import { all, one, run } from '../db.js';
import { complete } from './llm.js';
import { hasTerm } from './ats.js';
import { looksLikeJobDescription } from './postingText.js';
import { extractKeywords, includedRepos, parsedMaster, plannedProjects } from './resumeEngine.js';
import { masterText, plannedText, repoText } from './resumeGuard.js';
import { gapsAcross } from './resumeRules.js';
import { notify as whatsappNotify, projectsMessage } from './whatsapp.js';

const LOOKBACK_DAYS = 14;
const MAX_ROLES = 30;
const MAX_OPEN = 3;
const CONCURRENCY = 3;

const S = { type: 'string' };
const SA = { type: 'array', items: S };
const obj = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const IDEAS_SCHEMA = obj({ projects: { type: 'array', items: obj({ name: S, tech: SA, bullets: SA, covers: SA, why: S, plan: SA }) } });

const SYSTEM = `You are a senior engineer and recruiter advising a new grad on portfolio projects that will get them interviews for the roles they're applying to.
You get the candidate's background and the skills their target roles keep asking for that the candidate can't show yet, with how many roles ask for each.
Suggest 2 or 3 projects the candidate will build and push to GitHub:
- Each covers several of the most-requested gaps at once; together they cover the top gaps. Prefer gaps more roles ask for.
- Buildable by one person in 1–3 weeks, and realistic for a new grad: real data or public APIs, tests, a README with a demo. No toy CRUD apps.
- Build on what the candidate already knows, so the project reads as a natural next step.
- name: "Name | Subtitle". tech: the tools it uses, in the roles' exact spelling. covers: the gap keywords it adds.
- bullets: 2–3 resume bullets for the finished project: strong verb + what it does + tools. No numbers (nothing has been measured yet), no em dashes.
- why: one sentence on which roles it helps and why.
- plan: 5–8 concrete build steps, the last one about what the README shows.
- Don't repeat a project listed as already built or suggested, and never one listed as dismissed.`;

const str = (v) => String(v ?? '').trim();
const list = (v) => (Array.isArray(v) ? v : []);
const running = new Set();

/** Listed roles worth learning from: recent, scored well, with a real description. */
async function listedRoles(userId) {
  const rows = await all(
    `SELECT DISTINCT ON (lower(company_name), lower(title)) company_name, title, job_description, score
       FROM plan_items
      WHERE user_id = $1 AND tier IN ('top', 'worth') AND created_at > NOW() - make_interval(days => $2)
      ORDER BY lower(company_name), lower(title), score DESC NULLS LAST`,
    [userId, LOOKBACK_DAYS],
  );
  return rows.filter(r => looksLikeJobDescription(r.job_description))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, MAX_ROLES);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i += limit) {
    const part = await Promise.all(items.slice(i, i + limit).map((x, j) => fn(x, i + j)));
    part.forEach((v, j) => { out[i + j] = v; });
  }
  return out;
}

/**
 * Suggest projects for one user. Returns { created, open, gaps, roles, cost }
 * or { skipped } with the reason. Leaves alone a user who already has
 * MAX_OPEN weekly suggestions waiting, unless `force`.
 */
export async function suggestProjects(userId, { force = false } = {}) {
  if (running.has(userId)) return { skipped: 'Already running' };
  running.add(userId);
  try {
    const planned = await plannedProjects(userId);
    const open = planned.filter(p => p.status === 'suggested' && p.origin === 'weekly');
    if (open.length >= MAX_OPEN && !force) return { skipped: `${open.length} suggestions are already waiting`, open: open.length };

    const roles = await listedRoles(userId);
    if (roles.length < 3) return { skipped: 'Not enough roles on your recent lists yet' };
    const { parsed, cost: parseCost } = await parsedMaster(userId);
    const repos = await includedRepos(userId);
    const raw = (await one("SELECT value FROM meta WHERE user_id = $1 AND key = 'user_resume_text'", [userId]))?.value || '';
    const built = planned.filter(p => p.status === 'built');
    const sourceText = `${masterText(parsed)}\n${raw}\n${repos.map(repoText).join('\n')}\n${built.map(plannedText).join('\n')}`;

    let cost = parseCost;
    const keywordsPerRole = await mapLimit(roles, CONCURRENCY, async (r) => {
      const k = await extractKeywords({ title: r.title, company: r.company_name, description: r.job_description, userId }).catch(() => null);
      cost += k?.cost || 0;
      return k?.keywords || [];
    });
    const gaps = gapsAcross(keywordsPerRole, sourceText).filter(g => g.roles >= 2).slice(0, 20);
    if (!gaps.length) return { skipped: 'Your resume and GitHub already cover what your listed roles keep asking for', roles: roles.length, cost };

    const fmt = (p) => `- ${p.name} (${list(p.covers).join(', ') || list(p.tech).join(', ')})`;
    const r = await complete({
      task: 'resume',
      schema: IDEAS_SCHEMA,
      maxTokens: 12000,
      timeoutMs: 300_000,
      userId,
      system: SYSTEM,
      user: `CANDIDATE BACKGROUND (master resume, JSON):
${JSON.stringify({ education: parsed.education, experience: parsed.experience, projects: parsed.projects, skills: parsed.skills })}

GITHUB REPOS: ${repos.map(x => x.full_name + (x.description ? ` (${x.description})` : '')).join('; ') || 'none'}

SKILLS THEIR ${roles.length} TARGET ROLES ASK FOR THAT THEY CAN'T SHOW YET (roles asking, of ${roles.length}):
${gaps.map(g => `- ${g.term}: ${g.roles}${g.required ? ` (required in ${g.required})` : ''}`).join('\n')}

EXAMPLE ROLES: ${roles.slice(0, 12).map(x => `${x.company_name} · ${x.title}`).join('; ')}

ALREADY BUILT:
${built.map(fmt).join('\n') || '(none)'}
ALREADY SUGGESTED:
${planned.filter(p => p.status === 'suggested').map(fmt).join('\n') || '(none)'}
DISMISSED (never again):
${planned.filter(p => p.status === 'dismissed').map(fmt).join('\n') || '(none)'}`,
    });
    cost += r.costUsd;
    const ideas = list(JSON.parse(r.text).projects).slice(0, 3);
    let created = 0;
    const fresh = [];
    for (const p of ideas) {
      const name = str(p.name).slice(0, 120);
      if (!name || !list(p.bullets).length) continue;
      if (planned.some(x => x.name.toLowerCase() === name.toLowerCase())) continue;
      const covers = list(p.covers).map(str).filter(Boolean);
      const hit = gaps.filter(g => covers.some(c => hasTerm(c, g)) || list(p.tech).some(t => hasTerm(t, g)));
      const rolesHelped = new Set();
      keywordsPerRole.forEach((ks, i) => { if (ks.some(k => hit.some(g => g.term.toLowerCase() === str(k.term).toLowerCase()))) rolesHelped.add(i); });
      const demand = {
        roles: rolesHelped.size,
        of: roles.length,
        keywords: hit.map(g => ({ term: g.term, roles: g.roles })),
        examples: [...rolesHelped].slice(0, 5).map(i => `${roles[i].company_name} · ${roles[i].title}`),
      };
      const bullets = list(p.bullets).map(str).filter(Boolean).filter(b => !/\d/.test(b.replace(/\b[A-Za-z]+[-.]?\d[\w.]*\b/g, ''))).slice(0, 3);
      if (!bullets.length) continue;
      await run(
        `INSERT INTO planned_projects (user_id, name, tech, bullets, covers, why, plan, origin, demand)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'weekly', $8)`,
        [userId, name, JSON.stringify(list(p.tech).map(str).filter(Boolean).slice(0, 8)), JSON.stringify(bullets),
          JSON.stringify((hit.length ? hit.map(g => g.term) : covers).slice(0, 10)), str(p.why).slice(0, 500),
          JSON.stringify(list(p.plan).map(str).filter(Boolean).slice(0, 10)), JSON.stringify(demand)],
      );
      created += 1;
      fresh.push({ name, covers: hit.length ? hit.map(g => g.term) : covers, demand });
    }
    if (fresh.length) await whatsappNotify(userId, 'projects', projectsMessage(fresh)).catch(err => console.warn('[project-ideas] whatsapp:', err.message));
    await run("INSERT INTO meta (user_id, key, value) VALUES ($1, 'project_ideas_at', $2) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value", [userId, new Date().toISOString()]);
    return { created, open: open.length + created, gaps: gaps.length, roles: roles.length, cost: Number(cost.toFixed(5)) };
  } finally {
    running.delete(userId);
  }
}

export const isSuggesting = (userId) => running.has(userId);

/** The weekly pass: every user with a master resume and a recent list. */
export async function suggestProjectsForAll() {
  const users = await all(
    `SELECT DISTINCT p.user_id FROM plan_items p
       JOIN resume_files f ON f.user_id = p.user_id AND f.kind = 'master' AND f.is_current
      WHERE p.created_at > NOW() - make_interval(days => $1)`,
    [LOOKBACK_DAYS],
  );
  let created = 0;
  for (const u of users) {
    const r = await suggestProjects(u.user_id).catch(err => { console.warn('[project-ideas]', err.message); return null; });
    created += r?.created || 0;
  }
  return { users: users.length, created };
}

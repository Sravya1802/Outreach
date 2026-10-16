// ── SpeedyApply (github.com/speedyapply) daily job lists ─────────────────────
//
// SpeedyApply publishes two curated lists — "<year>-SWE-College-Jobs" and
// "<year>-AI-College-Jobs" — regenerated every day at 12:00 UTC by their
// get-jobs workflow (.github/scripts/src/get-jobs.ts). Their source database
// is private; the public output is four markdown tables per repo:
//
//   README.md          internships, USA      (with Salary, $/hr)
//   NEW_GRAD_USA.md    new grad, USA         (with Salary, $/yr)
//   INTERN_INTL.md     internships, non-USA  (no Salary)
//   NEW_GRAD_INTL.md   new grad, non-USA     (no Salary)
//
// Each file has three sections between HTML-comment markers — FAANG+,
// Quant (company_type "financial") and Other — and every row is rendered by
// generateMarkdownTable() as:
//
//   | <a href="{company_url}"><strong>{company}</strong></a> | {title} | {locations} | [$55/hr] | <a href="{job_url}"><img …/></a> | {age}d |
//
// This parser mirrors that generator exactly, so nothing it publishes
// (company website, salary, posting age, tier) is thrown away.

const ORG = 'speedyapply';
const REPO_RE = /^(\d{4})-(SWE|AI)-College-Jobs$/;

export const FILES = [
  { file: 'README.md', roleType: 'intern', usa: true },
  { file: 'NEW_GRAD_USA.md', roleType: 'new_grad', usa: true },
  { file: 'INTERN_INTL.md', roleType: 'intern', usa: false },
  { file: 'NEW_GRAD_INTL.md', roleType: 'new_grad', usa: false },
];

const SECTIONS = [
  { tier: 'faang', start: '<!-- TABLE_FAANG_START -->', end: '<!-- TABLE_FAANG_END -->' },
  { tier: 'quant', start: '<!-- TABLE_QUANT_START -->', end: '<!-- TABLE_QUANT_END -->' },
  { tier: 'other', start: '<!-- TABLE_START -->', end: '<!-- TABLE_END -->' },
];

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function splitRow(line) {
  // "| a | b | c |" → ['a','b','c']. Cells never contain "|" (their generator
  // emits plain text + simple HTML), so a straight split is exact.
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  return cells;
}

/** The internship season currently being recruited for (from August: next year). */
export function recruitingSeasonYear(now = new Date()) {
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

/**
 * Parse one SpeedyApply markdown file into catalog rows.
 * @param {string} md
 * @param {{ roleType: 'intern'|'new_grad', region?: 'usa'|'intl', repo?: string, now?: Date }} opts
 */
export function parseSpeedyApplyMarkdown(md, { roleType, region = 'usa', repo = '', now = new Date() }) {
  const rows = [];
  for (const section of SECTIONS) {
    const startIdx = md.indexOf(section.start);
    if (startIdx < 0) continue;
    const endIdx = md.indexOf(section.end, startIdx);
    const body = md.slice(startIdx + section.start.length, endIdx < 0 ? undefined : endIdx);
    let header = null;
    for (const line of body.split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const cells = splitRow(line);
      if (!header) {
        header = cells.map(c => c.toLowerCase());
        continue;
      }
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue; // |---|---| separator
      const col = (name) => cells[header.indexOf(name)] ?? '';

      const companyCell = col('company');
      const company = stripTags(companyCell);
      const companyUrl = companyCell.match(/href="(https?:\/\/[^"]+)"/i)?.[1] ?? null;
      const title = stripTags(col('position'));
      const location = stripTags(col('location')) || null;
      const applyUrl = col('posting').match(/href="(https?:\/\/[^"]+)"/i)?.[1] ?? null;
      const salary = stripTags(col('salary')) || null;
      const ageDays = Number(col('age').match(/^(\d+)\s*d$/i)?.[1]);
      if (!company || !title || !applyUrl) continue;

      rows.push({
        title,
        company_name: company,
        company_url: companyUrl ? decodeEntities(companyUrl) : null,
        location,
        apply_url: decodeEntities(applyUrl),
        salary_range: salary,
        posted_at: Number.isFinite(ageDays) ? new Date(now.getTime() - ageDays * 86_400_000).toISOString() : null,
        tier: section.tier,
        role_type: roleType,
        region,
        tracks: [/-AI-/i.test(repo) ? 'ai' : 'swe'],
        source: 'speedyapply',
        list: repo,
        description: null,
      });
    }
  }
  return rows;
}

/**
 * The SWE + AI repos for the newest season SpeedyApply publishes. Falls back
 * to the computed recruiting season if the GitHub API is unavailable.
 */
export async function discoverRepos({ fetchImpl = fetch, now = new Date() } = {}) {
  try {
    const res = await fetchImpl(`https://api.github.com/orgs/${ORG}/repos?per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ScoutnJobs' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const repos = (await res.json()).map(r => r.name).filter(n => REPO_RE.test(n));
      const newest = Math.max(...repos.map(n => Number(n.match(REPO_RE)[1])));
      if (Number.isFinite(newest)) return repos.filter(n => n.startsWith(`${newest}-`)).sort();
    }
  } catch { /* fall through */ }
  const year = recruitingSeasonYear(now);
  return [`${year}-AI-College-Jobs`, `${year}-SWE-College-Jobs`];
}

/**
 * Fetch every list for the current season.
 * @returns {Promise<{ rows: object[], repos: string[], files: { repo: string, file: string, count: number, error?: string }[] }>}
 */
export async function fetchSpeedyApplyListings({ includeInternational = true, fetchImpl = fetch, now = new Date() } = {}) {
  const repos = await discoverRepos({ fetchImpl, now });
  const files = [];
  const byUrl = new Map();
  const targets = repos.flatMap(repo => FILES.filter(f => includeInternational || f.usa).map(f => ({ repo, ...f })));
  await Promise.all(targets.map(async ({ repo, file, roleType, usa }) => {
    try {
      const res = await fetchImpl(`https://raw.githubusercontent.com/${ORG}/${repo}/main/${file}`, {
        headers: { 'User-Agent': 'ScoutnJobs' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseSpeedyApplyMarkdown(await res.text(), { roleType, region: usa ? 'usa' : 'intl', repo, now });
      files.push({ repo, file, count: parsed.length });
      // The SWE and AI lists overlap: keep one row per posting, remember both
      // lists it appeared in, and prefer a FAANG+/Quant tier over "other".
      for (const row of parsed) {
        const prev = byUrl.get(row.apply_url);
        if (!prev) { byUrl.set(row.apply_url, row); continue; }
        const tracks = [...new Set([...prev.tracks, ...row.tracks])].sort();
        const keep = prev.tier === 'other' && row.tier !== 'other' ? row : prev;
        byUrl.set(row.apply_url, { ...keep, tracks });
      }
    } catch (err) {
      files.push({ repo, file, count: 0, error: err.message });
    }
  }));
  return { rows: [...byUrl.values()], repos, files };
}

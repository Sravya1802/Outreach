// ── JobSpy (github.com/speedyapply/JobSpy) — free job-board scraping ─────────
// Replaces Apify for *job listings* (Apify is kept for finding people).
// Runs scripts/jobspy_fetch.py in its own virtualenv; on the VM:
//   python3 -m venv ~/outreach/.venv-jobspy && ~/outreach/.venv-jobspy/bin/pip install python-jobspy==1.1.82
// Indeed and LinkedIn work from the server; Glassdoor/Google are unreliable there.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', 'scripts', 'jobspy_fetch.py');
const PYTHON = process.env.JOBSPY_PYTHON || path.join(here, '..', '..', '.venv-jobspy', 'bin', 'python');
const TIMEOUT_MS = 8 * 60_000;

export const QUERIES = {
  intern: ['software engineer intern', 'machine learning intern', 'data science intern', 'software developer intern 2027'],
  new_grad: ['new grad software engineer', 'entry level software engineer', 'machine learning engineer new grad', 'software engineer I 2026 graduate'],
};

// India: freshers and graduate trainees are the new-grad titles there.
export const INDIA_QUERIES = {
  intern: ['software engineer intern', 'software developer intern', 'machine learning intern', 'data science intern'],
  new_grad: ['software engineer fresher', 'graduate engineer trainee software', 'associate software engineer', 'machine learning engineer fresher'],
};

const MARKET_SEARCH = {
  usa: { queries: QUERIES, location: 'United States', country: 'USA', region: 'usa' },
  india: { queries: INDIA_QUERIES, location: 'India', country: 'India', region: 'india' },
};

/** Run the Python fetcher. Resolves { jobs, errors }; never rejects for per-site failures. */
export function runJobSpy(request, { python = PYTHON, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(python, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('JobSpy timed out')); }, TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; if (err.length > 20_000) err = err.slice(-10_000); });
    child.on('error', e => { clearTimeout(timer); reject(new Error(`JobSpy not installed (${e.message})`)); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out || '{}');
        resolve({ jobs: parsed.jobs || [], errors: parsed.errors || [] });
      } catch {
        reject(new Error(`JobSpy exited ${code}: ${err.trim().split('\n').pop() || 'no output'}`));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

// null/''/NaN/0 all mean "not posted" (Number(null) is 0, which rendered as "$0").
const amount = v => {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

function salaryRange(j) {
  const lo = amount(j.min_amount);
  const hi = amount(j.max_amount);
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) return null;
  const unit = { hourly: 'hr', yearly: 'yr', monthly: 'mo', weekly: 'wk', daily: 'day' }[String(j.interval || '').toLowerCase()] || '';
  const fmt = n => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
  const range = Number.isFinite(lo) && Number.isFinite(hi) && lo !== hi ? `${fmt(lo)}–${fmt(hi)}` : fmt(Number.isFinite(lo) ? lo : hi);
  return `$${range}${unit ? `/${unit}` : ''}`;
}

/** JobSpy row → catalog row (scraped_roles shape). */
export function toCatalogRow(j, roleType, region = 'usa') {
  const apply = j.job_url_direct || j.job_url;
  if (!j.title || !j.company || !apply) return null;
  return {
    title: String(j.title).trim(),
    company_name: String(j.company).trim(),
    company_url: null,
    location: j.is_remote === true || j.is_remote === 'True' ? `Remote${j.location ? ` · ${j.location}` : ''}` : (j.location || null),
    apply_url: String(apply),
    salary_range: salaryRange(j),
    posted_at: j.date_posted ? new Date(`${String(j.date_posted).slice(0, 10)}T12:00:00Z`).toISOString() : null,
    tier: null,
    role_type: roleType,
    region,
    source: j.site, // 'indeed' | 'linkedin'
    description: null,
  };
}

/** Fetch catalog rows for one role type from Indeed + LinkedIn. */
export async function fetchJobSpyRoles(roleType, { sites = ['indeed', 'linkedin'], runner = runJobSpy, market = 'usa' } = {}) {
  const m = MARKET_SEARCH[market] || MARKET_SEARCH.usa;
  const { jobs, errors } = await runner({ sites, queries: m.queries[roleType] || [], location: m.location, country: m.country, results_wanted: 50, hours_old: 72 });
  const rows = jobs.map(j => toCatalogRow(j, roleType, m.region)).filter(Boolean);
  if (!rows.length && errors.length) throw new Error(`JobSpy: ${errors[0].site} — ${errors[0].error}`);
  return { rows, errors };
}

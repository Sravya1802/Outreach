import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverRepos, fetchSpeedyApplyListings, parseSpeedyApplyMarkdown, recruitingSeasonYear } from '../services/speedyApply.js'

const NOW = new Date('2026-10-13T12:30:00Z')
const IMG = '<img src="https://i.imgur.com/JpkfjIq.png" alt="Apply" width="70"/>'
const MD = `# 2027 SWE
<!-- TABLE_FAANG_START -->
| Company | Position | Location | Salary | Posting | Age |
|---|---|---|---|---|---|
| <a href="https://www.doordash.com"><strong>DoorDash</strong></a> | Software Engineer - Intern - Labs - Summer 2027 | San Francisco, CA +1 | $55/hr | <a href="https://job-boards.greenhouse.io/doordashusa/jobs/8263774">${IMG}</a> | 5d |

<!-- TABLE_FAANG_END -->
<!-- TABLE_QUANT_START -->
| Company | Position | Location | Salary | Posting | Age |
|---|---|---|---|---|---|
| <strong>Jane Street</strong> | Software Engineer Intern | New York, NY |  | <a href="https://www.janestreet.com/join-jane-street/position/123">${IMG}</a> | 0d |

<!-- TABLE_QUANT_END -->
<!-- TABLE_START -->
| Company | Position | Location | Posting | Age |
|---|---|---|---|---|
| <a href="https://geiconsultants.com"><strong>GEI Consultants</strong></a> | Web Developer Intern | Rancho Cordova, CA | <a href="https://jobs.jobvite.com/gei-consultants/job/ogR5zfwv">${IMG}</a> | 12d |
| <strong>Broken Row</strong> | No link here | Somewhere |  | 3d |
| <strong>AT&amp;T</strong> | R&amp;D Intern | Dallas, TX | <a href="https://att.jobs/x?a=1&amp;b=2">${IMG}</a> | 1d |

<!-- TABLE_END -->`

test('parses every section with tier, salary, company site and posting date', () => {
  const rows = parseSpeedyApplyMarkdown(MD, { roleType: 'intern', repo: '2027-SWE-College-Jobs', now: NOW })
  assert.equal(rows.length, 4) // the row without an apply link is skipped
  assert.deepEqual(rows[0], {
    title: 'Software Engineer - Intern - Labs - Summer 2027', company_name: 'DoorDash', company_url: 'https://www.doordash.com',
    location: 'San Francisco, CA +1', apply_url: 'https://job-boards.greenhouse.io/doordashusa/jobs/8263774', salary_range: '$55/hr',
    posted_at: '2026-10-08T12:30:00.000Z', tier: 'faang', role_type: 'intern', region: 'usa', tracks: ['swe'], source: 'speedyapply', list: '2027-SWE-College-Jobs', description: null,
  })
  assert.equal(rows[1].tier, 'quant')
  assert.equal(rows[1].company_url, null)
  assert.equal(rows[1].salary_range, null)
  assert.equal(rows[1].posted_at, NOW.toISOString())
  assert.equal(rows[2].tier, 'other')
  assert.equal(rows[2].salary_range, null) // "Other" tables have no Salary column
  assert.equal(rows[3].company_name, 'AT&T')
  assert.equal(rows[3].title, 'R&D Intern')
  assert.equal(rows[3].apply_url, 'https://att.jobs/x?a=1&b=2')
})

test('season year rolls over in August', () => {
  assert.equal(recruitingSeasonYear(new Date('2026-10-13T00:00:00Z')), 2027)
  assert.equal(recruitingSeasonYear(new Date('2026-07-31T00:00:00Z')), 2026)
})

test('discovers the newest season and falls back without the API', async () => {
  const api = async () => new Response(JSON.stringify([
    { name: 'JobSpy' }, { name: '2026-SWE-College-Jobs' }, { name: '2027-SWE-College-Jobs' }, { name: '2027-AI-College-Jobs' },
  ]), { status: 200 })
  assert.deepEqual(await discoverRepos({ fetchImpl: api, now: NOW }), ['2027-AI-College-Jobs', '2027-SWE-College-Jobs'])
  const down = async () => new Response('rate limited', { status: 403 })
  assert.deepEqual(await discoverRepos({ fetchImpl: down, now: NOW }), ['2027-AI-College-Jobs', '2027-SWE-College-Jobs'])
})

test('dedupes the overlapping SWE and AI lists and reports per-file counts', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('api.github.com')) return new Response(JSON.stringify([{ name: '2027-SWE-College-Jobs' }, { name: '2027-AI-College-Jobs' }]))
    if (url.endsWith('/README.md')) return new Response(MD)
    if (url.endsWith('/NEW_GRAD_USA.md')) return new Response('not found', { status: 404 })
    throw new Error('unexpected ' + url)
  }
  const out = await fetchSpeedyApplyListings({ fetchImpl, now: NOW, includeInternational: false })
  assert.equal(out.rows.length, 4) // same 4 postings in both repos
  assert.equal(out.files.length, 4)
  assert.equal(out.files.filter(f => f.error).length, 2)
  assert.ok(out.rows.every(r => r.region === 'usa'))
  assert.ok(out.rows.every(r => r.tracks.join() === 'ai,swe'), 'in both repos → both tracks')
})

test('international files are tagged intl', () => {
  const rows = parseSpeedyApplyMarkdown(MD.replace(/\| Salary /g, '| '), { roleType: 'new_grad', region: 'intl', now: NOW })
  assert.ok(rows.length > 0 && rows.every(r => r.region === 'intl' && r.role_type === 'new_grad'))
})

test('non-SpeedyApply roles are classified into SWE or AI by title', async () => {
  process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z' // module imports db.js; no query is made
  const { classifyTracks } = await import('../services/multiSourceScraper.js')
  assert.deepEqual(classifyTracks({ title: 'Machine Learning Engineer Intern' }), ['ai'])
  assert.deepEqual(classifyTracks({ title: 'AI Research Intern' }), ['ai'])
  assert.deepEqual(classifyTracks({ title: 'Software Engineer Intern' }), ['swe'])
  assert.deepEqual(classifyTracks({ title: 'Email Marketing Intern' }), ['swe']) // "email" ≠ "ml"
  assert.deepEqual(classifyTracks({ title: 'Data Engineer', tracks: ['ai', 'swe'] }), ['ai', 'swe'])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchJobSpyRoles, runJobSpy, toCatalogRow } from '../services/jobSpy.js'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

test('maps JobSpy rows to catalog rows', () => {
  const row = toCatalogRow({
    site: 'indeed', title: 'Intern, Software Controls', company: 'Blue Bird Body Company', location: 'Fort Valley, GA, US',
    job_url: 'https://www.indeed.com/viewjob?jk=1', job_url_direct: 'https://recruiting.ultipro.com/x', date_posted: '2026-10-13',
    min_amount: 22, max_amount: 28, interval: 'hourly', is_remote: false,
  }, 'intern')
  assert.deepEqual(row, {
    title: 'Intern, Software Controls', company_name: 'Blue Bird Body Company', company_url: null, location: 'Fort Valley, GA, US',
    apply_url: 'https://recruiting.ultipro.com/x', salary_range: '$22–28/hr', posted_at: '2026-10-13T12:00:00.000Z',
    tier: null, role_type: 'intern', region: 'usa', source: 'indeed', description: null,
  })
  const li = toCatalogRow({ site: 'linkedin', title: 'SWE Intern', company: 'Qualcomm', job_url: 'https://www.linkedin.com/jobs/view/1', job_url_direct: null, is_remote: 'True', location: 'Boston, MA', min_amount: 120000, max_amount: 120000, interval: 'yearly' }, 'new_grad')
  assert.equal(li.apply_url, 'https://www.linkedin.com/jobs/view/1')
  assert.equal(li.location, 'Remote · Boston, MA')
  assert.equal(li.salary_range, '$120k/yr')
  assert.equal(toCatalogRow({ site: 'indeed', title: 'x' }, 'intern'), null)
})

test('runs the Python fetcher and parses its JSON', async () => {
  const spawnImpl = () => {
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough()
    child.kill = () => {}
    child.stdin.on('finish', () => {
      child.stdout.end(JSON.stringify({ jobs: [{ site: 'indeed', title: 'A', company: 'B', job_url: 'https://x' }], errors: [] }))
      setImmediate(() => child.emit('close', 0))
    })
    return child
  }
  const out = await runJobSpy({ sites: ['indeed'], queries: ['q'] }, { spawnImpl })
  assert.equal(out.jobs.length, 1)
})

test('reports a total failure, keeps partial results', async () => {
  await assert.rejects(fetchJobSpyRoles('intern', { runner: async () => ({ jobs: [], errors: [{ site: 'linkedin', error: '429 rate limited' }] }) }), /linkedin — 429/)
  const r = await fetchJobSpyRoles('intern', { runner: async () => ({ jobs: [{ site: 'indeed', title: 'A', company: 'B', job_url: 'https://x' }], errors: [{ site: 'linkedin', error: '429' }] }) })
  assert.equal(r.rows.length, 1)
  assert.equal(r.errors.length, 1)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { groupRoles, queueOrder, rolesTabWhere } from '../services/queueOrder.js'

const now = new Date('2026-11-11T15:00:00Z')
const d = (days) => new Date(now.getTime() + days * 86_400_000).toISOString()

test('queueOrder: deadlines in the next 7 days first, then newest and oldest alternating', () => {
  const rows = [
    { id: 'new1', posted: d(-1) }, { id: 'new2', posted: d(-2) }, { id: 'mid', posted: d(-10) },
    { id: 'old2', posted: d(-30) }, { id: 'old1', posted: d(-60) },
    { id: 'soon5', posted: d(-40), deadline: d(5).slice(0, 10) },
    { id: 'soon2', posted: d(-3), deadline: d(2).slice(0, 10) },
    { id: 'later', posted: d(-5), deadline: d(20).slice(0, 10) },
    { id: 'passed', posted: d(-50), deadline: d(-1).slice(0, 10) },
  ]
  assert.deepEqual(queueOrder(rows, { now }).map(r => r.id), ['soon2', 'soon5', 'new1', 'old1', 'new2', 'passed', 'later', 'old2', 'mid'])
  assert.deepEqual(queueOrder([], { now }), [])
})

test('groupRoles: one role per company and title, auto-apply link first, locations grouped', () => {
  const groups = groupRoles([
    { id: 1, company_name: 'Acme', title: 'SWE Intern', location: 'Austin, TX', apply_url: 'https://www.linkedin.com/jobs/view/1', posted: d(-1) },
    { id: 2, company_name: 'acme ', title: 'swe intern', location: 'Seattle, WA', apply_url: 'https://boards.greenhouse.io/acme/jobs/2', posted: d(-5), apply_deadline: '2026-11-20' },
    { id: 3, company_name: 'Acme', title: 'SWE Intern', location: 'Austin, TX', apply_url: 'https://acme.com/3', posted: d(-2), apply_deadline: '2026-11-15' },
    { id: 4, company_name: 'Beta', title: 'New Grad SWE', location: null, apply_url: 'https://beta.com/4', posted: d(-3) },
  ])
  assert.equal(groups.length, 2)
  const acme = groups.find(g => g.ids.includes('1'))
  assert.equal(acme.lead.id, 2)
  assert.equal(acme.location, 'Austin, TX; Seattle, WA')
  assert.equal(acme.deadline, '2026-11-15')
  assert.deepEqual(groups.find(g => g.ids.includes('4')).ids, ['4'])
})

test('rolesTabWhere matches the Roles tab filters', () => {
  const w = rolesTabWhere(1)
  assert.match(w.sql, /region = 'usa'/)
  assert.match(w.sql, /sponsorship IS NULL OR sponsorship = 'sponsors'/)
  assert.match(w.sql, /return_to_school/)
  assert.equal(w.params.length, 2)
  assert.doesNotMatch(rolesTabWhere(1, { keepReturnToSchool: true }).sql, /return_to_school/)
})

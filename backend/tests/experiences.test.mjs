import assert from 'node:assert/strict'
import test from 'node:test'
import { mostRecent, normalizeExperiences } from '../services/experiences.js'

test('cleans and orders experience entries, newest first', () => {
  const list = normalizeExperiences([
    { company: 'Acme', title: 'SWE Intern', start: '2024-06', end: '2024-08', type: 'internship' },
    { company: ' Mercedes-Benz R&D ', title: 'Data Engineer', start: '2025-01', current: true, end: '2025-05', type: 'job' },
    { company: '', title: '' },
    { company: 'Lab', title: 'Research Assistant', start: '2023-09', end: 'June 2024', type: 'weird' },
  ])
  // Current first, then most recent end date (no end date sorts as ongoing).
  assert.deepEqual(list.map(e => e.company), ['Mercedes-Benz R&D', 'Lab', 'Acme'])
  assert.equal(list[0].company, 'Mercedes-Benz R&D')
  assert.equal(list[0].end, '', 'current roles have no end date')
  assert.equal(list.find(e => e.company === 'Lab').end, '', 'bad dates are dropped')
  assert.equal(list.find(e => e.company === 'Lab').type, 'internship', 'unknown types fall back')
  assert.equal(list.length, 3, 'empty entries are dropped')
  assert.equal(mostRecent(list).title, 'Data Engineer')
})

test('rejects non-lists and caps the length', () => {
  assert.throws(() => normalizeExperiences('nope'), /must be a list/)
  assert.deepEqual(normalizeExperiences(null), [])
  assert.equal(normalizeExperiences(Array.from({ length: 30 }, (_, i) => ({ company: `C${i}`, title: 'T' }))).length, 15)
})

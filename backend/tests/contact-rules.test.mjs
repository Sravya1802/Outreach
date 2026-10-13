import assert from 'node:assert/strict'
import test from 'node:test'
import { betterCandidate, isGoodEnough, isRelevantContact, isUsableEmail, nameKey, normalizeEmailStatus, seniorityScore, splitName } from '../services/contactRules.js'

test('relevant titles (audit regressions)', () => {
  const yes = ['Software Engineer', 'Software Engineer, AI Agents', 'Salesforce Developer', 'ML Operations Engineer',
    'CTO', 'Co-Founder & CEO', 'VP of Engineering', 'Technical Recruiter', 'University Recruiter', 'Talent Acquisition Partner',
    'People Operations Partner', 'Head of Data', 'Research Scientist', 'Sales Engineer', 'Staff Software Engineer', 'Quant Researcher']
  const no = ['Creative Director', 'Director of Finance', 'Art Director', 'Quantity Surveyor', 'Account Executive',
    'Marketing Manager', 'Office Manager', 'Executive Assistant', 'Legal Counsel', 'Staff Accountant', 'Vice President of Sales',
    'Insurance Agent']
  for (const t of yes) assert.equal(isRelevantContact(t), true, t)
  for (const t of no) assert.equal(isRelevantContact(t), false, t)
  assert.equal(isRelevantContact(''), true)
  assert.equal(isRelevantContact('', { requireTitle: true }), false)
})

test('seniority ranking', () => {
  assert.ok(seniorityScore('Co-founder') > seniorityScore('CTO'))
  assert.ok(seniorityScore('CTO') > seniorityScore('Director of Engineering'))
  assert.ok(seniorityScore('Technical Recruiter') > seniorityScore('Software Engineer'))
  assert.equal(seniorityScore('Creative Director') , 7) // ranked as a director — relevance filter removes it, not ranking
})

test('splitName handles honorifics, suffixes, particles, hyphens', () => {
  assert.deepEqual(splitName('Jane Doe'), { first: 'Jane', last: 'Doe', full: 'Jane Doe' })
  assert.deepEqual(splitName('Jane Doe, PhD'), { first: 'Jane', last: 'Doe', full: 'Jane Doe' })
  assert.deepEqual(splitName('Dr. Jane Doe'), { first: 'Jane', last: 'Doe', full: 'Jane Doe' })
  assert.deepEqual(splitName('Jane van der Berg'), { first: 'Jane', last: 'van der Berg', full: 'Jane van der Berg' })
  assert.deepEqual(splitName('Mary-Jane Smith (she/her)'), { first: 'Mary-Jane', last: 'Smith', full: 'Mary-Jane Smith' })
  assert.deepEqual(splitName('José García Jr.'), { first: 'José', last: 'García', full: 'José García' })
  assert.deepEqual(splitName('Jane Doe - Software Engineer at Acme'), { first: 'Jane', last: 'Doe', full: 'Jane Doe' })
  assert.equal(splitName('Cher'), null)
  assert.equal(splitName(''), null)
  assert.equal(nameKey('Jane Doe, PhD'), nameKey('jane doe'))
})

test('usable emails', () => {
  assert.equal(isUsableEmail('jane.doe@acme.com'), true)
  for (const e of ['info@acme.com', 'careers@acme.com', 'noreply@acme.com', 'email_not_unlocked@domain.com', 'not-an-email', 'jane@example.com']) {
    assert.equal(isUsableEmail(e), false, e)
  }
})

test('email status vocabulary', () => {
  assert.equal(normalizeEmailStatus('hunter', { verification_status: 'valid', score: 40 }), 'valid')
  assert.equal(normalizeEmailStatus('hunter', { verification_status: 'accept_all', score: 85 }), 'risky')   // was "valid"
  assert.equal(normalizeEmailStatus('hunter', { verification_status: null, score: 85 }), 'unverified')    // was "valid"
  assert.equal(normalizeEmailStatus('hunter', { verification_status: 'invalid' }), 'invalid')
  assert.equal(normalizeEmailStatus('prospeo', { email_status: 'VALID' }), 'valid')
  assert.equal(normalizeEmailStatus('prospeo', {}), 'unverified')                                         // was confidence 80 → "valid"
  assert.equal(normalizeEmailStatus('apollo', { email_status: 'verified' }), 'valid')
  assert.equal(normalizeEmailStatus('website', {}), 'risky')
})

test('candidate ranking', () => {
  const v = { email: 'a@x.com', status: 'valid', confidence: 50 }
  const r = { email: 'b@x.com', status: 'risky', confidence: 99 }
  const u = { email: 'c@x.com', status: 'unverified', confidence: 99 }
  assert.equal(betterCandidate(r, v), v)
  assert.equal(betterCandidate(u, r), r)
  assert.equal(betterCandidate(null, u), u)
  assert.equal(isGoodEnough(r), true)
  assert.equal(isGoodEnough(u), false)
})

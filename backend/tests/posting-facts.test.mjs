import assert from 'node:assert/strict'
import test from 'node:test'
import { deadlineFrom, postingFacts } from '../services/postingFacts.js'

const posted = new Date('2026-11-01T12:00:00Z')

test('deadlineFrom reads the deadline a posting states', () => {
  assert.equal(deadlineFrom('Apply by November 15, 2026 to be considered.', { posted }), '2026-11-15')
  assert.equal(deadlineFrom('Applications close 11/20/2026.', { posted }), '2026-11-20')
  assert.equal(deadlineFrom('Application deadline: Dec. 5th', { posted }), '2026-12-05')
  assert.equal(deadlineFrom('This posting will close on 2026-11-18.', { posted }), '2026-11-18')
  assert.equal(deadlineFrom('We are accepting applications until 30 November 2026.', { posted }), '2026-11-30')
  assert.equal(deadlineFrom('Applications will be accepted through January 9, 2027.', { posted }), '2027-01-09')
  // No year: the next one after the posting date (a January deadline posted in November is next year).
  assert.equal(deadlineFrom('Deadline to apply: January 15', { posted }), '2027-01-15')
  // Two deadlines: the earliest.
  assert.equal(deadlineFrom('Priority deadline: Nov 10, 2026. Final deadline: Dec 1, 2026.', { posted }), '2026-11-10')
})

test('deadlineFrom ignores dates that are not deadlines', () => {
  assert.equal(deadlineFrom('Start date: June 1, 2027. Graduating May 2027.', { posted }), null)
  assert.equal(deadlineFrom('The internship runs from May 26, 2027 to August 14, 2027.', { posted }), null)
  assert.equal(deadlineFrom('Posted on November 1, 2026.', { posted }), null)
  assert.equal(deadlineFrom('Apply by February 30, 2027', { posted }), null)
  assert.equal(deadlineFrom('', { posted }), null)
})

test('postingFacts: return-to-school only counts for internships', () => {
  const text = 'Candidates must be returning to school after the internship. Apply by Nov 20, 2026.'
  assert.deepEqual(postingFacts(text, { roleType: 'intern', posted }), { deadline: '2026-11-20', returnToSchool: true })
  assert.deepEqual(postingFacts(text, { roleType: 'new_grad', posted }), { deadline: '2026-11-20', returnToSchool: false })
})

test('usPersonOnly: citizenship, green card, ITAR/EAR U.S. persons and clearances; not EEO lines', async () => {
  const { usPersonOnly } = await import('../services/postingFacts.js')
  for (const t of [
    'Applicants must be U.S. citizens.',
    'Due to ITAR regulations, applicants must be U.S. persons (citizen, permanent resident, refugee or asylee).',
    'This role requires access to export-controlled information; candidates must qualify as a U.S. Person.',
    'U.S. citizenship is required.',
    'Must be a US citizen or permanent resident.',
    'Ability to obtain a Secret clearance.',
    'Active TS/SCI clearance with polygraph.',
    'Requires US citizenship to obtain a security clearance.',
    'Open to US citizens only.',
  ]) assert.ok(usPersonOnly(t), t)
  for (const t of [
    'All qualified applicants will receive consideration without regard to race, religion, national origin, citizenship status or disability.',
    'No security clearance required.',
    'We sponsor visas, including for international students.',
    'We may need to determine whether you are a U.S. person to comply with export laws; we will apply for a license if needed.',
    'Must be a US Citizen, permanent resident or be an MS student with work authorization (F1 Visa on CPT accepted only for masters-level students).',
    'Applicants must be U.S. citizens, permanent residents, or otherwise authorized to work in the United States.',
    '',
  ]) assert.equal(usPersonOnly(t), null, t)
})

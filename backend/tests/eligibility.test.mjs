import assert from 'node:assert/strict'
import test from 'node:test'
import { eligibilityFor } from '../services/eligibility.js'

const reason = (text, extra = {}) => eligibilityFor({ text, roleType: 'intern', ...extra })?.reason ?? null

test('citizenship: citizen, green card, refugee/asylee, ITAR/EAR U.S. persons', () => {
  assert.equal(reason('Applicants must be U.S. citizens.'), 'citizenship')
  assert.equal(reason('Must be a U.S. Citizen or Permanent Resident.'), 'citizenship')
  assert.equal(reason('applicant must be a (i) U.S. citizen or national, (ii) U.S. lawful, permanent resident (aka green card holder), (iii) Refugee'), 'citizenship')
  assert.equal(reason('Due to ITAR regulations, applicants must be U.S. persons (citizen, permanent resident, refugee or asylee).'), 'citizenship')
  assert.equal(reason('US Citizenship Required:'), 'citizenship')
  // The sponsorship check's saved quote counts too.
  assert.equal(eligibilityFor({ text: '', quote: 'Candidates must be US Citizens', roleType: 'new_grad' })?.reason, 'citizenship')
})

test('clearance: active or obtainable, any level, polygraph', () => {
  assert.equal(reason('Ability to obtain a Secret clearance.'), 'clearance')
  assert.equal(reason('Active TS/SCI clearance with polygraph.'), 'clearance')
  assert.equal(reason('Eligible to obtain and maintain an active U.S. Top Secret SCI security clearance'), 'clearance')
  assert.equal(reason('**Clearance:** TS/SCI - Polygraph required'), 'clearance')
  assert.equal(reason('Ability to obtain a SECRET clearance. ### **Preferred Qualifications**'), 'clearance')
  assert.equal(reason('Must be able to obtain a Public Trust clearance.'), 'clearance')
})

test('MBA and PhD only when required', () => {
  assert.equal(eligibilityFor({ title: 'Strategic Partnerships MBA Intern' })?.reason, 'mba')
  assert.equal(reason('Must be currently pursuing an MBA.'), 'mba')
  assert.equal(eligibilityFor({ title: 'Software Developer Intern - PhD - Summer 2027' })?.reason, 'phd')
  assert.equal(reason('Currently enrolled in a PhD program in Computer Science.'), 'phd')
  assert.equal(reason('A PhD in Computer Science is required.'), 'phd')
})

test('return to school (internships only)', () => {
  assert.equal(reason('Must be returning to school after the internship.'), 'return_to_school')
  assert.equal(reason('You must have at least one semester remaining after the internship.'), 'return_to_school')
  assert.equal(reason('This internship is designed for students graduating between December 2027 and June 2028.'), 'return_to_school')
  assert.equal(reason('Expected graduation date between Fall 2027 and Summer 2028.'), 'return_to_school')
  assert.equal(reason('Open to the Class of 2028.'), 'return_to_school')
  assert.equal(reason('Students graduating in 2028 or later.'), 'return_to_school')
  // Graduating by / no later than a date: the user meets it.
  assert.equal(reason('Must be graduating no later than December 2027.'), null)
  assert.equal(reason('Graduating between December 2026 and June 2027.'), null)
  // New grad roles aren't held to it.
  assert.equal(eligibilityFor({ text: 'Must be returning to school after the internship.', roleType: 'new_grad' }), null)
})

test('never removed: bachelor\'s only, either degree, preferred, work authorization alone, students welcome, EEO', () => {
  assert.equal(reason('Pursuing a Bachelor\'s degree in Computer Science.'), null)
  assert.equal(reason('Currently pursuing a Master\'s or PhD in Computer Science.'), null)
  assert.equal(eligibilityFor({ title: 'Research Intern (Masters/PhD)' }), null)
  assert.equal(eligibilityFor({ title: 'Intern: MBA/Graduate' }), null)
  assert.equal(reason('PhD preferred.'), null)
  assert.equal(reason('MBA preferred.'), null)
  assert.equal(reason('Currently pursuing a MBA or graduate degree in data science.'), null)
  assert.equal(reason('Must be authorized to work in the US.'), null)
  assert.equal(reason('Must be a US Citizen, permanent resident or be an MS student with work authorization (F1 Visa on CPT accepted only for masters-level students).'), null)
  assert.equal(reason('All qualified applicants will receive consideration without regard to race, national origin, citizenship status or disability.'), null)
  assert.equal(reason('Employee Polygraph Protection Act. E-Verify participant.'), null)
  assert.equal(reason('No security clearance required.'), null)
})

test('unsure: kept with a Check eligibility flag', () => {
  assert.match(eligibilityFor({ text: 'Secret clearance is preferred but not required.' })?.flag ?? '', /Clearance|clearance/)
  assert.match(eligibilityFor({ text: 'This role may require access to export-controlled technology; we may need an export license.' })?.flag ?? '', /export control/i)
  assert.match(eligibilityFor({ text: 'Must be a US Citizen, permanent resident or be an MS student with work authorization (F1 Visa on CPT accepted).' })?.flag ?? '', /students with work authorization/)
})

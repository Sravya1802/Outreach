import assert from 'node:assert/strict'
import test from 'node:test'
import { classifySponsorship, plainText } from '../services/sponsorship.js'

const s = t => classifySponsorship(t).status

test('US citizens only, including clearance roles', () => {
  assert.equal(s('Applicants must be a U.S. citizen due to contract requirements.'), 'citizens_only')
  assert.equal(s('US Citizenship is required for this position.'), 'citizens_only')
  assert.equal(s('This role requires an active Secret security clearance.'), 'citizens_only')
  assert.equal(s('Candidates must have the ability to obtain a DoD security clearance.'), 'citizens_only')
  assert.equal(s('Open only to US persons as defined by ITAR. U.S. persons only.'), 'citizens_only')
  assert.equal(s('Experience with TS/SCI environments.'), 'citizens_only')
})

test('no sponsorship', () => {
  assert.equal(s('We are unable to sponsor work visas for this role.'), 'no_sponsorship')
  assert.equal(s('Candidates must be authorized to work in the US without the need for current or future sponsorship.'), 'no_sponsorship')
  assert.equal(s('Visa sponsorship is not available for this position.'), 'no_sponsorship')
  assert.equal(s('This company does not sponsor H-1B.'), 'no_sponsorship')
  assert.equal(s('No visa sponsorship.'), 'no_sponsorship')
})

test('sponsors', () => {
  assert.equal(s('We sponsor visas for exceptional candidates.'), 'sponsors')
  assert.equal(s('Visa sponsorship is available for this role.'), 'sponsors')
  assert.equal(s('Students on CPT or OPT are welcome to apply.'), 'sponsors')
  assert.equal(s('We are happy to provide immigration sponsorship.'), 'sponsors')
})

test('strictest signal wins, and EEO boilerplate is not a signal', () => {
  assert.equal(s('Visa sponsorship is available. However, this role requires an active TS/SCI clearance.'), 'citizens_only')
  assert.equal(s('We do not discriminate on the basis of race, religion, national origin, or citizenship status.'), null)
  assert.equal(s('Must be authorized to work in the United States.'), null)
  assert.equal(s(''), null)
})

test('keeps the deciding sentence and reads escaped HTML', () => {
  const r = classifySponsorship('&lt;p&gt;Great team.&lt;/p&gt;&lt;p&gt;We are unable to sponsor visas at this time.&lt;/p&gt;')
  assert.equal(r.status, 'no_sponsorship')
  assert.equal(r.quote, 'We are unable to sponsor visas at this time.')
  assert.equal(plainText('<li>One</li><li>Two &amp; three</li>'), 'One\nTwo & three')
})

test('quotes the whole sentence, through abbreviations like U.S.', () => {
  const r = classifySponsorship('Great team. Due to export regulations, the applicant must be a U.S. citizen or permanent resident. Apply now.')
  assert.equal(r.status, 'citizens_only')
  assert.equal(r.quote, 'Due to export regulations, the applicant must be a U.S. citizen or permanent resident.')
})

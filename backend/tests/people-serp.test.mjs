import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLinkedInSerpResult } from '../services/apify.js'

const r = (title, snippet = '', link = 'https://www.linkedin.com/in/jane-doe?trk=x') => ({ title, snippet, link })

test('keeps people whose headline says they are at the company', () => {
  assert.deepEqual(parseLinkedInSerpResult(r('Jane Doe - Staff Software Engineer at Ramp | LinkedIn'), 'Ramp'),
    { name: 'Jane Doe', title: 'Staff Software Engineer', linkedin_url: 'https://www.linkedin.com/in/jane-doe' })
  assert.equal(parseLinkedInSerpResult(r('Sam Lee – Technical Recruiter – Acme Inc', 'Recruiting at Acme'), 'Acme Inc')?.name, 'Sam Lee')
})

test('drops ex-employees, other companies and non-profile links', () => {
  assert.equal(parseLinkedInSerpResult(r('Jane Doe - Engineer at Stripe', 'Formerly at Ramp, now Stripe'), 'Ramp'), null)
  assert.equal(parseLinkedInSerpResult(r('Jane Doe - Engineer at Scale Computing'), 'Ramp'), null)
  assert.equal(parseLinkedInSerpResult(r('Ramp Jobs', '', 'https://www.linkedin.com/company/ramp'), 'Ramp'), null)
  assert.equal(parseLinkedInSerpResult(r('LinkedIn - Ramp'), 'Ramp'), null)
})

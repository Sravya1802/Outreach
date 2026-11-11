import assert from 'node:assert/strict'
import test from 'node:test'
import { currentUsProfile, parseLinkedInSerpResult } from '../services/apify.js'

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

test('currentUsProfile keeps people at the company now, in the US', () => {
  const us = (title, snippet) => ({ title, snippet, link: 'https://www.linkedin.com/in/x' })
  assert.equal(currentUsProfile(us('Celestine N - Senior Technical Recruiter ...', 'Technical Recruitment Coordinator. Comscore, Inc. Feb 2018 - Present. United States.'), 'Comscore')?.name, 'Celestine N')
  assert.equal(currentUsProfile(us('Jane Doe - Recruiter at Comscore', 'Recruiter at Comscore · Location: Chicago'), 'Comscore')?.title, 'Recruiter')
  // A stint that ended, a country LinkedIn site, a non-US place: dropped.
  assert.equal(currentUsProfile(us('Dawn Spear - Talent Acquisition', 'Sr Technical Recruiter. comScore, Inc. May 2016 - May 2017 1 year 1 month.'), 'Comscore'), null)
  assert.equal(currentUsProfile({ title: 'Madhavi Dey - Recruiter at Comscore, Inc.', snippet: 'Recruiter at Comscore, Inc. · Location: Pune', link: 'https://in.linkedin.com/in/madhavi' }, 'Comscore'), null)
  assert.equal(currentUsProfile(us('Namita Tyagi - Recruiter at Comscore', 'Comscore, Inc. Aug 2025 - Present. Pune, Maharashtra, India'), 'Comscore'), null)
})

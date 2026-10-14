import { describe, expect, it } from 'vitest'
import { activityDetail, activityTitle } from './activity'
import { displayName, isProfileComplete, setupSteps } from './onboarding'

describe('activity formatting', () => {
  it('labels known and unknown actions', () => {
    expect(activityTitle({ action: 'scrape' })).toBe('Scraped companies')
    expect(activityTitle({ action: 'scrape_roles' })).toBe('Scrape roles')
    expect(activityTitle({ action: '' })).toBe('Activity')
  })

  it('flattens object, JSON-string and plain-string details', () => {
    expect(activityDetail({ details: { subcategory: 'Fintech', source: 'linkedin', added: 4, updated: 0 } })).toBe('Fintech · linkedin · +4 new')
    expect(activityDetail({ details: '{"category":"AI","imported":2,"skipped":1}' })).toBe('AI · +2 new · 1 skipped')
    expect(activityDetail({ details: 'Found 3 people' })).toBe('Found 3 people')
    expect(activityDetail({ details: '{broken json' })).toBe('{broken json')
    expect(activityDetail({ details: null })).toBe('')
  })
})

describe('setup checklist', () => {
  it('stays undefined while loading', () => {
    const steps = setupSteps({ hasResume: undefined, profileComplete: undefined, answers: undefined, githubConnected: undefined, rulesSet: undefined })
    expect(steps.every(s => s.done === undefined)).toBe(true)
  })

  it('marks steps done from data', () => {
    const steps = setupSteps({ hasResume: true, profileComplete: false, answers: 2, githubConnected: true, rulesSet: false })
    expect(Object.fromEntries(steps.map(s => [s.id, s.done]))).toEqual({
      resume: true, details: false, answers: false, github: true, rules: false,
    })
    expect(setupSteps({ hasResume: true, profileComplete: true, answers: 3, githubConnected: true, rulesSet: true }).every(s => s.done)).toBe(true)
  })

  it('requires name, email and phone for a complete profile', () => {
    expect(isProfileComplete(undefined)).toBeUndefined()
    expect(isProfileComplete({})).toBe(false)
    expect(isProfileComplete({ first_name: 'A', email: 'a@b.co' })).toBe(false)
    expect(isProfileComplete({ first_name: 'A', email: 'a@b.co', phone: '+1 555' })).toBe(true)
  })

  it('greets by first name when known', () => {
    expect(displayName({ first_name: ' Sravya ' }, 'Lakshmisravyar')).toBe('Sravya')
    expect(displayName({}, 'Lakshmisravyar')).toBe('Lakshmisravyar')
  })
})

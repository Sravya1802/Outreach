import { describe, expect, it } from 'vitest'
import { normalizeQuestion, similarity } from './match'
import { unansweredCommon } from './commonQuestions'
import { toForm, toPatch } from './fields'
import { topLanguages } from './repoFormat'

describe('question matching (mirrors the backend)', () => {
  it('normalizes length hints and punctuation away', () => {
    expect(normalizeQuestion('Tell us about a product you love and why. (150 words)*')).toBe('tell us about a product you love and why')
  })
  it('treats rephrasings with the same words as the same question', () => {
    expect(similarity('How did you hear about this position?', 'How did you hear about the position')).toBe(1)
    expect(similarity('Desired salary', 'Earliest start date')).toBe(0)
  })
  it('hides common questions the user already answered', () => {
    const left = unansweredCommon([{ question: 'how did you hear about this position', status: 'answered' }])
    expect(left.some(q => q.question.startsWith('How did you hear'))).toBe(false)
    expect(unansweredCommon([{ question: 'How did you hear about this position?', status: 'pending' }]).some(q => q.question.startsWith('How did you hear'))).toBe(true)
  })
})

describe('profile form', () => {
  it('round-trips INT flags and keeps demographics out without consent', () => {
    const form = toForm({ first_name: 'Ada', needs_sponsorship: 1, gender: 'female', demographic_consent: 0 })
    expect(form.needs_sponsorship).toBe('1')
    expect(form.work_authorization).toBe('') // never assume citizenship
    const patch = toPatch(form)
    expect(patch.needs_sponsorship).toBe(1)
    expect(patch.first_name).toBe('Ada')
    expect(patch.last_name).toBeNull()
    expect('gender' in patch).toBe(false)
    expect(patch.demographic_consent).toBe(0)
    const withConsent = toPatch({ ...form, demographic_consent: '1', gender: 'female' })
    expect(withConsent.gender).toBe('female')
  })
})

describe('GitHub repo languages', () => {
  it('shows the top languages by share', () => {
    expect(topLanguages({ TypeScript: 7000, Python: 2200, CSS: 700, Shell: 100 })).toEqual(['TypeScript 70%', 'Python 22%', 'CSS 7%'])
    expect(topLanguages({})).toEqual([])
    expect(topLanguages({ Go: 1, Rust: 10000 }, 2)).toEqual(['Rust 100%', 'Go 1%'])
  })
})

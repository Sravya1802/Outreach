import { describe, expect, it } from 'vitest'
import { normalizeQuestion, similarity } from './match'
import { unansweredCommon } from './commonQuestions'
import { toForm, toPatch } from './fields'
import { topLanguages } from './repoFormat'
import { countryLabel, countryOf, formatBytes } from './resumeFiles'
import { resumeFill, toMonth } from './resumeFill'
import { emptyExperience } from './experience'

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

import { readExperiences } from './experience'

describe('experience entries', () => {
  it('reads saved entries from an array or a JSON string', () => {
    expect(readExperiences([{ company: 'Acme', title: 'Intern' }])[0]).toMatchObject({ company: 'Acme', title: 'Intern', current: false, summary: '' })
    expect(readExperiences('[{"company":"Lab"}]')[0]?.company).toBe('Lab')
    expect(readExperiences('not json')).toEqual([])
    expect(readExperiences(undefined)).toEqual([])
  })
})

describe('resume files', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(50459)).toBe('49 KB')
    expect(formatBytes(1.25 * 1024 * 1024)).toBe('1.3 MB')
  })
  it('places an application in a country, listing first', () => {
    expect(countryOf({ region: 'india', market: 'usa' })).toBe('india')
    expect(countryOf({ region: 'intl', market: 'usa' })).toBe('other')
    expect(countryOf({ region: null, market: 'india' })).toBe('india')
    expect(countryOf({ region: null, market: null })).toBe('usa')
    expect(countryLabel('other')).toBe('International')
  })
})

describe('fill from resume', () => {
  const parsed = {
    name: 'Ada Lovelace',
    contact: { email: 'ada@example.com', phone: '', location: 'Boston, MA', links: [{ label: 'LinkedIn', url: 'linkedin.com/in/ada' }, { label: 'GitHub', url: 'https://github.com/ada' }] },
    education: [{ school: 'MIT', degree: 'M.S.', field: 'Computer Science', location: '', start: 'Aug 2025', end: 'May 2027', gpa: '3.9' }],
    experience: [
      { company: 'Acme', title: 'Software Engineer', location: 'NYC', start: 'Jan 2024', end: 'Present', bullets: ['Built X'] },
      { company: 'Mercedes-Benz R&D', title: 'Data Engineering Intern', location: 'Bengaluru, India', start: 'June 2023', end: '08/2023', bullets: ['Moved Y', 'Cut Z'] },
    ],
    skills: [{ category: 'Languages', items: ['Python', 'SQL'] }],
    extras: [{ heading: 'Certifications', items: ['AWS SAA'] }],
  }

  it('reads resume dates as months and never invents a month', () => {
    expect(toMonth('Jun 2025')).toBe('2025-06')
    expect(toMonth('Sept. 2024')).toBe('2024-09')
    expect(toMonth('06/2023')).toBe('2023-06')
    expect(toMonth('2023')).toBe('')
    expect(toMonth('Present')).toBe('')
  })

  it('fills only empty fields and replaces a blank experience entry', () => {
    const r = resumeFill(parsed, { first_name: 'Ada', education_degree: 'Masters', email: '' }, [emptyExperience()])
    expect(r.edits.first_name).toBeUndefined()
    expect(r.edits.education_degree).toBeUndefined()
    expect(r.edits).toMatchObject({ last_name: 'Lovelace', email: 'ada@example.com', linkedin_url: 'https://linkedin.com/in/ada', github_url: 'https://github.com/ada', education_major: 'Computer Science', graduation_date: 'May 2027', skills: 'Python, SQL', certifications: 'AWS SAA' })
    expect(r.edits.phone).toBeUndefined()
    expect(r.experiences).toHaveLength(2)
    expect(r.experiences?.[0]).toMatchObject({ company: 'Acme', type: 'job', start: '2024-01', end: '', current: true })
    expect(r.experiences?.[1]).toMatchObject({ type: 'internship', start: '2023-06', end: '2023-08', summary: '• Moved Y\n• Cut Z' })
  })

  it('leaves a listed role alone except its empty fields', () => {
    const mine = { ...emptyExperience(), company: 'Acme', title: 'Software Engineer', summary: 'My words', type: 'job' as const }
    const acme = { experience: parsed.experience.slice(0, 1) }
    const r = resumeFill(acme, {}, [mine])
    expect(r.experiences).toHaveLength(1)
    expect(r.experiences?.[0]).toMatchObject({ summary: 'My words', location: 'NYC', start: '2024-01' })
    expect(resumeFill(acme, {}, r.experiences ?? []).filled).toBe(0)
  })
})

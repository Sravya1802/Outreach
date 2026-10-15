// Fill the Details form from the parsed master resume. Only empty fields are
// filled, so nothing the user typed is ever replaced; they review, then Save.

import type { ParsedResume } from '@/lib/api'
import { emptyExperience, type Experience } from './experience'
import type { FormValues } from './fields'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const str = (v: unknown): string => (v == null ? '' : String(v).trim())

export const isPresent = (s: string): boolean => /\b(present|current|now|ongoing)\b/i.test(s)

/** A resume date ("Jun 2025", "June 2025", "06/2025", "2025-06") → "YYYY-MM"; a bare year or anything else → "". */
export function toMonth(raw: string): string {
  const s = str(raw).toLowerCase()
  const month = (y: string, m: number) => (m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, '0')}` : '')
  const [, name = '', y1 = ''] = /\b([a-z]{3})[a-z]*\.?\s*[',]?\s*(\d{4})\b/.exec(s) ?? []
  if (y1 && MONTHS.includes(name)) return month(y1, MONTHS.indexOf(name) + 1)
  const [, m2 = '', y2 = ''] = /\b(\d{1,2})[/.-](\d{4})\b/.exec(s) ?? []
  if (y2) return month(y2, +m2)
  const [, y3 = '', m3 = ''] = /\b(\d{4})[/.-](\d{1,2})\b/.exec(s) ?? []
  if (y3) return month(y3, +m3)
  return ''
}

export function guessType(title: string): Experience['type'] {
  if (/\bintern(ship)?\b/i.test(title)) return 'internship'
  if (/\bresearch/i.test(title)) return 'research'
  if (/\bpart[- ]time\b/i.test(title)) return 'part_time'
  if (/\bvolunteer/i.test(title)) return 'volunteer'
  return 'job'
}

/** Resume experience entries → editor entries, newest first as the resume lists them. */
export function experiencesFrom(parsed: ParsedResume): Experience[] {
  return (parsed.experience ?? [])
    .filter(e => str(e.company) || str(e.title))
    .map(e => {
      const current = isPresent(str(e.end))
      return {
        ...emptyExperience(),
        company: str(e.company),
        title: str(e.title),
        location: str(e.location),
        type: guessType(str(e.title)),
        start: toMonth(str(e.start)),
        end: current ? '' : toMonth(str(e.end)),
        current,
        summary: (e.bullets ?? []).map(b => `• ${str(b)}`).filter(b => b.length > 2).join('\n'),
      }
    })
}

const isBlank = (e: Experience): boolean => !e.current && [e.company, e.title, e.location, e.start, e.end, e.summary].every(v => !str(v))
const sameRole = (a: Experience, b: Experience): boolean =>
  str(a.company).toLowerCase() === str(b.company).toLowerCase() && str(a.title).toLowerCase() === str(b.title).toLowerCase()

/**
 * What the resume adds to the form: values only for empty fields, and the
 * experience list with resume roles merged in (blank entries dropped, a role
 * already listed only gets its empty fields filled). `filled` counts changes.
 */
export function resumeFill(parsed: ParsedResume, values: FormValues, current: Experience[]): { edits: FormValues; experiences: Experience[] | null; filled: number } {
  const edits: FormValues = {}
  const put = (key: string, v: unknown) => {
    const s = str(v)
    if (s && !str(values[key])) edits[key] = s
  }

  const [first, ...rest] = str(parsed.name).split(/\s+/)
  put('first_name', first)
  put('last_name', rest.join(' '))
  put('email', parsed.contact?.email)
  put('phone', parsed.contact?.phone)
  put('location', parsed.contact?.location)
  for (const l of parsed.contact?.links ?? []) {
    const url = str(l.url)
    if (!url) continue
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`
    if (/linkedin\.com/i.test(url)) put('linkedin_url', full)
    else if (/github\.com/i.test(url)) put('github_url', full)
    else if (!/mailto:|@/i.test(url)) put('portfolio_url', full)
  }

  const edu = parsed.education?.[0]
  if (edu) {
    put('education_school', edu.school)
    put('education_degree', edu.degree)
    put('education_major', edu.field)
    if (!isPresent(str(edu.end))) put('graduation_date', edu.end)
    put('gpa', edu.gpa)
  }

  put('skills', (parsed.skills ?? []).flatMap(g => g.items ?? []).map(str).filter(Boolean).join(', '))
  put('certifications', (parsed.extras ?? []).filter(x => /certif/i.test(str(x.heading))).flatMap(x => x.items ?? []).map(str).filter(Boolean).join(', '))

  let changes = Object.keys(edits).length
  const kept = current.filter(e => !isBlank(e))
  const merged = kept.map(e => ({ ...e }))
  for (const r of experiencesFrom(parsed)) {
    const hit = merged.find(e => sameRole(e, r))
    if (!hit) { merged.push(r); changes++; continue }
    for (const k of ['location', 'start', 'end', 'summary'] as const) {
      if (!str(hit[k]) && str(r[k]) && !(k === 'end' && hit.current)) { hit[k] = r[k]; changes++ }
    }
  }
  const experiencesChanged = merged.length !== current.length || merged.some((e, i) => JSON.stringify(e) !== JSON.stringify(current[i]))
  return { edits, experiences: experiencesChanged ? merged : null, filled: changes }
}

// The To apply screen: every resume the app wrote, sorted by what it needs.
import type { ResumeJob } from '@/lib/api'
import { isApplied, isApplying } from '@/features/applications/applied'

export type JobState = 'applied' | 'applying' | 'review' | 'needs' | 'working' | 'open' | 'skipped'

const WORKING_LABEL: Record<string, string> = {
  tailoring: 'Writing the resume',
  asking_referral: 'Asking for a referral',
  waiting_referral: 'Waiting on a referral',
  ready_to_apply: 'Applying in the company’s morning',
  applying: 'Applying now',
  referred: 'Referred',
  done: 'Done',
}

export function jobState(j: ResumeJob): JobState {
  if (isApplied(j)) return 'applied'
  if (isApplying(j.apply_status)) return 'applying'
  if (j.decision === 'approved') {
    if (j.stage === 'needs_you') return j.needs_reason === 'resume' ? 'review' : 'needs'
    return 'working'
  }
  return j.decision === 'skipped' ? 'skipped' : 'open'
}

/** What the status column says. */
export function stateLabel(j: ResumeJob): string {
  const s = jobState(j)
  if (s === 'applied') return 'Applied'
  if (s === 'applying') return 'The app is applying'
  if (s === 'review') return 'Ready for your review'
  if (s === 'needs') return 'Needs you'
  if (s === 'working') return WORKING_LABEL[j.stage ?? ''] ?? 'In progress'
  if (s === 'skipped') return 'Skipped'
  return j.list_date ? 'Not approved' : 'Not applied'
}

/** From an earlier list, never applied, and nothing is moving it along. */
export function isMissed(j: ResumeJob, latestList: string | null): boolean {
  const s = jobState(j)
  return Boolean(j.list_date && latestList && j.list_date < latestList) && (s === 'open' || s === 'review' || s === 'needs')
}

export type ToApplyFilter = 'todo' | 'missed' | 'working' | 'applied' | 'all'

export function matchesToApply(j: ResumeJob, f: ToApplyFilter, latestList: string | null): boolean {
  const s = jobState(j)
  switch (f) {
    case 'todo': return s === 'review' || s === 'needs' || s === 'open'
    case 'missed': return isMissed(j, latestList)
    case 'working': return s === 'working' || s === 'applying'
    case 'applied': return s === 'applied'
    default: return true
  }
}

/** Newest list first; within a day, what needs you first, then by fit. */
export function sortToApply(jobs: ResumeJob[]): ResumeJob[] {
  const rank: Record<JobState, number> = { review: 0, needs: 1, open: 2, working: 3, applying: 4, applied: 5, skipped: 6 }
  return [...jobs].sort((a, b) =>
    (b.list_date ?? '').localeCompare(a.list_date ?? '')
    || rank[jobState(a)] - rank[jobState(b)]
    || (b.eval_score ?? 0) - (a.eval_score ?? 0))
}

/** "Latest list · Tue, Oct 27", "Mon, Oct 26", "Not from a list". */
export function dayLabel(listDate: string | null, latestList: string | null): string {
  if (!listDate) return 'Not from a list'
  const d = new Date(`${listDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return listDate === latestList ? `Latest list · ${d}` : d
}

// ---- Narrowing the list: field, level, grad year, industry, visa, ATS ----

export type RoleCategory = 'ai' | 'data' | 'swe' | 'other'
export const CATEGORY_LABEL: Record<RoleCategory, string> = { ai: 'AI / ML', data: 'Data', swe: 'Software engineering', other: 'Other' }

const AI = /\b(ai|ml|machine learning|deep learning|llms?|nlp|computer vision|gen ?ai|generative|applied scien\w*|research scien\w*|mlops|perception)\b/i
const DATA = /\b(data|analytics?|analyst|business intelligence|bi|statistic\w*)\b/i
const SWE = /\b(software|swe|sde|developer|engineer\w*|back-?end|front-?end|full[- ]?stack|platform|devops|cloud|infrastructure|mobile|ios|android|web|firmware|embedded|systems?)\b/i

/** The field, from the title first; the listing's AI track only when the title says nothing. */
export function roleCategory(j: Pick<ResumeJob, 'job_title' | 'tracks'>): RoleCategory {
  const t = j.job_title
  if (AI.test(t)) return 'ai'
  if (DATA.test(t)) return 'data'
  if (SWE.test(t)) return 'swe'
  return j.tracks?.includes('ai') ? 'ai' : 'other'
}

export type RoleLevel = 'intern' | 'new_grad' | 'other'
export const LEVEL_LABEL: Record<RoleLevel, string> = { intern: 'Internship', new_grad: 'New grad / entry level', other: 'Experienced or not stated' }

const INTERN = /\b(intern(ship)?s?|co-?op)\b/i
const NEW_GRAD = /\b(new ?grad\w*|graduate|entry[- ]level|early[- ]career|university|campus|junior|jr\.?|apprentice)\b|\b(engineer|developer|scientist|analyst)\s+(i|1)\b/i

export function roleLevel(j: Pick<ResumeJob, 'job_title' | 'role_type'>): RoleLevel {
  const t = j.job_title
  if (INTERN.test(t)) return 'intern'
  if (NEW_GRAD.test(t)) return 'new_grad'
  return j.role_type === 'intern' ? 'intern' : j.role_type === 'new_grad' ? 'new_grad' : 'other'
}

export interface RoleFilters {
  category: RoleCategory | ''
  level: RoleLevel | ''
  /** A graduation / start year the posting names, like "2027". */
  year: string
  industry: string
  tier: 'faang' | 'quant' | ''
  /** open: hide "won't sponsor" and "US citizens only". */
  visa: 'open' | 'sponsors' | ''
  /** pass: tailored resume above 90%; under: at or below. */
  ats: 'pass' | 'under' | ''
}

export const NO_FILTERS: RoleFilters = { category: '', level: '', year: '', industry: '', tier: '', visa: '', ats: '' }

export function matchesRoleFilters(j: ResumeJob, f: RoleFilters): boolean {
  if (f.category && roleCategory(j) !== f.category) return false
  if (f.level && roleLevel(j) !== f.level) return false
  if (f.year && !(j.grad_years ?? []).includes(f.year)) return false
  if (f.industry && j.industry !== f.industry) return false
  if (f.tier && j.company_tier !== f.tier) return false
  if (f.visa === 'open' && (j.sponsorship === 'no_sponsorship' || j.sponsorship === 'citizens_only')) return false
  if (f.visa === 'sponsors' && j.sponsorship !== 'sponsors') return false
  const ats = j.resume?.ats
  if (f.ats === 'pass' && !(ats != null && ats > 90)) return false
  if (f.ats === 'under' && !(ats != null && ats <= 90)) return false
  return true
}

/** Each value present in the list, with how many roles have it, most first. */
export function tally(values: (string | null | undefined)[]): { value: string; n: number }[] {
  const m = new Map<string, number>()
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value))
}

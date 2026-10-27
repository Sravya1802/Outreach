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

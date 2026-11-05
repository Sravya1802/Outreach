import type { ReferralMode, ReviewRow, ReviewStatus } from '@/lib/api'

export type ReviewTab = 'ready' | 'revising' | 'approved' | 'applied' | 'closed'

export const TABS: { value: ReviewTab; label: string }[] = [
  { value: 'ready', label: 'Ready for review' },
  { value: 'revising', label: 'Revising' },
  { value: 'approved', label: 'Approved' },
  { value: 'applied', label: 'Applied' },
  { value: 'closed', label: 'Closed' },
]

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  queued: 'Waiting for a run',
  in_progress: 'A run is on it',
  ready: 'Ready for review',
  revision_requested: 'Revision requested',
  approved: 'Approved',
  applied: 'Applied',
  closed: 'Closed',
}

export const MODE_LABEL: Record<ReferralMode, string> = {
  recruiters: 'Recruiters only',
  recruiters_engineers: 'Recruiters and engineers',
  my_contact: 'My contact',
  none: 'None',
}

export const NOTE_LIMIT = 300

/** The tab a role sits in; null while it waits for its first run. */
export function reviewTab(r: Pick<ReviewRow, 'status' | 'open_comments'>): ReviewTab | null {
  if (r.status === 'ready') return 'ready'
  if (r.status === 'revision_requested' || (r.status === 'in_progress' && r.open_comments > 0)) return 'revising'
  if (r.status === 'approved' || r.status === 'applied' || r.status === 'closed') return r.status
  return null
}

/** The backlog bar: a role is done once a run has written it or closed it. */
export function backlog(rows: Pick<ReviewRow, 'status' | 'open_comments'>[]) {
  const done = rows.filter(r => reviewTab(r) !== null).length
  return { done, total: rows.length, percent: rows.length ? Math.round((done / rows.length) * 100) : 0 }
}

/** The rule is above 90, so 90 itself is under it. */
export const atsOk = (n: number | null | undefined) => n != null && n > 90

const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [])
const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x : null)

/** A run writes the report as free JSON, so anything can be missing. */
export function readReport(report: unknown) {
  const r = (report && typeof report === 'object' ? report : {}) as Record<string, unknown>
  const scores = (r.scores && typeof r.scores === 'object' ? r.scores : {}) as Record<string, unknown>
  const keywords = (Array.isArray(r.keyword_table) ? r.keyword_table : [])
    .map((k: { keyword?: unknown; where?: unknown } | null) => ({ keyword: text(k?.keyword), where: text(k?.where) }))
    .filter((k): k is { keyword: string; where: string | null } => k.keyword !== null)
  return {
    needs: strings(r.top_5_hiring_needs),
    gaps: strings(r.gaps),
    changes: strings(r.changes_made),
    keywords,
    verdict: text(r.verdict),
    posting: text(r.posting_check),
    eligibility: text(r.eligibility_flag),
    nextChange: text(r.one_more_change),
    atsReason: text(scores.ats_reason),
    callbackReason: text(scores.callback_reason),
  }
}

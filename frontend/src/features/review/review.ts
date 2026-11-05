import type { ApproveResult, PipelineRun, ReferralMode, ReviewRow, ReviewStatus } from '@/lib/api'
import { timeAgo } from '@/lib/format'

export type ReviewTab = 'ready' | 'revising' | 'working' | 'waiting' | 'approved' | 'applied' | 'closed'

export const TABS: { value: ReviewTab; label: string }[] = [
  { value: 'ready', label: 'Ready for you' },
  { value: 'revising', label: 'Revising' },
  { value: 'working', label: 'Run working now' },
  { value: 'waiting', label: 'Waiting for a run' },
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

/** The tab a role sits in. A role a run is revising stays in Revising. */
export function reviewTab(r: Pick<ReviewRow, 'status' | 'open_comments'>): ReviewTab {
  if (r.status === 'queued') return 'waiting'
  if (r.status === 'in_progress') return r.open_comments > 0 ? 'revising' : 'working'
  if (r.status === 'revision_requested') return 'revising'
  return r.status
}

/** The backlog bar: a role is done once a run has written it or closed it. */
export function backlog(rows: Pick<ReviewRow, 'status' | 'open_comments'>[]) {
  const done = rows.filter(r => !['working', 'waiting'].includes(reviewTab(r))).length
  return { done, total: rows.length, percent: rows.length ? Math.round((done / rows.length) * 100) : 0 }
}

// claim_tailor_jobs gives up on a run after this long and puts its roles back in line.
const RUN_STOPPED_MS = 2 * 60 * 60 * 1000

/** A run with no finish time isn't running if it has outlived the 2 hours. */
export const isRunning = (run: PipelineRun | null, now = Date.now()) =>
  !!run && !run.finished_at && now - new Date(run.started_at).getTime() < RUN_STOPPED_MS

/** One line on the latest run, so an empty Run working now tile isn't a mystery. */
export function runLine(run: PipelineRun | null, now = Date.now()) {
  if (!run) return 'No run has started yet.'
  if (isRunning(run, now)) return `Run ${run.id} started ${timeAgo(run.started_at, now)}.`
  if (!run.finished_at) return `Run ${run.id} started ${timeAgo(run.started_at, now)} and never finished. Its roles go back in line on the next run.`
  const failed = run.roles_failed ? `, ${run.roles_failed} failed` : ''
  return `Run ${run.id} finished ${timeAgo(run.finished_at, now)}: ${run.roles_done} ${run.roles_done === 1 ? 'role' : 'roles'} done${failed}.`
}

/** What Approve did, for the toast. */
export function approvedLine({ emails, inGmail }: ApproveResult) {
  if (!emails) return 'Approved. This role has no emails to draft.'
  const count = emails === 1 ? '1 email' : `${emails} emails`
  if (inGmail < emails) return `Approved. ${count} in Outbox, but ${emails - inGmail} didn’t reach Gmail Drafts. OK each one in Outbox.`
  return `Approved. ${count} in Gmail Drafts. OK each one in Outbox to send it.`
}

/** The rule is above 90, so 90 itself is under it. */
export const atsOk = (n: number | null | undefined) => n != null && n > 90

/** A role Approve can take. */
export const canApprove = (r: Pick<ReviewRow, 'status' | 'check_status'>) => r.status === 'ready' && r.check_status === 'passed'

/** What Select all takes: nothing under the ATS rule or with an eligibility question goes in unread. */
export const safeToBulk = (r: Pick<ReviewRow, 'status' | 'check_status' | 'ats_after' | 'eligibility'>) => canApprove(r) && atsOk(r.ats_after) && !r.eligibility

/** How a bulk approve went, for the toast. */
export function bulkLine(done: ApproveResult[], failed: number) {
  const emails = done.reduce((n, r) => n + r.emails, 0)
  const roles = done.length === 1 ? '1 role' : `${done.length} roles`
  const mail = emails === 1 ? '1 email' : `${emails} emails`
  return `Approved ${roles}.${emails ? ` ${mail} in Gmail Drafts, each waiting for your OK in Outbox.` : ''}${failed ? ` ${failed} couldn’t be approved.` : ''}`
}

/** "About 3:05 PM", or Due now once the time has passed. */
export function nextRunLine(at: string | null, now = Date.now()) {
  if (!at) return 'Not scheduled'
  const t = new Date(at)
  if (t.getTime() <= now) return 'Due now'
  return `About ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

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

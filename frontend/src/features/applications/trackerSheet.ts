import type { TrackerReferral, TrackerRow, TrackerStatus } from '@/lib/api'

/** The sheet's words and colors (green yes, yellow waiting, blue in progress, red rejected). */
export const STATUS_OPTIONS: { value: TrackerStatus; label: string; tone: PillTone }[] = [
  { value: 'not_started', label: 'Not applied', tone: 'none' },
  { value: 'submitted', label: 'Waiting to hear back', tone: 'warning' },
  { value: 'responded', label: 'In Progress', tone: 'info' },
  { value: 'interview', label: 'Interview', tone: 'accent' },
  { value: 'offer', label: 'Offer', tone: 'success' },
  { value: 'rejected', label: 'Rejected', tone: 'danger' },
]

export const REFERRAL_OPTIONS: { value: TrackerReferral | ''; label: string; tone: PillTone }[] = [
  { value: '', label: '—', tone: 'none' },
  { value: 'yes', label: 'Yes', tone: 'success' },
  { value: 'asked', label: 'Asked', tone: 'warning' },
  { value: 'no', label: 'No', tone: 'danger' },
  { value: 'not_required', label: 'Not Required', tone: 'info' },
]

export type PillTone = 'none' | 'success' | 'warning' | 'info' | 'accent' | 'danger'

export const PILL: Record<PillTone, string> = {
  none: 'bg-hover text-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
  danger: 'bg-danger-soft text-danger',
}

export const statusTone = (s: TrackerStatus) => STATUS_OPTIONS.find(o => o.value === s)?.tone ?? 'none'
export const referralTone = (r: TrackerReferral | null) => REFERRAL_OPTIONS.find(o => o.value === (r ?? ''))?.tone ?? 'none'

export type TrackerFilter = 'all' | 'applied' | 'waiting' | 'active' | 'rejected' | 'not_applied'

export const FILTERS: { value: TrackerFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'applied', label: 'Applied' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'active', label: 'In progress' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'not_applied', label: 'Not applied' },
]

export function matchesFilter(r: Pick<TrackerRow, 'apply_status' | 'submitted'>, f: TrackerFilter): boolean {
  switch (f) {
    case 'applied': return r.submitted
    case 'waiting': return r.apply_status === 'submitted'
    case 'active': return ['responded', 'interview', 'offer'].includes(r.apply_status)
    case 'rejected': return r.apply_status === 'rejected'
    case 'not_applied': return !r.submitted
    default: return true
  }
}

export function matchesQuery(r: Pick<TrackerRow, 'company_name' | 'job_title'>, q: string): boolean {
  const s = q.trim().toLowerCase()
  return !s || r.company_name.toLowerCase().includes(s) || r.job_title.toLowerCase().includes(s)
}

/** The counts above the sheet. */
export function trackerCounts(rows: Pick<TrackerRow, 'apply_status' | 'submitted' | 'referral'>[]) {
  const n = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length
  return {
    applied: n(r => r.submitted),
    waiting: n(r => r.apply_status === 'submitted'),
    active: n(r => r.apply_status === 'responded' || r.apply_status === 'interview'),
    offers: n(r => r.apply_status === 'offer'),
    rejected: n(r => r.apply_status === 'rejected'),
    referred: n(r => r.referral === 'yes'),
    notApplied: n(r => !r.submitted),
  }
}

/** "jobs.ashbyhq.com" from a posting link, for the Link column. */
export function linkLabel(url: string | null): string {
  if (!url) return ''
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// Whether a role counts as applied: the app sent it, or you marked it.
import { stageFor } from './score'
import type { ApplyStatus } from '@/lib/api'

export function isApplied(r: { apply_status?: ApplyStatus | string | null; sent?: boolean }): boolean {
  return Boolean(r.sent) || stageFor((r.apply_status ?? null) as ApplyStatus | null) !== 'evaluated'
}

export type AppliedFilter = 'applied' | 'ready' | 'all'

export function matchesApplied(r: { apply_status?: ApplyStatus | string | null; sent?: boolean }, f: AppliedFilter): boolean {
  if (f === 'all') return true
  return f === 'applied' ? isApplied(r) : !isApplied(r)
}

const DAY = 86_400_000
/** "Applied today", "Applied Oct 14". */
export function appliedLabel(appliedAt: string | null | undefined, now = Date.now()): string {
  if (!appliedAt) return 'Applied'
  const t = Date.parse(appliedAt)
  if (Number.isNaN(t)) return 'Applied'
  if (now - t < DAY && new Date(t).toDateString() === new Date(now).toDateString()) return 'Applied today'
  return `Applied ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

/** The job sites the app can fill in and submit itself, by the application link. */
export function autoSite(url: string | null | undefined): 'Greenhouse' | 'Lever' | 'Ashby' | null {
  let host = ''
  try { host = new URL(String(url)).hostname.toLowerCase() } catch { return null }
  const on = (d: string) => host === d || host.endsWith(`.${d}`)
  return on('greenhouse.io') ? 'Greenhouse' : on('lever.co') ? 'Lever' : on('ashbyhq.com') ? 'Ashby' : null
}

/** The app is submitting it right now. */
export const isApplying = (status: string | null | undefined) => status === 'queued' || status === 'in_progress'

/** The app tried and couldn't send it (needs your answer, a captcha, a login…). */
export const appCouldNotSend = (status: string | null | undefined) =>
  ['needs_review', 'submit_failed', 'captcha_needed', 'login_needed', 'platform_unsupported'].includes(String(status))

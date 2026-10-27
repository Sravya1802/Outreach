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

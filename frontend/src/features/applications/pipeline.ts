// Pipeline page helpers: follow-up nudges, next-step dates, funnel numbers.
import type { EvaluationSummary } from '@/lib/api'
import { stageFor } from './score'

/** An application with no reply after this many days gets a follow-up nudge. */
export const FOLLOW_UP_DAYS = 7

const DAY = 24 * 60 * 60 * 1000

/** Postgres text timestamps ("2026-10-04 21:00:00.12+00") → ms; Safari can't parse them raw. */
export function parseTime(s: string | null | undefined): number | null {
  if (!s) return null
  const iso = s.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

/** Days an applied role has gone without a reply, once that's FOLLOW_UP_DAYS or more; else null. */
export function followUpDays(r: Pick<EvaluationSummary, 'apply_status' | 'applied_at'>, now: number = Date.now()): number | null {
  if (stageFor(r.apply_status) !== 'applied') return null
  const t = parseTime(r.applied_at)
  if (t == null) return null
  const days = Math.floor((now - t) / DAY)
  return days >= FOLLOW_UP_DAYS ? days : null
}

/** When the row last changed stage (falls back to applied, then created). */
export function updatedAt(r: Pick<EvaluationSummary, 'stage_changed_at' | 'applied_at' | 'created_at'>): string {
  return r.stage_changed_at || r.applied_at || r.created_at
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later'

function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** "2026-10-16" against today (local): overdue / today / within 3 days / later, plus a short label. */
export function nextStepDue(date: string | null | undefined, today: Date = new Date()): { state: DueState; label: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const diff = Math.round((d.getTime() - localMidnight(today)) / DAY)
  const label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday'
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return { state: diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff <= 3 ? 'soon' : 'later', label }
}

export interface Funnel { applied: number; heardBack: number; interviews: number; offers: number }

/** A Closed role counts as applied (and as heard back) only if it was ever applied to. */
export function funnel(items: Pick<EvaluationSummary, 'apply_status' | 'applied_at'>[]): Funnel {
  const f: Funnel = { applied: 0, heardBack: 0, interviews: 0, offers: 0 }
  for (const r of items) {
    const s = stageFor(r.apply_status)
    if (s === 'evaluated' || (s === 'rejected' && !r.applied_at)) continue
    f.applied++
    if (s !== 'applied') f.heardBack++
    if (s === 'interview' || s === 'offer') f.interviews++
    if (s === 'offer') f.offers++
  }
  return f
}

/** Case-insensitive match on company, title, note and next step. */
export function matchesSearch(r: Pick<EvaluationSummary, 'company_name' | 'job_title' | 'notes' | 'next_step'>, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [r.company_name, r.job_title, r.notes, r.next_step].some(v => v?.toLowerCase().includes(needle))
}

/** How it was sent, for the row's small print. */
export function applyNote(r: Pick<EvaluationSummary, 'apply_mode' | 'apply_status' | 'apply_error'>): { text: string; tone: 'muted' | 'danger' } | null {
  if (r.apply_error && stageFor(r.apply_status) === 'evaluated') return { text: `Auto-apply stopped: ${r.apply_error}`, tone: 'danger' }
  if (stageFor(r.apply_status) === 'evaluated') return null
  return { text: r.apply_mode === 'auto' ? 'Auto-applied' : 'Applied by hand', tone: 'muted' }
}

// Dashboard numbers, computed from rows the app already loads.
import type { EvaluationSummary, OutboxItem } from '@/lib/api'
import { parseTime } from '@/features/applications/pipeline'

export interface Bucket { label: string; value: number; /** Tooltip wording. */ title: string }

const DAY = 24 * 60 * 60 * 1000

/** Monday 00:00 local of the week containing t. */
function weekStart(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

/** Counts per week for the last `weeks` weeks (oldest first), from timestamps. */
export function perWeek(times: (string | null | undefined)[], now: number, weeks = 8, noun = 'applications'): Bucket[] {
  const thisWeek = weekStart(now)
  const starts = Array.from({ length: weeks }, (_, i) => thisWeek - (weeks - 1 - i) * 7 * DAY)
  const counts = starts.map(() => 0)
  for (const s of times) {
    const t = parseTime(s)
    if (t == null || t > now) continue
    const i = starts.findIndex((st, k) => t >= st && t < (starts[k + 1] ?? Infinity))
    if (i >= 0) counts[i] = (counts[i] ?? 0) + 1
  }
  return starts.map((st, i) => {
    const label = new Date(st).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const n = counts[i] ?? 0
    return { label, value: n, title: `${n} ${n === 1 ? noun.replace(/s$/, '') : noun} the week of ${label}` }
  })
}

/** Fit scores (stored 0–100) grouped into the bands the rules use. */
export function scoreBands(rows: Pick<EvaluationSummary, 'score'>[]): Bucket[] {
  const bands = [
    { label: 'Under 6', test: (s: number) => s < 6 },
    { label: '6–6.9', test: (s: number) => s >= 6 && s < 7 },
    { label: '7–7.9', test: (s: number) => s >= 7 && s < 8 },
    { label: '8–8.9', test: (s: number) => s >= 8 && s < 9 },
    { label: '9+', test: (s: number) => s >= 9 },
  ]
  const scores = rows.map(r => Number(r.score)).filter(n => Number.isFinite(n) && n > 0).map(n => n / 10)
  return bands.map(b => {
    const n = scores.filter(b.test).length
    return { label: b.label, value: n, title: `${n} ${n === 1 ? 'role' : 'roles'} scored ${b.label}` }
  })
}

/** Sent emails: first emails and follow-ups, by when they went out. */
export const sentTimes = (outbox: OutboxItem[] | undefined) => (outbox ?? []).filter(o => o.status === 'sent').map(o => o.sent_at)

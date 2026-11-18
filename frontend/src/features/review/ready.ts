import type { ReadyRole } from '@/lib/api'

/** Is the Scout'n'Jobs filler extension in this browser? (It marks the page.) */
export function hasFiller(doc: Document = document): boolean {
  return Boolean(doc.documentElement.dataset.snjFiller)
}

/** Whole days from today until a date-only deadline ("2026-11-20"), in the user's own day. */
export function daysLeft(deadline: string | null, now = new Date()): number | null {
  if (!deadline) return null
  const [y, m, d] = deadline.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000)
}

/** "Closes today", "Closes tomorrow", "Closes Fri, Nov 20", or "Closed Nov 15". */
export function closesLabel(deadline: string | null, now = new Date()): string | null {
  const n = daysLeft(deadline, now)
  if (n == null || !deadline) return null
  const day = new Date(`${deadline.slice(0, 10)}T12:00:00Z`)
  const fmt = (o: Intl.DateTimeFormatOptions) => day.toLocaleDateString('en-US', { ...o, timeZone: 'UTC' })
  if (n < 0) return `Closed ${fmt({ month: 'short', day: 'numeric' })}`
  if (n === 0) return 'Closes today'
  if (n === 1) return 'Closes tomorrow'
  return `Closes ${fmt({ weekday: 'short', month: 'short', day: 'numeric' })}`
}

/** What the last fill left: "Filled 14 · resume attached · 2 questions need you". */
export function fillLine(r: Pick<ReadyRole, 'filled_at' | 'filled' | 'unanswered' | 'resume_attached'>): string | null {
  if (!r.filled_at) return null
  return [
    `Filled ${r.filled ?? 0}`,
    r.resume_attached ? 'resume attached' : 'resume not attached',
    r.unanswered.length ? `${r.unanswered.length} question${r.unanswered.length === 1 ? '' : 's'} need you` : '',
  ].filter(Boolean).join(' · ')
}

/** The origin the extension calls (the API server), from the client's API base. */
export function apiOrigin(apiBase: string, here = window.location.href): string {
  return new URL(apiBase, here).origin
}

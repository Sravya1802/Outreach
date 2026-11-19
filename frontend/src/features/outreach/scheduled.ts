import type { ApproveAllResult, OutboxItem } from '@/lib/api'
import { cityOf, inZone } from './outbox'

/** Your own clock (Chicago) for counting a day's sends, as the server does. */
export const HOME_TZ = 'America/Chicago'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "3 skipped: 2 still empty or being written by Claude, 1 already emailed…". Empty when none. */
export function skipLine(r: Pick<ApproveAllResult, 'skipped' | 'reasons'>): string {
  if (!r.skipped) return ''
  return `${r.skipped} skipped: ${r.reasons.map(x => `${x.count} ${x.label}`).join(', ')}.`
}

/** The button's label: how many finished emails it schedules. */
export function approveAllLabel(r: Pick<ApproveAllResult, 'approved'> | undefined): string {
  if (!r) return 'Approve all emails'
  return r.approved ? `Approve all ${plural(r.approved, 'email')}` : 'No finished emails to approve'
}

/** What the confirm dialog says before anything is scheduled. */
export function approveAllText(r: ApproveAllResult, cap = 40): string {
  return `${plural(r.approved, 'email')} your Claude run has finished writing. They’re scheduled, not sent now: each goes the next business morning, `
    + `8–10 AM in the recipient’s time zone (Chicago time if unknown), 2 to 4 minutes apart, at most ${cap} a day; the rest roll to the next business morning. `
    + 'Each carries its role’s latest tailored resume. You can cancel or send any of them now from People → Scheduled.'
    + (r.skipped ? ` ${skipLine(r)}` : '')
}

/** After Approve all: what was scheduled, when, and what was skipped. */
export function approvedLine(r: ApproveAllResult): string {
  if (!r.approved) return r.skipped ? `Nothing approved. ${skipLine(r)}` : 'Nothing to approve.'
  const first = r.first ? inZone(r.first, HOME_TZ) : null
  const last = r.last ? inZone(r.last, HOME_TZ) : null
  const when = first ? ` The first goes ${first}${last && last !== first ? `, the last ${last}` : ''} (your time).` : ''
  return `Scheduled ${plural(r.approved, 'email')}.${when}${r.skipped ? ` ${skipLine(r)}` : ''}`
}

/** Scheduled emails, soonest first, grouped by the day they go (your time). */
export function scheduledDays(items: OutboxItem[]): { day: string; items: OutboxItem[] }[] {
  const list = items.filter(i => i.status === 'scheduled' || i.status === 'sending').sort((a, b) => Date.parse(a.send_after) - Date.parse(b.send_after))
  const days = new Map<string, OutboxItem[]>()
  for (const i of list) {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: HOME_TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(i.send_after))
    days.set(day, [...(days.get(day) ?? []), i])
  }
  return [...days.entries()].map(([day, items]) => ({ day, items }))
}

/** "8:14 AM Chicago time" for the recipient, and yours when it differs. */
export function sendTimeLabel(i: Pick<OutboxItem, 'send_after' | 'recipient_tz' | 'status'>): string {
  if (i.status === 'sending') return 'Sending now…'
  const time = (tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(i.send_after))
  const theirs = `${time(i.recipient_tz)} ${cityOf(i.recipient_tz)} time`
  return i.recipient_tz === HOME_TZ ? theirs : `${theirs} · ${time(HOME_TZ)} yours`
}

/** Emails held back before sending (empty, not Claude's, no resume), newest first. */
export function notSent(items: OutboxItem[]): OutboxItem[] {
  return items.filter(i => i.status === 'failed' && (i.error ?? '').startsWith('Not sent:')).sort((a, b) => b.id - a.id)
}

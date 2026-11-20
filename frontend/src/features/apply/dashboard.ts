import type { DashboardChip, DashboardGroup, DashboardRole, RolePerson } from '@/lib/api'

export const HOME_TZ = 'America/Chicago'

/** The counts across the top; each one filters the list when pressed. */
export const COUNTS: { key: DashboardGroup; label: string }[] = [
  { key: 'review', label: 'Ready to review' },
  { key: 'approved', label: 'Approved' },
  { key: 'emailed', label: 'Emails sent' },
  { key: 'replies', label: 'Replies' },
  { key: 'submit', label: 'To submit' },
  { key: 'applied', label: 'Applied' },
  { key: 'closing', label: 'Closing soon' },
]

export interface Filters {
  group: DashboardGroup | null
  search: string
  kind: '' | 'intern' | 'new_grad'
  deadline: '' | 'week' | 'month' | 'dated' | 'none'
  ats: '' | '90' | '80' | 'under90'
  closed: boolean
}
export const NO_FILTERS: Filters = { group: null, search: '', kind: '', deadline: '', ats: '', closed: false }

/** Whole days from today (your day) to a date-only deadline. */
export function daysTo(deadline: string | null, now = new Date()): number | null {
  if (!deadline) return null
  const [y, m, d] = deadline.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000)
}

/** Does a card pass the filters? Closed roles show only when asked for. */
export function matches(c: DashboardRole, f: Filters, now = new Date()): boolean {
  if (!f.closed && c.chip === 'Closed') return false
  if (f.group && !c.groups.includes(f.group)) return false
  const s = f.search.trim().toLowerCase()
  if (s && !`${c.company} ${c.title} ${c.location ?? ''}`.toLowerCase().includes(s)) return false
  if (f.kind && c.kind !== f.kind) return false
  const left = daysTo(c.deadline, now)
  if (f.deadline === 'week' && !(left != null && left >= 0 && left <= 7)) return false
  if (f.deadline === 'month' && !(left != null && left >= 0 && left <= 30)) return false
  if (f.deadline === 'dated' && left == null) return false
  if (f.deadline === 'none' && left != null) return false
  if (f.ats === '90' && !((c.ats ?? 0) >= 90)) return false
  if (f.ats === '80' && !((c.ats ?? 0) >= 80)) return false
  if (f.ats === 'under90' && !(c.ats != null && c.ats < 90)) return false
  return true
}

/** How many cards each count holds (closed ones aside). */
export function countGroups(cards: DashboardRole[]): Record<DashboardGroup, number> {
  const out = Object.fromEntries(COUNTS.map(c => [c.key, 0])) as Record<DashboardGroup, number>
  for (const c of cards) for (const g of c.groups) out[g] += 1
  return out
}

const dayOf = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: HOME_TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))

/** The planned send day for a role's emails, or where its outreach stands. */
export function sendLine(c: Pick<DashboardRole, 'scheduled' | 'first_send' | 'last_send' | 'to_approve' | 'writing' | 'sent' | 'in_outbox'>): string | null {
  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`
  if (c.scheduled && c.first_send) {
    const first = dayOf(c.first_send)
    const last = c.last_send ? dayOf(c.last_send) : first
    return `${n(c.scheduled, 'email')} ${c.scheduled === 1 ? 'goes' : 'go'} ${first === last ? first : `${first} – ${last}`}`
  }
  if (c.to_approve) return `${n(c.to_approve, 'email')} to approve`
  if (c.in_outbox) return `${n(c.in_outbox, 'email')} waiting in Outbox`
  if (c.writing) return `Claude is writing ${n(c.writing, 'email')}`
  if (c.sent) return `${n(c.sent, 'email')} sent`
  return null
}

export const CHIP_TONE: Record<DashboardChip, 'accent' | 'info' | 'success' | 'warning' | 'neutral'> = {
  Review: 'accent', Approved: 'info', Emailed: 'info', Replied: 'warning', Applied: 'success', Closed: 'neutral',
}

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'accent'

/** Where one person's email is: written, scheduled, sent, replied, bounced, or why it won't go. */
export function emailState(p: Pick<RolePerson, 'email' | 'email_check' | 'outbox_status' | 'send_after' | 'recipient_tz' | 'reply' | 'writing' | 'body' | 'draft_status'>): { text: string; tone: Tone } {
  if (p.reply?.kind === 'bounce' || p.email_check === 'invalid') return { text: 'Bounced', tone: 'danger' }
  if (p.reply && p.reply.kind !== 'auto_reply') return { text: 'Replied', tone: 'success' }
  if (p.outbox_status === 'sent') return { text: 'Sent', tone: 'success' }
  if (p.outbox_status === 'scheduled' || p.outbox_status === 'sending') {
    return { text: p.send_after ? `Scheduled ${new Intl.DateTimeFormat('en-US', { timeZone: p.recipient_tz || HOME_TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(p.send_after))}` : 'Scheduled', tone: 'info' }
  }
  if (p.outbox_status === 'draft') return { text: 'In Outbox', tone: 'info' }
  if (p.outbox_status === 'failed') return { text: 'Held back', tone: 'danger' }
  if (!p.email) return { text: 'No email address', tone: 'neutral' }
  if (p.email_check !== 'valid') return { text: 'Address not verified', tone: 'warning' }
  if (p.writing || !(p.body ?? '').trim()) return { text: 'Claude is writing', tone: 'neutral' }
  return { text: 'Written', tone: 'accent' }
}

/** Where one person's LinkedIn note is. */
export function noteState(p: Pick<RolePerson, 'note_status' | 'note_text' | 'linkedin_url'>): { text: string; tone: Tone } | null {
  if (p.note_status === 'replied') return { text: 'Note answered', tone: 'success' }
  if (p.note_status === 'marked_sent') return { text: 'Note sent', tone: 'success' }
  if (p.note_status === 'to_send') return { text: 'Note to send', tone: 'warning' }
  if ((p.note_text ?? '').trim()) return { text: 'Note written', tone: 'neutral' }
  return p.linkedin_url ? { text: 'Claude is writing the note', tone: 'neutral' } : null
}

/** What to do about a reply or a bounce. */
export function nextStep(p: Pick<RolePerson, 'name' | 'reply' | 'email_check'>): string | null {
  const first = (p.name || '').split(/\s+/)[0] || 'them'
  if (p.reply?.kind === 'bounce' || p.email_check === 'invalid') return `The address bounced. Send ${first} the LinkedIn note instead, or find another address on the role page.`
  if (p.reply?.kind === 'reply' || p.reply?.kind === 'linkedin_message') return `Read ${first}’s reply in Gmail and answer it. If they refer you, apply with their link and press I applied.`
  if (p.reply?.kind === 'auto_reply') return `${first} sent an automatic reply (often out of office). Nothing to do yet.`
  return null
}

/** Every LinkedIn note for the role, ready to paste one by one. */
export function notesText(people: Pick<RolePerson, 'name' | 'note_text' | 'linkedin_url' | 'note_status'>[]): string {
  return people.filter(p => (p.note_text ?? '').trim() && p.note_status !== 'marked_sent' && p.note_status !== 'replied')
    .map(p => [p.name, p.linkedin_url, p.note_text].filter(Boolean).join('\n')).join('\n\n')
}

/** People-tab link for a company (its key there is the lowercased name). */
export const peopleLink = (company: string) => `/people/contacts?company=${encodeURIComponent(company.trim().toLowerCase())}`

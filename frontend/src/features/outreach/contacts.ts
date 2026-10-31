import type { OutreachContact, PlanCompany } from '@/lib/api'

const EMAIL: Record<string, { text: string; tone: string }> = {
  verified: { text: 'verified', tone: 'text-success' },
  valid: { text: 'valid', tone: 'text-success' },
  catch_all: { text: 'catch-all', tone: 'text-warning' },
  accept_all: { text: 'catch-all', tone: 'text-warning' },
  risky: { text: 'risky', tone: 'text-warning' },
  guessed: { text: 'guessed from pattern', tone: 'text-warning' },
  unknown: { text: 'unverified', tone: 'text-subtle' },
  unverified: { text: 'unverified', tone: 'text-subtle' },
  invalid: { text: 'invalid', tone: 'text-danger' },
}

export function emailLabel(status: string | null | undefined): { text: string; tone: string } | null {
  return status ? EMAIL[status.toLowerCase()] ?? { text: status.replace(/_/g, ' '), tone: 'text-subtle' } : null
}

const STATUS: Record<string, { text: string; tone: string }> = {
  pending: { text: 'Not contacted', tone: 'text-subtle' },
  generated: { text: 'Draft ready', tone: 'text-info' },
  sent: { text: 'Emailed', tone: 'text-warning' },
  dm_sent: { text: 'Messaged', tone: 'text-warning' },
  replied: { text: 'Replied', tone: 'text-success' },
  connected: { text: 'Connected on LinkedIn', tone: 'text-info' },
  closed: { text: 'Closed', tone: 'text-subtle' },
}

export function statusLabel(status: string | null | undefined): { text: string; tone: string } {
  return STATUS[status ?? 'pending'] ?? { text: String(status).replace(/_/g, ' '), tone: 'text-subtle' }
}

export function contactMatches(c: Pick<OutreachContact, 'name' | 'title' | 'company_name' | 'email'>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [c.name, c.title, c.company_name, c.email].some(v => (v ?? '').toLowerCase().includes(q))
}

/** What a company row says at a glance: what's waiting on you first. */
export function planSummary(c: Pick<PlanCompany, 'waiting' | 'notesToSend' | 'scheduled' | 'sent'>): { text: string; tone: 'accent' | 'info' | 'neutral' | 'success' }[] {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
  return [
    c.waiting > 0 && { text: n(c.waiting, 'email to approve', 'emails to approve'), tone: 'accent' as const },
    c.notesToSend > 0 && { text: n(c.notesToSend, 'LinkedIn note to send', 'LinkedIn notes to send'), tone: 'info' as const },
    c.scheduled > 0 && { text: `${c.scheduled} scheduled`, tone: 'neutral' as const },
    c.sent > 0 && { text: `${c.sent} emailed`, tone: 'success' as const },
  ].filter((b): b is { text: string; tone: 'accent' | 'info' | 'neutral' | 'success' } => Boolean(b))
}

export const needsYou = (c: Pick<PlanCompany, 'waiting' | 'notesToSend'>) => c.waiting + c.notesToSend > 0

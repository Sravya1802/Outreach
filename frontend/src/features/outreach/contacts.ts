import type { OutreachContact } from '@/lib/api'

const EMAIL: Record<string, { text: string; tone: string }> = {
  verified: { text: 'verified', tone: 'text-success' },
  valid: { text: 'valid', tone: 'text-success' },
  catch_all: { text: 'catch-all', tone: 'text-warning' },
  accept_all: { text: 'catch-all', tone: 'text-warning' },
  risky: { text: 'risky', tone: 'text-warning' },
  unknown: { text: 'unverified', tone: 'text-subtle' },
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

import type { OutboxItem, ReplyItem } from '@/lib/api'
import { timeAgo } from '@/lib/format'

export interface Thread { root: OutboxItem; followups: OutboxItem[] }

/** First email + its follow-ups, newest thread first (API order). */
export function groupThreads(items: OutboxItem[]): Thread[] {
  const byRoot = new Map<number, Thread>()
  const order: number[] = []
  for (const it of items) {
    const rootId = it.thread_root_id ?? it.id
    if (!byRoot.has(rootId)) { byRoot.set(rootId, { root: it, followups: [] }); order.push(rootId) }
    const t = byRoot.get(rootId) as Thread
    if (it.step === 0) t.root = it
    else t.followups.push(it)
  }
  return order.map(id => byRoot.get(id) as Thread).map(t => ({ ...t, followups: t.followups.sort((a, b) => a.step - b.step) }))
}

export const STEP_LABEL = ['First email', 'Follow-up 1', 'Follow-up 2'] as const

/** "Tue 9:14 AM" in the given zone. */
export function inZone(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  } catch { return new Date(iso).toLocaleString() }
}

export function cityOf(tz: string): string {
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? tz
}

export function itemStatus(it: OutboxItem, now = Date.now()): { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'accent' } {
  if (it.status === 'sent') return { text: `Sent ${timeAgo(it.sent_at, now)}`, tone: 'success' }
  if (it.status === 'cancelled') return { text: it.cancel_reason ? `Not sent: ${it.cancel_reason.toLowerCase()}` : 'Cancelled', tone: 'neutral' }
  if (it.status === 'failed') return { text: `Failed: ${it.error || 'unknown error'}`, tone: 'danger' }
  if (it.status === 'sending') return { text: 'Sending…', tone: 'accent' }
  return { text: `Goes ${inZone(it.send_after, it.recipient_tz)} (${cityOf(it.recipient_tz)} time)`, tone: 'warning' }
}

export function replyText(r: ReplyItem): string {
  const who = r.contact_name || r.from_name || r.from_email || 'Someone'
  if (r.kind === 'reply') return `${who} replied`
  if (r.kind === 'auto_reply') return `${who} sent an automatic reply`
  if (r.kind === 'bounce') return `Your email to ${who} bounced`
  if (r.kind === 'linkedin_message') return `${who} messaged you on LinkedIn`
  return `${who} accepted your LinkedIn invitation`
}

// "Today" on Home: everything that needs the user, or is happening for them, right now.
import type { DailyPlanOverview, EvaluationSummary, GmailStatus, OutboxItem, PlanStage, ReplyItem } from '@/lib/api'
import { followUpDays, nextStepDue } from '@/features/applications/pipeline'

export type TodayTone = 'danger' | 'action' | 'info'

export interface TodayItem {
  id: string
  tone: TodayTone
  title: string
  /** Names or a breakdown, kept short. */
  detail?: string
  to: string
}

export interface TodayInput {
  plan?: DailyPlanOverview
  queue?: { needs_review?: number; failed?: number }
  /** Pipeline rows (all stages). */
  tracked?: EvaluationSummary[]
  replies?: ReplyItem[]
  outbox?: OutboxItem[]
  gmail?: GmailStatus
  servicesDown?: { id: string; name: string; purpose: string }[]
  now: number
  today?: Date
}

const HOUR = 60 * 60 * 1000
const REPLY_WINDOW = 72 * HOUR
const OUTBOX_WINDOW = 24 * HOUR
const ON_THE_WAY: PlanStage[] = ['tailoring', 'asking_referral', 'waiting_referral', 'ready_to_apply', 'applying']
const REAL_REPLY: ReplyItem['kind'][] = ['reply', 'linkedin_message', 'linkedin_accept']

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Ramp, Stripe and 2 more" */
export function nameList(names: (string | null | undefined)[], max = 3): string {
  const unique = [...new Set(names.filter((n): n is string => Boolean(n)))]
  if (unique.length <= max) return unique.length > 1 ? `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}` : (unique[0] ?? '')
  return `${unique.slice(0, max).join(', ')} and ${unique.length - max} more`
}

/** Problems first, then things to do, then what's happening on its own. */
export function todayItems(i: TodayInput): TodayItem[] {
  const out: TodayItem[] = []
  const today = i.today ?? new Date(i.now)

  // Problems
  if (i.gmail?.connected && i.gmail.status === 'error') {
    out.push({ id: 'gmail', tone: 'danger', title: 'Gmail stopped accepting your app password', detail: 'Emails are on hold until you reconnect.', to: '/integrations/gmail' })
  }
  for (const s of i.servicesDown ?? []) {
    out.push({ id: `svc-${s.id}`, tone: 'danger', title: `${s.name} is unavailable`, detail: `${s.purpose} won’t work for now.`, to: '/usage' })
  }
  const stuck = (i.plan?.active ?? []).filter(a => a.stage === 'needs_you')
  const review = i.queue?.needs_review ?? 0
  if (stuck.length + review > 0) {
    out.push({ id: 'needs-you', tone: 'danger', title: `${plural(stuck.length + review, 'application needs', 'applications need')} you`,
      detail: stuck.length ? nameList(stuck.map(a => a.company_name)) : 'A form asked something it couldn’t answer.', to: '/applications/auto-apply' })
  }
  if (i.queue?.failed) {
    out.push({ id: 'failed', tone: 'danger', title: `${plural(i.queue.failed, 'application', 'applications')} couldn’t be sent`, to: '/applications/auto-apply' })
  }

  // To do
  const pending = (i.plan?.items ?? []).filter(p => p.tier === 'top' && p.decision === 'pending')
  if (pending.length) {
    out.push({ id: 'approve', tone: 'action', title: `${plural(pending.length, 'role is', 'roles are')} waiting for your OK`,
      detail: nameList(pending.map(p => p.company_name)), to: '/applications/auto-apply' })
  }
  const quiet = (i.tracked ?? []).filter(r => followUpDays(r, i.now) != null)
  const due = (i.tracked ?? []).filter(r => {
    const d = nextStepDue(r.next_step_at, today)
    return d && (d.state === 'overdue' || d.state === 'today')
  })
  if (quiet.length) {
    out.push({ id: 'follow-up', tone: 'action', title: `Follow up on ${plural(quiet.length, 'application', 'applications')}`,
      detail: `No reply in a week: ${nameList(quiet.map(r => r.company_name))}`, to: '/dashboard?stage=followup#tracker' })
  }
  if (due.length) {
    out.push({ id: 'next-steps', tone: 'action', title: `${plural(due.length, 'next step is', 'next steps are')} due`,
      detail: nameList(due.map(r => r.next_step ? `${r.next_step} (${r.company_name})` : r.company_name), 2), to: '/dashboard#tracker' })
  }
  const replies = (i.replies ?? []).filter(r => REAL_REPLY.includes(r.kind) && i.now - new Date(r.received_at).getTime() <= REPLY_WINDOW)
  if (replies.length) {
    out.push({ id: 'replies', tone: 'action', title: `${plural(replies.length, 'new reply', 'new replies')}`,
      detail: nameList(replies.map(r => r.company_name || r.contact_name || r.from_name)), to: '/people/outbox' })
  }

  // Happening on its own
  const onTheWay = (i.plan?.active ?? []).filter(a => ON_THE_WAY.includes(a.stage))
  if (onTheWay.length) {
    const waiting = onTheWay.filter(a => a.stage === 'waiting_referral' || a.stage === 'asking_referral').length
    out.push({ id: 'going-out', tone: 'info', title: `${plural(onTheWay.length, 'approved role is', 'approved roles are')} on the way`,
      detail: waiting ? `${waiting} waiting on a referral first` : nameList(onTheWay.map(a => a.company_name)), to: '/applications/auto-apply' })
  }
  const sending = (i.outbox ?? []).filter(o => o.status === 'scheduled' && new Date(o.send_after).getTime() - i.now <= OUTBOX_WINDOW)
  if (sending.length) {
    out.push({ id: 'emails', tone: 'info', title: `${plural(sending.length, 'email goes', 'emails go')} out in the next day`,
      detail: nameList(sending.map(o => o.company_name || o.to_name)), to: '/people/outbox' })
  }
  return out
}

/** Items the user has to act on (problems and to-dos). */
export const needsYouCount = (items: TodayItem[]) => items.filter(t => t.tone !== 'info').length

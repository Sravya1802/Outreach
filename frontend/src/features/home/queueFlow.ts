// "How your job queue works" on Home: each stage from finding a role to following up,
// explained with the user's own settings and a live count.
import type { DailyPlanOverview, EvaluationSummary, GmailStatus, OutboxItem, ReplyItem, WhatsAppStatus } from '@/lib/api'
import { followUpDays } from '@/features/applications/pipeline'
import { stageFor } from '@/features/applications/score'
import { hourLabel, tzLabel } from '@/features/applications/plan'

export type FlowState = 'idle' | 'busy' | 'you' | 'stuck'

export interface FlowStep {
  id: string
  title: string
  /** What happens here, in the user's own numbers. */
  explain: string
  count: number
  /** "59 today", "3 waiting" … */
  countLabel: string
  /** you = waiting on the user; stuck = something failed or needs an answer. */
  state: FlowState
  /** Extra line, e.g. "1 needs you". */
  alert?: string
  to: string
}

export interface FlowInput {
  newToday: number
  plan?: DailyPlanOverview
  tracked?: EvaluationSummary[]
  now: number
}

/** Defaults match the server's daily plan defaults. */
const DEFAULTS = { listHour: 22, timezone: 'America/Chicago', minScore: 9, maxPerDay: 15, referralFirst: true, referralWaitDays: 2, enabled: false }

export function flowSteps(i: FlowInput): FlowStep[] {
  const s = { ...DEFAULTS, ...(i.plan?.settings ?? {}) }
  const plan = i.plan?.plan
  const items = i.plan?.items ?? []
  const active = i.plan?.active ?? []
  const at = (...stages: string[]) => active.filter(a => stages.includes(a.stage)).length
  const sent = (i.tracked ?? []).filter(r => stageFor(r.apply_status) !== 'evaluated' && !(stageFor(r.apply_status) === 'rejected' && !r.applied_at))
  const heard = sent.filter(r => !['applied'].includes(stageFor(r.apply_status))).length
  const quiet = (i.tracked ?? []).filter(r => followUpDays(r, i.now) != null).length
  const pending = items.filter(p => p.tier === 'top' && p.decision === 'pending').length
  const scored = plan?.stats.scored ?? 0
  const writing = at('tailoring')
  const referral = at('asking_referral', 'waiting_referral')
  const going = at('ready_to_apply', 'applying')
  const stuck = at('needs_you')
  const listTime = `${hourLabel(s.listHour)} ${tzLabel(s.timezone)}`
  const minScore = Number(s.minScore).toFixed(1)

  return [
    { id: 'find', title: 'Find new roles', to: '/jobs/roles/intern',
      explain: 'Internships and new-grad roles are pulled from SpeedyApply, job boards and company career pages throughout the day.',
      count: i.newToday, countLabel: `${i.newToday} today`, state: i.newToday ? 'busy' : 'idle' },
    { id: 'score', title: 'Score them for you', to: '/applications/auto-apply',
      explain: `About an hour before ${hourLabel(s.listHour)}, the day’s new roles are scored 1–10 against your resume. Roles that won’t sponsor you, and companies you applied to in the last 30 days, are left out.`,
      count: scored, countLabel: plan?.status === 'building' ? 'scoring now' : `${scored} scored`, state: plan?.status === 'building' ? 'busy' : scored ? 'busy' : 'idle' },
    { id: 'list', title: 'Your evening list', to: '/applications/auto-apply',
      explain: `At ${listTime}, the best roles scoring ${minScore} or higher (up to ${s.maxPerDay}) are emailed to you. Nothing is sent until you approve it.`,
      count: pending, countLabel: pending ? `${pending} need your OK` : 'nothing waiting', state: pending ? 'you' : 'idle' },
    { id: 'tailor', title: 'Tailor your resume', to: '/applications/auto-apply',
      explain: 'For each role you approve, a resume is written for that job and checked against its keywords. It never adds skills you don’t have. If it scores under 90%, it waits for you.',
      count: writing, countLabel: `${writing} being written`, state: writing ? 'busy' : 'idle' },
    { id: 'referral', title: 'Ask for a referral', to: '/applications/auto-apply',
      explain: s.referralFirst
        ? `Someone you know there (from your LinkedIn connections) or a contact at the company is asked to refer you. If nobody has an email address yet, the company’s emails are looked up. The email is written with your tailored resume attached and waits for your OK in People → Outbox (a copy is in your Gmail Drafts); once you approve, it goes at their next morning. Without an address, it’s a LinkedIn note you send. Report a link or code, “they submitted me” or “they said no”. With no referral ${s.referralWaitDays} business day${s.referralWaitDays === 1 ? '' : 's'} after the email goes, it applies anyway.`
        : 'Referral asks are turned off, so approved roles go straight to applying the next morning.',
      count: referral, countLabel: s.referralFirst ? `${referral} waiting` : 'off', state: referral ? 'busy' : 'idle' },
    { id: 'apply', title: 'Apply', to: '/applications/auto-apply',
      explain: 'Between 6 and 10 AM in the company’s time zone. Greenhouse, Lever and Ashby forms are filled and sent for you; other job sites become “apply yourself” with your tailored resume ready. A form that asks something new waits for your answer.',
      count: going, countLabel: `${going} scheduled`, state: stuck ? 'stuck' : going ? 'busy' : 'idle',
      alert: stuck ? `${stuck} ${stuck === 1 ? 'needs' : 'need'} you` : undefined },
    { id: 'track', title: 'Track replies', to: '/dashboard#tracker',
      explain: 'Replies to your application emails, plus LinkedIn notifications in your Gmail, move each role to Heard back or Interviewing.',
      count: sent.length, countLabel: `${heard} of ${sent.length} heard back`, state: sent.length ? 'busy' : 'idle' },
    { id: 'follow', title: 'Follow up', to: '/dashboard?stage=followup#tracker',
      explain: 'After a week with no reply, the app reminds you to follow up or ask someone there for a referral.',
      count: quiet, countLabel: quiet ? `${quiet} to follow up` : 'none due', state: quiet ? 'you' : 'idle' },
  ]
}

/** One-line summary of the evening-list settings. */
export function flowSettingsLine(plan?: DailyPlanOverview): string {
  const s = { ...DEFAULTS, ...(plan?.settings ?? {}) }
  if (!s.enabled) return 'The evening list is off. Turn it on in Auto-apply and the queue runs every night.'
  return `On · list at ${hourLabel(s.listHour)} ${tzLabel(s.timezone)} · score ${Number(s.minScore).toFixed(1)}+ · up to ${s.maxPerDay} a day · ${s.referralFirst ? `referral wait ${s.referralWaitDays} business day${s.referralWaitDays === 1 ? '' : 's'}` : 'no referral asks'}`
}

export interface EmailFlowInput {
  gmail?: GmailStatus
  contactsWithEmail: number
  /** LinkedIn connections imported (undefined while loading). */
  connections?: number
  outbox?: OutboxItem[]
  replies?: ReplyItem[]
}

const REAL_REPLY: ReplyItem['kind'][] = ['reply', 'linkedin_message', 'linkedin_accept']

/** How outreach goes out: email from the user's own Gmail plus LinkedIn notes they send, with live counts. */
export function emailSteps(i: EmailFlowInput): FlowStep[] {
  const connected = Boolean(i.gmail?.connected)
  const broken = connected && i.gmail?.status === 'error'
  const cap = i.gmail?.daily_cap || 20
  const out = i.outbox ?? []
  const drafts = out.filter(o => o.step === 0 && o.status === 'draft').length
  const firstScheduled = out.filter(o => o.step === 0 && o.status === 'scheduled').length
  const firstSent = out.filter(o => o.step === 0 && o.status === 'sent').length
  const followScheduled = out.filter(o => o.step > 0 && o.status === 'scheduled').length
  const failed = out.filter(o => o.status === 'failed').length
  const replies = (i.replies ?? []).filter(r => REAL_REPLY.includes(r.kind)).length
  const conns = i.connections ?? 0

  return [
    { id: 'gmail', title: 'Connect your Gmail', to: '/integrations/gmail',
      explain: 'Emails go out from your own address, so replies land in your inbox. Referral asks from your evening list use it too.',
      count: connected ? 1 : 0,
      countLabel: broken ? 'needs reconnecting' : connected ? `connected${i.gmail?.email ? ` as ${i.gmail.email}` : ''}` : 'not connected',
      state: broken ? 'stuck' : connected ? 'busy' : 'you' },
    { id: 'linkedin', title: 'Import your LinkedIn connections', to: '/integrations/linkedin',
      explain: 'Upload the connections file LinkedIn lets you export. People you already know at a company are asked first, since they refer far more often.',
      count: conns, countLabel: conns ? `${conns} connections` : 'not imported', state: conns ? 'busy' : 'you' },
    { id: 'people', title: 'Find people', to: '/people/contacts',
      explain: 'Open a company and press Find people. Engineers, recruiters and alumni there get added with their work email when one can be found. For roles you approve, the company’s emails are looked up on their own.',
      count: i.contactsWithEmail, countLabel: `${i.contactsWithEmail} with email`, state: i.contactsWithEmail ? 'busy' : 'idle' },
    { id: 'write', title: 'Write the messages', to: '/people/messages',
      explain: 'People → Messages writes a LinkedIn note and an email for each person, for the role that fits you at their company. You read and edit them.',
      count: firstScheduled, countLabel: `${firstScheduled} ${firstScheduled === 1 ? 'email' : 'emails'} scheduled`, state: firstScheduled ? 'busy' : 'idle' },
    { id: 'approve', title: 'Approve the drafts', to: '/people/outbox',
      explain: 'Referral emails for roles you approved are written for you with that role’s tailored resume attached, and wait here and in your Gmail Drafts. Edit them in either place. Nothing goes out until you approve.',
      count: drafts, countLabel: `${drafts} waiting`, state: drafts ? 'you' : 'idle' },
    { id: 'send', title: 'Send emails from your Gmail', to: '/people/outbox',
      explain: `Weekdays between 8 and 11 AM in the recipient’s time zone, at least 3 minutes apart, and at most ${cap} a day.`,
      count: firstSent, countLabel: `${firstSent} sent`, state: failed ? 'stuck' : firstSent ? 'busy' : 'idle',
      alert: failed ? `${failed} failed` : undefined },
    { id: 'notes', title: 'Send LinkedIn notes yourself', to: '/people/messages',
      explain: 'LinkedIn doesn’t allow apps to send for you, so each note has Copy and Open profile buttons. Paste it, send it, then mark it sent.',
      count: 0, countLabel: 'by hand', state: 'idle' },
    { id: 'followups', title: 'Follow up automatically', to: '/people/outbox',
      explain: 'Two email follow-ups go out in the same thread, 4 and 10 business days later. Any reply, or a bounce, cancels the rest.',
      count: followScheduled, countLabel: `${followScheduled} scheduled`, state: followScheduled ? 'busy' : 'idle' },
    { id: 'replies', title: 'Catch replies', to: '/people/outbox',
      explain: 'Your inbox is checked for replies and for LinkedIn’s notification emails (messages and accepted invites), and the person is marked Replied.',
      count: replies, countLabel: `${replies} ${replies === 1 ? 'reply' : 'replies'}`, state: replies ? 'you' : 'idle' },
  ]
}

/** WhatsApp: the same updates on the user's phone, and approving by reply. */
export function whatsappSteps(w?: WhatsAppStatus): FlowStep[] {
  const linked = Boolean(w?.linked)
  const on = (k: keyof WhatsAppStatus['prefs']) => linked && w?.enabled !== false && w?.prefs?.[k] !== false
  const pref = (k: keyof WhatsAppStatus['prefs']): Pick<FlowStep, 'count' | 'countLabel' | 'state'> =>
    !linked ? { count: 0, countLabel: 'link your phone first', state: 'idle' } : on(k) ? { count: 1, countLabel: 'on', state: 'busy' } : { count: 0, countLabel: 'off', state: 'idle' }
  return [
    { id: 'wa-link', title: 'Link your phone', to: '/integrations/whatsapp',
      explain: 'Integrations → WhatsApp gives you a code. Send “JOIN” and the code to the Scout’n’Jobs number from your phone. That proves the number is yours.',
      count: linked ? 1 : 0,
      countLabel: !w ? '…' : !w.configured ? 'not available yet' : linked ? `linked${w.phone ? ` · ${w.phone}` : ''}` : 'not linked',
      state: !w?.configured ? 'idle' : linked ? 'busy' : 'you' },
    { id: 'wa-list', title: 'Approve your list by reply', to: '/integrations/whatsapp', ...pref('list'),
      explain: 'Your evening list arrives on WhatsApp too. Reply YES to approve all, YES 1 3 for some, SKIP 2 to drop one, or LIST to see it again.' },
    { id: 'wa-replies', title: 'Reply alerts', to: '/integrations/whatsapp', ...pref('replies'),
      explain: 'When someone answers your outreach, you get who replied, from which company, and the first line of what they said.' },
    { id: 'wa-needs', title: 'When something needs you', to: '/integrations/whatsapp', ...pref('needs'),
      explain: 'An approved role that’s stuck (a resume under 90%, a referral code to enter, a form question) is sent to you so it doesn’t sit.' },
    { id: 'wa-summary', title: 'Morning summary', to: '/integrations/whatsapp', ...pref('summary'),
      explain: 'Once a day: how many applied, how many need you, and how many LinkedIn notes are waiting to be sent.' },
    { id: 'wa-cmds', title: 'Pause any time', to: '/integrations/whatsapp',
      count: 0, countLabel: 'STOP · START · HELP', state: 'idle',
      explain: 'Reply STOP to pause all messages and START to turn them back on. HELP lists the commands. You can also pick which messages you get on the WhatsApp page.' },
  ]
}

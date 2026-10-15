// "How your job queue works" on Home: each stage from finding a role to following up,
// explained with the user's own settings and a live count.
import type { DailyPlanOverview, EvaluationSummary } from '@/lib/api'
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
        ? `The next morning, people at the company are asked to refer you. A link or code gets used. With no referral after ${s.referralWaitDays} business day${s.referralWaitDays === 1 ? '' : 's'}, it applies anyway.`
        : 'Referral asks are turned off, so approved roles go straight to applying the next morning.',
      count: referral, countLabel: s.referralFirst ? `${referral} waiting` : 'off', state: referral ? 'busy' : 'idle' },
    { id: 'apply', title: 'Apply', to: '/applications/auto-apply',
      explain: 'Applications go out between 6 and 10 AM in the company’s time zone, spread out. A form that asks something new stops and waits for your answer.',
      count: going, countLabel: `${going} scheduled`, state: stuck ? 'stuck' : going ? 'busy' : 'idle',
      alert: stuck ? `${stuck} ${stuck === 1 ? 'needs' : 'need'} you` : undefined },
    { id: 'track', title: 'Track replies', to: '/applications/auto-apply#tracker',
      explain: 'Replies to your application emails, plus LinkedIn notifications in your Gmail, move each role to Heard back or Interviewing.',
      count: sent.length, countLabel: `${heard} of ${sent.length} heard back`, state: sent.length ? 'busy' : 'idle' },
    { id: 'follow', title: 'Follow up', to: '/applications/auto-apply?stage=followup#tracker',
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

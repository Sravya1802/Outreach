// The Integrations overview: what each connection does for you, in plain words, and where it stands.
import type { ConnectionsSummary, GithubStatus, GmailStatus, WhatsAppStatus } from '@/lib/api'
import { formatPhone } from './phone'

export type IntegrationId = 'gmail' | 'linkedin' | 'whatsapp' | 'github'
export type IntegrationState = 'loading' | 'off' | 'on' | 'problem'

export interface IntegrationCard {
  id: IntegrationId
  title: string
  /** One sentence: what connecting it makes happen. */
  does: string
  /** What you get once it's on. */
  gives: string[]
  /** How long setup takes. */
  effort: string
  to: string
  state: IntegrationState
  /** "you@gmail.com", "+1 415 …", "312 connections" … */
  detail?: string
}

export interface OverviewInputs {
  gmail?: GmailStatus
  github?: GithubStatus
  linkedin?: ConnectionsSummary
  whatsapp?: WhatsAppStatus
  /** Which status requests failed; those cards show "problem". */
  errors?: Partial<Record<IntegrationId, boolean>>
}

function state(loaded: boolean, on: boolean, problem: boolean, errored?: boolean): IntegrationState {
  if (errored) return 'problem'
  if (!loaded) return 'loading'
  if (problem) return 'problem'
  return on ? 'on' : 'off'
}

export function integrationCards(i: OverviewInputs): IntegrationCard[] {
  const e = i.errors ?? {}
  return [
    {
      id: 'gmail', title: 'Gmail', to: '/integrations/gmail',
      does: 'Lets Scout’n’Jobs send email from your own address and read the replies.',
      gives: ['Referral asks and follow-ups go out as you, on a schedule', 'Replies are matched to the role and show up on Home', 'Your evening list and alerts arrive in your inbox'],
      effort: 'About 2 minutes',
      state: state(Boolean(i.gmail), Boolean(i.gmail?.connected), i.gmail?.status === 'error', e.gmail),
      detail: i.gmail?.status === 'error' ? 'Google stopped accepting the app password' : i.gmail?.email,
    },
    {
      id: 'linkedin', title: 'LinkedIn', to: '/integrations/linkedin',
      does: 'Tells the app who you already know, so it asks them for a referral before you apply cold.',
      gives: ['Roles at companies where you know someone are flagged', 'Those people are asked for a referral first', 'Nothing is posted or sent on LinkedIn for you'],
      effort: 'About 5 minutes',
      state: state(Boolean(i.linkedin), (i.linkedin?.total ?? 0) > 0, false, e.linkedin),
      detail: i.linkedin?.total ? `${i.linkedin.total.toLocaleString()} connections imported` : undefined,
    },
    {
      id: 'whatsapp', title: 'WhatsApp', to: '/integrations/whatsapp',
      does: 'Sends your evening list and alerts to your phone, and lets you approve roles by replying.',
      gives: ['Evening list, reply alerts and a morning summary on WhatsApp', 'Reply with a number to approve or skip a role', 'Turn each kind of message on or off'],
      effort: 'About 1 minute',
      state: state(Boolean(i.whatsapp), Boolean(i.whatsapp?.linked && i.whatsapp.enabled), false, e.whatsapp),
      detail: i.whatsapp?.linked ? (i.whatsapp.enabled ? formatPhone(i.whatsapp.phone) || undefined : 'Linked but paused') : undefined,
    },
    {
      id: 'github', title: 'GitHub', to: '/integrations/github',
      does: 'Gives tailored resumes real projects to pick from, taken from your public repos.',
      gives: ['Each tailored resume picks the repos that fit the role', 'Only the repo description, languages and README are used', 'Nothing is made up and nothing is written to GitHub'],
      effort: 'About 1 minute',
      state: state(Boolean(i.github), Boolean(i.github?.connected), i.github?.sync_status === 'error', e.github),
      detail: i.github?.sync_status === 'error' ? 'Last sync failed' : i.github?.login ? `@${i.github.login}` : undefined,
    },
  ]
}

export const STATE_LABEL: Record<IntegrationState, string> = { loading: 'Checking…', off: 'Not connected', on: 'Connected', problem: 'Needs attention' }
export const STATE_TONE = { loading: 'neutral', off: 'neutral', on: 'success', problem: 'danger' } as const satisfies Record<IntegrationState, 'neutral' | 'success' | 'danger'>

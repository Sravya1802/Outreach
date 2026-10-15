import type { PlanStage } from '@/lib/api'

export const STAGE_LABEL: Record<PlanStage, string> = {
  proposed: 'Waiting for your approval',
  tailoring: 'Writing your tailored resume',
  asking_referral: 'Asking for a referral',
  waiting_referral: 'Waiting on a referral',
  ready_to_apply: 'Applying in the company’s morning',
  applying: 'Applying now',
  applied: 'Applied',
  referred: 'Referred, they applied for you',
  needs_you: 'Needs you',
  done: 'Done',
}

export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'Asia/Kolkata', label: 'India' },
  { value: 'Europe/London', label: 'UK' },
  { value: 'Europe/Berlin', label: 'Central Europe' },
]

/** 22 → "10 PM" */
export function hourLabel(h: number): string {
  const hh = ((h + 11) % 12) + 1
  return `${hh} ${h < 12 ? 'AM' : 'PM'}`
}

export function tzLabel(tz: string): string {
  return TIMEZONES.find(t => t.value === tz)?.label ?? tz.split('/').pop()?.replace(/_/g, ' ') ?? tz
}

export const SPONSOR_TEXT: Record<string, { text: string; tone: 'success' | 'danger' | 'warning' }> = {
  sponsors: { text: 'Sponsors visas', tone: 'success' },
  no_sponsorship: { text: 'No sponsorship', tone: 'danger' },
  citizens_only: { text: 'US citizens only', tone: 'danger' },
}

export const num = (v: string | number | null | undefined): number | null => (v == null || v === '' ? null : Number(v))

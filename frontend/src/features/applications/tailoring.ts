import type { ResumeVerdict, Tailoring } from '@/lib/api'

export type AtsTone = 'strong' | 'ok' | 'weak' | 'none'

/** The rule: above the target (90%) passes. */
export function atsTone(score: number | null | undefined, target = 90): AtsTone {
  if (score == null) return 'none'
  if (score > target) return 'strong'
  if (score >= 75) return 'ok'
  return 'weak'
}

export const VERDICT_LABEL: Record<ResumeVerdict, string> = { apply: 'Apply', apply_with_referral: 'Apply with a referral', skip: 'Skip' }

/** Callback chance tone against its target (20%). */
export function callbackTone(pct: number | null | undefined, target = 20): AtsTone {
  if (pct == null) return 'none'
  if (pct >= target) return 'strong'
  if (pct >= target / 2) return 'ok'
  return 'weak'
}

/** One plain sentence on where this resume stands. */
export function tailoringHeadline(t: Pick<Tailoring, 'status' | 'approved_at' | 'ats' | 'ats_score' | 'report'>): string {
  const target = t.ats?.target ?? 90
  const score = t.ats_score ?? t.ats?.score ?? 0
  const skip = t.report?.verdict === 'skip'
  const project = t.report?.proposedProject
  if (t.status === 'ready') return `Scores ${score}% against the posting’s keywords, above the ${target}% bar. It goes out with the application.`
  if (t.approved_at) return `You chose to send it anyway.`
  if (project?.status === 'suggested' && project.onPage !== false) return `It includes a project to build, “${project.name}”. It won’t be sent until you’ve pushed it and marked it built, or taken it off.`
  if (skip) return `The recruiter check says skip this one${t.report?.verdictWhy ? `: ${t.report.verdictWhy}` : '.'} It won’t be sent without you.`
  const required = (t.ats?.missingYouDont ?? []).filter(m => m.importance === 'required').map(m => m.term)
  const gap = required.length
    ? `The posting requires ${list(required.slice(0, 4))}${required.length > 4 ? ` and ${required.length - 4} more` : ''}, which your resume doesn’t show.`
    : 'Most of the gap is preferred keywords your resume doesn’t show.'
  return `Not above the ${target}% bar, so it won’t be sent without you. ${gap}`
}

function list(xs: string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

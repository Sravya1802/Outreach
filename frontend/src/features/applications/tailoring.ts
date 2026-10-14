import type { Tailoring } from '@/lib/api'

export type AtsTone = 'strong' | 'ok' | 'weak' | 'none'

export function atsTone(score: number | null | undefined, target = 90): AtsTone {
  if (score == null) return 'none'
  if (score >= target) return 'strong'
  if (score >= 75) return 'ok'
  return 'weak'
}

/** One plain sentence on where this resume stands. */
export function tailoringHeadline(t: Pick<Tailoring, 'status' | 'approved_at' | 'ats' | 'ats_score'>): string {
  const target = t.ats?.target ?? 90
  const score = t.ats_score ?? t.ats?.score ?? 0
  if (t.status === 'ready') return `Scores ${score}% against the posting’s keywords, above the ${target}% target. It goes out with the application.`
  if (t.approved_at) return `Below the ${target}% target, and you chose to send it anyway.`
  const required = (t.ats?.missingYouDont ?? []).filter(m => m.importance === 'required').map(m => m.term)
  const gap = required.length
    ? `The posting requires ${list(required.slice(0, 4))}${required.length > 4 ? ` and ${required.length - 4} more` : ''}, which your resume doesn’t show.`
    : 'Most of the gap is preferred keywords your resume doesn’t show.'
  return `Below the ${target}% target, so it won’t be sent without you. ${gap}`
}

function list(xs: string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

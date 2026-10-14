// Scores are shown out of 10 everywhere (the evaluator scores 1–5; the
// database stores 0–100).
import type { ApplyStatus, PipelineColumn } from '@/lib/api'

/** 0–100 → "9.2"; null when unscored. */
export function scoreOutOf10(score100: number | null | undefined): string | null {
  const n = Number(score100)
  if (!Number.isFinite(n) || n <= 0) return null
  return (Math.round(n) / 10).toFixed(1)
}

/** Evaluator's 1–5 globalScore → "9.2". */
export function globalOutOf10(global: number | null | undefined): string | null {
  const n = Number(global)
  return Number.isFinite(n) && n > 0 ? (n * 2).toFixed(1) : null
}

/** Tone for a 0–10 score: 9+ strong, 7+ worth a look, else weak. */
export function scoreTone(score10: string | null): 'strong' | 'ok' | 'weak' | 'none' {
  if (score10 == null) return 'none'
  const n = Number(score10)
  return n >= 9 ? 'strong' : n >= 7 ? 'ok' : 'weak'
}

export const STAGES: { id: PipelineColumn; label: string; status: ApplyStatus }[] = [
  { id: 'evaluated', label: 'Evaluated', status: 'not_started' },
  { id: 'applied', label: 'Applied', status: 'submitted' },
  { id: 'responded', label: 'Responded', status: 'responded' },
  { id: 'interview', label: 'Interviewing', status: 'interview' },
  { id: 'offer', label: 'Offer', status: 'offer' },
  { id: 'rejected', label: 'Closed', status: 'rejected' },
]

/** Raw status → pipeline stage (mirrors GET /career/pipeline). */
export function stageFor(status: ApplyStatus | null | undefined): PipelineColumn {
  switch (status) {
    case 'submitted': return 'applied'
    case 'responded': return 'responded'
    case 'interview': return 'interview'
    case 'offer': return 'offer'
    case 'rejected': return 'rejected'
    default: return 'evaluated'
  }
}

/** "https://…" or a pasted description? */
export function looksLikeUrl(input: string): boolean {
  return /^https?:\/\/\S+$/i.test(input.trim())
}

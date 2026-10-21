// The job page: which tab, and the facts line about a role.
import type { EvaluationDetail, EvaluationFile } from '@/lib/api'

export const JOB_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'description', label: 'Job description' },
  { id: 'resume', label: 'Resume' },
] as const
export type JobTab = (typeof JOB_TABS)[number]['id']

export function jobTab(value: string | null): JobTab {
  return JOB_TABS.some(t => t.id === value) ? (value as JobTab) : 'overview'
}

/** The posting's own text: what was evaluated, else the catalog listing's. */
export function descriptionOf(d: Pick<EvaluationDetail, 'job_description' | 'role'>): string {
  return (d.job_description ?? '').trim() || (d.role?.description ?? '').trim()
}

const KIND: Record<EvaluationFile['kind'], string> = {
  tailored: 'Tailored resume', uploaded: 'Uploaded resume', master: 'Master resume', library: 'Library resume', cover_letter: 'Cover letter',
}
export const fileKindLabel = (k: EvaluationFile['kind']) => KIND[k] ?? 'PDF'

/** The file to show first: the one the application uses, else the newest. */
export function firstFile(files: EvaluationFile[] | undefined): EvaluationFile | null {
  if (!files?.length) return null
  return files.find(f => f.primary_file) ?? files[0] ?? null
}

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

// Words that start a section or sentence in job postings. Used to split text
// whose line breaks were lost when the posting was scraped.
const STARTERS = 'About|What|Who|You|Your|The|These|This|We|Our|Job|Program|Benefits|Preferred|Basic|Minimum|Required|Responsibilities|Qualifications|Requirements|Education|Salary|Compensation|Location|Note|Why|How|Key|Technical|Skills|Professional|Additional|Equal|Pay|Learn|Apply'
const GLUED_STARTER = new RegExp(`([a-z)\\]])(?=(?:${STARTERS})\\b)`, 'g')
const GLUED_SENTENCE = /([a-z)\]])([.!?])(?=[A-Z][a-z])/g

/** Put paragraph breaks back where a scraped posting ran headings and sentences together. */
export function readableDescription(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(GLUED_SENTENCE, '$1$2\n\n')
    .replace(GLUED_STARTER, '$1\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

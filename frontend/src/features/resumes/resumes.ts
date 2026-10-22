import type { ResumeJob } from '@/lib/api'

export type ResumeFilter = 'all' | 'tonight' | 'needs' | 'ready' | 'writing' | 'yours'

export const RESUME_FILTERS: { value: ResumeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'tonight', label: 'Latest list' },
  { value: 'needs', label: 'Needs you' },
  { value: 'ready', label: 'Ready' },
  { value: 'writing', label: 'Writing' },
  { value: 'yours', label: 'Your uploads' },
]

/** What the resume column says, and its tone. */
export function resumeState(j: Pick<ResumeJob, 'resume' | 'sending'>): { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' } {
  if (j.sending?.kind === 'yours') return { label: 'Your upload', tone: 'info' }
  const r = j.resume
  if (!r) return { label: '—', tone: 'neutral' }
  if (r.status === 'running') return { label: r.batch_phase?.startsWith('revis') ? 'Revising' : 'Writing', tone: 'neutral' }
  if (r.status === 'failed') return { label: 'Failed', tone: 'danger' }
  if (r.status === 'needs_review') return { label: 'Needs you', tone: 'warning' }
  return { label: 'Ready', tone: 'success' }
}

export function matchesResumeFilter(j: ResumeJob, f: ResumeFilter, latestList: string | null): boolean {
  const s = resumeState(j).label
  switch (f) {
    case 'tonight': return Boolean(latestList) && j.list_date === latestList
    case 'needs': return s === 'Needs you' || s === 'Failed'
    case 'ready': return s === 'Ready' || s === 'Your upload'
    case 'writing': return s === 'Writing' || s === 'Revising'
    case 'yours': return j.sending?.kind === 'yours'
    default: return true
  }
}

export const latestListDate = (jobs: Pick<ResumeJob, 'list_date'>[]) => jobs.map(j => j.list_date).filter((d): d is string => Boolean(d)).sort().pop() ?? null

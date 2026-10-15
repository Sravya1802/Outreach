import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { api, type EvaluationSummary } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { ErrorState, Page, PageHeader, Skeleton } from '@/ui'
import { scoreOutOf10 } from './score'
import { DailyPlanSections } from './DailyPlan'

const WAITING = ['needs_review', 'captcha_needed', 'login_needed']
const QUEUED = ['queued', 'in_progress']
const FAILED = ['submit_failed', 'platform_unsupported']

const REASON: Record<string, string> = {
  needs_review: 'The form asked something it couldn’t answer',
  captcha_needed: 'The form has a captcha',
  login_needed: 'The form needs you to log in',
  platform_unsupported: 'This job board isn’t supported yet',
  submit_failed: 'Submitting failed',
}

function Row({ r, right }: { r: EvaluationSummary; right?: ReactNode }) {
  const s = scoreOutOf10(r.score)
  return (
    <li className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line py-3">
      <span className="font-mono text-[15px] text-fg">{s ?? '—'}</span>
      <div className="min-w-0">
        <Link to={`/applications/evaluate?id=${r.id}`} className="hover:text-accent"><b className="font-medium text-fg">{r.company_name}</b> <span className="text-muted">· {r.job_title}</span></Link>
        {(REASON[r.apply_status ?? ''] || r.apply_error) && (
          <p className="text-[13px] text-subtle">{REASON[r.apply_status ?? ''] ?? ''}{r.apply_error ? ` · ${r.apply_error}` : ''}</p>
        )}
      </div>
      <div className="flex items-center gap-2 text-[13px] text-subtle">
        {right}
        {r.job_url && (
          <a href={r.job_url} target="_blank" rel="noreferrer" aria-label={`Open the ${r.company_name} posting`}
            className="grid size-8 place-items-center rounded-[4px] hover:bg-hover hover:text-fg"><ExternalLink className="size-4" /></a>
        )}
      </div>
    </li>
  )
}

function Section({ title, empty, items, right }: { title: string; empty: string; items: EvaluationSummary[]; right?: (r: EvaluationSummary) => ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1 font-display text-[22px] font-semibold text-fg">{title} <span className="font-sans text-[15px] font-normal text-subtle">· {items.length}</span></h2>
      {items.length === 0
        ? <p className="border-t border-rule py-4 text-[14px] text-subtle">{empty}</p>
        : <ul className="border-t border-rule">{items.map(r => <Row key={r.id} r={r} right={right?.(r)} />)}</ul>}
    </section>
  )
}

export default function AutoApplyPage() {
  const queue = useQuery({ queryKey: qk.autoApplyQueue, queryFn: api.autoApplyItems })
  const items = queue.data?.items ?? []
  const of = (statuses: string[]) => items.filter(r => statuses.includes(r.apply_status ?? ''))

  return (
    <Page wide>
      <PageHeader title="Auto-apply" description="Every evening you get a list of the day’s best-fitting roles. Approve the ones you want: each gets its own tailored resume, a referral ask, and an application in the company’s morning. What happens after you apply is tracked on the Dashboard." />

      <div className="space-y-10">
        <DailyPlanSections />
        {queue.error ? <ErrorState error={queue.error} onRetry={() => queue.refetch()} /> : queue.isLoading ? <Skeleton className="h-40" /> : (
          <>
            <Section title="Waiting on you" empty="Nothing needs you." items={of(WAITING)} />
            <Section title="In the queue" empty="Nothing queued." items={of(QUEUED)} />
            {of(FAILED).length > 0 && <Section title="Couldn’t apply" empty="" items={of(FAILED)} />}
          </>
        )}
      </div>
    </Page>
  )
}

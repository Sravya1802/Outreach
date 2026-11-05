import { Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type ReviewRow } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Badge, ButtonLink, EmptyState, ErrorState, Input, Page, PageHeader, Segmented, Skeleton } from '@/ui'
import { TABS, atsOk, backlog, reviewTab, type ReviewTab } from './review'

const head = 'border-b border-line px-3 py-2 font-medium'
const cell = 'border-b border-line px-3 py-3 align-top'
const num = 'font-mono text-[13px] whitespace-nowrap'
const blank = <span className="text-subtle">—</span>

function Row({ r }: { r: ReviewRow }) {
  return (
    <tr>
      <td className={cell}>
        <Link to={`/review/${r.id}`} className="hover:text-accent"><b className="font-medium">{r.company_name}</b> · {r.title}</Link>
        {r.location && <p className="mt-0.5 text-[12px] text-subtle">{r.location}</p>}
        <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
          {r.version != null && r.check_status === null && <Badge tone="info">Checking</Badge>}
          {r.check_status === 'flagged' && <Badge tone="danger">Failed a check</Badge>}
          {r.eligibility && <Badge tone="warning">Check eligibility</Badge>}
        </div>
      </td>
      <td className={cn(cell, num)}>{r.score == null ? blank : Number(r.score).toFixed(1)}</td>
      <td className={cn(cell, num)}>{r.ats_after == null ? blank : <span className={atsOk(r.ats_after) ? 'text-success' : 'text-warning'}>{r.ats_after}%</span>}</td>
      <td className={cn(cell, num)}>{r.callback_after == null ? blank : `${r.callback_after}%`}</td>
      <td className={cn(cell, num)}>{r.version == null ? blank : `v${r.version}`}</td>
      <td className={cn(cell, num)}>{r.open_comments || blank}</td>
      <td className={cn(cell, num)}>{r.outreach || blank}</td>
      <td className={cn(cell, 'text-right')}><ButtonLink size="sm" variant={r.status === 'ready' ? 'primary' : 'secondary'} to={`/review/${r.id}`}>{r.status === 'ready' ? 'Review' : 'Open'}</ButtonLink></td>
    </tr>
  )
}

/** Every role the Claude chat runs have written, by where it stands. */
export default function ReviewPage() {
  const [params, setParams] = useSearchParams()
  const [company, setCompany] = useState('')
  const roles = useQuery({ queryKey: qk.review, queryFn: api.reviewQueue, refetchInterval: 60_000 })
  const all = roles.data ?? []
  const tab = (TABS.find(t => t.value === params.get('tab'))?.value ?? 'ready')
  const setTab = (t: ReviewTab) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })
  const s = company.trim().toLowerCase()
  const rows = all.filter(r => reviewTab(r) === tab && (!s || r.company_name.toLowerCase().includes(s)))
  const { done, total, percent } = backlog(all)
  const options = TABS.map(t => ({ value: t.value, label: `${t.label} · ${all.filter(r => reviewTab(r) === t.value).length}` }))

  return (
    <Page wide>
      <PageHeader title="Review queue" description="Resumes and outreach written by your Claude chat runs. Open a role to read it, ask for changes or approve it." />
      {roles.error ? <ErrorState error={roles.error} onRetry={() => void roles.refetch()} /> : roles.isLoading ? <Skeleton className="h-72" /> : total === 0 ? (
        <EmptyState title="Nothing in the queue yet" description="Roles appear here as soon as they’re added to the queue." />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[13px] text-muted"><span className="font-medium text-fg">{done} of {total}</span> done · {total - done} waiting for a run</p>
            <div role="progressbar" aria-label="Backlog done" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Search company" aria-label="Search company" className="sm:w-56!" />
            <div className="max-w-full overflow-x-auto"><Segmented value={tab} onChange={setTab} options={options} label="Show" /></div>
          </div>
          <div className="overflow-x-auto rounded-[4px] border border-line bg-surface">
            <table className="w-full min-w-[860px] border-collapse text-[14px] text-fg">
              <thead>
                <tr className="bg-raised text-left text-[12px] font-medium tracking-wide text-subtle uppercase">
                  <th className={head}>Company and role</th>
                  <th className={head}>Fit</th>
                  <th className={head}>ATS</th>
                  <th className={head}>Callback</th>
                  <th className={head}>Version</th>
                  <th className={head}>Comments</th>
                  <th className={head}>Outreach</th>
                  <th className={head}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => <Row key={r.id} r={r} />)}
                {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted">{s ? 'No company matches that search here.' : 'Nothing here right now.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Page>
  )
}

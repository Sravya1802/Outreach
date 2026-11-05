import { Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ApproveResult, type ReviewRow } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { Badge, Button, ButtonLink, ConfirmDialog, EmptyState, ErrorState, Input, Page, PageHeader, Skeleton, useToast } from '@/ui'
import { TABS, atsOk, backlog, bulkLine, canApprove, isRunning, reviewTab, runLine, safeToBulk, type ReviewTab } from './review'

const head = 'border-b border-line px-3 py-2 font-medium'
const cell = 'border-b border-line px-3 py-3 align-top'
const num = 'font-mono text-[13px] whitespace-nowrap'
const blank = <span className="text-subtle">—</span>

function RoleName({ r }: { r: ReviewRow }) {
  return (
    <>
      <Link to={`/review/${r.id}`} className="hover:text-accent"><b className="font-medium">{r.company_name}</b> · {r.title}</Link>
      {r.location && <p className="mt-0.5 text-[12px] text-subtle">{r.location}</p>}
    </>
  )
}

const fit = (r: ReviewRow) => (r.score == null ? blank : Number(r.score).toFixed(1))

function Row({ r, picked, onPick }: { r: ReviewRow; picked?: boolean; onPick?: (on: boolean) => void }) {
  return (
    <tr>
      {onPick && (
        <td className={cn(cell, 'w-8 pr-0')}>
          {canApprove(r) && <input type="checkbox" className="mt-1 size-4 accent-accent" checked={picked} onChange={e => onPick(e.target.checked)} aria-label={`Select ${r.company_name} · ${r.title}`} />}
        </td>
      )}
      <td className={cell}>
        <RoleName r={r} />
        <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
          {r.version != null && r.check_status === null && <Badge tone="info">Checking</Badge>}
          {r.check_status === 'flagged' && <Badge tone="danger">Failed a check</Badge>}
          {r.eligibility && <Badge tone="warning">Check eligibility</Badge>}
          {r.referrer && <Badge tone="accent">Ask {r.referrer}</Badge>}
        </div>
      </td>
      <td className={cn(cell, num)}>{fit(r)}</td>
      <td className={cn(cell, num)}>{r.ats_after == null ? blank : <span className={atsOk(r.ats_after) ? 'text-success' : 'text-warning'}>{r.ats_after}%</span>}</td>
      <td className={cn(cell, num)}>{r.callback_after == null ? blank : `${r.callback_after}%`}</td>
      <td className={cn(cell, num)}>{r.version == null ? blank : `v${r.version}`}</td>
      <td className={cn(cell, num)}>{r.open_comments || blank}</td>
      <td className={cn(cell, num)}>{r.outreach || blank}</td>
      <td className={cn(cell, 'text-right')}><ButtonLink size="sm" variant={r.status === 'ready' ? 'primary' : 'secondary'} to={`/review/${r.id}`}>{r.status === 'ready' ? 'Review' : 'Open'}</ButtonLink></td>
    </tr>
  )
}

/** A role with no resume yet: its turn in line, or the run on it now. */
function LineRow({ r }: { r: ReviewRow }) {
  return (
    <tr>
      <td className={cn(cell, num)}>{r.place ?? `Run ${r.run}`}</td>
      <td className={cell}><RoleName r={r} /></td>
      <td className={cn(cell, num)}>{fit(r)}</td>
      <td className={cn(cell, 'text-[13px] whitespace-nowrap text-muted')}>{timeAgo(r.place == null ? r.locked_at : r.posted_at)}</td>
    </tr>
  )
}

const COLUMNS = ['Company and role', 'Fit', 'ATS', 'Callback', 'Version', 'Comments', 'Outreach', '']
const LINE_COLUMNS: Partial<Record<ReviewTab, string[]>> = {
  working: ['Run', 'Company and role', 'Fit', 'Started'],
  waiting: ['Turn', 'Company and role', 'Fit', 'Posted'],
}

/** Every role the Claude chat runs have written or will write, by where it stands. */
export default function ReviewPage() {
  const [params, setParams] = useSearchParams()
  const [company, setCompany] = useState('')
  const queue = useQuery({ queryKey: qk.review, queryFn: api.reviewQueue, refetchInterval: 60_000 })
  const all = queue.data?.roles ?? []
  const run = queue.data?.lastRun ?? null
  const tab = (TABS.find(t => t.value === params.get('tab'))?.value ?? 'ready')
  const setTab = (t: ReviewTab) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })
  const s = company.trim().toLowerCase()
  const rows = all.filter(r => reviewTab(r) === tab && (!s || r.company_name.toLowerCase().includes(s)))
  const { done, total, percent } = backlog(all)
  const line = LINE_COLUMNS[tab]
  const bulk = tab === 'ready'
  const columns = line ?? (bulk ? ['Select', ...COLUMNS] : COLUMNS)
  const qc = useQueryClient()
  const toast = useToast()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const chosen = rows.filter(r => picked.has(r.id) && canApprove(r))
  const safe = rows.filter(safeToBulk)
  const allSafe = safe.length > 0 && safe.every(r => picked.has(r.id))
  const pick = (id: string, on: boolean) => setPicked(p => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n })

  // One at a time: each one uploads a PDF and writes to Gmail, and one failure shouldn't stop the rest.
  async function approveChosen() {
    setConfirming(false)
    const done: ApproveResult[] = []
    const failed: string[] = []
    for (const [i, r] of chosen.entries()) {
      setProgress(i + 1)
      try { done.push(await api.approveRole(r.id)) } catch (e) { failed.push(`${r.company_name}: ${(e as Error).message}`) }
    }
    setProgress(null)
    setPicked(new Set())
    void qc.invalidateQueries({ queryKey: qk.review })
    if (done.length) toast.success(bulkLine(done, failed.length))
    if (failed.length) toast.error(failed.slice(0, 3).join(' '))
  }

  return (
    <Page wide>
      <PageHeader title="Review queue" description="Resumes and outreach written by your Claude chat runs. Open a role to read it, ask for changes or approve it." />
      {queue.error ? <ErrorState error={queue.error} onRetry={() => void queue.refetch()} /> : queue.isLoading ? <Skeleton className="h-72" /> : total === 0 ? (
        <EmptyState title="Nothing in the queue yet" description="Roles appear here as soon as they’re added to the queue." />
      ) : (
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Show" className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-2">
            {TABS.map(t => (
              <button key={t.value} type="button" role="radio" aria-checked={tab === t.value} onClick={() => setTab(t.value)}
                className={cn('rounded-[4px] border bg-surface px-3 py-2 text-left transition-colors', tab === t.value ? 'border-accent' : 'border-line hover:border-line-strong')}>
                <span className="block font-mono text-[20px] leading-7 text-fg">{all.filter(r => reviewTab(r) === t.value).length}</span>
                <span className={cn('block text-[12px] leading-4', tab === t.value ? 'font-medium text-fg' : 'text-muted')}>
                  {t.value === 'working' && isRunning(run) ? `Run ${run?.id} working now` : t.label}
                </span>
              </button>
            ))}
          </div>
          <div>
            <p className="mb-1.5 text-[13px] text-muted"><span className="font-medium text-fg">{done} of {total}</span> done · {runLine(run)}</p>
            <div role="progressbar" aria-label="Backlog done" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Search company" aria-label="Search company" className="sm:w-56!" />
            {bulk && safe.length > 0 && (
              <label className="inline-flex items-center gap-2 text-[14px] text-fg">
                <input type="checkbox" className="size-4 accent-accent" checked={allSafe} disabled={progress != null}
                  onChange={e => setPicked(e.target.checked ? new Set(safe.map(r => r.id)) : new Set())} />
                Select all {safe.length} above 90% ATS
              </label>
            )}
            {bulk && chosen.length > 0 && (
              <Button variant="primary" className="ml-auto" loading={progress != null} onClick={() => setConfirming(true)}>
                {progress != null ? `Approving ${progress} of ${chosen.length}` : `Approve ${chosen.length}`}
              </Button>
            )}
          </div>
          <div className="overflow-x-auto rounded-[4px] border border-line bg-surface">
            <table className={cn('w-full border-collapse text-[14px] text-fg', !line && 'min-w-[860px]')}>
              <thead>
                <tr className="bg-raised text-left text-[12px] font-medium tracking-wide text-subtle uppercase">
                  {columns.map(c => <th key={c} className={head}>{c === 'Select' ? <span className="sr-only">Select</span> : c || <span className="sr-only">Open</span>}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (line ? <LineRow key={r.id} r={r} /> : <Row key={r.id} r={r} picked={picked.has(r.id)} onPick={bulk ? on => pick(r.id, on) : undefined} />))}
                {rows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-muted">{s ? 'No company matches that search here.' : 'Nothing here right now.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <ConfirmDialog
            open={confirming}
            title={`Approve ${chosen.length} ${chosen.length === 1 ? 'role' : 'roles'}?`}
            description="Each resume becomes final and its emails go to Gmail Drafts with the PDF attached. Nothing sends until you OK each email in People → Outbox, and applying waits 2 business days for referrals."
            confirmLabel="Approve"
            onConfirm={() => void approveChosen()}
            onCancel={() => setConfirming(false)}
          />
        </div>
      )}
    </Page>
  )
}

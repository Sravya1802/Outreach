import { Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ApproveResult, type ReviewRow } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { AddOwnJob } from '@/features/toapply/AddOwnJob'
import { Badge, Button, ButtonLink, ConfirmDialog, EmptyState, ErrorState, Input, Page, PageHeader, Select, Skeleton, useToast } from '@/ui'
import { CLOSED_LABEL, TYPE_OPTIONS, typeMatch, daysOpen, CLOSES_OPTIONS, OPENED_OPTIONS, OUTREACH_OPTIONS, SORT_OPTIONS, sortRows, TABS, YEAR_OPTIONS, closesMatch, openedLabel, openedMatch, outreachMatch, atsOk, backlog, bulkLine, canApprove, deadlineLabel, isRunning, needsOutreach, outreachLine, reviewTab, runLine, safeToBulk, visaLine, yearMatch, yearsLabel, type ReviewTab } from './review'

// The menus remember the last choice in this browser.
const YEAR_KEY = 'snj.review.year'
const OUTREACH_KEY = 'snj.review.outreach'
const OPENED_KEY = 'snj.review.opened'
const CLOSES_KEY = 'snj.review.closes'
const SORT_KEY = 'snj.review.sort'
const TYPE_KEY = 'snj.review.type'
function saved(key: string) {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}
function save(key: string, v: string) {
  try { localStorage.setItem(key, v) } catch { /* private window: the choice lasts this visit */ }
}

const head = 'border-b border-line px-3 py-2 font-medium'
const cell = 'border-b border-line px-3 py-3 align-top'
const num = 'font-mono text-[13px] whitespace-nowrap'
const blank = <span className="text-subtle">—</span>

function RoleName({ r, opened = false }: { r: ReviewRow; opened?: boolean }) {
  const sub = [r.location, opened ? openedLabel(r.posted_at, Date.now(), r.posted_known) : null].filter(Boolean).join(' · ')
  return (
    <>
      <Link to={`/review/${r.id}`} className="hover:text-accent"><b className="font-medium">{r.company_name}</b> · {r.title}</Link>
      {sub && <p className="mt-0.5 text-[12px] text-subtle">{sub}</p>}
    </>
  )
}

const fit = (r: ReviewRow) => (r.score == null ? blank : Number(r.score).toFixed(1))
/** Days the posting has been up; "~" when that's counted from the day the app first saw it. */
function Days({ r }: { r: ReviewRow }) {
  const n = daysOpen(r.posted_at)
  if (n == null) return blank
  return <span title={r.posted_known ? `Opened ${n} ${n === 1 ? 'day' : 'days'} ago` : `First seen ${n} ${n === 1 ? 'day' : 'days'} ago (the site gives no posting date)`}>{r.posted_known ? n : `~${n}`}</span>
}

function Row({ r, picked, onPick }: { r: ReviewRow; picked?: boolean; onPick?: (on: boolean) => void }) {
  return (
    <tr>
      {onPick && (
        <td className={cn(cell, 'w-8 pr-0')}>
          {canApprove(r) && <input type="checkbox" className="mt-1 size-4 accent-accent" checked={picked} onChange={e => onPick(e.target.checked)} aria-label={`Select ${r.company_name} · ${r.title}`} />}
        </td>
      )}
      <td className={cell}>
        <RoleName r={r} opened />
        <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
          {r.version != null && r.check_status === null && <Badge tone="info">Checking</Badge>}
          {r.check_status === 'flagged' && <Badge tone="danger">Failed a check</Badge>}
          {r.eligibility && <Badge tone="warning">Check eligibility</Badge>}
          {r.no_opt && <span title={`“${r.no_opt}”`}><Badge tone="warning">Says no OPT/CPT</Badge></span>}
          {visaLine(r.sponsorship) && <Badge tone={r.sponsorship === 'no_sponsorship' ? 'warning' : 'danger'}>{visaLine(r.sponsorship)}</Badge>}
          {r.grad_years?.length > 0 && <span title="The posting names this year for graduating or starting"><Badge tone="accent">{yearsLabel(r.grad_years)}</Badge></span>}
          {r.referrer && <Badge tone="accent">Ask {r.referrer}</Badge>}
          {r.approve_failed && <Badge tone="danger">Approve failed</Badge>}
          {r.status === 'closed' && r.closed_reason && <Badge tone="neutral">{CLOSED_LABEL[r.closed_reason] ?? r.closed_reason}</Badge>}
          {deadlineLabel(r.deadline) && <Badge tone="warning">{deadlineLabel(r.deadline)}</Badge>}
          {r.to_learn > 0 && <span title="Skills added to Technical Skills that you should learn before interviews"><Badge tone="neutral">{r.to_learn} to learn</Badge></span>}
          {r.status === 'ready' && needsOutreach(r) && <Badge tone={r.outreach_due ? 'info' : 'neutral'}>{outreachLine(r)}</Badge>}
        </div>
      </td>
      <td className={cn(cell, num)}><Days r={r} /></td>
      <td className={cn(cell, num)}>{fit(r)}</td>
      <td className={cn(cell, num)}>{r.ats_after == null ? blank : <span className={atsOk(r.ats_after) ? 'text-success' : 'text-warning'}>{r.ats_after}%</span>}</td>
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
      <td className={cn(cell, num)}>{r.no_posting ? blank : r.place ?? `Run ${r.run}`}</td>
      <td className={cell}>
        <RoleName r={r} />
        {(r.no_opt || visaLine(r.sponsorship)) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {visaLine(r.sponsorship) && <Badge tone="warning">{visaLine(r.sponsorship)}</Badge>}
            {r.no_opt && <span title={`“${r.no_opt}”`}><Badge tone="warning">Says no OPT/CPT</Badge></span>}
          </div>
        )}
        {r.no_posting && (
          <div className="mt-1" title="A run needs the posting's text to write a resume. The app tries the link again each day (not TikTok, whose site turns automated readers away). Open the link to apply yourself.">
            <Badge tone="neutral">No posting text</Badge>
          </div>
        )}
      </td>
      <td className={cn(cell, num)}>{fit(r)}</td>
      <td className={cn(cell, r.status === 'queued' ? num : 'text-[13px] whitespace-nowrap text-muted')}>{r.status === 'queued' ? <Days r={r} /> : timeAgo(r.locked_at)}</td>
    </tr>
  )
}

const COLUMNS = ['Company and role', 'Days', 'Fit', 'ATS', 'Version', 'Comments', 'Outreach', '']
const LINE_COLUMNS: Partial<Record<ReviewTab, string[]>> = {
  working: ['Run', 'Company and role', 'Fit', 'Started'],
  waiting: ['Turn', 'Company and role', 'Fit', 'Days'],
}

const CAPS = [15, 30, 45, 60, 90, 120]

/** How many new roles the runs take from the queue a day (revisions don't count). */
function DailyCap() {
  const qc = useQueryClient()
  const toast = useToast()
  const settings = useQuery({ queryKey: ['dailyPlanSettings'], queryFn: api.dailyPlanSettings })
  const save = useMutation({
    mutationFn: (queueCap: number) => api.saveDailyPlanSettings({ queueCap }),
    onSuccess: (s) => { qc.setQueryData(['dailyPlanSettings'], s); toast.success(`Runs now take up to ${s.queueCap} new roles a day.`) },
    onError: (e: Error) => toast.error(e.message),
  })
  const cap = settings.data?.queueCap
  if (cap == null) return null
  const options = CAPS.includes(cap) ? CAPS : [...CAPS, cap].sort((a, b) => a - b)
  return (
    <label className="flex items-center gap-2 text-[13px] text-muted">
      New roles a day
      <Select aria-label="New roles a day" value={String(cap)} disabled={save.isPending} onChange={e => save.mutate(Number(e.target.value))} className="w-24!">
        {options.map(n => <option key={n} value={n}>{n}</option>)}
      </Select>
    </label>
  )
}

/** Every role the Claude chat runs have written or will write, by where it stands. */
export default function ReviewPage() {
  const [params, setParams] = useSearchParams()
  const [company, setCompany] = useState('')
  const [year, setYear] = useState(() => saved(YEAR_KEY))
  const [outreach, setOutreach] = useState(() => saved(OUTREACH_KEY))
  const [opened, setOpened] = useState(() => saved(OPENED_KEY))
  const [closes, setCloses] = useState(() => saved(CLOSES_KEY))
  const [sort, setSort] = useState(() => saved(SORT_KEY))
  const [kind, setKind] = useState(() => saved(TYPE_KEY))
  const queue = useQuery({ queryKey: qk.review, queryFn: api.reviewQueue, refetchInterval: 60_000 })
  const everything = queue.data?.roles ?? []
  // The menus narrow the tiles, the rows and Select all; the backlog bar counts everything.
  const all = everything.filter(r => yearMatch(r.grad_years, year) && outreachMatch(r, outreach) && openedMatch(r.posted_at, opened) && closesMatch(r.deadline, closes) && typeMatch(r.role_kind, kind))
  const run = queue.data?.lastRun ?? null
  const tab = (TABS.find(t => t.value === params.get('tab'))?.value ?? 'ready')
  const setTab = (t: ReviewTab) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })
  const s = company.trim().toLowerCase()
  const rows = sortRows(all.filter(r => reviewTab(r) === tab && (!s || r.company_name.toLowerCase().includes(s))), sort)
  const { done, total, percent } = backlog(everything)
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
      <div className="mb-4"><AddOwnJob queue /></div>
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
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-muted"><span className="font-medium text-fg">{done} of {total}</span> done · {runLine(run)}</p>
              <DailyCap />
            </div>
            <div role="progressbar" aria-label="Backlog done" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1.2fr)_repeat(5,minmax(0,1fr))]">
            <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Search company" aria-label="Search company" className="col-span-2 w-full lg:col-span-1" />
            <Select value={kind} onChange={e => { setKind(e.target.value); save(TYPE_KEY, e.target.value) }} aria-label="Type" className="w-full">
              <option value="">Any type</option>
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select value={year} onChange={e => { setYear(e.target.value); save(YEAR_KEY, e.target.value) }} aria-label="Year" className="w-full">
              <option value="">Any year</option>
              {YEAR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select value={outreach} onChange={e => { setOutreach(e.target.value); save(OUTREACH_KEY, e.target.value) }} aria-label="Outreach" className="w-full">
              <option value="">Any outreach</option>
              {OUTREACH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select value={opened} onChange={e => { setOpened(e.target.value); save(OPENED_KEY, e.target.value) }} aria-label="Opened" className="w-full">
              <option value="">Opened any time</option>
              {OPENED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select value={closes} onChange={e => { setCloses(e.target.value); save(CLOSES_KEY, e.target.value) }} aria-label="Closes" className="w-full">
              <option value="">Any closing date</option>
              {CLOSES_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-[13px] text-muted"><span className="font-medium text-fg">{rows.length}</span> {rows.length === 1 ? 'role' : 'roles'}</p>
            {bulk && safe.length > 0 && (
              <label className="inline-flex items-center gap-2 text-[13px] text-fg">
                <input type="checkbox" className="size-4 accent-accent" checked={allSafe} disabled={progress != null}
                  onChange={e => setPicked(e.target.checked ? new Set(safe.map(r => r.id)) : new Set())} />
                Select all {safe.length} above 90% ATS
              </label>
            )}
            {bulk && chosen.length > 0 && (
              <Button variant="primary" size="sm" loading={progress != null} onClick={() => setConfirming(true)}>
                {progress != null ? `Approving ${progress} of ${chosen.length}` : `Approve ${chosen.length}`}
              </Button>
            )}
            <label className="ml-auto flex items-center gap-2 text-[13px] whitespace-nowrap text-muted">
              Sort by
              <Select value={sort} onChange={e => { setSort(e.target.value); save(SORT_KEY, e.target.value) }} aria-label="Sort by" className="w-48">
                <option value="">Turn order</option>
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </label>
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
                {rows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-muted">{s ? 'No company matches that search here.' : closes && closes !== 'none' ? 'No role here states a closing date in that window. Most postings don’t say when they close.' : year || outreach || opened || kind ? 'No role here matches those filters.' : 'Nothing here right now.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <ConfirmDialog
            open={confirming}
            title={`Approve ${chosen.length} ${chosen.length === 1 ? 'role' : 'roles'}?`}
            description="Each resume becomes final and its emails go to Gmail Drafts with the PDF attached. Nothing sends until you OK each email in People → Outbox, and applying waits 2 business days after outreach goes out. A role with no outreach applies only when you press Apply without referral."
            confirmLabel="Approve"
            onConfirm={() => void approveChosen()}
            onCancel={() => setConfirming(false)}
          />
        </div>
      )}
    </Page>
  )
}

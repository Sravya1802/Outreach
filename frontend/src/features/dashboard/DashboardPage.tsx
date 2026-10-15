import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useDailyUpdates, useJobMetrics, useProviderUsage } from '@/app/queries'
import { qk } from '@/app/queryClient'
import { api, type EvaluationSummary } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatNumber, percent } from '@/lib/format'
import { ErrorState, Page, PageHeader, Skeleton } from '@/ui'
import { funnel } from '@/features/applications/pipeline'
import { stageFor } from '@/features/applications/score'
import { perWeek, scoreBands, sentTimes, type Bucket } from './metrics'

function Panel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('min-w-0 rounded-[6px] border border-line bg-surface p-5', className)}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-[6px] border border-line bg-surface px-4 py-3.5">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 font-mono text-[26px] leading-none text-fg tabular-nums">{value}</p>
      {sub && <p className="mt-1.5 truncate text-[12px] text-subtle">{sub}</p>}
    </div>
  )
}

/** Vertical bars, one hue; hover or focus a bar for its value. */
function ColumnChart({ data, label, empty }: { data: Bucket[]; label: string; empty: string }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...data.map(d => d.value), 0)
  const top = Math.max(1, max <= 4 ? max : Math.ceil(max / 4) * 4)
  const ticks = [top, top / 2, 0]
  return (
    <figure className="m-0">
      <div className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div className="flex h-40 flex-col justify-between text-right font-mono text-[11px] text-subtle tabular-nums" aria-hidden="true">
          {ticks.map(t => <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">{Number.isInteger(t) ? t : t.toFixed(1)}</span>)}
        </div>
        <div className="relative h-40 border-b border-line-strong">
          {ticks.slice(0, -1).map((t, i) => <div key={t} className="absolute inset-x-0 border-t border-line" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} aria-hidden="true" />)}
          <div className="absolute inset-0 flex items-end gap-[2px] px-1">
            {data.map((d, i) => (
              <div key={d.label} className="relative flex h-full flex-1 items-end justify-center"
                onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
                <button type="button" aria-label={d.title} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                  className={cn('w-full max-w-9 rounded-t-[4px] transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    d.value ? 'bg-accent' : 'bg-transparent', active != null && active !== i && 'opacity-55')}
                  style={{ height: d.value ? `${Math.max(3, (d.value / top) * 100)}%` : '100%' }} />
                {active === i && (
                  <span role="tooltip" className="pointer-events-none absolute bottom-full z-10 mb-1.5 rounded-[4px] border border-line bg-raised px-2 py-1 text-[12px] whitespace-nowrap text-fg shadow-pop">
                    {d.title}
                  </span>
                )}
              </div>
            ))}
          </div>
          {max === 0 && <p className="absolute inset-0 grid place-items-center text-[13px] text-subtle">{empty}</p>}
        </div>
        <span />
        <div className="flex gap-[2px] px-1 pt-1.5" aria-hidden="true">
          {data.map(d => <span key={d.label} className="flex-1 truncate text-center text-[11px] text-subtle">{d.label}</span>)}
        </div>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>{data.map(d => <tr key={d.label}><th scope="row">{d.label}</th><td>{d.value}</td></tr>)}</tbody>
      </table>
    </figure>
  )
}

/** Horizontal bars sharing one scale, value and share at the end of each row. */
function BarList({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(...rows.map(r => r.value), 1)
  return (
    <dl className="space-y-3">
      {rows.map(r => (
        <div key={r.label} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
          <dt className="text-muted">{r.label}</dt>
          <div className="h-2.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <dd className="min-w-14 text-right font-mono text-fg tabular-nums">
            {formatNumber(r.value)}{r.note && <span className="ml-1.5 text-[11px] text-subtle">{r.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export default function DashboardPage() {
  const [now] = useState(() => Date.now())
  const pipeline = useQuery({ queryKey: qk.pipeline, queryFn: api.pipeline })
  const metrics = useJobMetrics()
  const daily = useDailyUpdates()
  const ai = useQuery({ queryKey: qk.aiUsage, queryFn: api.aiUsage, staleTime: 60_000 })
  const lookups = useProviderUsage()
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const outbox = useQuery({ queryKey: qk.outbox, queryFn: api.outbox, enabled: Boolean(gmail.data?.connected) })

  const rows: EvaluationSummary[] = pipeline.data ? Object.values(pipeline.data.columns).flatMap(c => c.items) : []
  const sent = rows.filter(r => { const s = stageFor(r.apply_status); return s !== 'evaluated' && !(s === 'rejected' && !r.applied_at) })
  const f = funnel(rows)
  const s = metrics.data?.summary
  const auto = sent.filter(r => r.apply_mode === 'auto').length
  const newToday = (daily.data?.intern.today ?? 0) + (daily.data?.newGrad.today ?? 0)
  const lookupUsed = lookups.data ? Object.values(lookups.data).reduce((n, u) => n + (u?.used ?? 0), 0) : 0
  const lookupCap = lookups.data ? Object.values(lookups.data).reduce((n, u) => n + (u?.limit ?? 0), 0) : 0
  const loading = pipeline.isLoading || metrics.isLoading

  return (
    <Page wide>
      <PageHeader title="Dashboard" description="Your job search in numbers: applications, replies, outreach and what it’s costing." />

      {pipeline.error ? <ErrorState error={pipeline.error} onRetry={() => void pipeline.refetch()} /> : (
        <div className="space-y-4">
          {loading ? <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24" />)}</div> : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Applied" value={formatNumber(f.applied)} sub={`${formatNumber(rows.length)} roles evaluated`} />
              <Stat label="Heard back" value={`${percent(f.heardBack, f.applied)}%`} sub={`${f.heardBack} of ${f.applied}`} />
              <Stat label="Interviews" value={formatNumber(f.interviews)} sub={f.applied ? `${percent(f.interviews, f.applied)}% of applications` : undefined} />
              <Stat label="Offers" value={formatNumber(f.offers)} />
              <Stat label="Emails sent" value={formatNumber(s?.outreachSent)} sub={`${formatNumber(s?.contactsWithEmail)} contacts with email`} />
              <Stat label="Email replies" value={`${s?.responseRate ?? 0}%`} sub={`${formatNumber(s?.outreachReplied)} of ${formatNumber(s?.outreachSent)}`} />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Applications per week" className="lg:col-span-2"
              action={<Link to="/applications/auto-apply#tracker" className="text-[13px] text-accent hover:underline">Tracker</Link>}>
              {loading ? <Skeleton className="h-48" /> : (
                <ColumnChart label="Applications per week, last 8 weeks" empty="No applications sent yet"
                  data={perWeek(sent.map(r => r.applied_at), now, 8, 'applications')} />
              )}
            </Panel>
            <Panel title="Where your applications are">
              {loading ? <Skeleton className="h-48" /> : (
                <BarList rows={[
                  { label: 'Evaluated', value: rows.length },
                  { label: 'Applied', value: f.applied },
                  { label: 'Heard back', value: f.heardBack, note: f.applied ? `${percent(f.heardBack, f.applied)}%` : undefined },
                  { label: 'Interviewing', value: f.interviews, note: f.applied ? `${percent(f.interviews, f.applied)}%` : undefined },
                  { label: 'Offers', value: f.offers },
                ]} />
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Fit scores of roles you evaluated">
              {loading ? <Skeleton className="h-48" /> : <ColumnChart label="Roles by fit score" empty="Nothing evaluated yet" data={scoreBands(rows)} />}
            </Panel>
            <Panel title="Outreach emails per week" action={<Link to="/people/outbox" className="text-[13px] text-accent hover:underline">Outbox</Link>}>
              {gmail.isLoading || outbox.isLoading ? <Skeleton className="h-48" /> : !gmail.data?.connected ? (
                <div className="grid h-48 place-items-center text-center text-[13px] text-subtle">
                  <p>Connect Gmail to send and count outreach emails.<br /><Link to="/integrations/gmail" className="text-accent hover:underline">Connect Gmail</Link></p>
                </div>
              ) : (
                <ColumnChart label="Outreach emails sent per week, last 8 weeks" empty="No emails sent yet" data={perWeek(sentTimes(outbox.data), now, 8, 'emails')} />
              )}
            </Panel>
            <Panel title="This month" action={<Link to="/usage" className="text-[13px] text-accent hover:underline">Usage</Link>}>
              <dl className="divide-y divide-line text-[14px]">
                <div className="flex justify-between py-2.5"><dt className="text-muted">New roles today</dt><dd className="font-mono text-fg tabular-nums">{formatNumber(newToday)}</dd></div>
                <div className="flex justify-between py-2.5"><dt className="text-muted">How you applied</dt><dd className="font-mono text-fg tabular-nums">{auto} auto · {sent.length - auto} by hand</dd></div>
                <div className="flex justify-between py-2.5"><dt className="text-muted">AI spent</dt><dd className="font-mono text-fg tabular-nums">{ai.data ? `$${ai.data.spent.mine.toFixed(2)} of $${ai.data.caps.user.toFixed(0)}` : '—'}</dd></div>
                <div className="flex justify-between py-2.5"><dt className="text-muted">Lookups used</dt><dd className="font-mono text-fg tabular-nums">{lookups.data ? `${lookupUsed} of ${lookupCap}` : '—'}</dd></div>
              </dl>
            </Panel>
          </div>
        </div>
      )}
    </Page>
  )
}

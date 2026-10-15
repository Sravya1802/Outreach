import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, ChevronDown } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { useAutoApplyQueue, useDailyUpdates, useHasResume, useJobMetrics, useMarket, useProfile, useServiceHealth } from '@/app/queries'
import { qk } from '@/app/queryClient'
import { api } from '@/lib/api'
import { useDailyPlan } from '@/features/applications/useDailyPlan'
import { ItemRow } from '@/features/applications/DailyPlan'
import { num } from '@/features/applications/plan'
import { marketPhrase } from '@/lib/markets'
import { cn } from '@/lib/cn'
import { formatNumber, greeting, nameFromEmail, percent } from '@/lib/format'
import { Button, ButtonLink, ErrorState, Page, Skeleton, Spinner, useToast } from '@/ui'
import { displayName, isProfileComplete, setupSteps } from './onboarding'
import { needsYouCount, todayItems, type TodayTone } from './today'

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-rule pb-2">
      <h2 className="font-display text-[22px] font-semibold text-fg">{children}</h2>
      {action}
    </div>
  )
}

function SetupChecklist() {
  const resume = useHasResume()
  const profile = useProfile()
  const plan = useDailyPlan()
  const answers = useQuery({ queryKey: qk.answers, queryFn: api.answers })
  const github = useQuery({ queryKey: qk.githubStatus, queryFn: api.githubStatus })
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })

  const steps = setupSteps({
    hasResume: resume.data,
    profileComplete: isProfileComplete(profile.data),
    answers: answers.data?.filter(a => a.status === 'answered').length,
    githubConnected: github.data?.connected,
    gmailConnected: gmail.data ? gmail.data.connected && gmail.data.status !== 'error' : undefined,
    // Auto-apply's rules live on the daily list; the step is done once the list is on.
    rulesSet: plan.data?.settings.enabled,
  })
  const anyError = [resume, profile, plan, answers, github, gmail].some(q => q.isError)
  const loading = steps.some(s => s.done === undefined) && !anyError
  const doneCount = steps.filter(s => s.done).length
  const [open, setOpen] = useState(false)
  if (!loading && doneCount === steps.length) return null
  const next = steps.find(s => s.done === false)
  const pct = Math.round((doneCount / steps.length) * 100)

  return (
    <section aria-labelledby="setup-h" className="rounded-[4px] border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="setup-h" className="text-[15px] font-medium text-fg">Finish setting up</h2>
            <span className="text-[13px] text-subtle">{loading ? 'Checking…' : `${doneCount} of ${steps.length} done`}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {next && <ButtonLink to={next.to} size="sm" variant="primary">Next: {next.title}</ButtonLink>}
          <Button size="sm" variant="ghost" aria-expanded={open} aria-controls="setup-steps" onClick={() => setOpen(v => !v)}
            icon={<ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />}>
            {open ? 'Hide steps' : 'All steps'}
          </Button>
        </div>
      </div>
      {open && <ol id="setup-steps" className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((s, i) => (
          <li key={s.id}>
            <Link to={s.to} title={s.description}
              className={cn('flex h-full flex-col gap-1 rounded-[4px] border px-3 py-2.5 transition-colors',
                s.done ? 'border-line text-subtle' : s.id === next?.id ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-hover')}>
              <span className="flex items-center gap-2 text-[12px] text-subtle">
                <span className={cn('grid size-5 place-items-center rounded-full border text-[11px]',
                  s.done ? 'border-transparent bg-success-soft text-success' : 'border-line-strong')}>
                  {s.done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                {s.done === undefined ? <Skeleton className="h-3 w-10" /> : s.done ? 'Done' : s.cta}
              </span>
              <span className={cn('text-[14px] leading-snug', s.done ? 'line-through decoration-subtle/40' : 'text-fg')}>{s.title}</span>
            </Link>
          </li>
        ))}
      </ol>}
    </section>
  )
}

/** Everything that needs the user, or is happening for them, today. Shared by the header and the Today list. */
function useToday() {
  const [now] = useState(() => Date.now())
  const plan = useDailyPlan()
  const queue = useAutoApplyQueue()
  const { services } = useServiceHealth()
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const pipeline = useQuery({ queryKey: qk.pipeline, queryFn: api.pipeline })
  const replies = useQuery({ queryKey: qk.replies, queryFn: api.replies, enabled: Boolean(gmail.data?.connected) })
  const outbox = useQuery({ queryKey: qk.outbox, queryFn: api.outbox, enabled: Boolean(gmail.data?.connected) })
  const items = todayItems({
    now,
    plan: plan.data,
    queue: queue.data?.counts,
    tracked: pipeline.data ? Object.values(pipeline.data.columns).flatMap(c => c.items) : [],
    replies: replies.data,
    outbox: outbox.data,
    gmail: gmail.data,
    servicesDown: services.filter(sv => sv.state === 'down'),
  })
  return { items, loading: plan.isLoading || queue.isLoading || pipeline.isLoading }
}

const TONE_DOT: Record<TodayTone, string> = { danger: 'bg-danger', action: 'bg-accent', info: 'bg-subtle' }

function Today() {
  const { items, loading } = useToday()
  return (
    <section aria-labelledby="today-h">
      <SectionTitle action={<Link to="/applications/auto-apply" className="text-[14px] text-accent hover:underline">Today’s list</Link>}>
        <span id="today-h">Today</span>
      </SectionTitle>
      {loading ? <div className="space-y-2 pt-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12" />)}</div> : items.length === 0 ? (
        <div className="py-6">
          <p className="text-[15px] text-fg">Nothing needs you today.</p>
          <p className="mt-1 text-[14px] text-muted">Your list arrives each evening. Until then, browse new roles or evaluate one you found.</p>
        </div>
      ) : (
        <ul>
          {items.map(it => (
            <li key={it.id}>
              <Link to={it.to} className="group flex items-start gap-3 border-b border-line py-3.5 hover:bg-hover/40">
                <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', TONE_DOT[it.tone])} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[15px]', it.tone === 'info' ? 'text-muted' : 'font-medium text-fg')}>{it.title}</span>
                  {it.detail && <span className="block truncate text-[13px] text-subtle">{it.detail}</span>}
                </span>
                <ArrowRight className="mt-1 size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const TOP_PICKS = 5

/** The best-scoring roles from today's list, with Approve / Skip right here. */
function TopPicks() {
  const qc = useQueryClient()
  const toast = useToast()
  const plan = useDailyPlan()
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.dailyPlan })
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: 'approved' | 'skipped' | 'pending' }) => api.decidePlanItem(id, decision),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  })
  const build = useMutation({
    mutationFn: () => api.buildDailyPlan(false),
    onSuccess: () => { toast.success('Building today’s list. This takes a few minutes.'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const d = plan.data
  // Top tier first, then the best of "worth a look"; skipped and expired ones drop out.
  const picks = (d?.items ?? [])
    .filter(i => i.decision === 'pending' || i.decision === 'approved')
    .sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'top' ? -1 : 1) || (num(b.score) ?? 0) - (num(a.score) ?? 0))
  const busyId = decide.isPending ? decide.variables?.id : null

  return (
    <section aria-labelledby="picks-h">
      <SectionTitle action={picks.length > TOP_PICKS ? <Link to="/applications/auto-apply" className="text-[14px] text-accent hover:underline">See all {picks.length}</Link> : undefined}>
        <span id="picks-h">Top picks for you</span>
      </SectionTitle>
      {plan.isError ? <ErrorState compact error={plan.error} onRetry={() => void plan.refetch()} /> : plan.isLoading ? <Skeleton className="mt-2 h-32" /> : !d?.plan ? (
        <div className="py-5">
          <p className="text-[15px] text-fg">No list yet today.</p>
          <p className="mt-1 text-[14px] text-muted">Each evening the app scores the day’s new roles against your resume and picks the best. You can build today’s now.</p>
          <Button className="mt-3" size="sm" variant="primary" loading={build.isPending} onClick={() => build.mutate()}>Build today’s list</Button>
        </div>
      ) : d.plan.status === 'building' ? (
        <p className="flex items-center gap-2 py-5 text-[14px] text-muted" role="status"><Spinner /> Scoring today’s new roles. This takes a few minutes.</p>
      ) : picks.length === 0 ? (
        <p className="py-5 text-[14px] text-muted">Nothing scored high enough today. New roles are scored again tonight.</p>
      ) : (
        <ul>{picks.slice(0, TOP_PICKS).map(i => <ItemRow key={i.id} item={i} busy={busyId === i.id} onDecide={dec => decide.mutate({ id: i.id, decision: dec })} />)}</ul>
      )}
    </section>
  )
}

function Pipeline() {
  const metrics = useJobMetrics()
  const f = metrics.data?.applyFunnel
  const s = metrics.data?.summary
  const rows = [
    { label: 'Evaluated', n: f?.evaluated ?? 0 },
    { label: 'Applied', n: f?.applied ?? 0 },
    { label: 'Heard back', n: f?.responded ?? 0 },
    { label: 'Interviewing', n: f?.interview ?? 0 },
    { label: 'Offers', n: f?.offer ?? 0 },
  ]
  return (
    <section aria-labelledby="pipe-h">
      <SectionTitle action={<Link to="/dashboard#tracker" className="text-[14px] text-accent hover:underline">Track them</Link>}>
        <span id="pipe-h">So far</span>
      </SectionTitle>
      {metrics.isError ? <ErrorState compact error={metrics.error} onRetry={() => void metrics.refetch()} /> : metrics.isLoading ? <Skeleton className="mt-2 h-32" /> : (
        <dl className="divide-y divide-line">
          {rows.map((r, i) => {
            const prev = i > 0 ? (rows[i - 1]?.n ?? 0) : 0
            return (
              <div key={r.label} className="flex items-baseline justify-between py-2 text-[14px]">
                <dt className="text-muted">{r.label}</dt>
                <dd className="font-mono text-fg">
                  {formatNumber(r.n)}
                  {i > 0 && prev > 0 && <span className="ml-2 text-[12px] text-subtle">{percent(r.n, prev)}%</span>}
                </dd>
              </div>
            )
          })}
          <div className="flex items-baseline justify-between py-2 text-[14px]">
            <dt className="text-muted">Email replies</dt>
            <dd className="font-mono text-fg">{s?.responseRate ?? 0}%<span className="ml-2 text-[12px] text-subtle">{formatNumber(s?.outreachReplied)} of {formatNumber(s?.outreachSent)}</span></dd>
          </div>
        </dl>
      )}
    </section>
  )
}

export default function HomePage() {
  const { email } = useAuth()
  const profile = useProfile()
  const market = useMarket()
  const daily = useDailyUpdates()
  const todayList = useToday()
  const name = displayName(profile.data, nameFromEmail(email))
  const newToday = (daily.data?.intern.today ?? 0) + (daily.data?.newGrad.today ?? 0)
  const waiting = needsYouCount(todayList.items)
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <Page wide>
      <header className="mb-8 max-w-4xl">
        <p className="text-[14px] text-subtle">{today}</p>
        <h1 className="mt-1 font-display text-[36px] leading-tight font-normal tracking-tight text-fg sm:text-[44px]">
          {greeting()}, {name}.
        </h1>
        <p className="mt-3 text-[17px] leading-relaxed text-muted">
          {daily.isLoading ? 'Checking today’s roles…' : (
            <>
              <b className="font-medium text-fg">{formatNumber(newToday)} new roles</b> in {marketPhrase(market)} today.{' '}
              {waiting > 0
                ? <><a href="#today-h" className="text-accent hover:underline">{waiting} {waiting === 1 ? 'thing needs' : 'things need'} you</a>.</>
                : 'Nothing needs you right now.'}
            </>
          )}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <ButtonLink to="/jobs/roles/intern" variant="primary">Browse roles</ButtonLink>
          <ButtonLink to="/applications/evaluate">Evaluate a job</ButtonLink>
        </div>
      </header>

      <div className="space-y-10">
        <SetupChecklist />
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-10">
            <Today />
            <TopPicks />
          </div>
          <Pipeline />
        </div>
      </div>
    </Page>
  )
}

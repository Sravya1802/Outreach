import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, ChevronDown } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { useAutoApplyQueue, useDailyUpdates, useHasResume, useJobMetrics, useMarket, useNightlySettings, useProfile, useServiceHealth } from '@/app/queries'
import { qk } from '@/app/queryClient'
import { api, type CatalogListing, type RoleType } from '@/lib/api'
import { useDailyPlan } from '@/features/applications/useDailyPlan'
import { marketInfo, marketPhrase } from '@/lib/markets'
import { cn } from '@/lib/cn'
import { formatNumber, greeting, nameFromEmail, percent } from '@/lib/format'
import { Button, ButtonLink, ErrorState, Page, Skeleton } from '@/ui'
import { postedLabel } from '@/features/jobs/catalog'
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
  const nightly = useNightlySettings()
  const answers = useQuery({ queryKey: qk.answers, queryFn: api.answers })
  const github = useQuery({ queryKey: qk.githubStatus, queryFn: api.githubStatus })
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })

  const steps = setupSteps({
    hasResume: resume.data,
    profileComplete: isProfileComplete(profile.data),
    answers: answers.data?.filter(a => a.status === 'answered').length,
    githubConnected: github.data?.connected,
    gmailConnected: gmail.data ? gmail.data.connected && gmail.data.status !== 'error' : undefined,
    // Rules count as set once saved away from the old defaults (85 / 50).
    rulesSet: nightly.data ? nightly.data.minScore !== 85 || nightly.data.maxApps !== 50 : undefined,
  })
  const anyError = [resume, profile, nightly, answers, github, gmail].some(q => q.isError)
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

function RoleRow({ r, kind }: { r: CatalogListing; kind: string }) {
  return (
    <li>
      <a href={r.apply_url} target="_blank" rel="noreferrer"
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-line py-3 hover:bg-hover/40">
        <span className="truncate text-[14px] text-fg group-hover:text-accent">{r.title}</span>
        <span className={cn('font-mono text-[13px]', r.salary_range ? 'text-fg' : 'text-subtle')}>{r.salary_range || '—'}</span>
        <span className="truncate text-[13px] text-muted">{r.company_name}{r.location ? ` · ${r.location}` : ''}</span>
        <span className="text-[12px] text-subtle">{kind} · {postedLabel(r.posted_at, r.scraped_at)}</span>
      </a>
    </li>
  )
}

function NewRoles() {
  const market = useMarket()
  const region = marketInfo(market).region
  const fetchType = (roleType: RoleType) => api.catalog({ roleType, region, page: 0, pageSize: 3 })
  const intern = useQuery({ queryKey: qk.catalog({ home: 'intern', region }), queryFn: () => fetchType('intern') })
  const grad = useQuery({ queryKey: qk.catalog({ home: 'new_grad', region }), queryFn: () => fetchType('new_grad') })
  const loading = intern.isLoading || grad.isLoading
  const error = intern.error ?? grad.error
  return (
    <section aria-labelledby="new-h">
      <SectionTitle action={<Link to="/jobs/roles/intern" className="text-[14px] text-accent hover:underline">All roles</Link>}>
        <span id="new-h">Newest roles in {marketPhrase(market)}</span>
      </SectionTitle>
      {error ? <ErrorState compact error={error} onRetry={() => { void intern.refetch(); void grad.refetch() }} /> : loading ? (
        <div className="space-y-3 pt-2">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <ul>
          {(intern.data?.rows ?? []).slice(0, 3).map(r => <RoleRow key={r.id} r={r} kind="Internship" />)}
          {(grad.data?.rows ?? []).slice(0, 3).map(r => <RoleRow key={r.id} r={r} kind="New grad" />)}
        </ul>
      )}
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
      <SectionTitle action={<Link to="/applications/auto-apply#tracker" className="text-[14px] text-accent hover:underline">Track them</Link>}>
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
          <Today />
          <div className="space-y-10">
            <Pipeline />
            <NewRoles />
          </div>
        </div>
      </div>
    </Page>
  )
}

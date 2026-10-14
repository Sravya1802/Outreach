import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { useAutoApplyQueue, useDailyUpdates, useHasResume, useJobMetrics, useMarket, useNightlySettings, useProfile, useServiceHealth } from '@/app/queries'
import { qk } from '@/app/queryClient'
import { api, type CatalogListing, type RoleType } from '@/lib/api'
import { marketInfo, marketPhrase } from '@/lib/markets'
import { cn } from '@/lib/cn'
import { formatNumber, greeting, lowerFirst, nameFromEmail, percent } from '@/lib/format'
import { ButtonLink, ErrorState, Page, Skeleton } from '@/ui'
import { postedLabel } from '@/features/jobs/catalog'
import { displayName, isProfileComplete, setupSteps } from './onboarding'

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

  const steps = setupSteps({
    hasResume: resume.data,
    profileComplete: isProfileComplete(profile.data),
    answers: answers.data?.filter(a => a.status === 'answered').length,
    githubConnected: github.data?.connected,
    // Rules count as set once saved away from the old defaults (85 / 50).
    rulesSet: nightly.data ? nightly.data.minScore !== 85 || nightly.data.maxApps !== 50 : undefined,
  })
  const anyError = [resume, profile, nightly, answers, github].some(q => q.isError)
  const loading = steps.some(s => s.done === undefined) && !anyError
  const doneCount = steps.filter(s => s.done).length
  if (!loading && doneCount === steps.length) return null
  const next = steps.find(s => s.done === false)

  return (
    <section aria-labelledby="setup-h" className="rounded-[4px] border border-line bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="setup-h" className="font-display text-[20px] font-semibold text-fg">Before auto-apply can work for you</h2>
        <span className="text-[13px] text-subtle">{loading ? 'Checking…' : `${doneCount} of ${steps.length} done`}</span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-5">
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
      </ol>
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
  const fetchType = (roleType: RoleType) => api.catalog({ roleType, region, page: 0, pageSize: 5 })
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
          {(intern.data?.rows ?? []).slice(0, 4).map(r => <RoleRow key={r.id} r={r} kind="Internship" />)}
          {(grad.data?.rows ?? []).slice(0, 4).map(r => <RoleRow key={r.id} r={r} kind="New grad" />)}
        </ul>
      )}
    </section>
  )
}

function WaitingOnYou() {
  const queue = useAutoApplyQueue()
  const { services } = useServiceHealth()
  const c = queue.data?.counts
  const items: { id: string; tone: 'warning' | 'danger'; text: string; to: string }[] = []
  if (c?.needs_review) items.push({ id: 'review', tone: 'warning', text: `${c.needs_review} ${c.needs_review === 1 ? 'application needs' : 'applications need'} an answer from you`, to: '/applications/auto-apply' })
  if (c?.failed) items.push({ id: 'failed', tone: 'danger', text: `${c.failed} ${c.failed === 1 ? 'application' : 'applications'} couldn’t be sent`, to: '/applications/auto-apply' })
  for (const s of services.filter(sv => sv.state === 'down')) {
    items.push({ id: `svc-${s.id}`, tone: 'danger', text: `${s.name} is unavailable, so ${lowerFirst(s.purpose)} won’t work`, to: '/settings/integrations' })
  }
  return (
    <section aria-labelledby="wait-h">
      <SectionTitle><span id="wait-h">Waiting on you</span></SectionTitle>
      {queue.isLoading ? <Skeleton className="mt-2 h-10" /> : items.length === 0 ? (
        <p className="py-3 text-[14px] text-muted">Nothing. You’re all caught up.</p>
      ) : (
        <ul>
          {items.map(it => (
            <li key={it.id}>
              <Link to={it.to} className="group flex items-center gap-3 border-b border-line py-3 text-[14px] text-fg hover:bg-hover/40">
                <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', it.tone === 'danger' ? 'bg-danger' : 'bg-warning')} />
                <span className="min-w-0 flex-1">{it.text}</span>
                <ArrowRight className="size-3.5 text-subtle transition-transform group-hover:translate-x-0.5" />
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
      <SectionTitle action={<Link to="/applications/pipeline" className="text-[14px] text-accent hover:underline">Pipeline</Link>}>
        <span id="pipe-h">Your applications</span>
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

function AiSpend() {
  const usage = useQuery({ queryKey: qk.aiUsage, queryFn: api.aiUsage, staleTime: 60_000 })
  if (usage.isError || usage.isLoading || !usage.data) return null
  const { spent, caps } = usage.data
  const pct = Math.min(100, percent(Math.round(spent.mine * 100), Math.round(caps.user * 100)))
  return (
    <section aria-labelledby="ai-h">
      <SectionTitle action={<Link to="/settings/account" className="text-[14px] text-accent hover:underline">Details</Link>}>
        <span id="ai-h">AI this month</span>
      </SectionTitle>
      <p className="pt-2 text-[14px] text-muted">
        <span className="font-mono text-fg">${spent.mine.toFixed(2)}</span> of your <span className="font-mono">${caps.user.toFixed(0)}</span> limit
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
        <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-accent')} style={{ width: `${pct}%` }} />
      </div>
    </section>
  )
}

export default function HomePage() {
  const { email } = useAuth()
  const profile = useProfile()
  const market = useMarket()
  const daily = useDailyUpdates()
  const queue = useAutoApplyQueue()
  const name = displayName(profile.data, nameFromEmail(email))
  const newToday = (daily.data?.intern.today ?? 0) + (daily.data?.newGrad.today ?? 0)
  const waiting = (queue.data?.counts.needs_review ?? 0) + (queue.data?.counts.failed ?? 0)
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
                ? <><Link to="/applications/auto-apply" className="text-accent hover:underline">{waiting} {waiting === 1 ? 'thing needs' : 'things need'} you</Link>.</>
                : 'Nothing is waiting on you.'}
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
          <NewRoles />
          <div className="space-y-10">
            <WaitingOnYou />
            <Pipeline />
            <AiSpend />
          </div>
        </div>
      </div>
    </Page>
  )
}

import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, ArrowUpRight, Check, CheckCircle2, Clock, Inbox, Sparkles } from 'lucide-react'
import { useAuth } from '@/app/auth'
import {
  useActivity, useAutoApplyQueue, useDailyUpdates, useHasResume, useJobMetrics,
  useNightlySettings, useProfile, useServiceHealth, useStats,
} from '@/app/queries'
import type { CatalogRole } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatNumber, greeting, nameFromEmail, percent, timeAgo } from '@/lib/format'
import { ButtonLink, Card, CardHeader, EmptyState, ErrorState, Page, PageHeader, Skeleton } from '@/ui'
import { activityDetail, activityTitle } from './activity'
import { isProfileComplete, setupSteps } from './onboarding'

function SetupChecklist() {
  const resume = useHasResume()
  const profile = useProfile()
  const stats = useStats()
  const metrics = useJobMetrics()
  const nightly = useNightlySettings()

  const steps = setupSteps({
    hasResume: resume.data,
    profileComplete: isProfileComplete(profile.data),
    companies: stats.data?.totalCompanies,
    evaluations: metrics.data?.summary.totalEvaluations,
    nightlyEnabled: nightly.data?.enabled,
  })
  const loading = steps.some(s => s.done === undefined) && ![resume, profile, stats, metrics, nightly].some(q => q.isError)
  const doneCount = steps.filter(s => s.done).length
  if (!loading && doneCount === steps.length) return null
  const next = steps.find(s => s.done === false)

  return (
    <Card>
      <CardHeader
        title="Get set up"
        description={loading ? 'Checking your account…' : `${doneCount} of ${steps.length} done`}
        actions={
          <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-hover sm:block" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent(doneCount, steps.length)}%` }} />
          </div>
        }
      />
      <ol className="divide-y divide-line">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3">
            <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-medium',
              s.done ? 'border-transparent bg-success-soft text-success' : 'border-line-strong text-subtle')}>
              {s.done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-[13px] font-medium', s.done ? 'text-subtle line-through decoration-subtle/50' : 'text-fg')}>{s.title}</p>
              {!s.done && <p className="mt-0.5 text-xs text-subtle">{s.description}</p>}
            </div>
            {s.done === undefined
              ? <Skeleton className="h-7 w-20" />
              : !s.done && (
                <ButtonLink to={s.to} size="sm" variant={s.id === next?.id ? 'primary' : 'secondary'}>{s.cta}</ButtonLink>
              )}
          </li>
        ))}
      </ol>
    </Card>
  )
}

function Attention() {
  const queue = useAutoApplyQueue()
  const { services } = useServiceHealth()
  const down = services.filter(s => s.state === 'down')
  const items: { id: string; tone: 'warning' | 'danger'; text: string; to: string }[] = []
  const c = queue.data?.counts
  if (c?.needs_review) items.push({ id: 'review', tone: 'warning', text: `${c.needs_review} auto-apply ${c.needs_review === 1 ? 'application needs' : 'applications need'} your review`, to: '/applications/auto-apply' })
  if (c?.failed) items.push({ id: 'failed', tone: 'danger', text: `${c.failed} auto-apply ${c.failed === 1 ? 'attempt' : 'attempts'} failed`, to: '/applications/auto-apply' })
  for (const s of down) items.push({ id: `svc-${s.id}`, tone: 'danger', text: `${s.name} is unavailable — ${s.purpose.toLowerCase()} won’t work`, to: '/settings/integrations' })

  return (
    <Card>
      <CardHeader title="Needs attention" />
      {queue.isLoading ? (
        <div className="space-y-2 p-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
      ) : queue.isError ? (
        <ErrorState compact error={queue.error} onRetry={() => void queue.refetch()} />
      ) : items.length === 0 ? (
        <div className="flex items-center gap-2.5 px-4 py-4 text-[13px] text-muted">
          <CheckCircle2 className="size-4 text-success" /> You’re all caught up.
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map(it => (
            <li key={it.id}>
              <Link to={it.to} className="group flex items-center gap-3 px-4 py-3 text-[13px] text-fg hover:bg-hover/50">
                <AlertTriangle className={cn('size-4 shrink-0', it.tone === 'danger' ? 'text-danger' : 'text-warning')} />
                <span className="min-w-0 flex-1">{it.text}</span>
                <ArrowRight className="size-3.5 text-subtle transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Stat({ label, value, sub, to, loading }: { label: string; value: string; sub?: string; to: string; loading: boolean }) {
  return (
    <Link to={to} className="group rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-raised">
      <p className="text-xs font-medium text-subtle">{label}</p>
      {loading
        ? <Skeleton className="mt-2 h-7 w-14" />
        : <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>}
      {sub && <p className="mt-1 text-xs text-subtle">{sub}</p>}
    </Link>
  )
}

function Stats() {
  const metrics = useJobMetrics()
  const daily = useDailyUpdates()
  const f = metrics.data?.applyFunnel
  const s = metrics.data?.summary
  const newToday = (daily.data?.intern.today ?? 0) + (daily.data?.newGrad.today ?? 0)
  if (metrics.isError) return <Card><ErrorState compact error={metrics.error} onRetry={() => void metrics.refetch()} /></Card>
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="New roles today" value={formatNumber(newToday)} sub="intern + new grad" to="/jobs/roles" loading={daily.isLoading} />
      <Stat label="Evaluated" value={formatNumber(s?.totalEvaluations)} sub={`${formatNumber(daily.data?.careerOps.evaluatedToday)} today`} to="/applications/evaluate" loading={metrics.isLoading} />
      <Stat label="Interviews" value={formatNumber(f?.interview)} sub={`${formatNumber(f?.offer)} offers`} to="/applications/board" loading={metrics.isLoading} />
      <Stat label="Outreach replies" value={`${s?.responseRate ?? 0}%`} sub={`${formatNumber(s?.outreachReplied)} of ${formatNumber(s?.outreachSent)} sent`} to="/outreach/contacts" loading={metrics.isLoading} />
    </div>
  )
}

function Funnel() {
  const metrics = useJobMetrics()
  const f = metrics.data?.applyFunnel
  const stages = [
    { label: 'Evaluated', n: f?.evaluated ?? 0 },
    { label: 'Applied', n: f?.applied ?? 0 },
    { label: 'Heard back', n: f?.responded ?? 0 },
    { label: 'Interview', n: f?.interview ?? 0 },
    { label: 'Offer', n: f?.offer ?? 0 },
  ]
  const max = Math.max(1, ...stages.map(st => st.n))
  return (
    <Card>
      <CardHeader title="Pipeline" actions={<ButtonLink to="/home/analytics" size="sm" variant="ghost">Analytics</ButtonLink>} />
      {metrics.isLoading ? (
        <div className="space-y-3 p-4">{stages.map(st => <Skeleton key={st.label} className="h-5" />)}</div>
      ) : metrics.isError ? (
        <ErrorState compact error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : f?.evaluated ? (
        <ul className="space-y-2.5 p-4">
          {stages.map((st, i) => {
            const prev = i > 0 ? (stages[i - 1]?.n ?? 0) : 0
            return (
              <li key={st.label} className="grid grid-cols-[84px_1fr_64px] items-center gap-3 text-[13px]">
                <span className="text-muted">{st.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-hover">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(st.n / max) * 100}%`, opacity: 1 - i * 0.14 }} />
                </span>
                <span className="text-right tabular-nums text-fg">
                  {formatNumber(st.n)}
                  {i > 0 && prev > 0 && <span className="ml-1.5 text-xs text-subtle">{percent(st.n, prev)}%</span>}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState icon={<Inbox />} title="No applications yet" description="Evaluate a role to start your pipeline."
          action={<ButtonLink to="/applications/evaluate" size="sm" variant="primary">Evaluate a role</ButtonLink>} />
      )}
    </Card>
  )
}

function NewRoles() {
  const daily = useDailyUpdates()
  const roles: (CatalogRole & { kind: string })[] = [
    ...(daily.data?.intern.recent ?? []).map(r => ({ ...r, kind: 'Intern' })),
    ...(daily.data?.newGrad.recent ?? []).map(r => ({ ...r, kind: 'New grad' })),
  ].slice(0, 8)
  return (
    <Card>
      <CardHeader title="New roles" description="Added to the catalog in the last 24 hours"
        actions={<ButtonLink to="/jobs/roles" size="sm" variant="ghost">View all</ButtonLink>} />
      {daily.isLoading ? (
        <div className="space-y-3 p-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-4" />)}</div>
      ) : daily.isError ? (
        <ErrorState compact error={daily.error} onRetry={() => void daily.refetch()} />
      ) : roles.length === 0 ? (
        <EmptyState icon={<Sparkles />} title="Nothing new yet today" description="The catalog refreshes every morning at 06:15 UTC." />
      ) : (
        <ul className="divide-y divide-line">
          {roles.map((r, i) => (
            <li key={`${r.apply_url}-${i}`}>
              <a href={r.apply_url} target="_blank" rel="noreferrer" className="group flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-fg">{r.title}</p>
                  <p className="truncate text-xs text-subtle">{r.company_name} · {r.kind}</p>
                </div>
                <ArrowUpRight className="size-3.5 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RecentActivity() {
  const activity = useActivity()
  const items = activity.data ?? []
  return (
    <Card>
      <CardHeader title="Recent activity" />
      {activity.isLoading ? (
        <div className="space-y-3 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-4" />)}</div>
      ) : activity.isError ? (
        <ErrorState compact error={activity.error} onRetry={() => void activity.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Clock />} title="No activity yet" description="Scrapes, contact searches and outreach show up here." />
      ) : (
        <ul className="divide-y divide-line">
          {items.slice(0, 8).map(a => {
            const detail = activityDetail(a)
            return (
              <li key={a.id} className="flex items-baseline gap-3 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-fg">{activityTitle(a)}</span>
                  {detail && <span className="text-subtle"> · {detail}</span>}
                </span>
                <span className="shrink-0 text-xs text-subtle">{timeAgo(a.created_at)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

export default function HomePage() {
  const { email } = useAuth()
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <Page>
      <PageHeader title={`${greeting()}, ${nameFromEmail(email)}`} description={today} />
      <div className="space-y-4">
        <SetupChecklist />
        <Stats />
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Attention />
          <Funnel />
          <NewRoles />
          <RecentActivity />
        </div>
      </div>
    </Page>
  )
}

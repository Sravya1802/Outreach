import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, BellRing, Check, RefreshCw, Search, Sparkles, Zap } from 'lucide-react'
import { qk } from '@/app/queryClient'
import { api, type VisaFilter, type CatalogListing, type CatalogPage, type Field, type Tier } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/format'
import {
  Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Input, Page, PageHeader, Pager, Segmented, Select, Skeleton, useToast,
} from '@/ui'
import { AlertsDialog } from './AlertsDialog'
import { countsByList, listForKind, listsForMarket, postedDate, postedWords, sourceLabel, visaLabel, type CatalogList } from './catalog'
import { useMarket, useProfile } from '@/app/queries'
import { marketPhrase, type Market } from '@/lib/markets'

const PAGE_SIZE = 50

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

function RoleRow({ role, field, onTrack, onAutoApply, busy }: {
  field?: Field
  role: CatalogListing
  onTrack: () => void
  onAutoApply: () => void
  busy: 'track' | 'auto' | null
}) {
  const visa = visaLabel(role.sponsorship, role.jd_read)
  const visaTitle = role.sponsorship_quote ? `“${role.sponsorship_quote}”` : visa ? 'The job description doesn’t mention visas.' : 'The job description hasn’t been read yet.'
  const others = (role.also_on ?? []).filter(s => s !== role.source)
  const posted = postedDate(role.posted_at, role.scraped_at)
  return (
    <li className="group grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-hover/40 md:grid-cols-[minmax(0,1fr)_100px_120px_150px_110px_176px] md:items-center md:gap-4 xl:grid-cols-[minmax(0,1fr)_100px_120px_140px_88px_110px_176px]">
      <div className="min-w-0">
        <a href={role.apply_url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-[13px] font-medium text-fg hover:text-accent">
          <span className="truncate">{role.title}</span>
          <ArrowUpRight className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
        </a>
        <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted">
          {role.tier === 'faang' && <Badge tone="accent">FAANG+</Badge>}
          {role.tier === 'quant' && <Badge tone="info">Quant</Badge>}
          {role.salary_range && <span className="font-mono text-success md:hidden">{role.salary_range}</span>}
          {!field && role.tracks?.includes('ai') && <Badge>AI/ML</Badge>}
          {visa && <span className="md:hidden" title={visaTitle}><Badge tone={visa.tone}>{visa.text}</Badge></span>}
          {role.company_name}
          <span className="md:hidden">{role.location ? ` · ${role.location}` : ''}{posted ? ` · ${postedWords(posted)}` : ''}</span>
        </p>
      </div>
      <p className={cn('hidden truncate font-mono text-[13px] md:block', role.salary_range ? 'text-fg' : 'text-subtle')}
        title={role.salary_range ? 'Pay range from the job posting' : 'This posting doesn’t list pay'}>
        {role.salary_range || 'Not posted'}
      </p>
      <p className="hidden text-xs md:block" title={visaTitle}>
        {visa ? <Badge tone={visa.tone}>{visa.text}</Badge> : <span className="text-subtle">Not checked</span>}
      </p>
      <p className="hidden truncate text-xs text-subtle md:block" title={role.location || undefined}>{role.location || '—'}</p>
      <p className="hidden text-xs xl:block"
        title={posted ? (posted.known ? `Posted ${posted.date}` : 'This site doesn’t say when the job was posted. This is the day we first found it.') : undefined}>
        {posted ? (
          <>
            <span className={cn('block font-mono text-[13px]', posted.known ? 'text-fg' : 'text-subtle')}>{posted.date}</span>
            <span className="block text-subtle">{posted.known ? posted.ago : 'first seen'}</span>
          </>
        ) : <span className="text-subtle">—</span>}
      </p>
      <div className="hidden text-xs text-subtle md:block">
        <span className={role.source === 'speedyapply' ? 'font-medium text-accent' : undefined}>{sourceLabel(role.source)}</span>
        {others.length > 0 && <span className="block" title="The same job is listed there too">also on {others.map(sourceLabel).join(', ')}</span>}
        {posted && <span className="block xl:hidden">{postedWords(posted)}</span>}
      </div>
      <div className="flex items-center gap-1.5 md:justify-end">
        {role.autoQueued ? (
          <Badge tone="accent"><Zap className="size-3" /> Queued</Badge>
        ) : role.tracked ? (
          <>
            <Badge tone="success"><Check className="size-3" /> Tracking</Badge>
            <Button size="sm" variant="ghost" loading={busy === 'auto'} disabled={!!busy} onClick={onAutoApply}>Auto-apply</Button>
          </>
        ) : (
          <>
            <Button size="sm" loading={busy === 'track'} disabled={!!busy} onClick={onTrack}>Track</Button>
            <Button size="sm" variant="ghost" loading={busy === 'auto'} disabled={!!busy} onClick={onAutoApply} title="Queue for auto-apply">Auto-apply</Button>
          </>
        )}
      </div>
    </li>
  )
}

function RolesList({ list, market }: { list: CatalogList; market: Market }) {
  const roleType = list.roleType
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '')
  const search = useDebounced(searchInput.trim(), 300)
  const source = params.get('source') ?? ''
  const tierParam = params.get('tier')
  const tier: Tier | undefined = tierParam === 'faang' || tierParam === 'quant' ? tierParam : undefined
  const hasPay = params.get('pay') === '1'
  const profile = useProfile()
  const needsSponsorship = Number(profile.data?.needs_sponsorship) === 1
  // Students who need sponsorship default to hiding roles that won't sponsor.
  const visaParam = params.get('visa')
  const visa: VisaFilter | undefined = visaParam === 'sponsors' || visaParam === 'open' || visaParam === 'citizens' ? visaParam
    : visaParam === 'any' ? undefined : needsSponsorship ? 'open' : undefined
  const fieldParam = params.get('field')
  const field: Field | undefined = fieldParam === 'swe' || fieldParam === 'ai' ? fieldParam : undefined
  const page = Math.max(0, Number(params.get('page')) || 0)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [busy, setBusy] = useState<Record<number, 'track' | 'auto'>>({})

  // Keep ?q= in sync with the debounced search (and reset to page 1).
  useEffect(() => {
    if ((params.get('q') ?? '') === search) return
    const next = new URLSearchParams(params)
    if (search) next.set('q', search); else next.delete('q')
    next.delete('page')
    setParams(next, { replace: true })
  }, [search, params, setParams])

  const query = { roleType, region: list.region, field, source: source || undefined, search: search || undefined, tier, hasPay: hasPay || undefined, visa, page, pageSize: PAGE_SIZE }
  const listing = useQuery({ queryKey: qk.catalog(query), queryFn: () => api.catalog(query), placeholderData: keepPreviousData })
  const sources = useQuery({ queryKey: qk.catalogSources, queryFn: api.catalogSources, staleTime: 5 * 60_000 })
  const counts = countsByList(sources.data ?? [], market, field)
  const sourceOptions = (sources.data ?? []).filter(s => s.role_type === roleType && (s.region ?? 'usa') === list.region).sort((a, b) => b.n - a.n)

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }

  function markRow(id: number, patch: Partial<CatalogListing>) {
    qc.setQueryData(qk.catalog(query), (old: CatalogPage | undefined) =>
      old ? { ...old, rows: old.rows.map(r => (r.id === id ? { ...r, ...patch } : r)) } : old)
  }

  const track = useMutation({
    mutationFn: (role: CatalogListing) => api.trackListing(role.id),
    onMutate: (role) => setBusy(b => ({ ...b, [role.id]: 'track' })),
    onSuccess: (r, role) => {
      if (r.evaluation.alreadySubmitted) { toast.info('You already applied to this one'); return }
      markRow(role.id, { tracked: true })
      toast.success(`Tracking ${role.title} at ${role.company_name}`)
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: (_r, _e, role) => setBusy(({ [role.id]: _done, ...rest }) => rest),
  })
  const autoApply = useMutation({
    mutationFn: (role: CatalogListing) => api.autoApplyListing(role.id),
    onMutate: (role) => setBusy(b => ({ ...b, [role.id]: 'auto' })),
    onSuccess: (r, role) => {
      if (r.evaluation.alreadySubmitted) { toast.info('You already applied to this one'); return }
      markRow(role.id, { autoQueued: true, tracked: true })
      toast.success(`Queued ${role.company_name} for auto-apply`)
    },
    onError: (e: Error) => {
      if (/consent|paused/i.test(e.message)) {
        toast.error(`${e.message} Opening your auto-apply profile…`)
        navigate('/applications/auto-apply')
      } else toast.error(e.message)
    },
    onSettled: (_r, _e, role) => setBusy(({ [role.id]: _done, ...rest }) => rest),
  })
  const refresh = useMutation({
    mutationFn: api.refreshCatalog,
    onSuccess: (r) => toast.success(r.message),
    onError: (e: Error) => toast.error(e.message),
  })

  const rows = listing.data?.rows ?? []
  const total = listing.data?.total ?? 0
  const catalogEmpty = sources.isSuccess && Object.values(counts).every(n => n === 0)
  const filtered = Boolean(search || source || tier || field || hasPay || (visaParam && visaParam !== 'any'))

  return (
    <Page wide>
      <PageHeader
        title="Roles"
        description={<>Internship and new-grad openings in <b className="font-medium text-fg">{marketPhrase(market)}</b>, from SpeedyApply's daily lists, job boards and company career pages. <Link to="/profile/details" className="text-accent hover:underline">Change country</Link></>}
        actions={
          <>
            <Button variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={refresh.isPending} onClick={() => refresh.mutate()}>Refresh</Button>
            <Button icon={<BellRing className="size-3.5" />} onClick={() => setAlertsOpen(true)}>Email alerts</Button>
          </>
        }
      />

      <div className="mb-3 flex items-center gap-3">
        <Segmented
          label="Field"
          value={field ?? 'all'}
          onChange={(v) => setParam('field', v === 'all' ? '' : v)}
          options={[{ value: 'all', label: 'All roles' }, { value: 'swe', label: 'Software engineering' }, { value: 'ai', label: 'AI / ML' }]}
        />
      </div>
      <nav aria-label="Lists" className="mb-4 grid grid-cols-2 gap-2">
        {listsForMarket(market).map(l => {
          const active = l.kind === list.kind
          return (
            <Link key={l.kind} to={{ pathname: `/jobs/roles/${l.kind}`, search: new URLSearchParams({ ...(search ? { q: search } : {}), ...(field ? { field } : {}) }).toString() }}
              aria-current={active ? 'page' : undefined}
              className={cn('rounded-[4px] border px-4 py-3 transition-colors',
                active ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong hover:bg-raised')}>
              <span className={cn('block text-[13px] font-medium', active ? 'text-fg' : 'text-muted')}>{l.label}</span>
              <span className="flex items-baseline justify-between gap-2 text-xs text-subtle">
                {l.region_label}
                {sources.isSuccess ? <span className="tabular-nums">{formatNumber(counts[l.kind])}</span> : <Skeleton className="h-3 w-8" />}
              </span>
            </Link>
          )
        })}
      </nav>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search titles and companies…" aria-label="Search roles" className="pl-8" />
        </div>
        <Select value={tier ?? ''} onChange={e => setParam('tier', e.target.value)} aria-label="Company tier" className="sm:w-40">
          <option value="">All companies</option>
          <option value="faang">FAANG+ only</option>
          <option value="quant">Quant / trading</option>
        </Select>
        <Select value={visa ?? 'any'} onChange={e => setParam('visa', e.target.value)} aria-label="Visa sponsorship" className="sm:w-52">
          <option value="any">Any visa status</option>
          <option value="open">Hide “won’t sponsor”</option>
          <option value="sponsors">Says it sponsors</option>
          <option value="citizens">US citizens only</option>
        </Select>
        <label className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[4px] border border-line-strong px-3 text-[14px] text-muted hover:bg-hover">
          <input type="checkbox" checked={hasPay} onChange={e => setParam('pay', e.target.checked ? '1' : '')} className="size-4 accent-[var(--ui-accent)]" />
          Pay posted
        </label>
        <Select value={source} onChange={e => setParam('source', e.target.value)} aria-label="Source" className="sm:w-48">
          <option value="">All sources</option>
          {sourceOptions.map(s => <option key={s.source} value={s.source}>{sourceLabel(s.source)} ({formatNumber(s.n)})</option>)}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,1fr)_100px_120px_150px_110px_176px] gap-4 xl:grid-cols-[minmax(0,1fr)_100px_120px_140px_88px_110px_176px] border-b border-line px-4 py-2 text-[11px] font-medium tracking-wide text-subtle uppercase md:grid">
          <span>Role</span><span>Pay</span><span>Visa</span><span>Location</span><span className="hidden xl:block">Posted</span><span>Source</span><span>&nbsp;</span>
        </div>
        {listing.isLoading ? (
          <ul className="divide-y divide-line">{Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="space-y-2 px-4 py-3"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-1/4" /></li>
          ))}</ul>
        ) : listing.isError ? (
          <ErrorState error={listing.error} onRetry={() => void listing.refetch()} />
        ) : rows.length === 0 ? (
          catalogEmpty ? (
            <EmptyState icon={<Sparkles />} title="The catalog is empty right now"
              description="It fills up every morning at 06:15 UTC. You can also start a refresh now — it takes about 10 minutes."
              action={<Button variant="primary" loading={refresh.isPending} onClick={() => refresh.mutate()}>Refresh catalog</Button>} />
          ) : (
            <EmptyState icon={<Search />} title={filtered ? 'No roles match' : 'No roles of this type yet'}
              description={filtered ? 'Try a different search or source.' : 'Check back after the next morning refresh.'}
              action={filtered ? <ButtonLink to={`/jobs/roles/${list.kind}`} size="sm">Clear filters</ButtonLink> : undefined} />
          )
        ) : (
          <ul className={`divide-y divide-line transition-opacity ${listing.isPlaceholderData ? 'opacity-60' : ''}`}>
            {rows.map(role => (
              <RoleRow key={role.id} role={role} field={field} busy={busy[role.id] ?? null}
                onTrack={() => track.mutate(role)} onAutoApply={() => autoApply.mutate(role)} />
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <div className="border-t border-line">
            <Pager page={page} pageSize={PAGE_SIZE} total={total} busy={listing.isFetching} onPage={(p) => { setParam('page', p ? String(p) : ''); window.scrollTo({ top: 0 }) }} />
          </div>
        )}
      </Card>

      <p className="mt-3 text-xs text-subtle">
        <strong className="font-medium text-muted">Track</strong> adds a role to <Link to="/applications/evaluate" className="text-accent hover:underline">Applications</Link> so you can evaluate it against your resume.{' '}
        <strong className="font-medium text-muted">Auto-apply</strong> queues it for the auto-apply worker.
      </p>

      {alertsOpen && <AlertsDialog onClose={() => setAlertsOpen(false)} roleType={roleType} search={search} />}
    </Page>
  )
}

export default function RolesPage() {
  const { kind } = useParams()
  const { search } = useLocation()
  const market = useMarket()
  const list = listForKind(kind, market)
  if (!list) return <Navigate to="/jobs/roles/intern" replace />
  // Old region-specific links ("intern-intl") → the same list in your market.
  if (kind !== list.kind) return <Navigate to={`/jobs/roles/${list.kind}${search}`} replace />
  // key: switching lists or markets starts a fresh list state.
  return <RolesList key={`${market}:${list.kind}`} list={list} market={market} />
}

import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, BellRing, Check, RefreshCw, Search, Sparkles, Zap } from 'lucide-react'
import { qk } from '@/app/queryClient'
import { api, type CatalogListing, type CatalogPage, type RoleType } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import {
  Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Input, Page, PageHeader, Pager, Segmented, Select, Skeleton, useToast,
} from '@/ui'
import { AlertsDialog } from './AlertsDialog'
import { countsByType, kindToRoleType, postedLabel, roleTypeToKind, sourceLabel } from './catalog'

const PAGE_SIZE = 50

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

function RoleRow({ role, onTrack, onAutoApply, busy }: {
  role: CatalogListing
  onTrack: () => void
  onAutoApply: () => void
  busy: 'track' | 'auto' | null
}) {
  return (
    <li className="group grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-hover/40 md:grid-cols-[minmax(0,1fr)_170px_120px_auto] md:items-center md:gap-4">
      <div className="min-w-0">
        <a href={role.apply_url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-[13px] font-medium text-fg hover:text-accent">
          <span className="truncate">{role.title}</span>
          <ArrowUpRight className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
        </a>
        <p className="truncate text-xs text-muted">
          {role.company_name}
          <span className="md:hidden">{role.location ? ` · ${role.location}` : ''} · {postedLabel(role.posted_at, role.scraped_at)}</span>
        </p>
      </div>
      <p className="hidden truncate text-xs text-subtle md:block" title={role.location || undefined}>{role.location || '—'}</p>
      <div className="hidden text-xs text-subtle md:block">
        <span>{sourceLabel(role.source)}</span>
        <span className="block">{postedLabel(role.posted_at, role.scraped_at)}</span>
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

function RolesList({ roleType }: { roleType: RoleType }) {
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '')
  const search = useDebounced(searchInput.trim(), 300)
  const source = params.get('source') ?? ''
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

  const query = { roleType, source: source || undefined, search: search || undefined, page, pageSize: PAGE_SIZE }
  const listing = useQuery({ queryKey: qk.catalog(query), queryFn: () => api.catalog(query), placeholderData: keepPreviousData })
  const sources = useQuery({ queryKey: qk.catalogSources, queryFn: api.catalogSources, staleTime: 5 * 60_000 })
  const counts = countsByType(sources.data ?? [])
  const sourceOptions = (sources.data ?? []).filter(s => s.role_type === roleType).sort((a, b) => b.n - a.n)

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
  const catalogEmpty = sources.isSuccess && counts.intern + counts.new_grad === 0
  const filtered = Boolean(search || source)

  return (
    <Page wide>
      <PageHeader
        title="Roles"
        description="Internship and new-grad openings, refreshed every morning from job boards and company career pages."
        actions={
          <>
            <Button variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={refresh.isPending} onClick={() => refresh.mutate()}>Refresh</Button>
            <Button icon={<BellRing className="size-3.5" />} onClick={() => setAlertsOpen(true)}>Email alerts</Button>
          </>
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Segmented
          label="Role type"
          value={roleType}
          onChange={(t) => navigate({ pathname: `/jobs/roles/${roleTypeToKind(t)}`, search: search ? `?q=${encodeURIComponent(search)}` : '' })}
          options={[
            { value: 'intern', label: <>Internships {sources.isSuccess && <span className="text-subtle tabular-nums">{formatNumber(counts.intern)}</span>}</> },
            { value: 'new_grad', label: <>New grad {sources.isSuccess && <span className="text-subtle tabular-nums">{formatNumber(counts.new_grad)}</span>}</> },
          ]}
        />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search titles and companies…" aria-label="Search roles" className="pl-8" />
        </div>
        <Select value={source} onChange={e => setParam('source', e.target.value)} aria-label="Source" className="sm:w-48">
          <option value="">All sources</option>
          {sourceOptions.map(s => <option key={s.source} value={s.source}>{sourceLabel(s.source)} ({formatNumber(s.n)})</option>)}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,1fr)_170px_120px_auto] gap-4 border-b border-line px-4 py-2 text-[11px] font-medium tracking-wide text-subtle uppercase md:grid">
          <span>Role</span><span>Location</span><span>Source</span><span className="w-40 text-right">&nbsp;</span>
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
              action={filtered ? <ButtonLink to={`/jobs/roles/${roleTypeToKind(roleType)}`} size="sm">Clear filters</ButtonLink> : undefined} />
          )
        ) : (
          <ul className={`divide-y divide-line transition-opacity ${listing.isPlaceholderData ? 'opacity-60' : ''}`}>
            {rows.map(role => (
              <RoleRow key={role.id} role={role} busy={busy[role.id] ?? null}
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
  const roleType = kindToRoleType(kind)
  if (!roleType) return <Navigate to="/jobs/roles/intern" replace />
  // key: switching Internships ↔ New grad starts a fresh list state.
  return <RolesList key={roleType} roleType={roleType} />
}

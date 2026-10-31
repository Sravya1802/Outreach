import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Mail, Plus, Search, Users } from 'lucide-react'
import { qk } from '@/app/queryClient'
import { api, type CompanyPage, type CompanyRow, type CompanySort, type CompanyStatus } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatNumber, timeAgo } from '@/lib/format'
import { Button, Card, EmptyState, ErrorState, Input, Page, PageHeader, Pager, Select, Skeleton, useToast } from '@/ui'
import { usePageSize } from '@/lib/pageSize'
import { FindCompaniesDialog } from './FindCompaniesDialog'


const STATUSES: { value: CompanyStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'researching', label: 'Researching' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'responded', label: 'Responded' },
  { value: 'skip', label: 'Skip' },
]
const STATUS_STYLE: Record<CompanyStatus, string> = {
  new: 'text-muted',
  researching: 'text-info',
  contacted: 'text-accent',
  responded: 'text-success',
  skip: 'text-subtle',
}
const SORTS: { value: CompanySort; label: string }[] = [
  { value: 'recent', label: 'Recently added' },
  { value: 'contacts', label: 'Most contacts' },
  { value: 'az', label: 'A → Z' },
  { value: 'za', label: 'Z → A' },
]

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

function CompanyRowView({ c, onStatus }: { c: CompanyRow; onStatus: (s: CompanyStatus) => void }) {
  const status = (c.status ?? 'new') as CompanyStatus
  const people = c.total_contacts || 0
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-hover/40 md:grid-cols-[minmax(0,1fr)_190px_110px_110px_130px]">
      <div className="min-w-0">
        <Link to={`/company/${c.id}`} className="block truncate text-[13px] font-medium text-fg hover:text-accent">{c.name}</Link>
        <p className="truncate text-xs text-subtle">{[c.subcategory || c.category, c.location].filter(Boolean).join(' · ') || 'Unclassified'}</p>
      </div>
      <p className="hidden truncate text-xs text-muted md:block">{c.category || 'Unclassified'}</p>
      <p className="hidden items-center gap-3 text-xs tabular-nums text-muted md:flex" title={`${people} people found, ${c.email_count} with email`}>
        <span className="inline-flex items-center gap-1"><Users className="size-3 text-subtle" />{people}</span>
        <span className="inline-flex items-center gap-1"><Mail className="size-3 text-subtle" />{c.email_count}</span>
      </p>
      <p className="hidden text-xs text-muted md:block">
        {c.intern_roles_checked_at ? `${c.intern_roles_count ?? 0} roles · ${timeAgo(c.intern_roles_checked_at)}` : <span className="text-subtle">Not checked</span>}
      </p>
      <Select value={status} onChange={e => onStatus(e.target.value as CompanyStatus)} aria-label={`Status for ${c.name}`}
        className={cn('h-7 w-[124px] justify-self-end text-xs font-medium', STATUS_STYLE[status])}>
        {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </Select>
    </li>
  )
}

function AddByName() {
  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const add = useMutation({
    mutationFn: async (n: string) => {
      await api.addCompanyByName(n)
      const hits = await api.searchCompanies(n)
      return hits.find(h => h.name.toLowerCase() === n.toLowerCase()) ?? hits[0] ?? null
    },
    onSuccess: (hit, n) => {
      void qc.invalidateQueries({ queryKey: qk.companiesAll })
      void qc.invalidateQueries({ queryKey: qk.categoryCounts })
      setName('')
      if (hit) navigate(`/company/${hit.id}`)
      else toast.error(`Couldn’t add “${n}”`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length >= 2) add.mutate(name.trim())
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input value={name} onChange={e => setName(e.target.value)} placeholder="Add a company by name…" aria-label="Company name" className="w-full sm:w-56" />
      <Button type="submit" icon={<Plus className="size-3.5" />} loading={add.isPending} disabled={name.trim().length < 2}>Add</Button>
    </form>
  )
}

export default function CompaniesPage() {
  const toast = useToast()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? ''
  const status = params.get('status') ?? ''
  const sort = (params.get('sort') as CompanySort | null) ?? 'recent'
  const page = Math.max(0, Number(params.get('page')) || 0)
  const [pageSize, setPageSize] = usePageSize('companies')
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '')
  const search = useDebounced(searchInput.trim(), 300)
  const [findOpen, setFindOpen] = useState(params.get('find') === '1')

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }
  useEffect(() => {
    if ((params.get('q') ?? '') === search) return
    const next = new URLSearchParams(params)
    if (search) next.set('q', search); else next.delete('q')
    next.delete('page')
    setParams(next, { replace: true })
  }, [search, params, setParams])

  const query = { category: category || undefined, status: status || undefined, search: search || undefined, sort, page, pageSize }
  const list = useQuery({ queryKey: qk.companies(query), queryFn: () => api.companies(query), placeholderData: keepPreviousData })
  const counts = useQuery({ queryKey: qk.categoryCounts, queryFn: api.categoryCounts })
  const totalCompanies = (counts.data ?? []).reduce((n, c) => n + c.count, 0)

  const setStatus = useMutation({
    mutationFn: ({ id, s }: { id: number; s: CompanyStatus }) => api.setCompanyStatus(id, s),
    onMutate: ({ id, s }) => {
      const prev = qc.getQueryData<CompanyPage>(qk.companies(query))
      qc.setQueryData(qk.companies(query), (old: CompanyPage | undefined) =>
        old ? { ...old, companies: old.companies.map(c => (c.id === id ? { ...c, status: s } : c)) } : old)
      return { prev }
    },
    onError: (e: Error, _v, ctx) => { if (ctx?.prev) qc.setQueryData(qk.companies(query), ctx.prev); toast.error(e.message) },
  })

  const rows = list.data?.companies ?? []
  const filtered = Boolean(category || status || search)

  const categoryNav = (
    <nav aria-label="Industries" className="space-y-0.5">
      {[{ category: '', count: totalCompanies }, ...(counts.data ?? [])].map(c => {
        const active = category === c.category
        return (
          <button key={c.category || 'all'} type="button" onClick={() => setParam('category', c.category)}
            aria-current={active ? 'true' : undefined}
            className={cn('flex h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors',
              active ? 'bg-hover font-medium text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg')}>
            <span className="truncate">{c.category || 'All companies'}</span>
            <span className="shrink-0 text-xs tabular-nums text-subtle">{formatNumber(c.count)}</span>
          </button>
        )
      })}
    </nav>
  )

  return (
    <Page wide>
      <PageHeader
        title="Companies"
        description={counts.isSuccess ? `${formatNumber(totalCompanies)} companies across ${formatNumber((counts.data ?? []).length)} industries` : 'Companies you’re tracking'}
        actions={<Button variant="primary" icon={<Search className="size-3.5" />} onClick={() => setFindOpen(true)}>Find companies</Button>}
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="hidden w-56 shrink-0 lg:block">
          {counts.isLoading ? <div className="space-y-2">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-7" />)}</div> : categoryNav}
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Select value={category} onChange={e => setParam('category', e.target.value)} aria-label="Industry" className="lg:hidden">
              <option value="">All companies ({formatNumber(totalCompanies)})</option>
              {(counts.data ?? []).map(c => <option key={c.category} value={c.category}>{c.category} ({formatNumber(c.count)})</option>)}
            </Select>
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
              <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search companies…" aria-label="Search companies" className="pl-8" />
            </div>
            <Select value={status} onChange={e => setParam('status', e.target.value)} aria-label="Status" className="sm:w-36">
              <option value="">Any status</option>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            <Select value={sort} onChange={e => setParam('sort', e.target.value === 'recent' ? '' : e.target.value)} aria-label="Sort" className="sm:w-40">
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </div>

          <Card className="overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1fr)_190px_110px_110px_130px] gap-x-4 border-b border-line px-4 py-2 text-[11px] font-medium tracking-wide text-subtle uppercase md:grid">
              <span>Company</span><span>Industry</span><span>People</span><span>Roles</span><span className="text-right">Status</span>
            </div>
            {list.isLoading ? (
              <ul className="divide-y divide-line">{Array.from({ length: 8 }, (_, i) => (
                <li key={i} className="space-y-2 px-4 py-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-1/5" /></li>
              ))}</ul>
            ) : list.isError ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            ) : rows.length === 0 ? (
              filtered ? (
                <EmptyState icon={<Search />} title="No companies match" description="Try another industry, status or search."
                  action={<Button size="sm" onClick={() => { setSearchInput(''); setParams(new URLSearchParams()) }}>Clear filters</Button>} />
              ) : (
                <EmptyState icon={<Building2 />} title="No companies yet"
                  description="Pull in every hiring YC startup for free, scrape job boards by industry, or add one by name."
                  action={<Button variant="primary" onClick={() => setFindOpen(true)}>Find companies</Button>} />
              )
            ) : (
              <ul className={cn('divide-y divide-line transition-opacity', list.isPlaceholderData && 'opacity-60')}>
                {rows.map(c => <CompanyRowView key={c.id} c={c} onStatus={s => setStatus.mutate({ id: c.id, s })} />)}
              </ul>
            )}
            {rows.length > 0 && (
              <div className="border-t border-line">
                <Pager page={page} pageSize={pageSize} total={list.data?.total ?? 0} busy={list.isFetching} onPageSize={setPageSize}
                  onPage={p => { setParam('page', p ? String(p) : ''); window.scrollTo({ top: 0 }) }} />
              </div>
            )}
          </Card>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-subtle">Open a company to find people, emails and roles.</p>
            <AddByName />
          </div>
        </div>
      </div>

      {findOpen && <FindCompaniesDialog initialCategory={category || undefined} onClose={() => { setFindOpen(false); if (params.get('find')) setParam('find', '') }} />}
    </Page>
  )
}

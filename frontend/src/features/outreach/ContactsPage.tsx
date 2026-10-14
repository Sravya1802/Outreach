import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api, type OutreachContact } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { ButtonLink, EmptyState, ErrorState, Input, Page, PageHeader, Segmented, Select, Skeleton } from '@/ui'
import { contactMatches, emailLabel, statusLabel } from './contacts'

type EmailFilter = 'all' | 'with' | 'without'
type Sort = 'newest' | 'name' | 'company' | 'status'

function Row({ c }: { c: OutreachContact }) {
  const email = emailLabel(c.email_status)
  const status = statusLabel(c.status)
  return (
    <li className="grid gap-x-6 gap-y-1 border-b border-line py-3.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_110px] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium text-fg">{c.name || 'Unknown name'}</p>
        <p className="truncate text-[13px] text-muted">{c.title || '—'}</p>
      </div>
      <div className="min-w-0 text-[14px]">
        {c.job_id
          ? <Link to={`/company/${c.job_id}`} className="truncate text-fg hover:text-accent">{c.company_name || 'Company'}</Link>
          : <span className="truncate text-muted">{c.company_name || '—'}</span>}
      </div>
      <div className="min-w-0 text-[14px]">
        {c.email
          ? <span className="flex items-baseline gap-2"><span className="truncate font-mono text-[13px] text-fg">{c.email}</span>{email && <span className={cn('shrink-0 text-[12px]', email.tone)}>{email.text}</span>}</span>
          : c.linkedin_url
            ? <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">LinkedIn only</a>
            : <span className="text-subtle">No email yet</span>}
      </div>
      <span className={cn('text-[13px]', status.tone)}>{status.text}</span>
    </li>
  )
}

export default function ContactsPage() {
  const [emailFilter, setEmailFilter] = useState<EmailFilter>('all')
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const q = useQuery({ queryKey: qk.contacts(emailFilter), queryFn: () => api.contacts(emailFilter) })

  const all = q.data?.contacts ?? []
  const companies = [...new Set(all.map(c => c.company_name).filter((n): n is string => Boolean(n)))].sort()
  const list = all
    .filter(c => (!company || c.company_name === company) && contactMatches(c, search))
    .sort((a, b) => sort === 'name' ? (a.name ?? '').localeCompare(b.name ?? '')
      : sort === 'company' ? (a.company_name ?? '').localeCompare(b.company_name ?? '')
        : sort === 'status' ? (a.status ?? 'zz').localeCompare(b.status ?? 'zz')
          : b.id - a.id)

  return (
    <Page wide>
      <PageHeader
        title="Contacts"
        description="Everyone you’ve found at the companies you track. Open a company to find more people or write to them."
        actions={<ButtonLink to="/outreach/templates">Email templates</ButtonLink>}
      />

      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, title, company or email…" aria-label="Search contacts" className="pl-9" />
        </div>
        <Select value={company} onChange={e => setCompany(e.target.value)} aria-label="Company" className="lg:w-56">
          <option value="">All companies</option>
          {companies.map(n => <option key={n} value={n}>{n}</option>)}
        </Select>
        <Select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort" className="lg:w-40">
          <option value="newest">Newest</option>
          <option value="name">Name</option>
          <option value="company">Company</option>
          <option value="status">Status</option>
        </Select>
        <Segmented label="Email" value={emailFilter} onChange={setEmailFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'with', label: 'Has email' }, { value: 'without', label: 'No email' }]} />
      </div>

      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : list.length === 0 ? (
        <div className="border-t border-rule">
          <EmptyState
            title={all.length ? 'No contacts match' : 'No contacts yet'}
            description={all.length ? 'Try a different search or filter.' : 'Open a company from Jobs → Companies and press Find people. Contacts and their emails show up here.'}
            action={!all.length ? <ButtonLink to="/jobs/companies" size="sm" variant="primary">Go to companies</ButtonLink> : undefined}
          />
        </div>
      ) : (
        <>
          <p className="mb-1 text-[13px] text-subtle">{list.length} {list.length === 1 ? 'person' : 'people'}{company ? ` at ${company}` : ''}</p>
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_110px] gap-x-6 border-b border-rule pb-2 text-[12px] tracking-wide text-subtle uppercase sm:grid">
            <span>Person</span><span>Company</span><span>Email</span><span>Status</span>
          </div>
          <ul>{list.map(c => <Row key={c.id} c={c} />)}</ul>
        </>
      )}
    </Page>
  )
}

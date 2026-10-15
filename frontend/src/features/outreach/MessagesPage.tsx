import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Clock, Copy, ExternalLink, Mail, PenLine, RefreshCw } from 'lucide-react'
import { api, type MessageCompany, type MessageCompanyDetail, type MessageFilter, type MessagePerson } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Badge, Button, ButtonLink, EmptyState, ErrorState, Input, Page, PageHeader, Pager, Segmented, Skeleton, useToast } from '@/ui'
import { gmailComposeUrl } from '@/features/jobs/company'
import { statusLabel } from './contacts'

const FILTERS: { value: MessageFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'roles', label: 'Open roles' },
  { value: 'connections', label: 'Connections' },
  { value: 'emails', label: 'Has email' },
]

export default function MessagesPage() {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<MessageFilter>('all')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const query = { q: q.trim() || undefined, filter, page }
  const list = useQuery({ queryKey: qk.messageCompanies(query), queryFn: () => api.messageCompanies(query), placeholderData: prev => prev })

  return (
    <Page>
      <PageHeader
        title="Messages"
        description="Every company where you know someone or have found people. Each person gets a LinkedIn note and an email written for them and the role that fits you there. Copy, send, mark as sent."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="Search companies" aria-label="Search companies" className="w-64" />
        <Segmented label="Show" value={filter} onChange={v => { setFilter(v); setPage(1) }} options={FILTERS} />
        {list.data && <span className="text-[13px] text-subtle">{list.data.total} companies</span>}
      </div>

      {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isLoading ? <Skeleton className="h-64" /> : !list.data?.companies.length ? (
        <div className="border-t border-rule">
          <EmptyState
            title={q || filter !== 'all' ? 'No companies match' : 'Nobody here yet'}
            description={q || filter !== 'all' ? undefined : 'Upload your LinkedIn connections, or find people at a company from its page, and they show up here with messages ready to send.'}
            action={!q && filter === 'all' ? <ButtonLink to="/integrations/linkedin" size="sm" variant="primary">Upload LinkedIn connections</ButtonLink> : undefined}
          />
        </div>
      ) : (
        <>
          <ul className="border-t border-rule">
            {list.data.companies.map(c => (
              <CompanyRow key={c.key} c={c} open={open === c.key} onToggle={() => setOpen(o => (o === c.key ? null : c.key))} />
            ))}
          </ul>
          <div className="mt-4">
            <Pager page={page - 1} pageSize={list.data.pageSize} total={list.data.total} onPage={p => setPage(p + 1)} busy={list.isFetching} />
          </div>
        </>
      )}
    </Page>
  )
}

function CompanyRow({ c, open, onToggle }: { c: MessageCompany; open: boolean; onToggle: () => void }) {
  const people = c.connections + c.contacts
  return (
    <li className="border-b border-line">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-3.5 text-left hover:bg-hover/40">
        <ChevronDown className={cn('size-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg">{c.name}</span>
        <span className="flex flex-wrap gap-1.5">
          {c.openRoles > 0 && <Badge tone="success">{c.openRoles} open role{c.openRoles === 1 ? '' : 's'}</Badge>}
          {c.connections > 0 && <Badge tone="accent">{c.connections} connection{c.connections === 1 ? '' : 's'}</Badge>}
          {c.emails > 0 && <Badge tone="info">{c.emails} with email</Badge>}
          {c.contacted > 0 && <Badge tone="neutral">{c.contacted} contacted</Badge>}
          {people > c.connections + c.emails && c.connections === 0 && c.emails === 0 && <Badge tone="neutral">{people} people</Badge>}
        </span>
      </button>
      {open && <CompanyPeople companyKey={c.key} />}
    </li>
  )
}

function CompanyPeople({ companyKey }: { companyKey: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const detail = useQuery({ queryKey: qk.messageCompany(companyKey), queryFn: () => api.messageCompany(companyKey) })
  const [progress, setProgress] = useState<string | null>(null)
  const writeAll = useMutation({
    mutationFn: async (people: MessagePerson[]) => {
      let i = 0
      for (const p of people) {
        i += 1
        setProgress(`Writing ${i} of ${people.length}…`)
        await api.writeMessage(companyKey, p.ref)
      }
    },
    onSuccess: () => toast.success('Messages written'),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      setProgress(null)
      void qc.invalidateQueries({ queryKey: qk.messageCompany(companyKey) })
      void qc.invalidateQueries({ queryKey: ['message-companies'] })
    },
  })

  if (detail.error) return <div className="pb-4"><ErrorState compact error={detail.error} onRetry={() => detail.refetch()} /></div>
  if (detail.isLoading || !detail.data) return <div className="pb-4"><Skeleton className="h-24" /></div>
  const d = detail.data
  const missing = d.people.filter(p => !p.note)

  return (
    <div className="space-y-3 pb-5 pl-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          {d.role
            ? <>Messages ask about <a href={d.role.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{d.role.title}</a>, the best open role for you here.</>
            : 'No open role for you here right now, so messages ask for a short chat about the team.'}
        </p>
        {missing.length > 0 && (
          <Button size="sm" variant="primary" icon={<PenLine className="size-3.5" />} loading={writeAll.isPending} onClick={() => writeAll.mutate(missing)}>
            {progress ?? `Write messages for ${missing.length === d.people.length ? 'everyone' : `the other ${missing.length}`}`}
          </Button>
        )}
      </div>
      <ul className="space-y-3">
        {d.people.map(p => <PersonCard key={p.ref} p={p} company={d} />)}
      </ul>
    </div>
  )
}

function PersonCard({ p, company }: { p: MessagePerson; company: MessageCompanyDetail }) {
  const qc = useQueryClient()
  const toast = useToast()
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.messageCompany(company.key) })
    void qc.invalidateQueries({ queryKey: ['message-companies'] })
  }
  const write = useMutation({ mutationFn: () => api.writeMessage(company.key, p.ref), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) })
  const mark = useMutation({
    mutationFn: (status: string) => api.updateContact(p.contactId ?? 0, { status }),
    onSuccess: () => { toast.success('Marked as sent'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const send = useMutation({
    mutationFn: () => api.scheduleEmail({ contactId: p.contactId ?? 0, subject: p.subject ?? '', body: p.body ?? '', when: 'best' }),
    onSuccess: r => { toast.success(`Scheduled for ${r.when} their time`); refresh(); void qc.invalidateQueries({ queryKey: qk.outbox }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`) } catch { toast.error('Couldn’t copy; select the text instead') }
  }
  const status = statusLabel(p.status)
  const emailed = ['sent', 'replied'].includes(p.status)

  return (
    <li className="rounded-[4px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px]">
            <b className="font-medium text-fg">{p.name}</b>
            {p.title && <span className="text-muted"> · {p.title}</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-subtle">
            <Badge tone={p.isConnection ? 'accent' : 'neutral'}>{p.isConnection ? 'Your connection' : 'Found for you'}</Badge>
            {p.email && <span>{p.email}</span>}
            {p.linkedinUrl && <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">LinkedIn <ExternalLink className="size-3" /></a>}
            <span className={status.tone}>{status.text}</span>
          </p>
        </div>
        {p.note
          ? <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={write.isPending} onClick={() => write.mutate()}>Rewrite</Button>
          : <Button size="sm" icon={<PenLine className="size-3.5" />} loading={write.isPending} onClick={() => write.mutate()}>Write message</Button>}
      </div>

      {p.note && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-[12px] tracking-wide text-subtle uppercase">LinkedIn note · {p.note.length}/300</p>
            <p className="rounded-[4px] border border-line bg-raised p-3 text-[13px] leading-relaxed whitespace-pre-line text-fg">{p.note}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" icon={<Copy className="size-3.5" />}
                onClick={() => { void copy(p.note ?? '', 'Note'); if (p.linkedinUrl) window.open(p.linkedinUrl, '_blank', 'noopener') }}>
                {p.linkedinUrl ? 'Copy & open LinkedIn' : 'Copy note'}
              </Button>
              {p.status !== 'dm_sent' && p.status !== 'replied' && <Button size="sm" variant="ghost" loading={mark.isPending && mark.variables === 'dm_sent'} onClick={() => mark.mutate('dm_sent')}>Mark sent</Button>}
            </div>
          </div>
          {p.body && (
            <div>
              <p className="mb-1 text-[12px] tracking-wide text-subtle uppercase">Email{p.email ? '' : ' · no address yet'}</p>
              <div className="rounded-[4px] border border-line bg-raised p-3 text-[13px] leading-relaxed text-fg">
                <p className="mb-1.5 font-medium">{p.subject}</p>
                <p className="whitespace-pre-line text-muted">{p.body}</p>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.email && gmail.data?.connected && !emailed && (
                  <Button size="sm" variant="primary" icon={<Clock className="size-3.5" />} loading={send.isPending} onClick={() => send.mutate()}>Send at the best time</Button>
                )}
                {p.email && !gmail.data?.connected && (
                  <a href={gmailComposeUrl(p.email, p.subject ?? '', p.body)} target="_blank" rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-accent px-3 text-[13px] font-semibold text-on-accent hover:bg-accent-hover"><Mail className="size-3.5" /> Open in Gmail</a>
                )}
                <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => void copy(`Subject: ${p.subject ?? ''}\n\n${p.body ?? ''}`, 'Email')}>Copy email</Button>
                {p.email && !gmail.data?.connected && !emailed && <Button size="sm" variant="ghost" loading={mark.isPending && mark.variables === 'sent'} onClick={() => mark.mutate('sent')}>Mark emailed</Button>}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, Mail, Trash2, UserSearch } from 'lucide-react'
import { api, type CompanyContact, type CompanyDetail, type CompanyRole, type CompanyStatus, type PeopleEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Page, Segmented, Select, Skeleton, Spinner, Textarea, useToast } from '@/ui'
import { emailLabel } from '@/features/outreach/contacts'
import { companyBlurb, gmailComposeUrl, websiteHost } from './company'

const STATUSES: { value: CompanyStatus; label: string }[] = [
  { value: 'new', label: 'New' }, { value: 'researching', label: 'Researching' }, { value: 'contacted', label: 'Contacted' },
  { value: 'responded', label: 'Responded' }, { value: 'skip', label: 'Not interested' },
]
const CONTACT_STATUSES = [
  { value: 'pending', label: 'Not contacted' }, { value: 'sent', label: 'Emailed' }, { value: 'dm_sent', label: 'Messaged' },
  { value: 'replied', label: 'Replied' }, { value: 'closed', label: 'Closed' },
]
const key = (id: number) => ['company', id] as const

type Kind = 'email' | 'linkedin' | 'waas'

function Composer({ company, contact, onClose }: { company: CompanyDetail; contact: CompanyContact; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [kind, setKind] = useState<Kind>('email')
  const [extra, setExtra] = useState('')
  const [subject, setSubject] = useState(contact.generated_subject ?? '')
  const [body, setBody] = useState(contact.generated_body ?? '')
  const [dm, setDm] = useState(contact.generated_dm ?? '')
  const [waas, setWaas] = useState('')

  const write = useMutation({
    mutationFn: async () => {
      if (kind === 'waas') {
        const r = await api.writeWaas({ companyName: company.name, companyDescription: companyBlurb(company), contactName: contact.name ?? undefined, extraContext: extra, ycBatch: company.yc_batch ?? undefined })
        setWaas(r.message)
      } else {
        const r = await api.writeTo(contact.id, kind === 'email' ? 'cold_email' : 'linkedin', extra)
        if (kind === 'email') { setSubject(r.subject ?? ''); setBody(r.body ?? '') } else setDm(r.message || r.dm || r.body || '')
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const mark = useMutation({
    mutationFn: (status: string) => api.updateContact(contact.id, { status }),
    onSuccess: () => { toast.success('Marked as sent'); void qc.invalidateQueries({ queryKey: key(company.id) }); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })

  const text = kind === 'email' ? `${subject ? `Subject: ${subject}\n\n` : ''}${body}` : kind === 'linkedin' ? dm : waas
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied') } catch { toast.error('Couldn’t copy; select the text instead') }
  }

  return (
    <section aria-label={`Write to ${contact.name}`} className="rounded-[4px] border border-line bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-[20px] font-semibold text-fg">To {contact.name || 'this person'}</h3>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <Segmented label="Message type" value={kind} onChange={setKind}
        options={[{ value: 'email', label: 'Email' }, { value: 'linkedin', label: 'LinkedIn' }, ...(company.yc_batch ? [{ value: 'waas' as const, label: 'Work at a Startup' }] : [])]} />
      <div className="mt-4 space-y-3">
        <Field label="Anything to mention?" hint="Optional: a role you applied to, a shared interest, a project of theirs.">
          {f => <Input {...f} value={extra} onChange={e => setExtra(e.target.value)} placeholder="I applied to the SWE intern role last night" />}
        </Field>
        <Button variant="primary" onClick={() => write.mutate()} loading={write.isPending}>{text.trim() ? 'Rewrite' : 'Write it'}</Button>
        {kind === 'email' && (
          <>
            <Field label="Subject">{f => <Input {...f} value={subject} onChange={e => setSubject(e.target.value)} />}</Field>
            <Field label="Message">{f => <Textarea {...f} rows={9} value={body} onChange={e => setBody(e.target.value)} />}</Field>
          </>
        )}
        {kind === 'linkedin' && (
          <Field label="Message" hint={`${dm.length} / 300 characters for a connection note`} error={dm.length > 300 ? 'Too long for a connection note' : null}>
            {f => <Textarea {...f} rows={5} value={dm} onChange={e => setDm(e.target.value)} />}
          </Field>
        )}
        {kind === 'waas' && <Field label="Message">{f => <Textarea {...f} rows={6} value={waas} onChange={e => setWaas(e.target.value)} />}</Field>}
        {text.trim() && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {kind === 'email' && contact.email && (
              <a href={gmailComposeUrl(contact.email, subject, body)} target="_blank" rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-[4px] bg-accent px-4 text-[14px] font-semibold text-on-accent hover:bg-accent-hover">
                <Mail className="size-4" /> Open in Gmail
              </a>
            )}
            <Button icon={<Copy className="size-4" />} onClick={() => void copy()}>Copy</Button>
            <Button variant="ghost" loading={mark.isPending} onClick={() => mark.mutate(kind === 'email' ? 'sent' : 'dm_sent')}>Mark as sent</Button>
          </div>
        )}
      </div>
    </section>
  )
}

function People({ company, contacts }: { company: CompanyDetail; contacts: CompanyContact[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [writing, setWriting] = useState<number | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState<CompanyContact | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: key(company.id) })

  const findPeople = useMutation({
    mutationFn: () => {
      setProgress([])
      return api.findPeople(company.id, (e: PeopleEvent) => {
        if (e.type === 'source') setProgress(p => [...p.slice(-4), e.message || `${e.source}: ${e.status}${e.count != null ? ` (${e.count})` : ''}`])
        if (e.type === 'complete') toast.success(e.message || `Found ${e.added} new ${e.added === 1 ? 'person' : 'people'}`)
        if (e.type === 'error') toast.error(e.message)
      })
    },
    onSettled: refresh,
    onError: (e: Error) => toast.error(e.message),
  })
  const findEmails = useMutation({
    mutationFn: () => api.findEmails(company.id),
    onSuccess: r => { toast.info(r.hintText || r.message || `${r.added ?? 0} new, ${r.updated ?? 0} updated`); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const findOne = useMutation({
    mutationFn: (id: number) => api.findEmailFor(id),
    onSuccess: r => { if (r.email) toast.success(`Found ${r.email}`); else toast.info(r.message || 'No email found for this person'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.updateContact(id, { status }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteContact(id),
    onSuccess: () => { setConfirmDelete(null); toast.success('Removed'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })

  const selected = contacts.find(c => c.id === writing)
  const withEmail = contacts.filter(c => c.email).length

  return (
    <section aria-labelledby="people-h" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-2">
        <h2 id="people-h" className="font-display text-[24px] font-semibold text-fg">People <span className="font-sans text-[15px] font-normal text-subtle">· {contacts.length}, {withEmail} with email</span></h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<UserSearch className="size-4" />} onClick={() => findPeople.mutate()} loading={findPeople.isPending}>Find people</Button>
          <Button size="sm" icon={<Mail className="size-4" />} onClick={() => findEmails.mutate()} loading={findEmails.isPending} disabled={!contacts.length}>Find emails</Button>
        </div>
      </div>
      {findPeople.isPending && (
        <div className="rounded-[4px] border border-line bg-surface px-4 py-3 text-[13px] text-muted">
          <p className="mb-1 flex items-center gap-2 text-fg"><Spinner size={14} /> Searching Apollo, LinkedIn and Google…</p>
          {progress.map((l, i) => <p key={i} className="font-mono text-[12px]">{l}</p>)}
        </div>
      )}

      {selected && <Composer key={selected.id} company={company} contact={selected} onClose={() => setWriting(null)} />}

      {contacts.length === 0 ? (
        <EmptyState title="No people yet" description="Find people looks up recruiters, managers and engineers at this company." />
      ) : (
        <ul>
          {contacts.map(c => {
            const e = emailLabel(c.email_status)
            return (
              <li key={c.id} className={cn('grid gap-x-4 gap-y-2 border-b border-line py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center', c.id === writing && 'bg-hover/40')}>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate font-medium text-fg">
                    {c.name || 'Unknown name'}
                    {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" aria-label={`${c.name} on LinkedIn`} className="text-subtle hover:text-accent"><ExternalLink className="size-3.5" /></a>}
                  </p>
                  <p className="truncate text-[13px] text-muted">{c.title || '—'}</p>
                </div>
                <div className="min-w-0 text-[14px]">
                  {c.email
                    ? <span className="flex items-baseline gap-2"><span className="truncate font-mono text-[13px] text-fg">{c.email}</span>{e && <span className={cn('shrink-0 text-[12px]', e.tone)}>{e.text}</span>}</span>
                    : <Button size="sm" variant="ghost" onClick={() => findOne.mutate(c.id)} loading={findOne.isPending && findOne.variables === c.id}>Find email</Button>}
                </div>
                <div className="flex items-center gap-2">
                  <Select value={c.status ?? 'pending'} aria-label={`Status for ${c.name}`} className="h-8 w-36 text-[13px]"
                    onChange={ev => setStatus.mutate({ id: c.id, status: ev.target.value })}>
                    {CONTACT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </Select>
                  <Button size="sm" variant={c.id === writing ? 'primary' : 'secondary'} onClick={() => setWriting(c.id === writing ? null : c.id)}>Write</Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${c.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(c)} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDialog open={confirmDelete != null} title="Remove this person?" description={confirmDelete ? `${confirmDelete.name} is removed from ${company.name}.` : ''}
        confirmLabel="Remove" danger busy={remove.isPending} onConfirm={() => confirmDelete && remove.mutate(confirmDelete.id)} onCancel={() => setConfirmDelete(null)} />
    </section>
  )
}

function Roles({ company, initial }: { company: CompanyDetail; initial: CompanyRole[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [urlDraft, setUrlDraft] = useState<string | null>(null)
  const careers = useQuery({ queryKey: ['careers-url', company.id], queryFn: () => api.careersUrl(company.id) })
  const roles = useQuery({ queryKey: ['company-roles', company.id], queryFn: () => api.companyRoles(company.id), initialData: initial })

  const scrape = useMutation({
    mutationFn: (t: 'intern' | 'fulltime') => api.scrapeCompanyRoles(company.id, t),
    onSuccess: async r => {
      await roles.refetch()
      toast.success(r.added ? `Added ${r.added} ${r.added === 1 ? 'role' : 'roles'}` : 'No new roles found')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const saveUrl = useMutation({
    mutationFn: (u: string) => api.setCareersUrl(company.id, u),
    onSuccess: () => { setUrlDraft(null); toast.success('Careers page saved'); void qc.invalidateQueries({ queryKey: ['careers-url', company.id] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const submitUrl = (e: FormEvent) => { e.preventDefault(); if (urlDraft && /^https?:\/\//i.test(urlDraft.trim())) saveUrl.mutate(urlDraft.trim()) }
  const list = [...(roles.data ?? [])].sort((a, b) => (a.role_type === b.role_type ? 0 : a.role_type === 'intern' ? -1 : 1))

  return (
    <section aria-labelledby="roles-h" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-2">
        <h2 id="roles-h" className="font-display text-[24px] font-semibold text-fg">Open roles <span className="font-sans text-[15px] font-normal text-subtle">· {list.length}</span></h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => scrape.mutate('intern')} loading={scrape.isPending && scrape.variables === 'intern'}>Find internships</Button>
          <Button size="sm" onClick={() => scrape.mutate('fulltime')} loading={scrape.isPending && scrape.variables === 'fulltime'}>Find new-grad roles</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[14px] text-muted">
        {careers.data?.url
          ? <a href={careers.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Careers page <ExternalLink className="size-3.5" /></a>
          : <span>No careers page known.</span>}
        {urlDraft == null
          ? <button type="button" className="text-subtle hover:text-fg" onClick={() => setUrlDraft(careers.data?.url ?? '')}>{careers.data?.url ? 'Change' : 'Add one'}</button>
          : (
            <form onSubmit={submitUrl} className="flex flex-1 basis-80 gap-2">
              <Input value={urlDraft} onChange={e => setUrlDraft(e.target.value)} placeholder="https://jobs.lever.co/…" aria-label="Careers page link" />
              <Button type="submit" size="sm" loading={saveUrl.isPending}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setUrlDraft(null)}>Cancel</Button>
            </form>
          )}
      </div>
      {list.length === 0 ? (
        <EmptyState title="No roles found yet" description="Find internships or new-grad roles checks this company’s job board." />
      ) : (
        <ul>
          {list.map(r => (
            <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-line py-3">
              <a href={r.apply_url} target="_blank" rel="noreferrer" className="truncate text-[14px] font-medium text-fg hover:text-accent">{r.title}</a>
              <Link to={`/applications/evaluate?url=${encodeURIComponent(r.apply_url)}`} className="text-[14px] text-accent hover:underline">Evaluate</Link>
              <span className="truncate text-[13px] text-muted">{[r.role_type === 'intern' ? 'Internship' : 'New grad / full-time', r.location, r.source].filter(Boolean).join(' · ')}</span>
              <span className="text-[12px] text-subtle">{timeAgo(r.posted_at || r.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function CompanyPage() {
  const id = Number(useParams().id)
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: key(id), queryFn: () => api.company(id), enabled: Number.isInteger(id) && id > 0 })
  const status = useMutation({
    mutationFn: (s: CompanyStatus) => api.setCompanyStatus(id, s),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key(id) }); void qc.invalidateQueries({ queryKey: ['companies'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (q.error) return <Page><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>
  if (q.isLoading || !q.data) return <Page wide><Skeleton className="mb-6 h-24" /><Skeleton className="h-64" /></Page>
  const { company, contacts } = q.data
  const host = websiteHost(company)
  const blurb = companyBlurb(company)

  return (
    <Page wide>
      <p className="mb-4 text-[14px] text-subtle"><Link to="/jobs/companies" className="hover:text-fg">Companies</Link> / {company.name}</p>
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div className="min-w-0 flex-1 basis-[520px]">
          <h1 className="font-display text-[40px] leading-tight font-normal tracking-tight text-fg sm:text-[48px]">{company.name}</h1>
          <p className="mt-2 text-[14px] text-muted">
            {[company.subcategory || company.category, company.location, company.team_size ? `${company.team_size} people` : null, company.yc_batch ? `YC ${company.yc_batch}` : null].filter(Boolean).join(' · ')}
            {host && <> · <a href={company.website || `https://${host}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">{host}</a></>}
          </p>
          {blurb && <p className="mt-3 max-w-3xl leading-relaxed text-muted">{blurb}</p>}
        </div>
        <div className="w-48">
          <Field label="Status">
            {f => (
              <Select {...f} value={company.status ?? 'new'} onChange={e => status.mutate(e.target.value as CompanyStatus)} disabled={status.isPending}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            )}
          </Field>
        </div>
      </header>
      <div className="grid gap-12 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <People company={company} contacts={contacts} />
        <Roles company={company} initial={q.data.roles} />
      </div>
    </Page>
  )
}

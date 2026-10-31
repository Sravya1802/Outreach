import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Copy, ExternalLink, Mail, MessageSquare, Paperclip, Search } from 'lucide-react'
import { api, type OutboxItem, type PlanCompany, type PlanNote, type PlanPerson } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Badge, Button, ButtonLink, ConfirmDialog, EmptyState, ErrorState, Input, Page, PageHeader, Segmented, Skeleton, useToast } from '@/ui'
import { emailLabel, needsYou, planSummary, statusLabel } from './contacts'
import { cityOf, itemStatus } from './outbox'
import { EditEmailDialog } from './EditEmailDialog'

type Show = 'all' | 'needs'

export default function ContactsPage() {
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [open, setOpen] = useState<string | null>(null)
  const q = useQuery({ queryKey: qk.planCompanies, queryFn: api.planCompanies })

  const all = q.data ?? []
  const term = search.trim().toLowerCase()
  const list = all.filter(c => (show === 'all' || needsYou(c)) && (!term || c.name.toLowerCase().includes(term)))
  const waiting = all.reduce((n, c) => n + c.waiting, 0)
  const notes = all.reduce((n, c) => n + c.notesToSend, 0)

  return (
    <Page>
      <PageHeader
        title="Contacts"
        description="The companies you’re reaching out to. Open one to see every email planned for people there, each with the LinkedIn note that goes with it."
        actions={<ButtonLink to="/people/templates">Email templates</ButtonLink>}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search companies…" aria-label="Search companies" className="pl-9" />
        </div>
        <Segmented label="Show" value={show} onChange={setShow} options={[{ value: 'all', label: 'All' }, { value: 'needs', label: 'Waiting on you' }]} />
      </div>

      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : list.length === 0 ? (
        <div className="border-t border-rule">
          <EmptyState
            title={all.length ? (show === 'needs' && !term ? 'Nothing is waiting on you' : 'No companies match') : 'No contacts yet'}
            description={all.length ? undefined : 'When you approve a role, people at that company are found for you, and an email and a LinkedIn note are written for each. They show up here.'}
            action={!all.length ? <ButtonLink to="/jobs/companies" size="sm" variant="primary">Go to companies</ButtonLink> : undefined}
          />
        </div>
      ) : (
        <>
          <p className="mb-1 text-[13px] text-subtle">
            {list.length} {list.length === 1 ? 'company' : 'companies'}
            {waiting > 0 && ` · ${waiting} ${waiting === 1 ? 'email' : 'emails'} waiting for your OK`}
            {notes > 0 && ` · ${notes} LinkedIn ${notes === 1 ? 'note' : 'notes'} to send`}
          </p>
          <ul className="border-t border-rule">
            {list.map(c => <CompanyRow key={c.key} c={c} open={open === c.key} onToggle={() => setOpen(o => (o === c.key ? null : c.key))} />)}
          </ul>
        </>
      )}
    </Page>
  )
}

function CompanyRow({ c, open, onToggle }: { c: PlanCompany; open: boolean; onToggle: () => void }) {
  return (
    <li className="border-b border-line">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 py-3.5 text-left hover:bg-hover/40">
        <ChevronDown className={cn('size-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg">{c.name}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {planSummary(c).map(b => <Badge key={b.text} tone={b.tone}>{b.text}</Badge>)}
          {c.people > 0 && <span className="ml-1 text-[13px] text-subtle">{c.people} {c.people === 1 ? 'person' : 'people'} found</span>}
        </span>
      </button>
      {open && <CompanyPlan companyKey={c.key} />}
    </li>
  )
}

function useRefresh(companyKey: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: qk.planCompany(companyKey) })
    void qc.invalidateQueries({ queryKey: qk.planCompanies })
    void qc.invalidateQueries({ queryKey: qk.outbox })
    void qc.invalidateQueries({ queryKey: qk.dailyPlan })
  }
}

function CompanyPlan({ companyKey }: { companyKey: string }) {
  const toast = useToast()
  const refresh = useRefresh(companyKey)
  const detail = useQuery({ queryKey: qk.planCompany(companyKey), queryFn: () => api.planCompany(companyKey) })
  const [editing, setEditing] = useState<OutboxItem | null>(null)
  const [discarding, setDiscarding] = useState<OutboxItem | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)

  const discard = useMutation({
    mutationFn: (id: number) => api.cancelOutbox(id),
    onSuccess: () => { setDiscarding(null); toast.success('Discarded'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  // One at a time: each approval reads (and removes) the draft's copy in Gmail.
  const approveAll = useMutation({
    mutationFn: async (items: OutboxItem[]) => {
      let done = 0
      const failed: string[] = []
      for (const item of items) {
        setProgress(`Approving ${done + failed.length + 1} of ${items.length}…`)
        try { await api.approveOutbox(item.id); done += 1 } catch { failed.push(item.to_name || item.to_email) }
      }
      return { done, failed }
    },
    onSuccess: r => {
      setApprovingAll(false)
      if (r.failed.length) toast.error(`Approved ${r.done}. Couldn’t approve ${r.failed.join(', ')}; try those one by one.`)
      else toast.success(`Approved ${r.done}. Each goes out in that person’s morning.`)
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => { setProgress(null); refresh() },
  })

  if (detail.error) return <div className="pb-4 pl-7"><ErrorState compact error={detail.error} onRetry={() => detail.refetch()} /></div>
  if (detail.isLoading || !detail.data) return <div className="pb-4 pl-7"><Skeleton className="h-24" /></div>
  const d = detail.data
  const drafts = d.planned.map(p => p.email).filter((e): e is OutboxItem => e?.status === 'draft')

  return (
    <div className="space-y-3 pb-5 pl-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          {d.roles.length > 0 ? (
            <>Asking for a referral for {d.roles.map((r, i) => (
              <span key={r.title}>{i > 0 && (i === d.roles.length - 1 ? ' and ' : ', ')}
                {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{r.title}</a> : r.title}
              </span>
            ))}.</>
          ) : d.planned.length ? 'Messages written for people here.' : 'Nothing planned here yet.'}
        </p>
        {drafts.length > 1 && (
          <Button size="sm" variant="primary" disabled={approveAll.isPending} onClick={() => setApprovingAll(true)}>Approve all {drafts.length} emails</Button>
        )}
      </div>

      {d.search && d.planned.length === 0 && <SearchNote note={d.search} companyKey={companyKey} />}

      {d.planned.length > 0 && (
        <ul className="space-y-3">
          {d.planned.map(p => (
            <PersonCard key={p.ref} p={p} companyKey={companyKey} onEdit={setEditing} onDiscard={setDiscarding} />
          ))}
        </ul>
      )}

      {d.others.length > 0 && (
        <details className="group rounded-[4px] border border-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[14px] text-muted hover:text-fg">
            <ChevronDown className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-180" aria-hidden="true" />
            Also found here · {d.others.length} {d.others.length === 1 ? 'person' : 'people'} with nothing planned
          </summary>
          <ul className="border-t border-line px-3">
            {d.others.map(p => {
              const check = emailLabel(p.addressCheck)
              const status = statusLabel(p.contactStatus)
              return (
                <li key={p.ref} className="grid gap-x-4 gap-y-0.5 border-b border-line py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_110px] sm:items-center">
                  <p className="min-w-0 truncate text-[14px]"><span className="text-fg">{p.name}</span>{p.title && <span className="text-muted"> · {p.title}</span>}</p>
                  <p className="min-w-0 truncate text-[13px]">
                    {p.address
                      ? <><span className="font-mono text-fg">{p.address}</span>{check && <span className={cn('ml-2', check.tone)}>{check.text}</span>}</>
                      : p.linkedinUrl ? <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">LinkedIn only</a> : <span className="text-subtle">No email yet</span>}
                  </p>
                  <span className={cn('text-[13px]', status.tone)}>{status.text}</span>
                </li>
              )
            })}
          </ul>
        </details>
      )}

      {editing && <EditEmailDialog item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
      <ConfirmDialog
        open={discarding != null}
        title="Discard this email?"
        description={discarding ? `To ${discarding.to_name || discarding.to_email}: “${discarding.subject}”${discarding.in_gmail_drafts ? '. It’s removed from your Gmail Drafts too.' : ''} Their LinkedIn note stays.` : ''}
        confirmLabel="Discard"
        danger
        busy={discard.isPending}
        onConfirm={() => discarding && discard.mutate(discarding.id)}
        onCancel={() => setDiscarding(null)}
      />
      <ConfirmDialog
        open={approvingAll}
        title={`Approve all ${drafts.length} emails to ${d.name}?`}
        description={`${drafts.length} different people, each in their own morning, and they stop by themselves if someone replies. Their LinkedIn notes are still yours to send.${progress ? ` ${progress}` : ''}`}
        confirmLabel="Approve all"
        busy={approveAll.isPending}
        onConfirm={() => approveAll.mutate(drafts)}
        onCancel={() => { if (!approveAll.isPending) setApprovingAll(false) }}
      />
    </div>
  )
}

const TONE: Record<string, string> = { success: 'text-success', danger: 'text-danger', warning: 'text-fg', accent: 'text-accent', neutral: 'text-muted' }

function PersonCard({ p, companyKey, onEdit, onDiscard }: { p: PlanPerson; companyKey: string; onEdit: (o: OutboxItem) => void; onDiscard: (o: OutboxItem) => void }) {
  const check = emailLabel(p.addressCheck)
  return (
    <li className="rounded-[4px] border border-line bg-surface p-4">
      <p className="text-[15px]">
        <b className="font-medium text-fg">{p.name}</b>
        {p.title && <span className="text-muted"> · {p.title}</span>}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-subtle">
        {p.address && <span><span className="font-mono">{p.address}</span>{check && <span className={cn('ml-1.5', check.tone)}>{check.text}</span>}</span>}
        {p.linkedinUrl && <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">LinkedIn profile <ExternalLink className="size-3" /></a>}
      </p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <EmailPane email={p.email} companyKey={companyKey} onEdit={onEdit} onDiscard={onDiscard} />
        <NotePane note={p.note} companyKey={companyKey} />
      </div>
    </li>
  )
}

function EmailPane({ email, companyKey, onEdit, onDiscard }: { email: OutboxItem | null; companyKey: string; onEdit: (o: OutboxItem) => void; onDiscard: (o: OutboxItem) => void }) {
  const toast = useToast()
  const refresh = useRefresh(companyKey)
  const [full, setFull] = useState(false)
  const approve = useMutation({
    mutationFn: (id: number) => api.approveOutbox(id),
    onSuccess: r => { toast.success(`Approved. It goes ${r.when} ${email ? cityOf(email.recipient_tz) : ''} time${r.edited_in_gmail ? ', with your Gmail edits' : ''}.`); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const download = useMutation({
    mutationFn: () => api.downloadResumeFile(email?.attachment_file_id as number, email?.attachment_name || 'resume.pdf'),
    onError: (e: Error) => toast.error(e.message),
  })
  if (!email) {
    return (
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[12px] tracking-wide text-subtle uppercase"><Mail className="size-3.5" aria-hidden="true" /> Email</p>
        <p className="rounded-[4px] border border-dashed border-line p-3 text-[13px] text-subtle">No email for this person: no address was found, so it’s LinkedIn only.</p>
      </div>
    )
  }
  const st = itemStatus(email)
  return (
    <div className="min-w-0">
      <p className="mb-1 flex flex-wrap items-center gap-x-2 text-[12px] text-subtle">
        <span className="flex items-center gap-1.5 tracking-wide uppercase"><Mail className="size-3.5" aria-hidden="true" /> Email</span>
        <span className={cn('normal-case', TONE[st.tone])}>· {st.text}</span>
      </p>
      <div className="rounded-[4px] border border-line bg-raised p-3">
        <p className="text-[13px] font-medium text-fg">{email.subject}</p>
        <p className={cn('mt-1.5 text-[13px] leading-relaxed break-words whitespace-pre-line text-muted', !full && 'line-clamp-5')}>{email.body}</p>
        <button type="button" onClick={() => setFull(f => !f)} className="mt-1 text-[12px] text-accent hover:underline">{full ? 'Show less' : 'Show the whole email'}</button>
        {email.attachment_file_id ? (
          <p className="mt-2 border-t border-line pt-2 text-[12px]">
            <button type="button" onClick={() => download.mutate()} className="inline-flex min-w-0 items-center gap-1.5 text-accent hover:underline" title="Download the attached resume">
              <Paperclip className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{email.attachment_name || 'resume.pdf'}</span>
            </button>
          </p>
        ) : null}
      </div>
      {email.email_guessed && <p className="mt-1.5 text-[12px] text-warning">The address is guessed from the company’s email pattern and may bounce.</p>}
      {(email.status === 'draft' || email.status === 'scheduled') && (
        <div className="mt-2 flex flex-wrap gap-2">
          {email.status === 'draft' && <Button size="sm" variant="primary" loading={approve.isPending} onClick={() => approve.mutate(email.id)}>Approve</Button>}
          <Button size="sm" variant="ghost" onClick={() => onEdit(email)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => onDiscard(email)}>{email.status === 'draft' ? 'Discard' : 'Cancel'}</Button>
        </div>
      )}
    </div>
  )
}

function useNoteActions(note: PlanNote, companyKey: string) {
  const toast = useToast()
  const refresh = useRefresh(companyKey)
  const sent = useMutation({
    mutationFn: () => api.markAskSent(note.id),
    onSuccess: () => { toast.success('Marked as sent'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  async function copyAndOpen() {
    try { await navigator.clipboard.writeText(note.message); toast.success('Note copied. Paste it into LinkedIn.') } catch { toast.error('Couldn’t copy; select the note instead') }
    if (note.linkedinUrl) window.open(note.linkedinUrl, '_blank', 'noopener')
  }
  return { sent, copyAndOpen }
}

function NotePane({ note, companyKey }: { note: PlanNote | null; companyKey: string }) {
  if (!note) {
    return (
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[12px] tracking-wide text-subtle uppercase"><MessageSquare className="size-3.5" aria-hidden="true" /> LinkedIn note</p>
        <p className="rounded-[4px] border border-dashed border-line p-3 text-[13px] text-subtle">No LinkedIn note for this person.</p>
      </div>
    )
  }
  return <NoteBody note={note} companyKey={companyKey} />
}

function NoteBody({ note, companyKey }: { note: PlanNote; companyKey: string }) {
  const { sent, copyAndOpen } = useNoteActions(note, companyKey)
  const profile = Boolean(note.linkedinUrl && /linkedin\.com\/in\//i.test(note.linkedinUrl))
  return (
    <div className="min-w-0">
      <p className="mb-1 flex flex-wrap items-center gap-x-2 text-[12px] text-subtle">
        <span className="flex items-center gap-1.5 tracking-wide uppercase"><MessageSquare className="size-3.5" aria-hidden="true" /> LinkedIn note</span>
        <span className={note.status === 'to_send' ? 'text-accent' : 'text-success'}>· {note.status === 'to_send' ? 'Yours to send' : note.status === 'replied' ? 'They replied' : 'Sent'}</span>
        <span>· {note.message.length}/300</span>
      </p>
      <p className="rounded-[4px] border border-line bg-raised p-3 text-[13px] leading-relaxed break-words whitespace-pre-line text-fg">{note.message}</p>
      {note.status === 'to_send' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={<Copy className="size-3.5" />} onClick={() => void copyAndOpen()}>
            {profile ? 'Copy note & open profile' : 'Copy note & search LinkedIn'}
          </Button>
          <Button size="sm" variant="ghost" loading={sent.isPending} onClick={() => sent.mutate()}>I sent it</Button>
        </div>
      )}
    </div>
  )
}

function SearchNote({ note, companyKey }: { note: PlanNote; companyKey: string }) {
  return (
    <div className="rounded-[4px] border border-line bg-surface p-4">
      <p className="mb-2 text-[14px] text-fg">Nobody found here yet. Search LinkedIn for someone at the company and send them this note.</p>
      <NoteBody note={note} companyKey={companyKey} />
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Copy, Download, ExternalLink, FileText, Search } from 'lucide-react'
import { API } from '@/api.js'
import { api, type DashboardRole, type RoleCardData, type RolePerson } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { useProfile } from '@/app/queries'
import { cn } from '@/lib/cn'
import { Badge, Button, ButtonLink, buttonClass, ConfirmDialog, EmptyState, ErrorState, Input, Page, PageHeader, Select, Skeleton, Textarea, useToast } from '@/ui'
import { ApproveAllEmails } from '@/features/outreach/ApproveAllEmails'
import { timeAgo } from '@/lib/format'
import { CompanyOutreachSwitch } from './CompanyOutreachSwitch'
import { GapChat } from './GapChat'
import { approvedLine as reviewApprovedLine, resumeFileName, saveBlob } from '@/features/review/review'
import { apiOrigin, askFiller, closesLabel, hasFiller } from '@/features/review/ready'
import { CHIP_TONE, COUNTS, NO_FILTERS, countGroups, daysTo, emailState, matches, nextStep, noteState, notesText, peopleLink, sendLine, type Filters } from './dashboard'

const PAGE = 60

/** To apply: one card per role Claude has tailored, with its resume, its people and how to apply. */
export default function RoleDashboardPage() {
  const [params, setParams] = useSearchParams()
  const q = useQuery({ queryKey: qk.dashboard, queryFn: api.dashboard, refetchInterval: 60_000 })
  const [f, setF] = useState<Filters>(() => ({ ...NO_FILTERS, group: (params.get('f') as Filters['group']) || null }))
  const [shown, setShown] = useState(PAGE)
  const focus = params.get('role')
  const all = useMemo(() => q.data?.roles ?? [], [q.data])
  const active = useMemo(() => all.filter(c => c.chip !== 'Closed'), [all])
  const counts = useMemo(() => countGroups(active), [active])
  const list = useMemo(() => all.filter(c => matches(c, f) || c.id === focus), [all, f, focus])
  const set = (patch: Partial<Filters>) => { setF(x => ({ ...x, ...patch })); setShown(PAGE) }
  const pick = (g: Filters['group']) => {
    set({ group: f.group === g ? null : g })
    setParams(p => { const n = new URLSearchParams(p); if (f.group === g || !g) n.delete('f'); else n.set('f', g); return n }, { replace: true })
  }
  // A card opened from People (?role=) is shown even past the first page.
  const visible = useMemo(() => {
    const first = list.slice(0, shown)
    const target = focus ? list.find(c => c.id === focus) : null
    return target && !first.includes(target) ? [target, ...first] : first
  }, [list, shown, focus])

  return (
    <Page wide>
      <PageHeader title="To apply" description="Every role Claude has tailored: review the resume, approve the emails, and apply, all on its card." />
      <div role="group" aria-label="Show" className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {COUNTS.map(c => (
          <button key={c.key} type="button" aria-pressed={f.group === c.key} onClick={() => pick(c.key)}
            className={cn('rounded-[4px] border bg-surface px-3 py-2 text-left transition-colors', f.group === c.key ? 'border-accent' : 'border-line hover:border-line-strong')}>
            <span className="block font-mono text-[20px] leading-7 text-fg">{counts[c.key]}</span>
            <span className={cn('block text-[12px] leading-4', f.group === c.key ? 'font-medium text-fg' : 'text-muted')}>{c.label}</span>
          </button>
        ))}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <div className="relative col-span-2 md:col-span-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={f.search} onChange={e => set({ search: e.target.value })} placeholder="Search company or role" aria-label="Search company or role" className="w-full pl-9" />
        </div>
        <Select value={f.kind} onChange={e => set({ kind: e.target.value as Filters['kind'] })} aria-label="Type" className="w-full">
          <option value="">Intern and new grad</option><option value="intern">Intern</option><option value="new_grad">New grad</option>
        </Select>
        <Select value={f.deadline} onChange={e => set({ deadline: e.target.value as Filters['deadline'] })} aria-label="Deadline" className="w-full">
          <option value="">Any deadline</option><option value="week">Closes within 7 days</option><option value="month">Closes within 30 days</option>
          <option value="dated">Has a deadline</option><option value="none">No deadline stated</option>
        </Select>
        <Select value={f.ats} onChange={e => set({ ats: e.target.value as Filters['ats'] })} aria-label="ATS" className="w-full">
          <option value="">Any ATS</option><option value="90">ATS 90%+</option><option value="80">ATS 80%+</option><option value="under90">ATS under 90%</option>
        </Select>
        <label className="col-span-2 inline-flex items-center gap-2 text-[13px] text-muted md:col-span-1">
          <input type="checkbox" className="size-4 accent-accent" checked={f.closed} onChange={e => set({ closed: e.target.checked })} /> Closed too
        </label>
      </div>

      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : all.length === 0 ? (
        <EmptyState title="No tailored roles yet" description="When your Claude run writes a resume for a role, the role shows here." action={<ButtonLink to="/jobs/roles/intern" size="sm" variant="primary">Find roles</ButtonLink>} />
      ) : list.length === 0 ? (
        <EmptyState title="No roles match" description="Clear a filter to see more." action={<Button size="sm" onClick={() => { set(NO_FILTERS); setParams({}, { replace: true }) }}>Clear filters</Button>} />
      ) : (
        <>
          <p className="mb-1 text-[13px] text-subtle">{list.length} {list.length === 1 ? 'role' : 'roles'} · closing soonest first, then highest callback</p>
          <ul className="border-t border-rule">{visible.map(c => <RoleCard key={c.id} c={c} startOpen={c.id === focus} />)}</ul>
          {list.length > shown && <div className="mt-3 flex justify-center"><Button size="sm" onClick={() => setShown(n => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</Button></div>}
        </>
      )}
    </Page>
  )
}

function Deadline({ deadline }: { deadline: string | null }) {
  const label = closesLabel(deadline)
  if (!label) return null
  const n = daysTo(deadline) ?? 99
  return <Badge tone={n < 0 ? 'neutral' : n <= 3 ? 'danger' : n <= 7 ? 'warning' : 'neutral'}>{label}</Badge>
}

function RoleCard({ c, startOpen }: { c: DashboardRole; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => { if (startOpen) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [startOpen])
  const send = sendLine(c)
  return (
    <li ref={ref} className="border-b border-line">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-3 text-left hover:bg-hover/40">
        <ChevronDown className={cn('size-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')} aria-hidden="true" />
        <span className="min-w-0 flex-1 basis-56">
          <span className="block truncate text-[15px] text-fg"><b className="font-medium">{c.company}</b> · {c.title}</span>
          <span className="block truncate text-[13px] text-subtle">{[c.location, send].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <Deadline deadline={c.deadline} />
          {c.ats != null && <span className="font-mono">ATS {c.ats}%</span>}
          {c.callback != null && <span className="font-mono">CB {c.callback}%</span>}
          {c.version != null && (
            <span className="inline-flex items-center gap-1 font-mono" title={c.unseen ? 'A new version you haven’t opened' : undefined}>
              {c.unseen && <span className="size-2 rounded-full bg-accent" aria-label="New version" />}v{c.version}{c.version_at ? ` · updated ${timeAgo(c.version_at)}` : ''}
            </span>
          )}
          {c.open_gaps > 0 && <Badge tone="warning">{c.open_gaps} question{c.open_gaps === 1 ? '' : 's'}</Badge>}
          {c.no_outreach && <Badge tone="neutral">No outreach</Badge>}
          <Badge tone={CHIP_TONE[c.chip]}>{c.chip}</Badge>
        </span>
      </button>
      {open && <CardBody c={c} />}
    </li>
  )
}

function useCardRefresh(id: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: qk.roleCard(id) })
    void qc.invalidateQueries({ queryKey: qk.dashboard })
    void qc.invalidateQueries({ queryKey: ['approve-all-preview'] })
  }
}

function CardBody({ c }: { c: DashboardRole }) {
  const d = useQuery({ queryKey: qk.roleCard(c.id), queryFn: () => api.roleCard(c.id) })
  if (d.error) return <div className="pb-4"><ErrorState error={d.error} onRetry={() => d.refetch()} /></div>
  if (!d.data) return <div className="space-y-2 pb-4 pl-7"><Skeleton className="h-8" /><Skeleton className="h-16" /></div>
  return (
    <div className="grid gap-5 pb-5 pl-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)]">
      <GapChat roleId={c.id} gaps={d.data.gaps} />
      <ResumeSection c={c} d={d.data} />
      <PeopleSection c={c} d={d.data} />
      <ApplySection c={c} d={d.data} />
      <p className="flex flex-wrap gap-4 text-[13px] lg:col-span-3">
        <Link to={peopleLink(c.company)} className="text-accent hover:underline">Open in People</Link>
        <Link to={`/review/${c.id}`} className="text-accent hover:underline">Open the full role page</Link>
      </p>
    </div>
  )
}

const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 text-[12px] font-medium tracking-wide text-subtle uppercase">{children}</h3>

function ResumeSection({ c, d }: { c: DashboardRole; d: RoleCardData }) {
  const toast = useToast()
  const refresh = useCardRefresh(c.id)
  const profile = useProfile()
  const latest = d.versions[0]
  const [asking, setAsking] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'view' | 'save' | null>(null)
  async function pdf(save: boolean) {
    if (!latest) return
    setBusy(save ? 'save' : 'view')
    const win = save ? null : window.open('', '_blank')
    try {
      const blob = await api.reviewPdf(latest.id)
      if (save) saveBlob(blob, resumeFileName(profile.data?.first_name, profile.data?.last_name, c.company))
      else if (win) win.location.href = URL.createObjectURL(blob)
    } catch (e) { win?.close(); toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const revise = useMutation({
    mutationFn: () => api.requestRevision(c.id, text.trim()),
    onSuccess: () => { toast.success('Asked for a revision. Your next run writes the new version.'); setAsking(false); setText(''); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const approve = useMutation({
    mutationFn: () => api.approveRole(c.id),
    onSuccess: r => { toast.success(reviewApprovedLine(r)); refresh(); setTimeout(refresh, 6000) },
    onError: (e: Error) => toast.error(e.message),
  })
  const canRevise = ['ready', 'revision_requested', 'approved'].includes(c.status)
  return (
    <section aria-label="Resume">
      <H>Resume</H>
      <p className="mb-2 text-[13px] text-muted">
        {latest ? `v${latest.version}${latest.is_final ? ' (final)' : ''}${c.version_at ? ` · updated ${timeAgo(c.version_at)}` : ''} · ATS ${latest.ats_after ?? '?'}% · callback ${latest.callback_after ?? '?'}%` : 'Not written yet'}
        {c.status === 'revision_requested' && ' · revision asked for'}
        {d.comments > 0 && ` · ${d.comments} open comment${d.comments === 1 ? '' : 's'}`}
      </p>
      <div className="flex flex-wrap gap-2">
        {c.status === 'ready' && <Button size="sm" variant="primary" loading={approve.isPending} disabled={latest?.check_status !== 'passed'} onClick={() => approve.mutate()}>Approve resume</Button>}
        <Button size="sm" icon={<FileText className="size-3.5" />} disabled={!latest?.has_pdf} loading={busy === 'view'} onClick={() => void pdf(false)}>View PDF</Button>
        <Button size="sm" icon={<Download className="size-3.5" />} disabled={!latest?.has_pdf} loading={busy === 'save'} onClick={() => void pdf(true)}>Download</Button>
        {canRevise && !asking && <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>Request revision</Button>}
      </div>
      {asking && (
        <div className="mt-2 space-y-2">
          <Textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="What should change?" aria-label="What should change" />
          <span className="flex gap-2">
            <Button size="sm" variant="primary" disabled={!text.trim()} loading={revise.isPending} onClick={() => revise.mutate()}>Send</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </span>
        </div>
      )}
      {d.versions.length > 1 && <p className="mt-2 text-[13px]"><Link to={`/review/${c.id}`} className="text-accent hover:underline">Version history and compare ({d.versions.length} versions)</Link></p>}
      <p className="mt-2 text-[13px]">
        {d.evaluation_id
          ? <Link to={`/resumes/job/${d.evaluation_id}`} className="text-accent hover:underline">Cover letter</Link>
          : <span className="text-subtle">Cover letter: comes with the approved resume</span>}
      </p>
    </section>
  )
}

function PeopleSection({ c, d }: { c: DashboardRole; d: RoleCardData }) {
  const toast = useToast()
  const refresh = useCardRefresh(c.id)
  const undo = useUndo()
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [moveTo, setMoveTo] = useState('')
  const [confirmAll, setConfirmAll] = useState<{ contacts: number; unsent_emails: number } | null>(null)
  const people = d.people.filter(p => !p.contact_id || !undo.hidden.has(p.contact_id))
  const ids = (list: RolePerson[]) => list.map(p => p.contact_id).filter((x): x is string => Boolean(x))
  const picked = people.filter(p => p.contact_id && chosen.has(p.contact_id))
  const toSend = people.filter(p => p.note_status === 'to_send').length
  const notes = notesText(people)
  const marked = useMutation({
    mutationFn: () => api.roleNotesSent(c.id),
    onSuccess: r => { toast.success(r.marked ? `Marked ${r.marked} note${r.marked === 1 ? '' : 's'} sent.` : 'No notes were waiting.'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const copy = () => { void navigator.clipboard.writeText(notes).then(() => toast.success('LinkedIn notes copied.'), () => toast.error('Couldn’t copy them.')) }
  const send = sendLine(c)
  const who = (n: number) => (n === 1 ? '1 person' : `${n} people`)
  // Remove, move and delete wait 10 seconds for Undo, then go to the server.
  const act = (verb: string, run: (contactIds: string[]) => Promise<unknown>) => {
    const list = ids(picked)
    if (!list.length) return
    setChosen(new Set())
    undo.schedule(list, `${verb} ${who(list.length)}.`, async () => {
      try { await run(list); refresh() } catch (e) { toast.error((e as Error).message); refresh() }
    })
  }
  const allPreview = useMutation({
    mutationFn: () => api.deleteAllPreview(c.company),
    onSuccess: r => setConfirmAll({ contacts: r.contacts, unsent_emails: r.unsent_emails }),
    onError: (e: Error) => toast.error(e.message),
  })
  const deleteAll = useMutation({
    mutationFn: () => api.deleteAllContacts(c.company),
    onSuccess: r => {
      setConfirmAll(null)
      toast.success(`Deleted ${who(r.deleted)}${r.keptForHistory ? `; ${r.keptForHistory} you already emailed stay in your history` : ''}.`)
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const others = d.company_roles.filter(r => r.id !== c.id)
  return (
    <section aria-label="People">
      <H>People{people.length ? ` · ${people.length}` : ''}</H>
      <div className="mb-2"><CompanyOutreachSwitch company={c.company} onDone={refresh} /></div>
      {send && <p className="mb-2 text-[13px] text-fg">{send}</p>}
      {people.length === 0 ? (
        <p className="text-[13px] text-muted">{d.no_outreach ? `No outreach for ${c.company}.` : ['my_contact', 'none'].includes(c.referral_mode) ? 'This role’s mode emails nobody.' : 'Nobody found yet. Find people from the full role page.'}</p>
      ) : (
        <>
          <label className="mb-1.5 inline-flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" className="size-4 accent-accent" checked={picked.length > 0 && picked.length === ids(people).length}
              onChange={e => setChosen(e.target.checked ? new Set(ids(people)) : new Set())} /> Select all
          </label>
          <ul className="space-y-2">
            {people.map(p => (
              <PersonRow key={p.draft_id} p={p} checked={Boolean(p.contact_id && chosen.has(p.contact_id))}
                onCheck={p.contact_id ? (on) => setChosen(s => { const n = new Set(s); if (on) n.add(p.contact_id as string); else n.delete(p.contact_id as string); return n }) : undefined} />
            ))}
          </ul>
          {picked.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[4px] border border-line bg-raised px-2 py-2">
              <span className="text-[13px] text-fg">{who(picked.length)}:</span>
              <Button size="sm" onClick={() => act('Removed from this role:', list => api.removeFromRole(c.id, list))}>Remove from this role</Button>
              {others.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Select value={moveTo} onChange={e => setMoveTo(e.target.value)} aria-label="Move to role" className="w-auto! max-w-[14rem] py-0.5 text-[13px]">
                    <option value="">Move to another role…</option>
                    {others.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                  </Select>
                  <Button size="sm" disabled={!moveTo} onClick={() => { const to = moveTo; setMoveTo(''); act('Moved', list => api.moveToRole(c.id, list, to)) }}>Move</Button>
                </span>
              )}
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => act('Deleted', list => api.deleteContacts(list))}>Delete contact{picked.length === 1 ? '' : 's'}</Button>
            </div>
          )}
        </>
      )}
      {undo.pending && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-[4px] bg-accent-soft px-3 py-2 text-[13px] text-fg" role="status">
          <span>{undo.pending.message} Sent emails and replies stay in your history.</span>
          <Button size="sm" onClick={undo.cancel}>Undo ({undo.left}s)</Button>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-start gap-2">
        {people.length > 0 && <ApproveAllEmails role={c.id} onDone={refresh} />}
        {notes && <Button size="sm" icon={<Copy className="size-3.5" />} onClick={copy}>Copy LinkedIn notes</Button>}
        {toSend > 0 && <Button size="sm" variant="ghost" loading={marked.isPending} onClick={() => marked.mutate()}>Mark {toSend} note{toSend === 1 ? '' : 's'} sent</Button>}
        <Button size="sm" variant="ghost" className="text-danger" loading={allPreview.isPending} onClick={() => allPreview.mutate()}>Delete all contacts at {c.company}</Button>
      </div>
      <ConfirmDialog
        open={confirmAll != null}
        title={confirmAll ? `Delete ${confirmAll.contacts} contact${confirmAll.contacts === 1 ? '' : 's'} and ${confirmAll.unsent_emails} unsent email${confirmAll.unsent_emails === 1 ? '' : 's'} from ${c.company}?` : ''}
        description="This can’t be undone. Emails you already sent and any replies stay in your history."
        confirmLabel="Delete all"
        danger
        busy={deleteAll.isPending}
        onConfirm={() => deleteAll.mutate()}
        onCancel={() => { if (!deleteAll.isPending) setConfirmAll(null) }}
      />
    </section>
  )
}

/**
 * Hide now, act in 10 seconds unless Undo is pressed. Leaving the page does
 * it at once, so nothing waits forever.
 */
function useUndo() {
  const [pending, setPending] = useState<{ ids: string[]; message: string; run: () => Promise<void>; at: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runRef = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => {
    if (!pending) return
    const tick = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(tick)
  }, [pending])
  useEffect(() => {
    const flush = () => { const r = runRef.current; runRef.current = null; if (r) void r() }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [])
  const finish = () => {
    if (timer.current) clearTimeout(timer.current)
    const r = runRef.current
    runRef.current = null
    setPending(null)
    if (r) void r()
  }
  return {
    pending,
    left: pending ? Math.max(0, Math.ceil((pending.at + 10_000 - now) / 1000)) : 0,
    hidden: new Set(pending?.ids ?? []),
    schedule: (ids: string[], message: string, run: () => Promise<void>) => {
      if (runRef.current) finish() // one at a time: the earlier one goes now
      runRef.current = run
      setPending({ ids, message, run, at: Date.now() })
      timer.current = setTimeout(finish, 10_000)
    },
    cancel: () => { if (timer.current) clearTimeout(timer.current); runRef.current = null; setPending(null) },
  }
}

function PersonRow({ p, checked = false, onCheck }: { p: RolePerson; checked?: boolean; onCheck?: (on: boolean) => void }) {
  const mail = emailState(p)
  const note = noteState(p)
  const step = nextStep(p)
  return (
    <li className="rounded-[4px] border border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {onCheck && <input type="checkbox" className="size-4 accent-accent" checked={checked} onChange={e => onCheck(e.target.checked)} aria-label={`Select ${p.name || p.email || 'this person'}`} />}
        <span className="min-w-0 flex-1 basis-40 text-[14px] text-fg">
          {p.linkedin_url ? <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{p.name || 'Someone'}</a> : <b className="font-medium">{p.name || 'Someone'}</b>}
          {p.title && <span className="text-muted">, {p.title}</span>}
        </span>
        <Badge tone={mail.tone}>{mail.text}</Badge>
        {note && <Badge tone={note.tone}>{note.text}</Badge>}
      </div>
      {p.email && <p className="truncate text-[12px] text-subtle">{p.email}</p>}
      {p.reply?.snippet && p.reply.kind !== 'bounce' && <p className="mt-1 text-[13px] leading-relaxed text-fg">“{p.reply.snippet}”</p>}
      {step && <p className="mt-1 text-[13px] text-warning">{step}</p>}
    </li>
  )
}

function ApplySection({ c, d }: { c: DashboardRole; d: RoleCardData }) {
  const toast = useToast()
  const refresh = useCardRefresh(c.id)
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const applied = useMutation({
    mutationFn: () => api.markRoleApplied(c.id),
    onSuccess: () => { toast.success(`${c.company} marked applied.`); refresh(); void qc.invalidateQueries({ queryKey: qk.ready }) },
    onError: (e: Error) => toast.error(e.message),
  })
  async function openFill() {
    setBusy(true)
    try {
      const link = await api.fillLink(c.id)
      if (!hasFiller()) {
        window.open(link.url, '_blank', 'noopener')
        toast.error('The filler extension isn’t installed, so the form opened empty. Install it from To apply → Ready to submit.')
        return
      }
      const r = await askFiller('open', { token: link.token, url: link.url, api: apiOrigin(API) })
      if (!r.ok) toast.error(r.error || 'Couldn’t open it.')
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const done = c.chip === 'Applied' || c.chip === 'Closed'
  return (
    <section aria-label="Apply">
      <H>Apply</H>
      {done ? <p className="text-[13px] text-muted">{c.chip === 'Applied' ? 'Applied.' : `Closed${c.closed_reason ? ` (${c.closed_reason.replace(/_/g, ' ')})` : ''}.`}</p> : d.submit ? (
        <>
          {d.submit.posting_closed && <p className="mb-2 text-[13px] text-danger">The job board says this posting is closed.</p>}
          <div className="flex flex-wrap gap-2">
            {d.submit.kind === 'fill'
              ? <Button size="sm" variant="primary" loading={busy} icon={<ExternalLink className="size-3.5" />} onClick={() => void openFill()}>Open and fill</Button>
              : <a href={d.submit.open_url} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'sm', 'gap-1.5')}><ExternalLink className="size-3.5" /> Apply on LinkedIn</a>}
            <Button size="sm" loading={applied.isPending} onClick={() => applied.mutate()}>I applied</Button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-2 text-[13px] text-muted">{c.status === 'approved' ? (d.role.stage_note || 'It applies on its own after the referral wait.') : 'Approve the resume first; applying comes after.'}</p>
          {c.status !== 'queued' && <Button size="sm" loading={applied.isPending} onClick={() => applied.mutate()}>I applied</Button>}
        </>
      )}
      {!done && d.needs.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[13px] font-medium text-warning">Needs you</p>
          {d.needs.map(n => <AnswerRow key={n.question} roleId={c.id} q={n.question} note={n.note} onDone={refresh} />)}
        </div>
      )}
    </section>
  )
}

function AnswerRow({ roleId, q, note, onDone }: { roleId: string; q: string; note: string | null; onDone: () => void }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const save = useMutation({
    mutationFn: () => api.answerQuestion(roleId, q, text.trim()),
    onSuccess: () => { toast.success('Saved. The filler uses it next time it opens the form.'); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-1">
      <label className="block text-[13px] text-fg">{q}{note && <span className="block text-[12px] text-subtle">{note}</span>}
        <Input value={text} onChange={e => setText(e.target.value)} className="mt-1 w-full" aria-label={q} />
      </label>
      <Button size="sm" disabled={!text.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save answer</Button>
    </div>
  )
}

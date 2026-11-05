import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Copy, ExternalLink } from 'lucide-react'
import { api, type OutreachDraft, type ReferralMode, type ReviewComment, type ReviewRole, type ResumeVersion } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Badge, Button, EmptyState, ErrorState, Field, Input, Page, Segmented, Select, Skeleton, Textarea, useToast, type Tone } from '@/ui'
import { PdfPages } from '@/features/profile/PdfViewer'
import { MODE_LABEL, NOTE_LIMIT, STATUS_LABEL, atsOk, readReport } from './review'

type Panel = 'report' | 'comments' | 'outreach' | 'apply'

const STATUS_TONE: Record<ReviewRole['role']['status'], Tone> = {
  queued: 'neutral', in_progress: 'info', ready: 'accent', revision_requested: 'warning', approved: 'success', applied: 'success', closed: 'neutral',
}
const box = 'rounded-[4px] border border-line bg-surface p-4'
const heading = 'mb-2 text-[13px] font-medium text-fg'

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <section>
      <h3 className={heading}>{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-muted">{items.map(i => <li key={i}>{i}</li>)}</ul>
    </section>
  )
}

function Score({ label, before, after, note, good }: { label: string; before: number | null; after: number | null; note: string | null; good?: boolean }) {
  return (
    <div className="min-w-0 flex-1 basis-56">
      <p className="text-[12px] font-medium tracking-wide text-subtle uppercase">{label}</p>
      <p className="mt-0.5 font-mono text-[20px] text-fg">
        {before != null && <span className="text-[14px] text-subtle">{before}% → </span>}
        <span className={good === undefined ? undefined : good ? 'text-success' : 'text-warning'}>{after == null ? 'Not estimated' : `${after}%`}</span>
      </p>
      {note && <p className="mt-1 text-[13px] leading-relaxed text-muted">{note}</p>}
    </div>
  )
}

function ReportPanel({ v }: { v: ResumeVersion }) {
  const r = readReport(v.report)
  return (
    <div className="space-y-5">
      {r.eligibility && <p className="rounded-[4px] bg-warning-soft px-3 py-2 text-[14px] text-fg"><b className="font-medium">Check eligibility:</b> {r.eligibility}</p>}
      <div className="flex flex-wrap gap-4">
        <Score label="ATS" before={v.ats_before} after={v.ats_after} note={r.atsReason} good={atsOk(v.ats_after)} />
        <Score label="Callback" before={v.callback_before} after={v.callback_after} note={r.callbackReason} />
      </div>
      {r.verdict && <section><h3 className={heading}>Verdict</h3><p className="text-[14px] text-muted">{r.verdict}</p></section>}
      <List title="Top 5 hiring needs" items={r.needs} />
      {r.keywords.length > 0 && (
        <section>
          <h3 className={heading}>Keywords</h3>
          {v.keywords && v.keywords.missing.length > 0 && (
            <p className="mb-2 text-[13px] text-muted">{v.keywords.found} of {v.keywords.total} are in the PDF word for word. Not found: {v.keywords.missing.join(', ')}.</p>
          )}
          <div className="overflow-x-auto rounded-[4px] border border-line">
            <table className="w-full border-collapse text-[13px] text-fg">
              <tbody>
                {r.keywords.map(k => (
                  <tr key={k.keyword}>
                    <td className="border-b border-line px-3 py-1.5 font-medium">{k.keyword}</td>
                    <td className="border-b border-line px-3 py-1.5 text-muted">{k.where ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <List title="Gaps" items={r.gaps} />
      <List title="Changes made" items={r.changes} />
      {r.nextChange && <section><h3 className={heading}>One more change that would help</h3><p className="text-[14px] leading-relaxed text-muted">{r.nextChange}</p></section>}
      {r.posting && <section><h3 className={heading}>Posting check</h3><p className="text-[14px] leading-relaxed text-muted">{r.posting}</p></section>}
    </div>
  )
}

function commentState(c: ReviewComment, status: ReviewRole['role']['status']) {
  if (c.status === 'addressed') return c.addressed_in_version ? `Answered in v${c.addressed_in_version}` : 'Answered'
  return status === 'in_progress' ? 'A run is working on this' : 'Waiting for the next run'
}

function CommentsPanel({ data, onDone }: { data: ReviewRole; onDone: () => void }) {
  const toast = useToast()
  const [body, setBody] = useState('')
  const canRevise = ['ready', 'revision_requested', 'approved'].includes(data.role.status) && data.versions.length > 0
  const send = useMutation({
    mutationFn: () => api.requestRevision(data.role.id, body),
    onSuccess: () => { setBody(''); toast.success('The next run will write a new version.'); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-4">
      {data.comments.length === 0 && <p className="text-[14px] text-muted">No comments yet. Say what should change and the next run writes a new version with a change log.</p>}
      {data.comments.map(c => (
        <article key={c.id} className="border-b border-line pb-3">
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-fg">{c.body}</p>
          <p className="mt-1 text-[12px] text-subtle">{commentState(c, data.role.status)}</p>
        </article>
      ))}
      {canRevise ? (
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); send.mutate() }}>
          <Field label="What should change?">
            {p => <Textarea {...p} value={body} onChange={e => setBody(e.target.value)} rows={4} />}
          </Field>
          <Button type="submit" variant="primary" loading={send.isPending} disabled={!body.trim()}>Request revision</Button>
        </form>
      ) : <p className="text-[13px] text-subtle">This role can’t take a revision while it’s {STATUS_LABEL[data.role.status].toLowerCase()}.</p>}
    </div>
  )
}

function DraftCard({ d, onDone }: { d: OutreachDraft; onDone: () => void }) {
  const toast = useToast()
  const [subject, setSubject] = useState(d.email_subject ?? '')
  const [body, setBody] = useState(d.email_body ?? '')
  const [note, setNote] = useState(d.linkedin_note ?? '')
  const changed = subject !== (d.email_subject ?? '') || body !== (d.email_body ?? '') || note !== (d.linkedin_note ?? '')
  const over = note.length > NOTE_LIMIT
  const save = useMutation({
    mutationFn: () => api.saveOutreachDraft(d.id, { email_subject: subject, email_body: body, linkedin_note: note }),
    onSuccess: () => { toast.success('Saved.'); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  const copy = () => { void navigator.clipboard.writeText(note).then(() => toast.success('Note copied.'), () => toast.error('Couldn’t copy that.')) }
  return (
    <article className={cn(box, 'space-y-3')}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-fg">{d.name ?? 'Unknown contact'}</p>
          <p className="text-[13px] text-muted">{d.title ?? d.audience}{d.email ? ` · ${d.email}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={d.audience === 'engineer' ? 'info' : 'neutral'}>{d.audience === 'engineer' ? 'Engineer' : 'Recruiter'}</Badge>
          {d.status === 'edited' && <Badge tone="accent">Edited</Badge>}
        </div>
      </header>
      {d.email_body !== null || d.email ? (
        <>
          <Field label="Subject">{p => <Input {...p} value={subject} onChange={e => setSubject(e.target.value)} />}</Field>
          <Field label="Email">{p => <Textarea {...p} value={body} onChange={e => setBody(e.target.value)} rows={10} />}</Field>
        </>
      ) : <p className="text-[13px] text-subtle">No email address, so this person gets the LinkedIn note only.</p>}
      <Field label="LinkedIn note" error={over ? `${note.length - NOTE_LIMIT} over the limit` : null} hint={<span className={cn('font-mono', over && 'text-danger')}>{note.length}/{NOTE_LIMIT}</span>}>
        {p => <Textarea {...p} value={note} onChange={e => setNote(e.target.value)} rows={4} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={save.isPending} disabled={!changed || over} onClick={() => save.mutate()}>Save</Button>
        <Button variant="ghost" icon={<Copy className="size-4" />} disabled={!note} onClick={copy}>Copy note</Button>
        {d.linkedin_url && <a href={d.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-center text-[13px] text-accent hover:underline">LinkedIn profile <ExternalLink className="size-3.5" /></a>}
      </div>
    </article>
  )
}

function ModeSelect({ data, onDone }: { data: ReviewRole; onDone: () => void }) {
  const toast = useToast()
  const set = useMutation({
    mutationFn: (mode: ReferralMode) => api.setReferralMode(data.role.id, mode),
    onSuccess: () => { toast.success('Referral mode saved.'); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Field label="Referral mode" hint="The best 2 recruiters by default. Recruiters and engineers adds 1 engineer. Applies from the next run.">
      {p => (
        <Select {...p} value={data.role.referral_mode} disabled={set.isPending} onChange={e => set.mutate(e.target.value as ReferralMode)}>
          {(Object.keys(MODE_LABEL) as ReferralMode[]).map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </Select>
      )}
    </Field>
  )
}

function ApplyPanel({ data, latest, onDone }: { data: ReviewRole; latest: ResumeVersion | undefined; onDone: () => void }) {
  const toast = useToast()
  const approve = useMutation({
    mutationFn: () => api.approveRole(data.role.id),
    onSuccess: () => { toast.success('Approved.'); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  const passed = latest?.check_status === 'passed'
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
        <dt className="text-subtle">Status</dt><dd className="text-fg">{STATUS_LABEL[data.role.status]}</dd>
        <dt className="text-subtle">Referral mode</dt><dd className="text-fg">{MODE_LABEL[data.role.referral_mode]}</dd>
        <dt className="text-subtle">Resume</dt><dd className="text-fg">{latest ? `v${latest.version}${latest.is_final ? ' (final)' : ''}` : 'Not written yet'}</dd>
      </dl>
      {latest && !atsOk(latest.ats_after) && <p className="text-[14px] text-warning">ATS is {latest.ats_after ?? '?'}%, under your 90% rule. You can still approve it.</p>}
      {latest && !passed && <p className="text-[14px] text-danger">This version hasn’t passed its checks, so it can’t be approved.</p>}
      {data.role.status === 'ready' && <Button variant="primary" loading={approve.isPending} disabled={!passed} onClick={() => approve.mutate()}>Approve</Button>}
      <p className="text-[13px] leading-relaxed text-subtle">Approving saves this version as final. Gmail drafts and applying aren’t connected to this queue yet, so nothing is sent or submitted from here.</p>
    </div>
  )
}

function ResumePanel({ versions, current, onPick }: { versions: ResumeVersion[]; current: ResumeVersion; onPick: (id: string) => void }) {
  const load = useCallback(() => api.reviewPdf(current.id), [current.id])
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={current.id} onChange={e => onPick(e.target.value)} aria-label="Resume version" className="w-auto!">
          {versions.map((v, i) => <option key={v.id} value={v.id}>v{v.version}{i === 0 ? ' (latest)' : ''}{v.is_final ? ' · final' : ''}</option>)}
        </Select>
        {current.check_status === 'passed' && <Badge tone="success">Passed checks</Badge>}
        {current.check_status === 'flagged' && <Badge tone="danger">Failed a check</Badge>}
        {current.check_status === null && <Badge tone="info">Checking</Badge>}
      </div>
      {current.check_errors.length > 0 && (
        <ul className="list-disc rounded-[4px] bg-danger-soft py-2 pr-3 pl-7 text-[14px] text-fg">{current.check_errors.map(e => <li key={e}>{e}</li>)}</ul>
      )}
      {current.change_log && (
        <section className={box}>
          <h3 className={heading}>What changed</h3>
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-muted">{current.change_log}</p>
        </section>
      )}
      {current.has_pdf
        ? <div className="rounded-[4px] border border-line bg-raised p-2"><PdfPages key={current.id} fileId={`version-${current.id}`} filename={`Resume v${current.version}`} load={load} /></div>
        : <EmptyState title={current.check_status ? 'This version didn’t compile' : 'Building the PDF'} description={current.check_status ? 'Ask for a revision and the next run will fix it.' : 'New resumes are compiled every 2 minutes.'} />}
    </div>
  )
}

/** One role: the resume on the left, everything about it on the right. */
export default function RolePage() {
  const id = useParams().id ?? ''
  const qc = useQueryClient()
  const role = useQuery({ queryKey: qk.reviewRole(id), queryFn: () => api.reviewRole(id), enabled: id !== '' })
  const [picked, setPicked] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('report')
  const refresh = () => { void qc.invalidateQueries({ queryKey: qk.review }) }

  if (role.error) return <Page wide><ErrorState error={role.error} onRetry={() => void role.refetch()} /></Page>
  if (role.isLoading || !role.data) return <Page wide><Skeleton className="h-72" /></Page>
  const d = role.data
  const latest = d.versions[0]
  const current = d.versions.find(v => v.id === picked) ?? latest
  const openComments = d.comments.filter(c => c.status === 'open').length
  const panels = [
    { value: 'report' as const, label: 'Report' },
    { value: 'comments' as const, label: openComments ? `Comments · ${openComments}` : 'Comments' },
    { value: 'outreach' as const, label: d.outreach.length ? `Outreach · ${d.outreach.length}` : 'Outreach' },
    { value: 'apply' as const, label: 'Apply' },
  ]

  return (
    <Page wide>
      <Link to="/review" className="mb-4 inline-flex items-center gap-1 text-[14px] text-muted hover:text-fg"><ArrowLeft className="size-4" /> Review queue</Link>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[30px] leading-tight text-fg">{d.role.company_name}</h1>
          <Badge tone={STATUS_TONE[d.role.status]}>{STATUS_LABEL[d.role.status]}</Badge>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[15px] text-muted">
          <span>{d.role.title}</span>
          {d.role.location && <span className="text-[13px]">{d.role.location}</span>}
          {d.role.apply_url && <a href={d.role.apply_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">Job posting <ExternalLink className="size-3.5" /></a>}
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          {current ? <ResumePanel versions={d.versions} current={current} onPick={setPicked} /> : <EmptyState title="No resume yet" description="It shows up here once a run writes it." />}
        </div>
        <div className="min-w-0">
          <div className="mb-4 max-w-full overflow-x-auto"><Segmented value={panel} onChange={setPanel} options={panels} label="Section" /></div>
          {panel === 'report' && (current ? <ReportPanel v={current} /> : <p className="text-[14px] text-muted">The report comes with the resume.</p>)}
          {panel === 'comments' && <CommentsPanel data={d} onDone={refresh} />}
          {panel === 'outreach' && (
            <div className="space-y-4">
              <ModeSelect data={d} onDone={refresh} />
              {d.outreach.length === 0 && <p className="text-[14px] text-muted">No outreach for this role. Either no recruiters were found or the mode doesn’t send any.</p>}
              {d.outreach.map(o => <DraftCard key={o.id} d={o} onDone={refresh} />)}
              {d.outreach.length > 0 && <p className="text-[13px] text-subtle">Runs never rewrite these, so your edits stay. Nothing is emailed until Gmail drafts are connected and you approve.</p>}
            </div>
          )}
          {panel === 'apply' && <ApplyPanel data={d} latest={latest} onDone={refresh} />}
        </div>
      </div>
    </Page>
  )
}

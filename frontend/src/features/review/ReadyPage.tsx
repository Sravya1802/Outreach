import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, X } from 'lucide-react'
import { API } from '@/api.js'
import { api, type ReadyRole } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Page, PageHeader, Skeleton, useToast } from '@/ui'
import { answersLine, apiOrigin, askFiller, closesLabel, daysLeft, fillLine, fillerVersion, hasFiller } from './ready'

/** The extension marks the page at load; check again in case it was just installed. */
function useFiller() {
  const [on, setOn] = useState(hasFiller)
  useEffect(() => {
    const t = setInterval(() => setOn(hasFiller()), 2000)
    return () => clearInterval(t)
  }, [])
  return on
}

function Deadline({ deadline }: { deadline: string | null }) {
  const label = closesLabel(deadline)
  if (!label) return null
  const n = daysLeft(deadline) ?? 99
  return <Badge tone={n < 0 ? 'neutral' : n <= 3 ? 'danger' : n <= 7 ? 'warning' : 'neutral'}>{label}</Badge>
}

function RoleHead({ r }: { r: ReadyRole }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/review/${r.id}`} className="text-[15px] font-medium text-fg hover:underline">{r.company}</Link>
        <Deadline deadline={r.deadline} />
      </div>
      <p className="text-[14px] text-muted">{r.title}{r.location ? ` · ${r.location}` : ''}</p>
    </div>
  )
}

function Applied({ r }: { r: ReadyRole }) {
  const qc = useQueryClient()
  const toast = useToast()
  const done = useMutation({
    mutationFn: () => api.markRoleApplied(r.id),
    onSuccess: () => { toast.success(`${r.company} marked applied.`); qc.invalidateQueries({ queryKey: qk.ready }); qc.invalidateQueries({ queryKey: qk.review }) },
    onError: (e: Error) => toast.error(e.message),
  })
  return <Button size="sm" loading={done.isPending} onClick={() => done.mutate()}>I applied</Button>
}

/** Out of this list and To apply, to Closed in the Review queue, where Restore brings it back. Never deleted. */
function Remove({ r }: { r: ReadyRole }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [asking, setAsking] = useState(false)
  const remove = useMutation({
    mutationFn: () => api.removeRole(r.id),
    onSuccess: ({ emailsWaiting = 0 }) => {
      const mail = emailsWaiting === 1 ? '1 email for it is' : `${emailsWaiting} emails for it are`
      toast.success(`Removed ${r.company}. It’s under Closed in the Review queue.${emailsWaiting ? ` ${mail} still in Outbox; cancel them there if you don’t want them sent.` : ''}`)
      qc.invalidateQueries({ queryKey: qk.ready }); qc.invalidateQueries({ queryKey: qk.review })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <>
      <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => setAsking(true)} icon={<X className="size-3.5" />}>Remove</Button>
      <ConfirmDialog
        open={asking}
        title={`Remove ${r.company}?`}
        description="It leaves this list and To apply, and goes to Closed in the Review queue, where Restore brings it back for review. Emails already in Outbox for it stay there for you to cancel or send."
        confirmLabel="Remove"
        onConfirm={() => { setAsking(false); remove.mutate() }}
        onCancel={() => setAsking(false)}
      />
    </>
  )
}

function FillRow({ r }: { r: ReadyRole }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const line = fillLine(r)
  async function open() {
    setBusy(true)
    try {
      const link = await api.fillLink(r.id)
      if (!hasFiller()) {
        window.open(link.url, '_blank', 'noopener')
        toast.error('The filler extension isn’t installed, so the form opened empty. Install it (above) and press Open again.')
        return
      }
      const r2 = await askFiller('open', { token: link.token, url: link.url, api: apiOrigin(API) })
      if (!r2.ok) toast.error(r2.error || 'Couldn’t open it.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-4">
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <RoleHead r={r} />
        {r.posting_closed && <p className="text-[13px] text-danger">The job board says this posting is closed (checked last night), so the morning run skips it. Remove it, or press I applied if you already did.</p>}
        {answersLine(r) && <p className="text-[13px] text-subtle">{answersLine(r)}</p>}
        {line && <p className="text-[13px] text-subtle">{line}</p>}
        {r.unanswered.length > 0 && (
          <p className="text-[13px] text-warning">Needs you: {r.unanswered.slice(0, 4).join(' · ')}{r.unanswered.length > 4 ? ` and ${r.unanswered.length - 4} more` : ''}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={open} icon={<ExternalLink className="size-3.5" />}>Open</Button>
        <Applied r={r} />
        <Remove r={r} />
      </div>
    </li>
  )
}

function LinkedInRow({ r }: { r: ReadyRole }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-4">
      <div className="min-w-0 flex-1 basis-64"><RoleHead r={r} /></div>
      <div className="flex shrink-0 items-center gap-2">
        <a href={r.open_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong px-3 text-[13px] font-medium text-fg hover:bg-hover">
          <ExternalLink className="size-3.5" /> LinkedIn
        </a>
        <Link to={`/review/${r.id}`} className="inline-flex h-8 items-center rounded-[4px] px-3 text-[13px] font-medium text-muted hover:bg-hover hover:text-fg">Resume</Link>
        <Applied r={r} />
        <Remove r={r} />
      </div>
    </li>
  )
}

/** The morning auto-open: on or off, when it last ran, and Open all now. */
function Morning({ count }: { count: number }) {
  const toast = useToast()
  const [state, setState] = useState<{ daily: boolean; lastDaily: string | null; lastDailyResult: { opened: number; errors: string[] } | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const pair = async (daily?: boolean) => {
    const { key } = await api.extensionKey()
    const r = await askFiller<{ daily: boolean; lastDaily: string | null; lastDailyResult: { opened: number; errors: string[] } | null }>('pair', { key, api: apiOrigin(API), ...(daily == null ? {} : { daily }) })
    if (r.ok && r.result) setState(r.result)
    return r
  }
  useEffect(() => { void pair().catch(() => {}) }, [])
  async function openAll() {
    setBusy(true)
    try {
      const r = await askFiller<{ opened: number; errors?: string[] }>('daily-now', {})
      if (!r.ok) toast.error(r.error || 'Couldn’t open them.')
      else toast.success(`Opened ${r.result?.opened ?? 0} in a new window. Each one fills as it loads.${r.result?.errors?.length ? ` Couldn’t open: ${r.result.errors.join('; ')}` : ''}`)
    } finally { setBusy(false) }
  }
  if (!state) return null
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-surface p-4 text-[14px]">
      <p className="min-w-0 flex-1 basis-72 text-muted">
        {state.daily
          ? <>Every morning, the first time Chrome starts (or at 7 AM if it’s open), the filler opens {count === 1 ? 'this role' : `these ${count} roles`} in one window and fills each with your profile, prepared answers and tailored resume.</>
          : <>Morning auto-open is off. Open fills one role at a time.</>}
        {state.lastDaily && <span className="text-subtle"> Last opened {state.lastDaily}{state.lastDailyResult ? ` (${state.lastDailyResult.opened})` : ''}.</span>}
      </p>
      <span className="flex gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={!count} onClick={() => void openAll()}>Open all now</Button>
        <Button size="sm" variant="ghost" onClick={() => void pair(!state.daily)}>{state.daily ? 'Turn off mornings' : 'Turn on mornings'}</Button>
      </span>
    </div>
  )
}

function Install({ update = false }: { update?: boolean }) {
  return (
    <div className="mb-6 rounded-[6px] border border-line bg-surface p-4 text-[14px] leading-relaxed">
      <p className="font-medium text-fg">{update ? 'Update the Scout’n’Jobs filler (a new version fills Ashby’s Yes/No questions, forms inside frames, and opens your roles each morning)' : 'Install the Scout’n’Jobs filler once (Chrome)'}</p>
      {update && <p className="mt-1 text-muted">Download it again, unzip it over the old folder, then press the reload arrow on the filler’s card in chrome://extensions.</p>}
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
        <li><a href="/scoutnjobs-filler.zip" download className="inline-flex items-center gap-1 text-accent hover:underline"><Download className="size-3.5" /> Download the extension</a> and unzip it.</li>
        <li>Open <code className="text-fg">chrome://extensions</code> and turn on Developer mode (top right).</li>
        <li>Press Load unpacked and choose the unzipped <code className="text-fg">scoutnjobs-filler</code> folder.</li>
        <li>Reload this page. From then on, each morning when Chrome starts it opens these roles and fills them; Open fills one now.</li>
      </ol>
    </div>
  )
}

export default function ReadyPage() {
  const q = useQuery({ queryKey: qk.ready, queryFn: api.readyToSubmit, refetchInterval: 60_000 })
  const filler = useFiller()
  const roles = q.data?.roles ?? []
  const fill = roles.filter(r => r.kind === 'fill')
  const linkedin = roles.filter(r => r.kind === 'linkedin')
  return (
    <Page>
      <PageHeader
        title="Ready to submit"
        description="Approved roles the app couldn’t send for you. Open fills the form with your profile, saved answers and the role’s tailored resume. You do the CAPTCHA and press Submit; the role is marked applied when the confirmation page shows, or press I applied."
      />
      {(!filler || fillerVersion() === '1.0.0') && <Install update={filler} />}
      {filler && fillerVersion() !== '1.0.0' && <Morning count={fill.filter(r => !r.posting_closed).length} />}
      {q.isLoading && <Skeleton className="h-40" />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && !roles.length && <EmptyState title="Nothing waiting" description="Approved roles the app can’t submit on its own show up here, closing soonest first." />}
      {fill.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-[16px] font-medium text-fg">Fill and submit ({fill.length})</h2>
          <ul>{fill.map(r => <FillRow key={r.id} r={r} />)}</ul>
        </section>
      )}
      {linkedin.length > 0 && (
        <section>
          <h2 className="mb-1 text-[16px] font-medium text-fg">Apply on LinkedIn by hand ({linkedin.length})</h2>
          <p className="text-[13px] text-subtle">LinkedIn is never automated, and these companies have no job board the app can find. Download the resume from the role, apply on LinkedIn, then press I applied.</p>
          <ul>{linkedin.map(r => <LinkedInRow key={r.id} r={r} />)}</ul>
        </section>
      )}
    </Page>
  )
}

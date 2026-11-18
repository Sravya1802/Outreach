import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink } from 'lucide-react'
import { API } from '@/api.js'
import { api, type ReadyRole } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { Badge, Button, EmptyState, ErrorState, Page, PageHeader, Skeleton, useToast } from '@/ui'
import { apiOrigin, closesLabel, daysLeft, fillLine, hasFiller } from './ready'

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
      const id = `${r.id}-${Date.now()}`
      const answer = new Promise<{ ok: boolean; error?: string }>((ok) => {
        const on = (e: MessageEvent) => {
          if (e.source !== window || e.data?.source !== 'snj-ext' || e.data.id !== id) return
          window.removeEventListener('message', on)
          ok(e.data)
        }
        window.addEventListener('message', on)
        setTimeout(() => { window.removeEventListener('message', on); ok({ ok: false, error: 'The extension didn’t answer. Reload this page and try again.' }) }, 20_000)
      })
      window.postMessage({ source: 'snj-app', type: 'open', id, token: link.token, url: link.url, api: apiOrigin(API) }, window.location.origin)
      const r2 = await answer
      if (!r2.ok) toast.error(r2.error || 'Couldn’t open it.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-4">
      <div className="min-w-0 flex-1 space-y-1">
        <RoleHead r={r} />
        {line && <p className="text-[13px] text-subtle">{line}</p>}
        {r.unanswered.length > 0 && (
          <p className="text-[13px] text-warning">Needs you: {r.unanswered.slice(0, 4).join(' · ')}{r.unanswered.length > 4 ? ` and ${r.unanswered.length - 4} more` : ''}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={open} icon={<ExternalLink className="size-3.5" />}>Open</Button>
        <Applied r={r} />
      </div>
    </li>
  )
}

function LinkedInRow({ r }: { r: ReadyRole }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-4">
      <div className="min-w-0 flex-1"><RoleHead r={r} /></div>
      <div className="flex shrink-0 items-center gap-2">
        <a href={r.open_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong px-3 text-[13px] font-medium text-fg hover:bg-hover">
          <ExternalLink className="size-3.5" /> LinkedIn
        </a>
        <Link to={`/review/${r.id}`} className="inline-flex h-8 items-center rounded-[4px] px-3 text-[13px] font-medium text-muted hover:bg-hover hover:text-fg">Resume</Link>
        <Applied r={r} />
      </div>
    </li>
  )
}

function Install() {
  return (
    <div className="mb-6 rounded-[6px] border border-line bg-surface p-4 text-[14px] leading-relaxed">
      <p className="font-medium text-fg">Install the Scout’n’Jobs filler once (Chrome)</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
        <li><a href="/scoutnjobs-filler.zip" download className="inline-flex items-center gap-1 text-accent hover:underline"><Download className="size-3.5" /> Download the extension</a> and unzip it.</li>
        <li>Open <code className="text-fg">chrome://extensions</code> and turn on Developer mode (top right).</li>
        <li>Press Load unpacked and choose the unzipped <code className="text-fg">scoutnjobs-filler</code> folder.</li>
        <li>Reload this page. Open then fills each form in your own browser.</li>
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
      {!filler && <Install />}
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

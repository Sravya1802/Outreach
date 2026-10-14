import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Lock } from 'lucide-react'
import { api, type EvaluationSummary } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { useNightlySettings } from '@/app/queries'
import { Button, ErrorState, Field, Input, Page, PageHeader, Skeleton, useToast } from '@/ui'
import { scoreOutOf10 } from './score'
import { Tracker } from './Tracker'

const WAITING = ['needs_review', 'captcha_needed', 'login_needed']
const QUEUED = ['queued', 'in_progress']
const FAILED = ['submit_failed', 'platform_unsupported']

const REASON: Record<string, string> = {
  needs_review: 'The form asked something it couldn’t answer',
  captcha_needed: 'The form has a captcha',
  login_needed: 'The form needs you to log in',
  platform_unsupported: 'This job board isn’t supported yet',
  submit_failed: 'Submitting failed',
}

function Row({ r, right }: { r: EvaluationSummary; right?: ReactNode }) {
  const s = scoreOutOf10(r.score)
  return (
    <li className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line py-3">
      <span className="font-mono text-[15px] text-fg">{s ?? '—'}</span>
      <div className="min-w-0">
        <Link to={`/applications/evaluate?id=${r.id}`} className="hover:text-accent"><b className="font-medium text-fg">{r.company_name}</b> <span className="text-muted">· {r.job_title}</span></Link>
        {(REASON[r.apply_status ?? ''] || r.apply_error) && (
          <p className="text-[13px] text-subtle">{REASON[r.apply_status ?? ''] ?? ''}{r.apply_error ? ` · ${r.apply_error}` : ''}</p>
        )}
      </div>
      <div className="flex items-center gap-2 text-[13px] text-subtle">
        {right}
        {r.job_url && (
          <a href={r.job_url} target="_blank" rel="noreferrer" aria-label={`Open the ${r.company_name} posting`}
            className="grid size-8 place-items-center rounded-[4px] hover:bg-hover hover:text-fg"><ExternalLink className="size-4" /></a>
        )}
      </div>
    </li>
  )
}

function Section({ title, empty, items, right }: { title: string; empty: string; items: EvaluationSummary[]; right?: (r: EvaluationSummary) => ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1 font-display text-[22px] font-semibold text-fg">{title} <span className="font-sans text-[15px] font-normal text-subtle">· {items.length}</span></h2>
      {items.length === 0
        ? <p className="border-t border-rule py-4 text-[14px] text-subtle">{empty}</p>
        : <ul className="border-t border-rule">{items.map(r => <Row key={r.id} r={r} right={right?.(r)} />)}</ul>}
    </section>
  )
}

function Rules() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: settings, isLoading } = useNightlySettings()
  const [threshold, setThreshold] = useState<string | null>(null)
  const [perDay, setPerDay] = useState<string | null>(null)
  // Defaults follow the agreed rules: 9.0 and up, at most 15 a day.
  const t = threshold ?? (settings && settings.minScore !== 85 ? (settings.minScore / 10).toFixed(1) : '9.0')
  const d = perDay ?? (settings && settings.maxApps !== 50 ? String(settings.maxApps) : '15')
  const tNum = Number(t)
  const dNum = Number(d)
  const valid = tNum >= 5 && tNum <= 10 && Number.isInteger(dNum) && dNum >= 1 && dNum <= 50

  const save = useMutation({
    mutationFn: () => api.saveNightlySettings({ ...settings, enabled: false, minScore: Math.round(tNum * 10), maxApps: dNum }),
    onSuccess: s => { qc.setQueryData(qk.nightlySettings, s); setThreshold(null); setPerDay(null); toast.success('Saved') },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <section aria-labelledby="rules-h" className="rounded-[4px] border border-line bg-surface p-6">
      <h2 id="rules-h" className="font-display text-[22px] font-semibold text-fg">Your rules</h2>
      <div className="mt-4 grid gap-6 md:grid-cols-3">
        <div>
          <p className="font-mono text-[14px] text-success">{t} to 10</p>
          <p className="font-medium text-fg">Goes on the daily plan</p>
          <p className="text-[14px] text-muted">You get the list each morning; each one sends at its time unless you hold or remove it.</p>
        </div>
        <div>
          <p className="font-mono text-[14px] text-warning">7.0 to {(Math.max(7, tNum) - 0.1).toFixed(1)}</p>
          <p className="font-medium text-fg">Waits for one tap</p>
          <p className="text-[14px] text-muted">Listed for you to apply or skip.</p>
        </div>
        <div>
          <p className="font-mono text-[14px] text-subtle">below 7</p>
          <p className="font-medium text-fg">Left alone</p>
          <p className="text-[14px] text-muted">Still in Jobs if you want to look. Never applied to.</p>
        </div>
      </div>
      {isLoading ? <Skeleton className="mt-6 h-9 w-80" /> : (
        <form className="mt-6 flex flex-wrap items-end gap-4 border-t border-line pt-5" onSubmit={e => { e.preventDefault(); if (valid) save.mutate() }}>
          <div className="w-40"><Field label="Plan roles scoring at least">{f => <Input {...f} type="number" step="0.1" min={5} max={10} value={t} onChange={e => setThreshold(e.target.value)} />}</Field></div>
          <div className="w-40"><Field label="At most per day">{f => <Input {...f} type="number" min={1} max={50} value={d} onChange={e => setPerDay(e.target.value)} />}</Field></div>
          <Button type="submit" loading={save.isPending} disabled={!valid}>Save</Button>
          <p className="basis-full text-[13px] text-subtle">Also always on: one role per company every 30 days, roles that won’t sponsor are skipped, and anything with a question you haven’t answered stops and waits for you.</p>
        </form>
      )}
    </section>
  )
}

export default function AutoApplyPage() {
  const queue = useQuery({ queryKey: qk.autoApplyQueue, queryFn: api.autoApplyItems })
  const items = queue.data?.items ?? []
  const of = (statuses: string[]) => items.filter(r => statuses.includes(r.apply_status ?? ''))
  const { hash } = useLocation()

  // Links to #tracker (Home, old Pipeline URLs) land on the tracker once the page has laid out.
  useEffect(() => {
    if (hash !== '#tracker' || queue.isLoading) return
    document.getElementById('tracker')?.scrollIntoView({ block: 'start' })
  }, [hash, queue.isLoading])

  return (
    <Page wide>
      <PageHeader title="Auto-apply" description="Roles that fit you get applied to with a resume tailored to each one, but only after you’ve seen the day’s list. Everything sent is tracked at the bottom until you hear back." />

      <div className="mb-8 flex items-start gap-3 rounded-[4px] border border-line bg-surface px-5 py-4 text-[14px]">
        <Lock className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
        <p className="text-muted">
          <b className="font-medium text-fg">Automatic applying is off.</b> It turns on with the daily plan, which sends you the morning list first.
          Until then, set your rules below, and make sure <Link to="/profile/details" className="text-accent hover:underline">your details</Link>,{' '}
          <Link to="/profile/resume" className="text-accent hover:underline">resume</Link> and{' '}
          <Link to="/profile/answers" className="text-accent hover:underline">answers</Link> are filled in.
        </p>
      </div>

      <div className="space-y-10">
        <Rules />
        {queue.error ? <ErrorState error={queue.error} onRetry={() => queue.refetch()} /> : queue.isLoading ? <Skeleton className="h-40" /> : (
          <>
            <Section title="Waiting on you" empty="Nothing needs you." items={of(WAITING)} />
            <Section title="In the queue" empty="Nothing queued." items={of(QUEUED)} />
            {of(FAILED).length > 0 && <Section title="Couldn’t apply" empty="" items={of(FAILED)} />}
          </>
        )}
        <Tracker />
      </div>
    </Page>
  )
}

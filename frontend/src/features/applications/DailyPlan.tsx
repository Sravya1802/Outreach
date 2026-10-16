import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, X } from 'lucide-react'
import { api, type DailyPlanOverview, type DailyPlanSettings, type PlanItem } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge, Button, ButtonLink, ErrorState, Field, Input, Select, Skeleton, Spinner, useToast } from '@/ui'
import { SPONSOR_TEXT, STAGE_LABEL, TIMEZONES, hourLabel, num, tzLabel } from './plan'
import { useDailyPlan } from './useDailyPlan'
import { ReferralPanel } from './Referrals'

const HOURS = [17, 18, 19, 20, 21, 22, 23]

/** On/off, list time, bar and daily cap. */
export function EveningListSettings({ data }: { data: DailyPlanOverview }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<Partial<DailyPlanSettings>>({})
  const s = { ...data.settings, ...draft }
  const dirty = Object.keys(draft).length > 0
  const save = useMutation({
    mutationFn: (patch: Partial<DailyPlanSettings>) => api.saveDailyPlanSettings(patch),
    onSuccess: (next) => {
      qc.setQueryData<DailyPlanOverview>(qk.dailyPlan, old => (old ? { ...old, settings: next } : old))
      setDraft({})
      toast.success(next.enabled ? `On. Your list arrives at ${hourLabel(next.listHour)} ${tzLabel(next.timezone)} time.` : 'Saved')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const set = (patch: Partial<DailyPlanSettings>) => setDraft(d => ({ ...d, ...patch }))

  return (
    <section aria-labelledby="evening-h" className="rounded-[4px] border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="evening-h" className="font-display text-[22px] font-semibold text-fg">Your evening list</h2>
          <p className="mt-1 max-w-2xl text-[14px] text-muted">
            Each evening the day’s new roles are scored against your resume. The best ones are emailed to you at {hourLabel(s.listHour)} {tzLabel(s.timezone)} time.
            Only the roles you approve go on. {s.referralFirst ? `For each one, we ask for a referral first and apply ${s.referralWaitDays} business days later if none comes.` : 'Each one is applied to the next morning.'}
            {!data.settings.enabled && ' Turning this on lets Scout’n’Jobs submit applications, with your tailored resume, for the roles you approve, and only those.'}
          </p>
        </div>
        <Button variant={s.enabled ? 'secondary' : 'primary'} loading={save.isPending && 'enabled' in (save.variables ?? {})}
          onClick={() => save.mutate({ ...draft, enabled: !data.settings.enabled })}>
          {data.settings.enabled ? 'Turn off' : 'Turn on'}
        </Button>
      </div>
      {data.settings.enabled && !data.gmailConnected && (
        <p className="mt-4 rounded-[4px] border border-warning/40 bg-warning-soft px-3 py-2 text-[14px] text-fg">
          Connect your Gmail so the list can be emailed to you. Until then, it shows up here. <Link to="/integrations/gmail" className="text-accent hover:underline">Connect Gmail</Link>
        </p>
      )}
      <form className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-[repeat(6,minmax(0,1fr))_auto] lg:items-end"
        onSubmit={e => { e.preventDefault(); save.mutate(draft) }}>
        <Field label="List arrives at">
          {f => <Select {...f} value={s.listHour} onChange={e => set({ listHour: Number(e.target.value) })}>{HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</Select>}
        </Field>
        <Field label="Your time zone">
          {f => <Select {...f} value={s.timezone} onChange={e => set({ timezone: e.target.value })}>{TIMEZONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>}
        </Field>
        <Field label="Score at least">
          {f => <Input {...f} type="number" min={5} max={10} step={0.1} value={s.minScore} onChange={e => set({ minScore: Number(e.target.value) })} />}
        </Field>
        <Field label="At least a day" hint="Filled with close matches (8+)">
          {f => <Input {...f} type="number" min={0} max={30} value={s.minPerDay} onChange={e => set({ minPerDay: Number(e.target.value) })} />}
        </Field>
        <Field label="At most a day">
          {f => <Input {...f} type="number" min={1} max={30} value={s.maxPerDay} onChange={e => set({ maxPerDay: Number(e.target.value) })} />}
        </Field>
        <Field label="Wait for a referral">
          {f => (
            <Select {...f} value={s.referralFirst ? s.referralWaitDays : -1} onChange={e => { const v = Number(e.target.value); set(v < 0 ? { referralFirst: false } : { referralFirst: true, referralWaitDays: v }) }}>
              <option value={-1}>Don’t ask, apply next morning</option>
              {[1, 2, 3, 5].map(d => <option key={d} value={d}>{d} business day{d > 1 ? 's' : ''}</option>)}
            </Select>
          )}
        </Field>
        <Button type="submit" disabled={!dirty} loading={save.isPending && !('enabled' in (save.variables ?? {}))}>Save</Button>
      </form>
    </section>
  )
}

/** "Company · Title", the title linking to the job posting. */
function PostingTitle({ company, title, url }: { company: string; title: string; url: string | null | undefined }) {
  const href = url && /^https?:\/\//i.test(url) ? url : null
  return (
    <>
      <b className="font-medium text-fg">{company}</b> <span className="text-muted">·</span>{' '}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title="Open the job posting" className="text-muted underline decoration-line underline-offset-[3px] hover:text-accent hover:decoration-accent">
          {title}<ExternalLink className="ml-1 inline size-3.5 align-[-2px]" aria-hidden />
        </a>
      ) : <span className="text-muted">{title}</span>}
    </>
  )
}

export function ItemRow({ item, busy, onDecide }: { item: PlanItem; busy: boolean; onDecide: (d: 'approved' | 'skipped' | 'pending') => void }) {
  const score = num(item.score)
  const sponsor = item.sponsorship ? SPONSOR_TEXT[item.sponsorship] : null
  return (
    <li className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-4 gap-y-2 border-b border-line py-4 sm:grid-cols-[52px_minmax(0,1fr)_auto]">
      <span className={cn('font-mono text-[18px]', score != null && score >= 9 ? 'text-success' : 'text-warning')}>{score?.toFixed(1) ?? '—'}</span>
      <div className="min-w-0">
        <p className="text-[15px]">
          <PostingTitle company={item.company_name} title={item.title} url={item.apply_url} />
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-subtle">
          {[item.location, item.pay].filter(Boolean).join(' · ')}
          {sponsor && <span className={sponsor.tone === 'success' ? 'text-success' : 'text-danger'}>{sponsor.text}</span>}
          {item.connections > 0 && <span className="text-accent">You know {item.connections} {item.connections === 1 ? 'person' : 'people'} here</span>}
        </p>
        {item.reason && <p className="mt-1 text-[14px] text-muted">{item.reason}</p>}
      </div>
      <div className="col-start-2 flex items-center gap-2 sm:col-start-3">
        {item.decision === 'pending' && (
          <>
            <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={busy} onClick={() => onDecide('approved')}>Approve</Button>
            <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} disabled={busy} onClick={() => onDecide('skipped')}>Skip</Button>
          </>
        )}
        {item.decision === 'approved' && (
          <>
            <Badge tone="success">Approved</Badge>
            {['tailoring', 'needs_you'].includes(item.stage) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide('pending')}>Undo</Button>}
          </>
        )}
        {item.decision === 'skipped' && (<><Badge tone="neutral">Skipped</Badge><Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide('pending')}>Undo</Button></>)}
        {item.decision === 'expired' && <Badge tone="neutral">Expired</Badge>}
      </div>
    </li>
  )
}

/** Tonight's list with Approve / Skip. */
export function TonightsList({ data }: { data: DailyPlanOverview }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [showWorth, setShowWorth] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.dailyPlan })
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: 'approved' | 'skipped' | 'pending' }) => api.decidePlanItem(id, decision),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  })
  const approveAll = useMutation({
    mutationFn: (planId: number) => api.approveAllPlan(planId),
    onSuccess: r => { toast.success(`Approved ${r.approved}. Resumes are being written.`); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const build = useMutation({
    mutationFn: () => api.buildDailyPlan(Boolean(data.plan)),
    onSuccess: () => { toast.success('Building today’s list. This takes a few minutes.'); refresh() },
    onError: (e: Error) => { toast.error(e.message); refresh() },
  })

  const plan = data.plan
  const top = data.items.filter(i => i.tier === 'top')
  const worth = data.items.filter(i => i.tier === 'worth')
  const pending = top.filter(i => i.decision === 'pending').length
  const day = plan ? new Date(`${String(plan.plan_date).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
  const busyId = decide.isPending ? decide.variables?.id : null

  return (
    <section aria-labelledby="tonight-h">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="tonight-h" className="font-display text-[22px] font-semibold text-fg">{plan ? `The list for ${day}` : 'Tonight’s list'}</h2>
          {plan?.status === 'ready' && (
            <p className="text-[13px] text-subtle">
              {plan.stats.considered ?? 0} new roles looked at · {plan.stats.scored ?? 0} scored · {plan.stats.excluded ?? 0} left out
              {plan.emailed_at ? ` · emailed ${timeAgo(plan.emailed_at)}` : ''}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {plan?.status === 'ready' && pending > 0 && <Button variant="primary" loading={approveAll.isPending} onClick={() => approveAll.mutate(plan.id)}>Approve all {pending}</Button>}
          {plan?.status !== 'building' && <Button variant="ghost" loading={build.isPending} onClick={() => build.mutate()}>{plan ? 'Rebuild today’s list' : 'Build today’s list now'}</Button>}
        </div>
      </div>

      {!plan ? (
        <p className="border-t border-rule py-4 text-[14px] text-muted">
          {data.settings.enabled
            ? `Your first list is built about an hour before ${hourLabel(data.settings.listHour)} and emailed at ${hourLabel(data.settings.listHour)}. You can also build it now.`
            : 'Turn on the evening list above, or build today’s list now to see what it would pick.'}
        </p>
      ) : plan.status === 'building' ? (
        <p className="flex items-center gap-2 border-t border-rule py-4 text-[14px] text-muted" role="status"><Spinner /> Reading and scoring today’s new roles. This takes a few minutes.</p>
      ) : plan.status === 'failed' ? (
        <p className="border-t border-rule py-4 text-[14px] text-danger">Building the list failed: {plan.error}</p>
      ) : top.length === 0 ? (
        <p className="border-t border-rule py-4 text-[14px] text-muted">Nothing scored {data.settings.minScore} or higher today.{worth.length ? ` ${worth.length} worth a look below.` : ''}</p>
      ) : (
        <ul className="border-t border-rule">{top.map(i => <ItemRow key={i.id} item={i} busy={busyId === i.id} onDecide={d => decide.mutate({ id: i.id, decision: d })} />)}</ul>
      )}

      {worth.length > 0 && (
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={() => setShowWorth(v => !v)}>{showWorth ? 'Hide' : 'Show'} {worth.length} worth a look (7.0 to {(data.settings.minScore - 0.1).toFixed(1)})</Button>
          {showWorth && <ul className="mt-2 border-t border-line">{worth.map(i => <ItemRow key={i.id} item={i} busy={busyId === i.id} onDecide={d => decide.mutate({ id: i.id, decision: d })} />)}</ul>}
        </div>
      )}
    </section>
  )
}

/** Approved roles and where each one is. */
export function InProgress({ data }: { data: DailyPlanOverview }) {
  if (!data.active.length) return null
  return (
    <section aria-labelledby="progress-h">
      <h2 id="progress-h" className="mb-1 font-display text-[22px] font-semibold text-fg">Approved roles <span className="font-sans text-[15px] font-normal text-subtle">· {data.active.length}</span></h2>
      <ul className="border-t border-rule">
        {data.active.map(a => (
          <li key={a.id} className="border-b border-line py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <div className="min-w-0 flex-1 basis-[260px]">
                <p className="text-[15px]">
                  <PostingTitle company={a.company_name} title={a.title} url={a.apply_url} />
                  {a.connections > 0 && <span className="ml-2 text-[13px] text-accent">You know {a.connections} here</span>}
                </p>
                <p className={cn('text-[13px]', a.stage === 'needs_you' ? 'text-danger' : 'text-subtle')}>
                  {(a.stage === 'tailoring' || a.stage === 'applying') && <Spinner size={12} className="mr-1.5 align-[-1px]" />}{a.stage_note || STAGE_LABEL[a.stage]}
                </p>
              </div>
              <Badge tone={a.stage === 'needs_you' ? 'danger' : a.stage === 'applied' || a.stage === 'referred' ? 'success' : 'accent'}>{STAGE_LABEL[a.stage]}</Badge>
              {a.evaluation_id && <ButtonLink to={`/applications/evaluate?id=${a.evaluation_id}`} size="sm" variant="ghost">{a.ats_score != null ? `Resume · ATS ${a.ats_score}%` : 'Open'}</ButtonLink>}
            </div>
            {['waiting_referral', 'needs_you', 'ready_to_apply'].includes(a.stage) && <ReferralPanel item={a} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function DailyPlanSections() {
  const q = useDailyPlan()
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (q.isLoading || !q.data) return <Skeleton className="h-64" />
  return (
    <div className="space-y-10">
      <EveningListSettings data={q.data} />
      <TonightsList data={q.data} />
      <InProgress data={q.data} />
    </div>
  )
}

import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, FileUp, X } from 'lucide-react'
import { api, type DailyPlanOverview, type DailyPlanSettings, type PlanItem, type PlanPick, type ApplyMode, type ReviewRow } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge, Button, ButtonLink, ErrorState, Field, Input, Select, Skeleton, Spinner, useToast } from '@/ui'
import { STATUS_LABEL } from '@/features/review/review'
import { SPONSOR_TEXT, STAGE_LABEL, TIMEZONES, groupRoles, hourLabel, num, placesLine, tzLabel, type RoleGroup } from './plan'
import { useDailyPlan } from './useDailyPlan'
import { ReferralPanel } from './Referrals'

const MORNING_HOURS = [5, 6, 7, 8, 9, 10, 11, 12]
const UPDATE_HOURS = [11, 12, 13, 14, 15, 16, 17, 18]
const EVENING_HOURS = [17, 18, 19, 20, 21, 22, 23]

/** On/off, the three times of day, and the referral wait. */
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
      toast.success(next.enabled ? `On. Today’s roles arrive at ${hourLabel(next.morningHour)} ${tzLabel(next.timezone)} time.` : 'Saved')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const set = (patch: Partial<DailyPlanSettings>) => setDraft(d => ({ ...d, ...patch }))

  return (
    <section aria-labelledby="evening-h" className="rounded-[4px] border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="evening-h" className="font-display text-[22px] font-semibold text-fg">Your daily roles</h2>
          <p className="mt-1 max-w-2xl text-[14px] text-muted">
            At {hourLabel(s.morningHour)} {tzLabel(s.timezone)} time the day’s new roles are scored against your resume and sent to you, with an update at {hourLabel(s.updateHour)}.
            Pick each one: <b className="font-medium text-fg">Add to queue</b> (the next Claude run writes the resume, and it waits in the Review queue for your approval) or <b className="font-medium text-fg">I’ll draft my own</b> (you get a reminder at {hourLabel(s.listHour)}).
            Roles you don’t pick cost nothing. {s.referralFirst ? `For each approved role, we ask for a referral first and apply ${s.referralWaitDays} business days later if none comes.` : 'Each approved role is applied to the next morning.'}
            {!data.settings.enabled && ' Turning this on lets Scout’n’Jobs submit applications for the roles you approve, and only those.'}
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
        <Field label="Roles arrive at">
          {f => <Select {...f} value={s.morningHour} onChange={e => set({ morningHour: Number(e.target.value) })}>{MORNING_HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</Select>}
        </Field>
        <Field label="Update at">
          {f => <Select {...f} value={s.updateHour} onChange={e => set({ updateHour: Number(e.target.value) })}>{UPDATE_HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</Select>}
        </Field>
        <Field label="Drafts ready by">
          {f => <Select {...f} value={s.listHour} onChange={e => set({ listHour: Number(e.target.value) })}>{EVENING_HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</Select>}
        </Field>
        <Field label="Your time zone">
          {f => <Select {...f} value={s.timezone} onChange={e => set({ timezone: e.target.value })}>{TIMEZONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>}
        </Field>
        <Field label="Top match from" hint="Marked as a top match">
          {f => <Input {...f} type="number" min={5} max={10} step={0.1} value={s.minScore} onChange={e => set({ minScore: Number(e.target.value) })} />}
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

/** "4 people found, 2 with email" → that company's people. */
function PeopleFound({ n, withEmail, companyId }: { n?: number; withEmail?: number; companyId?: number | null }) {
  if (!n) return null
  const text = `${n} ${n === 1 ? 'person' : 'people'} found${withEmail ? `, ${withEmail} with email` : ''}`
  return companyId
    ? <Link to={`/company/${companyId}`} className="text-accent hover:underline">{text}</Link>
    : <span className="text-accent">{text}</span>
}

/** Approve a role two ways: the app takes it to applying, or it stops for you to read the resume first. */
export function ApproveButtons({ busy, onApprove }: { busy: boolean; onApprove: (mode: ApplyMode) => void }) {
  return (
    <>
      <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={busy} onClick={() => onApprove('auto')}
        title="Approve: the app writes the resume, asks for a referral, and applies for you">Apply for me</Button>
      <Button size="sm" disabled={busy} onClick={() => onApprove('review')}
        title="Approve: the app writes the resume, then waits for you to read it and choose Send it or apply yourself">I’ll review</Button>
    </>
  )
}

type QueueMap = Map<string, ReviewRow>

/** Where each listed role stands in the Claude queue, by plan item id. */
function useQueueMap(): QueueMap {
  const q = useQuery({ queryKey: qk.review, queryFn: api.reviewQueue })
  return useMemo(() => new Map((q.data?.roles ?? []).map(r => [String(r.id), r])), [q.data])
}

function QueueBadge({ row }: { row: ReviewRow }) {
  return <Link to={`/review/${row.id}`}><Badge tone="info">{STATUS_LABEL[row.status]}{row.version != null ? ` · v${row.version}` : ''}</Badge></Link>
}

/** Ticks on a list of roles, and sending them to the queue or skipping them. Costs nothing: no resume is written here. */
function useBulk<T extends { id: number }>(groups: RoleGroup<T>[], queue: QueueMap) {
  const qc = useQueryClient()
  const toast = useToast()
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const open = groups.filter(g => !queue.has(String(g.item.id)))
  const chosen = open.filter(g => picked.has(g.item.id))
  const act = useMutation({
    mutationFn: async (action: 'queue' | 'skip') => {
      const others = chosen.flatMap(g => g.others.map(o => o.id))
      const main = chosen.map(g => g.item.id)
      // One resume per role: the other locations are set aside, whichever way it goes.
      const r = await api.bulkPlanItems(main, action)
      if (others.length) await api.bulkPlanItems(others, 'skip')
      return { action, changed: r.changed }
    },
    onSuccess: ({ action, changed }) => {
      toast.success(action === 'queue' ? `Added ${changed} to the queue. The next run writes them.` : `Skipped ${changed}.`)
      setPicked(new Set())
      void qc.invalidateQueries({ queryKey: qk.dailyPlan })
      void qc.invalidateQueries({ queryKey: qk.review })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return {
    open, chosen, act,
    isPicked: (id: number) => picked.has(id),
    toggle: (id: number, on: boolean) => setPicked(p => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n }),
    setAll: (on: boolean) => setPicked(on ? new Set(open.map(g => g.item.id)) : new Set()),
  }
}

function BulkBar<T extends { id: number }>({ bulk }: { bulk: ReturnType<typeof useBulk<T>> }) {
  if (!bulk.open.length) return null
  const n = bulk.chosen.length
  return (
    <div className="flex flex-wrap items-center gap-3 py-2">
      <label className="inline-flex items-center gap-2 text-[14px] text-fg">
        <input type="checkbox" className="size-4 accent-accent" checked={n === bulk.open.length} onChange={e => bulk.setAll(e.target.checked)} />
        Select all {bulk.open.length}
      </label>
      {n > 0 && (
        <>
          <Button size="sm" variant="primary" loading={bulk.act.isPending && bulk.act.variables === 'queue'} disabled={bulk.act.isPending} onClick={() => bulk.act.mutate('queue')}
            title="The next Claude run writes the resume and outreach. Nothing goes out without your approval.">Add {n} to the queue</Button>
          <Button size="sm" variant="ghost" loading={bulk.act.isPending && bulk.act.variables === 'skip'} disabled={bulk.act.isPending} onClick={() => bulk.act.mutate('skip')}>Skip {n}</Button>
        </>
      )}
    </div>
  )
}

/** One listed role's actions: pick, approve, undo, upload your own, I applied. Refreshes the list. */
function useItemActions() {
  const qc = useQueryClient()
  const toast = useToast()
  const refresh = () => { void qc.invalidateQueries({ queryKey: qk.dailyPlan }); void qc.invalidateQueries({ queryKey: qk.review }) }
  const fail = (e: Error) => toast.error(e.message)
  return {
    pick: useMutation({
      // A choice on a role covers it everywhere: its other locations are set aside.
      mutationFn: async ({ id, pick, others = [] }: { id: number; pick: PlanPick | 'skip' | 'none'; others?: number[] }) => {
        const r = await api.pickPlanItem(id, pick)
        if (pick !== 'none' && others.length) await api.bulkPlanItems(others, 'skip')
        return r
      },
      onSuccess: (_d, v) => { if (v.pick === 'app') toast.success('Added to the queue. The next run writes it for you to approve.'); refresh() },
      onError: fail,
    }),
    decide: useMutation({
      mutationFn: ({ id, decision, mode }: { id: number; decision: 'approved' | 'skipped' | 'pending'; mode?: ApplyMode }) => api.decidePlanItem(id, decision, mode),
      onSuccess: refresh,
      onError: fail,
    }),
    upload: useMutation({
      mutationFn: ({ id, file }: { id: number; file: File }) => api.ownResumeForPlanItem(id, file),
      onSuccess: () => { toast.success('Got your resume. The app asks for a referral, then applies with it.'); refresh() },
      onError: fail,
    }),
    applied: useMutation({
      mutationFn: (evalId: number) => api.markApplied(evalId),
      onSuccess: () => { toast.success('Marked as applied'); refresh() },
      onError: fail,
    }),
  }
}

const shortDay = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** What happened to the app's draft for an 'app' pick. */
function DraftState({ item }: { item: PlanItem }) {
  if (item.t_status === 'ready' || item.t_status === 'needs_review') {
    return <span className={item.t_status === 'ready' ? 'text-success' : 'text-warning'}>Draft ready{item.t_ats != null ? ` · ATS ${item.t_ats}%` : ''}</span>
  }
  if (item.t_status === 'failed') return <span className="text-danger">The draft failed. Open it to try again.</span>
  return <span className="text-muted"><Spinner size={12} className="mr-1.5 align-[-1px]" />Drafting. Ready tonight.</span>
}

export function ItemRow({ item, others = [], queued, select }: { item: PlanItem; others?: PlanItem[]; queued?: ReviewRow; select?: { on: boolean; toggle: (on: boolean) => void } }) {
  const a = useItemActions()
  const file = useRef<HTMLInputElement>(null)
  const busy = [a.pick, a.decide, a.upload].some(m => m.isPending) || a.applied.isPending
  const score = num(item.score)
  const sponsor = item.sponsorship ? SPONSOR_TEXT[item.sponsorship] : null
  const open = item.decision === 'pending' || item.decision === 'expired'
  const pick = (p: PlanPick | 'skip' | 'none') => a.pick.mutate({ id: item.id, pick: p, others: others.map(o => o.id) })
  return (
    <li className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 gap-y-2 border-b border-line py-4 sm:grid-cols-[64px_minmax(0,1fr)_auto]">
      <span className={cn('flex items-center gap-2 self-start font-mono text-[18px]', score != null && score >= 9 ? 'text-success' : 'text-warning')}>
        {select && !queued && <input type="checkbox" className="size-4 shrink-0 accent-accent" checked={select.on} onChange={e => select.toggle(e.target.checked)} aria-label={`Select ${item.company_name} · ${item.title}`} />}
        {score?.toFixed(1) ?? '—'}
      </span>
      <div className="min-w-0">
        <p className="text-[15px]">
          <PostingTitle company={item.company_name} title={item.title} url={item.apply_url} />
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-subtle">
          {[item.plan_date ? `From ${shortDay(item.plan_date)}` : null, placesLine(item.location, others), item.pay].filter(Boolean).join(' · ')}
          {sponsor && <span className={sponsor.tone === 'success' ? 'text-success' : 'text-danger'}>{sponsor.text}</span>}
          {item.connections > 0 && <span className="text-accent">You know {item.connections} {item.connections === 1 ? 'person' : 'people'} here</span>}
          <PeopleFound n={item.people} withEmail={item.people_email} companyId={item.company_id} />
        </p>
        {open && item.pick === 'app' && <p className="mt-1 text-[14px]"><DraftState item={item} /></p>}
        {open && item.pick === 'self' && <p className="mt-1 text-[14px] text-muted">Your resume. Upload it and the app applies, or mark it applied when you’re done.</p>}
        {!item.pick && item.reason && <p className="mt-1 text-[14px] text-muted">{item.reason}</p>}
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
        {queued && <QueueBadge row={queued} />}
        {open && !item.pick && !queued && (
          <>
            <Button size="sm" variant="primary" loading={a.pick.isPending && a.pick.variables?.pick === 'app'} disabled={busy} onClick={() => pick('app')}
              title="The next Claude run writes the resume. It waits in the Review queue; nothing goes out before you approve it.">Add to queue</Button>
            <Button size="sm" disabled={busy} onClick={() => pick('self')}
              title="You write this resume yourself. You get a reminder tonight.">I’ll draft my own</Button>
            <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} disabled={busy} onClick={() => pick('skip')}>Skip</Button>
          </>
        )}
        {open && item.pick === 'app' && (
          <>
            {item.evaluation_id && <ButtonLink to={`/resumes/job/${item.evaluation_id}`} size="sm" variant="ghost">View the draft</ButtonLink>}
            <ApproveButtons busy={a.decide.isPending} onApprove={mode => a.decide.mutate({ id: item.id, decision: 'approved', mode })} />
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => pick('none')}>Undo</Button>
          </>
        )}
        {open && item.pick === 'self' && (
          <>
            <input ref={file} type="file" accept="application/pdf" className="hidden" aria-label={`Your resume for ${item.company_name}`}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) a.upload.mutate({ id: item.id, file: f }) }} />
            <Button size="sm" variant="primary" icon={<FileUp className="size-3.5" />} loading={a.upload.isPending} disabled={busy} onClick={() => file.current?.click()}
              title="Upload your PDF: the app asks for a referral, then applies with it">Upload my resume</Button>
            {item.evaluation_id && <Button size="sm" disabled={busy} loading={a.applied.isPending} onClick={() => item.evaluation_id && a.applied.mutate(item.evaluation_id)}>I applied</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => pick('none')}>Undo</Button>
          </>
        )}
        {item.decision === 'approved' && (
          <>
            <Badge tone="success">{item.stage === 'applied' ? 'Applied' : item.pick === 'self' ? 'Your resume · app applies' : item.apply_mode === 'review' ? 'Approved · you review' : 'Approved · app applies'}</Badge>
            {['tailoring', 'needs_you'].includes(item.stage) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => a.decide.mutate({ id: item.id, decision: 'pending' })}>Undo</Button>}
          </>
        )}
        {item.decision === 'skipped' && (<><Badge tone="neutral">Skipped</Badge><Button size="sm" variant="ghost" disabled={busy} onClick={() => pick('none')}>Undo</Button></>)}
      </div>
    </li>
  )
}

type Group = 'pick' | 'app' | 'self' | 'skipped'
const GROUPS: { id: Group; label: string }[] = [
  { id: 'pick', label: 'To pick' },
  { id: 'app', label: 'App drafts' },
  { id: 'self', label: 'Your own' },
  { id: 'skipped', label: 'Skipped' },
]
const groupOf = (i: PlanItem): Group | null =>
  i.decision === 'skipped' ? 'skipped'
    : i.decision !== 'pending' ? null
      : i.pick === 'app' ? 'app' : i.pick === 'self' ? 'self' : 'pick'

/** Today's roles: pick each one, then approve the app's drafts and finish your own. */
export function TodaysRoles({ data, queue }: { data: DailyPlanOverview; queue: QueueMap }) {
  const qc = useQueryClient()
  const toast = useToast()
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.dailyPlan })
  const approveAll = useMutation({
    mutationFn: (planId: number) => api.approveAllPlan(planId),
    onSuccess: r => { toast.success(`Approved ${r.approved}. The app asks for referrals, then applies.`); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const build = useMutation({
    mutationFn: () => api.buildDailyPlan(Boolean(data.plan)),
    onSuccess: () => { toast.success('Building today’s list. This takes a few minutes.'); refresh() },
    onError: (e: Error) => { toast.error(e.message); refresh() },
  })

  const plan = data.plan
  // Today's roles plus anything picked on an earlier day and not finished.
  const all = [...data.items, ...(data.picked ?? [])]
  const by = (g: Group) => all.filter(i => groupOf(i) === g)
  const counts = Object.fromEntries(GROUPS.map(g => [g.id, by(g.id).length])) as Record<Group, number>
  const [chosen, setChosen] = useState<Group | null>(null)
  const group = chosen ?? (counts.pick ? 'pick' : counts.app ? 'app' : counts.self ? 'self' : 'pick')
  const shown = groupRoles(by(group))
  const bulk = useBulk(group === 'pick' ? shown : [], queue)
  const readyDrafts = data.items.filter(i => groupOf(i) === 'app' && (i.t_status === 'ready' || i.t_status === 'needs_review')).length
  const day = plan ? new Date(`${String(plan.plan_date).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''

  return (
    <section aria-labelledby="tonight-h">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="tonight-h" className="font-display text-[22px] font-semibold text-fg">{plan ? `Roles for ${day}` : 'Today’s roles'}</h2>
          {plan?.status === 'ready' && (
            <p className="text-[13px] text-subtle">
              {plan.stats.considered ?? 0} new roles looked at · {plan.stats.scored ?? 0} scored · {plan.stats.excluded ?? 0} left out
              {plan.emailed_at ? ` · sent ${timeAgo(plan.emailed_at)}` : ''}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {group === 'app' && plan?.status === 'ready' && readyDrafts > 0 && <Button variant="primary" loading={approveAll.isPending} onClick={() => approveAll.mutate(plan.id)}>Approve all {readyDrafts} ready</Button>}
          {plan?.status !== 'building' && <Button variant="ghost" loading={build.isPending} onClick={() => build.mutate()}>{plan ? 'Look for new roles now' : 'Build today’s list now'}</Button>}
        </div>
      </div>

      {!plan ? (
        <p className="border-t border-rule py-4 text-[14px] text-muted">
          {data.settings.enabled
            ? `Today’s roles arrive at ${hourLabel(data.settings.morningHour)}. You can also build the list now.`
            : 'Turn on your daily roles above, or build today’s list now to see what it would find.'}
        </p>
      ) : plan.status === 'building' ? (
        <p className="flex items-center gap-2 border-t border-rule py-4 text-[14px] text-muted" role="status"><Spinner /> Reading and scoring today’s new roles. This takes a few minutes.</p>
      ) : plan.status === 'failed' ? (
        <p className="border-t border-rule py-4 text-[14px] text-danger">Building the list failed: {plan.error}</p>
      ) : (
        <>
          <div role="tablist" aria-label="Today’s roles" className="flex flex-wrap gap-1 border-b border-line">
            {GROUPS.filter(g => g.id !== 'app' || counts.app > 0).map(g => (
              <button key={g.id} type="button" role="tab" aria-selected={group === g.id} onClick={() => setChosen(g.id)}
                className={cn('-mb-px border-b-2 px-3 py-2 text-[14px]', group === g.id ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>
                {g.label} <span className="font-mono text-[13px] text-subtle">{counts[g.id]}</span>
              </button>
            ))}
          </div>
          <BulkBar bulk={bulk} />
          {shown.length ? <ul>{shown.map(({ item: i, others }) => <ItemRow key={i.id} item={i} others={others} queued={queue.get(String(i.id))} select={group === 'pick' ? { on: bulk.isPicked(i.id), toggle: on => bulk.toggle(i.id, on) } : undefined} />)}</ul> : (
            <p className="py-4 text-[14px] text-muted">
              {group === 'pick' ? 'Nothing left to pick. New roles arrive tomorrow morning, with an update in the afternoon.'
                : group === 'app' ? 'Nothing here. New picks go to the Review queue.'
                  : group === 'self' ? 'No roles of your own yet. Pick I’ll draft my own on a role and you get a reminder tonight.'
                    : 'Nothing skipped.'}
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** Roles from earlier lists that were never answered. They stay here until they're picked or skipped. */
export function MissedRoles({ data, queue }: { data: DailyPlanOverview; queue: QueueMap }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const pick = useMutation({
    mutationFn: async ({ id, pick, others }: { id: number; pick: PlanPick | 'skip'; others: number[] }) => {
      const r = await api.pickPlanItem(id, pick)
      if (others.length) await api.bulkPlanItems(others, 'skip')
      return r
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.dailyPlan }); void qc.invalidateQueries({ queryKey: qk.review }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const missed = useMemo(() => groupRoles(data.missed ?? []), [data.missed])
  const bulk = useBulk(missed, queue)
  if (!missed.length) return null
  const busyId = pick.isPending ? pick.variables?.id : null
  const shown = open ? missed : missed.slice(0, 10)
  return (
    <section aria-labelledby="missed-h">
      <h2 id="missed-h" className="font-display text-[22px] font-semibold text-fg">Missed roles <span className="font-sans text-[15px] font-normal text-subtle">· {missed.length}</span></h2>
      <p className="mb-1 text-[13px] text-subtle">Roles from earlier lists you didn’t pick, best fit first. They stay here until you pick or skip them.</p>
      <BulkBar bulk={bulk} />
      <ul className="border-t border-rule">
        {shown.map(({ item: m, others }) => {
          const queued = queue.get(String(m.id))
          const ids = others.map(o => o.id)
          return (
          <li key={m.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 gap-y-2 border-b border-line py-3 sm:grid-cols-[64px_minmax(0,1fr)_auto]">
            <span className={cn('flex items-center gap-2 self-start font-mono text-[18px]', (num(m.score) ?? 0) >= 9 ? 'text-success' : 'text-warning')}>
              {!queued && <input type="checkbox" className="size-4 shrink-0 accent-accent" checked={bulk.isPicked(m.id)} onChange={e => bulk.toggle(m.id, e.target.checked)} aria-label={`Select ${m.company_name} · ${m.title}`} />}
              {num(m.score)?.toFixed(1) ?? '—'}
            </span>
            <div className="min-w-0">
              <p className="text-[15px]"><PostingTitle company={m.company_name} title={m.title} url={m.apply_url} /></p>
              <p className="mt-0.5 text-[13px] text-subtle">
                {[`From ${new Date(`${m.plan_date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`, placesLine(m.location, others)].filter(Boolean).join(' · ')}
                {m.connections > 0 && <span className="ml-2 text-accent">You know {m.connections} here</span>}
              </p>
            </div>
            <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3">
              {m.evaluation_id && <ButtonLink to={`/resumes/job/${m.evaluation_id}`} size="sm" variant="ghost">{m.ats_score != null ? `Resume · ATS ${m.ats_score}%` : 'Resume'}</ButtonLink>}
              {queued ? <QueueBadge row={queued} /> : (
                <>
                  <Button size="sm" variant="primary" loading={busyId === m.id && pick.variables?.pick === 'app'} disabled={busyId === m.id} onClick={() => pick.mutate({ id: m.id, pick: 'app', others: ids })}>Add to queue</Button>
                  <Button size="sm" disabled={busyId === m.id} onClick={() => pick.mutate({ id: m.id, pick: 'self', others: ids })}>I’ll draft my own</Button>
                  <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} disabled={busyId === m.id} onClick={() => pick.mutate({ id: m.id, pick: 'skip', others: ids })}>Skip</Button>
                </>
              )}
            </div>
          </li>
          )
        })}
      </ul>
      {missed.length > 10 && <Button className="mt-3" variant="ghost" size="sm" onClick={() => setOpen(v => !v)}>{open ? 'Show fewer' : `Show all ${missed.length}`}</Button>}
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
                  {(a.people ?? 0) > 0 && <span className="ml-2 text-[13px]"><PeopleFound n={a.people} withEmail={a.people_email} companyId={a.company_id} /></span>}
                </p>
                <p className={cn('text-[13px]', a.stage === 'needs_you' ? 'text-danger' : 'text-subtle')}>
                  {(a.stage === 'tailoring' || a.stage === 'applying') && <Spinner size={12} className="mr-1.5 align-[-1px]" />}{a.stage_note || STAGE_LABEL[a.stage]}
                </p>
              </div>
              <Badge tone={a.stage === 'needs_you' ? 'danger' : a.stage === 'applied' || a.stage === 'referred' ? 'success' : 'accent'}>{STAGE_LABEL[a.stage]}</Badge>
              {a.evaluation_id && <ButtonLink to={`/jobs/job/${a.evaluation_id}`} size="sm" variant="ghost">{a.ats_score != null ? `Resume · ATS ${a.ats_score}%` : 'Open'}</ButtonLink>}
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
  const queue = useQueueMap()
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (q.isLoading || !q.data) return <Skeleton className="h-64" />
  return (
    <div className="space-y-10">
      <EveningListSettings data={q.data} />
      <TodaysRoles data={q.data} queue={queue} />
      <MissedRoles data={q.data} queue={queue} />
      <InProgress data={q.data} />
    </div>
  )
}

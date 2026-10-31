import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Send } from 'lucide-react'
import { api, type ApplyMode, type ResumeJob } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Badge, Button, EmptyState, ErrorState, Input, Page, PageHeader, Segmented, Select, Skeleton, useToast, type Tone } from '@/ui'
import { PdfDialog } from '@/features/profile/PdfViewer'
import { ManualApply } from '@/features/applications/ManualApply'
import { ApproveButtons } from '@/features/applications/DailyPlan'
import { latestListDate } from '@/features/resumes/resumes'
import { SkillGapsPanel } from './SkillGapsPanel'
import { AddOwnJob } from './AddOwnJob'
import {
  CATEGORY_LABEL, LEVEL_LABEL, NO_FILTERS, dayLabel, isMissed, jobState, matchesRoleFilters, matchesToApply, roleCategory, roleLevel, sortToApply, stateLabel, tally,
  type JobState, type RoleCategory, type RoleFilters, type RoleLevel, type ToApplyFilter,
} from './toApply'

const TONE: Record<JobState, Tone> = { applied: 'success', applying: 'info', review: 'warning', needs: 'warning', working: 'info', open: 'neutral', skipped: 'neutral' }
const cell = 'border-b border-line px-3 py-3 align-top'
const pick = 'sm:w-auto! sm:min-w-36'
const FILTER_KEYS = Object.keys(NO_FILTERS) as (keyof RoleFilters)[]

/** Field, level, grad year and the rest, kept in the address so a reload or a shared link keeps them. */
function useRoleFilters() {
  const [params, setParams] = useSearchParams()
  const f = Object.fromEntries(FILTER_KEYS.map(k => [k, params.get(k) ?? ''])) as unknown as RoleFilters
  const set = (k: keyof RoleFilters, v: string) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const clear = () => setParams(p => { const n = new URLSearchParams(p); for (const k of FILTER_KEYS) n.delete(k); return n }, { replace: true })
  return { f, set, clear, active: FILTER_KEYS.filter(k => f[k]).length }
}

function RoleFilterBar({ all, rf }: { all: ResumeJob[]; rf: ReturnType<typeof useRoleFilters> }) {
  const { f, set } = rf
  const by = <T extends string>(fn: (j: ResumeJob) => T) => Object.fromEntries(tally(all.map(fn)).map(t => [t.value, t.n])) as Partial<Record<T, number>>
  const cats = by(roleCategory)
  const levels = by(roleLevel)
  const years = tally(all.flatMap(j => j.grad_years ?? []))
  const industries = tally(all.map(j => j.industry))
  const tiers = by(j => j.company_tier ?? '')
  const n = (v?: number) => ` (${v ?? 0})`
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={f.category} onChange={e => set('category', e.target.value)} aria-label="Field" className={pick}>
        <option value="">All fields</option>
        {(Object.keys(CATEGORY_LABEL) as RoleCategory[]).map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}{n(cats[c])}</option>)}
      </Select>
      <Select value={f.level} onChange={e => set('level', e.target.value)} aria-label="Level" className={pick}>
        <option value="">All levels</option>
        {(Object.keys(LEVEL_LABEL) as RoleLevel[]).map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}{n(levels[l])}</option>)}
      </Select>
      <Select value={f.year} onChange={e => set('year', e.target.value)} aria-label="Graduation or start year" className={pick} title="Years the posting names, like “class of 2027” or “Summer 2027”">
        <option value="">Any grad year</option>
        {years.map(y => <option key={y.value} value={y.value}>Mentions {y.value}{n(y.n)}</option>)}
      </Select>
      {industries.length > 0 && (
        <Select value={f.industry} onChange={e => set('industry', e.target.value)} aria-label="Industry" className={pick}>
          <option value="">All industries</option>
          {industries.map(i => <option key={i.value} value={i.value}>{i.value}{n(i.n)}</option>)}
        </Select>
      )}
      {(tiers.faang || tiers.quant || f.tier) && (
        <Select value={f.tier} onChange={e => set('tier', e.target.value)} aria-label="Company tier" className={pick}>
          <option value="">All companies</option>
          <option value="faang">FAANG+{n(tiers.faang)}</option>
          <option value="quant">Quant / trading{n(tiers.quant)}</option>
        </Select>
      )}
      <Select value={f.visa} onChange={e => set('visa', e.target.value)} aria-label="Visa sponsorship" className={pick}>
        <option value="">Any visa status</option>
        <option value="open">Hide “won’t sponsor”</option>
        <option value="sponsors">Says it sponsors</option>
      </Select>
      <Select value={f.ats} onChange={e => set('ats', e.target.value)} aria-label="ATS score" className={pick}>
        <option value="">Any ATS</option>
        <option value="pass">Above 90%</option>
        <option value="under">90% or under</option>
      </Select>
      {rf.active > 0 && <Button size="sm" variant="ghost" onClick={rf.clear}>Clear filters ({rf.active})</Button>}
    </div>
  )
}

/** "AI / ML · New grad · 2027 · FAANG+ · Tech & Software · Seattle, WA" under the role. */
function roleTags(j: ResumeJob): string {
  const lv = roleLevel(j)
  const cat = roleCategory(j)
  return [
    cat === 'other' ? null : CATEGORY_LABEL[cat],
    lv === 'intern' ? 'Internship' : lv === 'new_grad' ? 'New grad' : null,
    j.grad_years?.length ? j.grad_years.join(', ') : null,
    j.company_tier === 'faang' ? 'FAANG+' : j.company_tier === 'quant' ? 'Quant' : null,
    j.industry,
    j.location && j.location.length > 48 ? `${j.location.slice(0, 46)}…` : j.location,
  ].filter(Boolean).join(' · ')
}

/** The buttons a role needs right now. */
function Actions({ j, onView }: { j: ResumeJob; onView: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const refresh = () => { for (const k of [qk.resumeJobs, qk.dailyPlan, qk.resumeHistory, qk.pipeline]) void qc.invalidateQueries({ queryKey: k }) }
  const approve = useMutation({
    mutationFn: (mode: ApplyMode) => api.decidePlanItem(j.plan_item_id as number, 'approved', mode),
    onSuccess: (_d, mode) => { toast.success(mode === 'review' ? `Approved ${j.company_name}. Its resume will wait here for you to read.` : `Approved ${j.company_name}. The app takes it from here.`); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const send = useMutation({
    mutationFn: () => api.sendPlanItem(j.plan_item_id as number),
    onSuccess: () => { toast.success(`Sending ${j.company_name}: a referral ask first if you know someone, then the app applies.`); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const s = jobState(j)
  const fileId = j.sending?.file_id ?? j.resume?.file_id
  const view = fileId != null && (
    <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={onView} aria-label={`View the resume for ${j.company_name}`}>View</Button>
  )
  const manual = <ManualApply evalId={j.id} company={j.company_name} jobUrl={j.job_url} applied={s === 'applied'} appliedAt={j.applied_at} applyStatus={j.apply_status} compact />
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {view}
      {s === 'review' && j.plan_item_id != null && (
        <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} loading={send.isPending} onClick={() => send.mutate()}
          title="You’ve read it: the app asks for a referral if it can, then applies">Send it</Button>
      )}
      {(s === 'open' || s === 'skipped') && j.plan_item_id != null && <ApproveButtons busy={approve.isPending} onApprove={mode => approve.mutate(mode)} />}
      {s === 'working' ? null : manual}
    </div>
  )
}

/** Every resume the app wrote, by list day: what's applied, what the app is doing, and what you missed. */
export default function ToApplyPage() {
  const [filter, setFilter] = useState<ToApplyFilter>('todo')
  const [q, setQ] = useState('')
  const [viewing, setViewing] = useState<{ id: number; filename: string; company?: string } | null>(null)
  const rf = useRoleFilters()
  const jobs = useQuery({
    queryKey: qk.resumeJobs, queryFn: api.resumeJobs,
    refetchInterval: query => ((query.state.data ?? []).some(j => j.resume?.status === 'running' || ['queued', 'in_progress'].includes(String(j.apply_status))) ? 60_000 : false),
  })
  const everything = jobs.data ?? []
  const latest = latestListDate(everything)
  const s = q.trim().toLowerCase()
  // The dropdowns narrow everything, so the counts on To do / Missed follow them.
  const all = everything.filter(j => matchesRoleFilters(j, rf.f)
    && (!s || [j.company_name, j.job_title, j.location, j.industry].some(v => v?.toLowerCase().includes(s))))
  const count = (f: ToApplyFilter) => all.filter(j => matchesToApply(j, f, latest)).length
  const options = [
    { value: 'todo' as const, label: `To do · ${count('todo')}` },
    { value: 'missed' as const, label: `Missed · ${count('missed')}` },
    { value: 'working' as const, label: `App is on it · ${count('working')}` },
    { value: 'applied' as const, label: `Applied · ${count('applied')}` },
    { value: 'all' as const, label: 'All' },
  ]
  const rows = sortToApply(all.filter(j => matchesToApply(j, filter, latest)))

  return (
    <Page wide>
      <PageHeader title="To apply"
        description="Every job the app wrote a resume for, newest list first. Apply for me: the app takes it from approval to applying. I’ll review: it stops once the resume is written so you can read it, then Send it or apply yourself." />
      <div className="mb-4"><AddOwnJob /></div>
      {jobs.error ? <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} /> : jobs.isLoading ? <Skeleton className="h-72" /> : everything.length === 0 ? (
        <EmptyState title="No resumes yet" description="Each evening the top roles get a resume written before the list arrives. They’ll show up here." />
      ) : (
        <div className="space-y-4">
          <SkillGapsPanel />
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company, role or place" aria-label="Search company, role or place" className="w-full sm:w-64" />
            <div className="max-w-full overflow-x-auto"><Segmented value={filter} onChange={setFilter} options={options} label="Show" /></div>
          </div>
          <RoleFilterBar all={everything} rf={rf} />
          <div className="overflow-x-auto rounded-[4px] border border-line bg-surface">
            <table className="w-full min-w-[980px] border-collapse text-[14px] text-fg">
              <thead>
                <tr className="bg-raised text-left text-[12px] font-medium tracking-wide text-subtle uppercase">
                  <th className="border-b border-line px-3 py-2 font-medium">Company and role</th>
                  <th className="border-b border-line px-3 py-2 font-medium">Fit</th>
                  <th className="border-b border-line px-3 py-2 font-medium" title="Your original resume → the one tailored for this job. The rule is above 90%.">ATS original → tailored</th>
                  <th className="border-b border-line px-3 py-2 font-medium">Status</th>
                  <th className="border-b border-line px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j, i) => {
                  const st = jobState(j)
                  const newDay = i === 0 || rows[i - 1]?.list_date !== j.list_date
                  const missed = isMissed(j, latest)
                  const fileId = j.sending?.file_id ?? j.resume?.file_id
                  const filename = j.sending?.filename ?? `${j.company_name} resume.pdf`
                  return (
                    <Fragment key={j.id}>
                      {newDay && (
                        <tr><td colSpan={5} className="border-b border-line bg-canvas px-3 py-1.5 text-[12px] font-medium tracking-wide text-subtle uppercase">{dayLabel(j.list_date, latest)}</td></tr>
                      )}
                      <tr className={cn(missed && 'bg-warning-soft/30')}>
                        <td className={cell}>
                          <Link to={`/jobs/job/${j.id}`} className="hover:text-accent"><b className="font-medium">{j.company_name}</b> <span className="text-muted">· {j.job_title}</span></Link>
                          {roleTags(j) && <p className="mt-0.5 text-[12px] text-subtle">{roleTags(j)}</p>}
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {missed && <Badge tone="warning">Missed</Badge>}
                            {j.apply_mode === 'review' && j.decision === 'approved' && <Badge tone="neutral">You review</Badge>}
                            {j.sending?.kind === 'yours' && <Badge tone="info">Your upload</Badge>}
                          </div>
                        </td>
                        <td className={cn(cell, 'font-mono text-[13px]')}>{j.eval_score == null ? '—' : j.eval_score.toFixed(1)}</td>
                        <td className={cn(cell, 'font-mono text-[13px] whitespace-nowrap')}>
                          {j.resume?.ats == null ? <span className="text-subtle">—</span> : (
                            <span title={j.resume.ats_before == null ? 'Tailored resume' : `Your original resume: ${j.resume.ats_before}%. Tailored for this job: ${j.resume.ats}%.`}>
                              {j.resume.ats_before != null && <span className="text-subtle">{j.resume.ats_before}% → </span>}
                              <span className={j.resume.ats > 90 ? 'text-success' : 'text-warning'}>{j.resume.ats}%</span>
                            </span>
                          )}
                        </td>
                        <td className={cell}>
                          <Badge tone={TONE[st]}>{stateLabel(j)}</Badge>
                          {j.stage_note && (st === 'review' || st === 'needs' || st === 'working') && <p className="mt-1 max-w-80 text-[12px] leading-snug text-muted">{j.stage_note}</p>}
                        </td>
                        <td className={cell}>
                          <Actions j={j} onView={() => fileId != null && setViewing({ id: fileId, filename, company: j.company_name })} />
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted">
                    {rf.active || s ? 'Nothing matches. Clear the search or the filters, or pick another tab.' : filter === 'todo' ? 'Nothing waiting on you.' : filter === 'missed' ? 'Nothing missed.' : 'Nothing matches. Clear the search or the filters, or pick another tab.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <PdfDialog file={viewing} onClose={() => setViewing(null)} />
    </Page>
  )
}

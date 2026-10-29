import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Send } from 'lucide-react'
import { api, type ApplyMode, type ResumeJob } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Badge, Button, EmptyState, ErrorState, Input, Page, PageHeader, Segmented, Skeleton, useToast, type Tone } from '@/ui'
import { PdfDialog } from '@/features/profile/PdfViewer'
import { ManualApply } from '@/features/applications/ManualApply'
import { ApproveButtons } from '@/features/applications/DailyPlan'
import { latestListDate } from '@/features/resumes/resumes'
import { SkillGapsPanel } from './SkillGapsPanel'
import { dayLabel, isMissed, jobState, matchesToApply, sortToApply, stateLabel, type JobState, type ToApplyFilter } from './toApply'

const TONE: Record<JobState, Tone> = { applied: 'success', applying: 'info', review: 'warning', needs: 'warning', working: 'info', open: 'neutral', skipped: 'neutral' }
const cell = 'border-b border-line px-3 py-3 align-top'

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
  const [viewing, setViewing] = useState<{ id: number; filename: string } | null>(null)
  const jobs = useQuery({
    queryKey: qk.resumeJobs, queryFn: api.resumeJobs,
    refetchInterval: query => ((query.state.data ?? []).some(j => j.resume?.status === 'running' || ['queued', 'in_progress'].includes(String(j.apply_status))) ? 60_000 : false),
  })
  const all = jobs.data ?? []
  const latest = latestListDate(all)
  const s = q.trim().toLowerCase()
  const count = (f: ToApplyFilter) => all.filter(j => matchesToApply(j, f, latest)).length
  const options = [
    { value: 'todo' as const, label: `To do · ${count('todo')}` },
    { value: 'missed' as const, label: `Missed · ${count('missed')}` },
    { value: 'working' as const, label: `App is on it · ${count('working')}` },
    { value: 'applied' as const, label: `Applied · ${count('applied')}` },
    { value: 'all' as const, label: 'All' },
  ]
  const rows = sortToApply(all.filter(j => matchesToApply(j, filter, latest) && (!s || j.company_name.toLowerCase().includes(s) || j.job_title.toLowerCase().includes(s))))

  return (
    <Page wide>
      <PageHeader title="To apply"
        description="Every job the app wrote a resume for, newest list first. Apply for me: the app takes it from approval to applying. I’ll review: it stops once the resume is written so you can read it, then Send it or apply yourself." />
      {jobs.error ? <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} /> : jobs.isLoading ? <Skeleton className="h-72" /> : all.length === 0 ? (
        <EmptyState title="No resumes yet" description="Each evening the top roles get a resume written before the list arrives. They’ll show up here." />
      ) : (
        <div className="space-y-4">
          <SkillGapsPanel />
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company or role" aria-label="Search company or role" className="w-full sm:w-64" />
            <div className="max-w-full overflow-x-auto"><Segmented value={filter} onChange={setFilter} options={options} label="Show" /></div>
          </div>
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
                          <Actions j={j} onView={() => fileId != null && setViewing({ id: fileId, filename })} />
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted">
                    {filter === 'todo' ? 'Nothing waiting on you.' : filter === 'missed' ? 'Nothing missed.' : 'Nothing matches. Clear the search or pick another filter.'}
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

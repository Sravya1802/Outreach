import { useState } from 'react'
import { Eye } from 'lucide-react'
import { PdfDialog } from '@/features/profile/PdfViewer'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Badge, EmptyState, ErrorState, Input, Page, PageHeader, Segmented, Skeleton } from '@/ui'
import { ManualApply } from '@/features/applications/ManualApply'
import { isApplied } from '@/features/applications/applied'
import { RESUME_FILTERS, latestListDate, matchesResumeFilter, resumeState, type ResumeFilter } from './resumes'

const cell = 'border-b border-line px-3 py-2.5 align-middle'
const head = 'border-b border-line bg-raised px-3 py-2 text-left text-[12px] font-medium tracking-wide text-subtle uppercase'
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`)

/** Resumes → By job: every resume the app wrote (or you uploaded), one row per job. */
export default function ResumesPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ResumeFilter>('all')
  const [q, setQ] = useState('')
  const [viewing, setViewing] = useState<{ id: number; filename: string } | null>(null)
  const jobs = useQuery({
    queryKey: qk.resumeJobs,
    queryFn: api.resumeJobs,
    refetchInterval: (query) => ((query.state.data ?? []).some(j => j.resume?.status === 'running') ? 60_000 : false),
  })
  const all = jobs.data ?? []
  const latest = latestListDate(all)
  const s = q.trim().toLowerCase()
  const shown = all.filter(j => matchesResumeFilter(j, filter, latest) && (!s || j.company_name.toLowerCase().includes(s) || j.job_title.toLowerCase().includes(s)))
  const writing = all.filter(j => j.resume?.status === 'running').length

  return (
    <Page wide>
      <PageHeader
        title="Resumes by job"
        description="Every top role on your evening list gets a draft resume before the list arrives. Open a job to see every change, download it, or upload your own version, which is then sent as-is."
      />
      {jobs.error ? <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} /> : jobs.isLoading ? <Skeleton className="h-72" /> : all.length === 0 ? (
        <EmptyState title="No resumes yet" description="Drafts appear here when your next evening list is built, about two hours before it arrives." />
      ) : (
        <div className="space-y-4">
          {writing > 0 && <p className="text-[13px] text-muted">{writing} still being written (batched at half price; usually ready within the hour).</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company or role" aria-label="Search company or role" className="w-full sm:w-64" />
            <div className="max-w-full overflow-x-auto"><Segmented value={filter} onChange={setFilter} options={RESUME_FILTERS} label="Show" /></div>
          </div>
          <div className="overflow-x-auto rounded-[4px] border border-line bg-surface">
            <table className="w-full min-w-[1240px] border-collapse text-[14px] text-fg">
              <thead>
                <tr>
                  <th className={head}>Company</th>
                  <th className={head}>Role</th>
                  <th className={head}>List</th>
                  <th className={head}>Fit</th>
                  <th className={head}>Resume</th>
                  <th className={head}>ATS</th>
                  <th className={head}>Interview</th>
                  <th className={head}>Sent with</th>
                  <th className={head}>Apply</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(j => {
                  const st = resumeState(j)
                  const r = j.resume
                  return (
                    <tr key={j.id} onClick={() => navigate(`/resumes/job/${j.id}`)} className="cursor-pointer hover:bg-hover">
                      <td className={cn(cell, 'font-medium')}><Link to={`/resumes/job/${j.id}`} onClick={e => e.stopPropagation()} className="hover:underline">{j.company_name}</Link></td>
                      <td className={cell}>{j.job_title}</td>
                      <td className={cn(cell, 'text-[13px] whitespace-nowrap text-subtle')}>{j.list_date ? new Date(`${j.list_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'}</td>
                      <td className={cn(cell, 'font-mono text-[13px]')}>{j.eval_score == null ? '—' : j.eval_score.toFixed(1)}</td>
                      <td className={cell}><Badge tone={st.tone}>{st.label}</Badge>{r?.project && r.project_status === 'suggested' && <span className="ml-1.5 text-[12px] text-subtle">· project idea</span>}</td>
                      <td className={cn(cell, 'font-mono text-[13px] whitespace-nowrap', r?.ats == null ? 'text-subtle' : r.ats > 90 ? 'text-success' : 'text-warning')}>
                        {r?.ats_before != null && r.ats != null ? <span className="text-subtle">{r.ats_before}% → </span> : null}{pct(r?.ats)}
                      </td>
                      <td className={cn(cell, 'font-mono text-[13px]', r?.callback == null ? 'text-subtle' : r.callback >= 20 ? 'text-success' : 'text-muted')}>{pct(r?.callback)}</td>
                      <td className={cn(cell, 'text-[13px] text-muted')}>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          {j.sending?.kind === 'yours' ? 'Your upload' : j.sending ? 'The app’s resume' : '—'}
                          {j.sending && (
                            <button type="button" aria-label={`View the resume for ${j.company_name}`}
                              onClick={e => { e.stopPropagation(); if (j.sending) setViewing({ id: j.sending.file_id, filename: j.sending.filename }) }}
                              className="inline-flex items-center gap-1 rounded-[4px] border border-line px-2 py-0.5 text-[12px] text-fg hover:bg-hover">
                              <Eye className="size-3" aria-hidden="true" /> View
                            </button>
                          )}
                        </span>
                      </td>
                      <td className={cell}><ManualApply evalId={j.id} company={j.company_name} jobUrl={j.job_url} applied={isApplied(j)} applyStatus={j.apply_status} compact /></td>
                    </tr>
                  )
                })}
                {shown.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted">Nothing matches. Clear the search or pick another filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <PdfDialog file={viewing} onClose={() => setViewing(null)} />
    </Page>
  )
}

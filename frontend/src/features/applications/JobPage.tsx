import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react'
import { api, type EvaluationDetail, type EvaluationFile } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge, EmptyState, ErrorState, Page, PageHeader, Skeleton } from '@/ui'
import { PdfPages, PdfToolbar } from '@/features/profile/PdfViewer'
import { Report } from './EvaluatePage'
import { JOB_TABS, descriptionOf, fileKindLabel, firstFile, jobTab, readableDescription, type JobTab } from './job'
import { globalOutOf10, scoreOutOf10, stageFor } from './score'

const STAGE_LABEL = { evaluated: 'Not applied yet', applied: 'Applied', responded: 'Heard back', interview: 'Interviewing', offer: 'Offer', rejected: 'Not moving forward' } as const

function Facts({ d }: { d: EvaluationDetail }) {
  const score = globalOutOf10(d.evaluation?.globalScore) ?? scoreOutOf10(d.score)
  const pay = d.role?.salary_range || d.evaluation?.blockD_compAndDemand?.salaryRange
  const items: [string, string | null | undefined][] = [
    ['Status', STAGE_LABEL[stageFor(d.apply_status)]],
    ['Fit', score != null ? `${score} / 10` : null],
    ['Location', d.role?.location],
    ['Pay', pay],
    ['Posted', d.role?.posted_at ? timeAgo(d.role.posted_at) : null],
    ['Type', d.role?.role_type === 'new_grad' ? 'New grad' : d.role?.role_type === 'intern' ? 'Internship' : null],
  ]
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3 border-y border-line py-3 text-[14px]">
      {items.filter(([, v]) => v).map(([k, v]) => (
        <div key={k}>
          <dt className="text-[12px] text-subtle">{k}</dt>
          <dd className="text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Description({ d }: { d: EvaluationDetail }) {
  const e = d.evaluation ?? {}
  const reqs = e.blockB_cvMatch?.requirements ?? []
  const text = readableDescription(descriptionOf(d))
  const MARK = { match: { sym: '✓', cls: 'text-success', label: 'You have this' }, partial: { sym: '~', cls: 'text-warning', label: 'Partly' }, gap: { sym: '✗', cls: 'text-danger', label: 'Missing' } } as const
  return (
    <div className="space-y-9">
      {(e.blockA_roleSummary?.tldr || e.blockA_roleSummary?.seniority || e.blockA_roleSummary?.remote) && (
        <section aria-labelledby="about-h">
          <h2 id="about-h" className="mb-2 font-display text-[20px] font-semibold text-fg">The role in short</h2>
          {e.blockA_roleSummary?.tldr && <p className="leading-relaxed text-fg">{e.blockA_roleSummary.tldr}</p>}
          <p className="mt-1 text-[14px] text-muted">{[e.blockA_roleSummary?.seniority, e.blockA_roleSummary?.remote].filter(Boolean).join(' · ')}</p>
        </section>
      )}
      {reqs.length > 0 && (
        <section aria-labelledby="reqs-h">
          <h2 id="reqs-h" className="mb-3 font-display text-[20px] font-semibold text-fg">What they ask for</h2>
          <ul className="divide-y divide-line border-y border-line">
            {reqs.map(r => {
              const m = MARK[r.status ?? 'gap'] ?? MARK.gap
              return (
                <li key={r.requirement} className="flex gap-3 py-2.5 text-[14px]">
                  <span className={cn('w-4 shrink-0 text-center font-medium', m.cls)} aria-label={m.label}>{m.sym}</span>
                  <span className="min-w-0">
                    <span className="text-fg">{r.requirement}</span>
                    {r.cvEvidence && <span className="block text-[13px] text-muted">From your resume: {r.cvEvidence}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {e.atsKeywords && e.atsKeywords.length > 0 && (
        <section aria-labelledby="kw-h">
          <h2 id="kw-h" className="mb-2 font-display text-[20px] font-semibold text-fg">Keywords the screeners look for</h2>
          <p className="flex flex-wrap gap-1.5">{e.atsKeywords.map(k => <Badge key={k}>{k}</Badge>)}</p>
        </section>
      )}
      <section aria-labelledby="jd-h">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="jd-h" className="font-display text-[20px] font-semibold text-fg">Full job description</h2>
          {d.job_url && <a href={d.job_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[14px] text-accent hover:underline">Original posting <ExternalLink className="size-3.5" /></a>}
        </div>
        {text
          ? <div className="rounded-[4px] border border-line bg-surface p-5 text-[14px] leading-relaxed whitespace-pre-wrap text-fg">{text}</div>
          : <p className="text-[14px] text-muted">The description wasn’t saved for this role. Open the original posting to read it.</p>}
      </section>
    </div>
  )
}

function Resumes({ d }: { d: EvaluationDetail }) {
  const files = d.files ?? []
  const [chosen, setChosen] = useState<EvaluationFile | null>(() => firstFile(files))
  const [zoom, setZoom] = useState(1)
  const file = chosen ?? firstFile(files)
  if (!file) {
    return <EmptyState icon={<FileText />} title="No resume for this role yet"
      description="Make a tailored resume from the Overview tab. It will show up here to read." />
  }
  return (
    <div className="space-y-4">
      {files.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Files for this role">
          {files.map(f => (
            <button key={f.id} type="button" role="tab" aria-selected={f.id === file.id} onClick={() => setChosen(f)}
              className={cn('rounded-[4px] border px-3 py-1.5 text-left text-[13px] transition-colors',
                f.id === file.id ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:border-line-strong')}>
              <span className="block font-medium">{fileKindLabel(f.kind)}</span>
              <span className="block text-[12px] text-subtle">{f.sent ? 'Sent' : f.primary_file ? 'Ready to send' : timeAgo(f.created_at)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[14px]">
          <span className="font-medium text-fg">{file.filename}</span>
          <span className="ml-2 text-subtle">{fileKindLabel(file.kind)}{file.sent ? ' · sent with the application' : file.primary_file ? ' · ready to send' : ''}</span>
        </p>
        <PdfToolbar fileId={file.id} filename={file.filename} zoom={zoom} onZoom={setZoom} />
      </div>
      <div className="rounded-[4px] border border-line bg-canvas p-3 sm:p-5">
        <PdfPages key={file.id} fileId={file.id} filename={file.filename} zoom={zoom} />
      </div>
    </div>
  )
}

/** Everything about one role in one place: the fit, the full posting, and the resume made for it. */
export default function JobPage() {
  const navigate = useNavigate()
  const id = Number(useParams().id)
  const [params, setParams] = useSearchParams()
  const tab = jobTab(params.get('tab'))
  const detail = useQuery({ queryKey: qk.evaluation(id), queryFn: () => api.evaluation(id), enabled: id > 0 })
  const resume = useQuery({ queryKey: qk.resume, queryFn: api.resumeStatus })
  const d = detail.data
  const setTab = (t: JobTab) => setParams(p => { const n = new URLSearchParams(p); if (t === 'overview') n.delete('tab'); else n.set('tab', t); return n }, { replace: true })

  return (
    <Page>
      <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/applications/tracker'))}
        className="mb-4 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back
      </button>
      {detail.error ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : !d ? <Skeleton className="h-64" /> : (
        <>
          <PageHeader title={d.company_name} description={d.job_title} />
          <Facts d={d} />
          <div role="tablist" aria-label="Job" className="mt-6 mb-7 flex gap-6 border-b border-line">
            {JOB_TABS.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={cn('-mb-px border-b-2 py-2.5 text-[15px] whitespace-nowrap transition-colors',
                  tab === t.id ? 'border-accent font-semibold text-fg' : 'border-transparent text-muted hover:text-fg')}>
                {t.label}{t.id === 'resume' && d.files?.length ? <span className="ml-1.5 text-[13px] text-subtle">{d.files.length}</span> : null}
              </button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === 'overview' && <Report detail={d} hasResume={Boolean(resume.data?.hasResume)} onJobPage />}
            {tab === 'description' && <Description d={d} />}
            {tab === 'resume' && <Resumes d={d} />}
          </div>
          {tab === 'overview' && (
            <p className="mt-10 text-[14px] text-muted">
              Read the <Link to="?tab=description" className="text-accent hover:underline">full job description</Link> or the <Link to="?tab=resume" className="text-accent hover:underline">resume for this role</Link>.
            </p>
          )}
        </>
      )}
    </Page>
  )
}

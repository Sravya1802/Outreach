import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, ExternalLink, Eye, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { Button, ErrorState, Page, Skeleton, useToast } from '@/ui'
import { TailoredResume } from '@/features/applications/TailoredResume'
import { ManualApply } from '@/features/applications/ManualApply'
import { isApplied } from '@/features/applications/applied'
import { PdfDialog } from '@/features/profile/PdfViewer'

const MAX_BYTES = 10 * 1024 * 1024

/** One job: which resume goes out (yours or the app's), and the tailored resume with every change. */
export default function ResumeJobPage() {
  const id = Number(useParams().id)
  const qc = useQueryClient()
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [viewing, setViewing] = useState<{ id: number; filename: string; company?: string } | null>(null)
  const jobs = useQuery({ queryKey: qk.resumeJobs, queryFn: api.resumeJobs })
  const detail = useQuery({ queryKey: qk.evaluation(id), queryFn: () => api.evaluation(id), enabled: Number.isInteger(id) && id > 0 })
  const resume = useQuery({ queryKey: qk.resume, queryFn: api.resumeStatus })
  const job = jobs.data?.find(j => j.id === id)
  const refresh = () => { void qc.invalidateQueries({ queryKey: qk.resumeJobs }); void qc.invalidateQueries({ queryKey: qk.evaluation(id) }) }
  const upload = useMutation({
    mutationFn: (f: File) => api.uploadRoleResume(id, f),
    onSuccess: () => { toast.success('Your version will be sent for this role.'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const useApp = useMutation({
    mutationFn: () => api.useTailored(id),
    onSuccess: () => { toast.success('The app’s tailored resume will be sent for this role.'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const download = useMutation({
    mutationFn: (f: { id: number; filename: string }) => api.downloadResumeFile(f.id, f.filename),
    onError: (e: Error) => toast.error(e.message),
  })
  function pick(f: File | undefined) {
    if (!f) return
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) { toast.error('Upload a PDF'); return }
    if (f.size > MAX_BYTES) { toast.error('That PDF is over 10 MB'); return }
    upload.mutate(f)
  }

  if (detail.error) return <Page><ErrorState error={detail.error} onRetry={() => void detail.refetch()} /></Page>
  if (detail.isLoading || !detail.data) return <Page><Skeleton className="h-72" /></Page>
  const d = detail.data
  const yours = job?.sending?.kind === 'yours'

  return (
    <Page>
      <Link to="/resumes/jobs" className="mb-4 inline-flex items-center gap-1 text-[14px] text-muted hover:text-fg"><ArrowLeft className="size-4" /> All resumes</Link>
      <header className="mb-6">
        <h1 className="font-display text-[30px] leading-tight text-fg">{d.company_name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[15px] text-muted">
          <span>{d.job_title}</span>
          {job?.eval_score != null && <span className="font-mono text-[13px]">fit {job.eval_score.toFixed(1)}/10</span>}
          {job?.list_date && <span className="text-[13px]">from the {new Date(`${job.list_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} list</span>}
          {d.job_url && <a href={d.job_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">Posting <ExternalLink className="size-3" /></a>}
          <Link to={`/jobs/evaluate?id=${id}`} className="text-[13px] text-accent hover:underline">Full evaluation</Link>
        </p>
        <ManualApply evalId={id} company={d.company_name} jobUrl={d.job_url} applied={isApplied(d)} appliedAt={d.applied_at} applyStatus={d.apply_status} className="mt-4" />
      </header>

      <section aria-labelledby="sent-h" className="mb-6 rounded-[4px] border border-line bg-surface p-5">
        <h2 id="sent-h" className="font-medium text-fg">What gets sent for this role</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">
          {yours
            ? <>Your upload, <span className="text-fg">{job?.sending?.filename}</span>, exactly as it is.</>
            : job?.sending ? 'The app’s tailored resume below. Want changes? Download it (PDF or LaTeX), edit it, and upload your version: that one is sent as-is.'
            : 'The tailored resume below, once it’s written. You can upload your own version instead.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {job?.sending && <Button icon={<Eye className="size-4" />} onClick={() => job.sending && setViewing({ id: job.sending.file_id, filename: job.sending.filename, company: job.company_name })}>View the resume</Button>}
          {yours && job?.sending && <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => job.sending && download.mutate({ id: job.sending.file_id, filename: job.sending.filename })}>Download yours</Button>}
          <Button icon={<Upload className="size-4" />} loading={upload.isPending} onClick={() => file.current?.click()}>{yours ? 'Upload a new version' : 'Upload my version'}</Button>
          {yours && job?.resume?.file_id && <Button variant="ghost" loading={useApp.isPending} onClick={() => useApp.mutate()}>Send the app’s resume instead</Button>}
          <input ref={file} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </section>

      <TailoredResume evalId={id} company={d.company_name} hasResume={Boolean(resume.data?.hasResume)} />
      <PdfDialog file={viewing} onClose={() => setViewing(null)} />
    </Page>
  )
}

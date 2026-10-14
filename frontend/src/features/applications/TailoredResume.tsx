import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, RefreshCw } from 'lucide-react'
import { api, type Tailoring, type TailoringState } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge, Button, ButtonLink, Spinner, useToast } from '@/ui'
import { atsTone, tailoringHeadline } from './tailoring'

const TONE_TEXT = { strong: 'text-success', ok: 'text-warning', weak: 'text-danger', none: 'text-subtle' } as const

/** The tailored resume (and cover letter) for one evaluated role. */
export function TailoredResume({ evalId, company, hasResume }: { evalId: number; company: string; hasResume: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const state = useQuery({
    queryKey: qk.tailoring(evalId),
    queryFn: () => api.tailoring(evalId),
    refetchInterval: q => {
      const d = q.state.data as TailoringState | undefined
      return d?.resume?.status === 'running' || d?.cover_letter?.status === 'running' ? 4000 : false
    },
  })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.tailoring(evalId) })
    void qc.invalidateQueries({ queryKey: qk.resumeHistory })
    void qc.invalidateQueries({ queryKey: qk.pipeline })
  }
  const tailor = useMutation({ mutationFn: () => api.startTailoring(evalId), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) })
  const letter = useMutation({ mutationFn: () => api.startCoverLetter(evalId), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) })
  const approve = useMutation({
    mutationFn: (id: number) => api.approveTailoring(id),
    onSuccess: () => { toast.success('Approved. This resume can go out with the application.'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const download = useMutation({
    mutationFn: (t: Tailoring) => api.downloadResumeFile(t.file_id ?? 0, t.filename || 'resume.pdf'),
    onError: (e: Error) => toast.error(e.message),
  })

  const r = state.data?.resume ?? null
  const c = state.data?.cover_letter ?? null
  const running = r?.status === 'running'

  return (
    <section aria-labelledby="tailor-h" className="rounded-[4px] border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="tailor-h" className="font-display text-[22px] font-semibold text-fg">Tailored resume</h3>
          <p className="mt-1 max-w-2xl text-[14px] text-muted">
            Rewritten for this job from your master resume and GitHub projects, fact-checked so nothing is invented, scored against the posting’s ATS keywords and made into a one-page PDF.
          </p>
        </div>
        {r && !running && (
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={tailor.isPending} onClick={() => tailor.mutate()}>Tailor again</Button>
        )}
      </div>

      {state.isLoading ? <div className="mt-5"><Spinner /></div> : !hasResume ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="text-[14px] text-muted">Upload your master resume first.</p>
          <ButtonLink to="/profile/resume" size="sm">Go to Profile → Resume</ButtonLink>
        </div>
      ) : !r ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<FileText className="size-4" />} loading={tailor.isPending} onClick={() => tailor.mutate()}>Tailor my resume for {company}</Button>
          <span className="text-[13px] text-subtle">About a minute · roughly $0.08 of your AI budget</span>
        </div>
      ) : running ? (
        <p className="mt-5 flex items-center gap-2 text-[14px] text-muted" role="status"><Spinner /> Writing your resume for {company}… usually under a minute.</p>
      ) : r.status === 'failed' ? (
        <div className="mt-5 space-y-3">
          <p className="text-[14px] text-danger">{r.error || 'Something went wrong.'}</p>
          <Button onClick={() => tailor.mutate()} loading={tailor.isPending}>Try again</Button>
        </div>
      ) : (
        <ResumeResult t={r} onDownload={() => download.mutate(r)} onApprove={() => approve.mutate(r.id)} approving={approve.isPending} />
      )}

      {r && r.status !== 'running' && r.status !== 'failed' && (
        <div className="mt-8 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-medium text-fg">Cover letter</h4>
              <p className="text-[13px] text-muted">
                {state.data?.coverLetterRequested ? 'This posting asks for a cover letter.' : 'This posting doesn’t mention one. Write one only if the form asks.'}
              </p>
            </div>
            {c?.status === 'running' ? (
              <span className="flex items-center gap-2 text-[14px] text-muted" role="status"><Spinner /> Writing…</span>
            ) : c?.status === 'ready' ? (
              <div className="flex gap-2">
                <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => download.mutate(c)}>Download</Button>
                <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={letter.isPending} onClick={() => letter.mutate()}>Rewrite</Button>
              </div>
            ) : (
              <Button variant={state.data?.coverLetterRequested ? 'primary' : 'secondary'} loading={letter.isPending} onClick={() => letter.mutate()}>Write a cover letter</Button>
            )}
          </div>
          {c?.status === 'failed' && <p className="mt-2 text-[14px] text-danger">{c.error}</p>}
          {c?.status === 'ready' && (c.report?.paragraphs?.length ?? 0) > 0 && (
            <div className="mt-4 space-y-3 rounded-[4px] border border-line bg-raised p-4 text-[14px] leading-relaxed text-muted">
              <p>{c.report?.greeting}</p>
              {c.report?.paragraphs?.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function ResumeResult({ t, onDownload, onApprove, approving }: { t: Tailoring; onDownload: () => void; onApprove: () => void; approving: boolean }) {
  const a = t.ats
  const rep = t.report ?? {}
  const score = t.ats_score ?? a?.score ?? null
  const target = a?.target ?? 90
  const tone = atsTone(score, target)
  const failed = (a?.checks ?? []).filter(x => !x.ok)
  const missingRequired = (a?.missingYouDont ?? []).filter(m => m.importance === 'required')
  const missingPreferred = (a?.missingYouDont ?? []).filter(m => m.importance !== 'required')

  return (
    <div className="mt-6 space-y-8">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="shrink-0">
          <p className={cn('font-display text-[64px] leading-none', TONE_TEXT[tone])}>{score ?? '—'}<span className="text-[28px]">%</span></p>
          <p className="mt-1 font-mono text-[12px] text-subtle">ATS score · target {target}%</p>
        </div>
        <div className="min-w-0 flex-1 basis-[280px] space-y-2">
          <p className="flex flex-wrap items-center gap-2">
            {t.status === 'ready' ? <Badge tone="success">Ready to send</Badge>
              : t.approved_at ? <Badge tone="accent">You approved it</Badge>
              : <Badge tone="warning">Waiting on you</Badge>}
            <span className="text-[13px] text-subtle">Made {timeAgo(t.finished_at || t.created_at)} · cost ${Number(t.cost_usd || 0).toFixed(2)}</span>
          </p>
          <p className="text-[14px] leading-relaxed text-muted">{tailoringHeadline(t)}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {t.file_id && <Button icon={<Download className="size-4" />} onClick={onDownload}>Download PDF</Button>}
            {t.status === 'needs_review' && !t.approved_at && <Button variant="ghost" loading={approving} onClick={onApprove}>Send it anyway</Button>}
          </div>
        </div>
      </div>

      {(missingRequired.length > 0 || missingPreferred.length > 0) && (
        <div>
          <h4 className="mb-2 font-medium text-fg">Not on your resume or GitHub</h4>
          <p className="mb-3 text-[13px] text-muted">These weren’t added, because nothing you’ve shared shows them. If you do have them, add them to your master resume and tailor again.</p>
          <ul className="flex flex-wrap gap-2">
            {missingRequired.map(m => <li key={m.term} className="rounded-full border border-danger/50 px-3 py-1 text-[13px] text-fg">{m.term} <span className="text-subtle">· required</span></li>)}
            {missingPreferred.map(m => <li key={m.term} className="rounded-full border border-line-strong px-3 py-1 text-[13px] text-muted">{m.term}</li>)}
          </ul>
        </div>
      )}

      {(a?.matched?.length ?? 0) > 0 && (
        <div>
          <h4 className="mb-2 font-medium text-fg">Keywords on the page <span className="font-normal text-subtle">· {a?.matched.length} of {a?.keywords.length}</span></h4>
          <ul className="flex flex-wrap gap-2">
            {a?.matched.map(k => <li key={k} className="rounded-full bg-success-soft px-3 py-1 text-[13px] text-success">{k}</li>)}
          </ul>
        </div>
      )}

      {failed.length > 0 && (
        <div>
          <h4 className="mb-2 font-medium text-fg">Format checks that didn’t pass</h4>
          <ul className="space-y-1 text-[14px] text-muted">{failed.map(f => <li key={f.id}>· {f.label}</li>)}</ul>
        </div>
      )}

      <div>
        <h4 className="mb-1 font-medium text-fg">What changed for this role</h4>
        {rep.notes && <p className="mb-4 text-[14px] leading-relaxed text-muted">{rep.notes}</p>}
        {(rep.projects?.length ?? 0) > 0 && (
          <div className="mb-5">
            <p className="mb-2 text-[12px] tracking-wide text-subtle uppercase">Projects chosen</p>
            <ul className="space-y-2 text-[14px] leading-relaxed">
              {rep.projects?.map(p => (
                <li key={p.name}><span className="text-fg">{p.name}</span> <span className="text-subtle">· {p.source === 'github' ? 'from GitHub' : 'from your resume'}</span>{p.why && <span className="block text-muted">{p.why}</span>}</li>
              ))}
            </ul>
          </div>
        )}
        {(rep.changes?.length ?? 0) > 0 && (
          <ol className="space-y-4">
            {rep.changes?.map((ch, i) => (
              <li key={i} className="grid gap-1 text-[14px] leading-relaxed">
                <span className="text-[12px] tracking-wide text-subtle uppercase">{ch.section}</span>
                {ch.before && <span className="text-muted line-through decoration-danger/60">{ch.before}</span>}
                <span className="text-fg">{ch.after}</span>
                {ch.why && <span className="text-[13px] text-subtle">{ch.why}</span>}
              </li>
            ))}
          </ol>
        )}
        {(rep.addedSkills?.length ?? 0) > 0 && (
          <p className="mt-4 text-[14px] text-muted">Added to Skills from your own background: <span className="text-fg">{rep.addedSkills?.join(', ')}</span></p>
        )}
        {(rep.removed?.length ?? 0) > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[12px] tracking-wide text-subtle uppercase">Removed by the fact check</p>
            <ul className="space-y-2 text-[14px] leading-relaxed">
              {rep.removed?.map((x, i) => <li key={i}><span className="text-muted">{x.where}:</span> <span className="text-fg">{x.what}</span> <span className="block text-[13px] text-subtle">{x.why}</span></li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

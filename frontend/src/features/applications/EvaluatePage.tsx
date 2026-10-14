import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { api, type EvaluationDetail, type EvaluationReport } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, ButtonLink, ErrorState, Page, PageHeader, Skeleton, Spinner, Textarea, useToast } from '@/ui'
import { globalOutOf10, looksLikeUrl, scoreOutOf10, scoreTone, stageFor } from './score'

const TONE_TEXT = { strong: 'text-success', ok: 'text-warning', weak: 'text-danger', none: 'text-subtle' } as const
const BREAKDOWN: { key: keyof NonNullable<EvaluationReport['scoreBreakdown']>; label: string }[] = [
  { key: 'cvMatch', label: 'Skills match' },
  { key: 'northStar', label: 'Fits what you want' },
  { key: 'comp', label: 'Pay' },
  { key: 'culture', label: 'Team and culture' },
  { key: 'redFlags', label: 'Few red flags' },
]

function Report({ detail }: { detail: EvaluationDetail }) {
  const qc = useQueryClient()
  const toast = useToast()
  const e = detail.evaluation ?? {}
  const score = globalOutOf10(e.globalScore) ?? scoreOutOf10(detail.score)
  const tone = scoreTone(score)
  const matches = (e.blockB_cvMatch?.requirements ?? []).filter(r => r.status === 'match' || r.status === 'partial')
  const stage = stageFor(detail.apply_status)

  const markApplied = useMutation({
    mutationFn: () => api.markApplied(detail.id),
    onSuccess: () => {
      toast.success('Marked as applied')
      void qc.invalidateQueries({ queryKey: qk.evaluation(detail.id) })
      void qc.invalidateQueries({ queryKey: qk.pipeline })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <article className="space-y-10">
      <section className="flex flex-wrap gap-10 border-t border-rule pt-7">
        <div className="shrink-0">
          <p className={cn('font-display text-[96px] leading-[0.9]', TONE_TEXT[tone])}>{score ?? '—'}</p>
          <p className="mt-1 font-mono text-[13px] text-subtle">out of 10{detail.grade ? ` · grade ${detail.grade}` : ''}</p>
        </div>
        <div className="min-w-0 flex-1 basis-[420px] space-y-3">
          <p className="text-[14px] text-muted">{detail.company_name} · {detail.job_title}</p>
          {e.verdict?.headline && <h2 className="font-display text-[28px] leading-snug text-fg">{e.verdict.headline}</h2>}
          {e.verdict?.oneLineWhy && <p className="leading-relaxed text-muted">{e.verdict.oneLineWhy}</p>}
          {e.verdict?.interviewOdds?.asIs && (
            <p className="text-[14px] text-muted">
              Interview odds: <b className="font-medium text-fg">{e.verdict.interviewOdds.asIs}</b> as is
              {e.verdict.interviewOdds.properlyTailored && <>, <b className="font-medium text-fg">{e.verdict.interviewOdds.properlyTailored}</b> with a tailored resume</>}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {detail.job_url && (
              <a href={detail.job_url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[4px] bg-accent px-4 text-[14px] font-semibold text-on-accent hover:bg-accent-hover">
                Open the posting <ExternalLink className="size-3.5" />
              </a>
            )}
            {stage === 'evaluated'
              ? <Button onClick={() => markApplied.mutate()} loading={markApplied.isPending}>I applied</Button>
              : <span className="px-2 text-[14px] text-success">In your pipeline as {stage === 'applied' ? 'applied' : stage}</span>}
            <Button variant="ghost" onClick={() => void api.openReport(detail.id)}>Full report</Button>
          </div>
        </div>
      </section>

      <div className="grid gap-10 md:grid-cols-3">
        <section aria-labelledby="match-h">
          <h3 id="match-h" className="mb-3 font-display text-[20px] font-semibold text-fg">Where you match</h3>
          {matches.length ? (
            <ul className="space-y-2.5 text-[14px] leading-relaxed text-muted">
              {matches.slice(0, 6).map(m => (
                <li key={m.requirement} className="flex gap-2">
                  <span className={m.status === 'match' ? 'text-success' : 'text-warning'} aria-label={m.status}>{m.status === 'match' ? '✓' : '~'}</span>
                  <span>{m.requirement}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[14px] text-subtle">Nothing clearly matched.</p>}
        </section>
        <section aria-labelledby="gap-h">
          <h3 id="gap-h" className="mb-3 font-display text-[20px] font-semibold text-fg">Gaps</h3>
          {e.topGaps?.length ? (
            <ul className="space-y-3 text-[14px] leading-relaxed">
              {e.topGaps.map(g => (
                <li key={g.gap}>
                  <span className="text-fg">{g.gap}</span>
                  {g.fix && <span className="block text-muted">{g.fix}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-[14px] text-subtle">No major gaps.</p>}
        </section>
        <section aria-labelledby="how-h">
          <h3 id="how-h" className="mb-3 font-display text-[20px] font-semibold text-fg">How it scored</h3>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[14px] text-muted">
            {BREAKDOWN.filter(b => e.scoreBreakdown?.[b.key] != null).map(b => (
              <div key={b.key} className="contents">
                <dt>{b.label}</dt>
                <dd className="font-mono text-fg">{globalOutOf10(e.scoreBreakdown?.[b.key])}</dd>
              </div>
            ))}
            {e.blockD_compAndDemand?.salaryRange && <><dt>Pay (estimate)</dt><dd className="text-right text-fg">{e.blockD_compAndDemand.salaryRange}</dd></>}
            {e.blockG_legitimacy?.assessment && <><dt>Posting looks</dt><dd className="text-right text-fg">{e.blockG_legitimacy.assessment.toLowerCase()}</dd></>}
          </dl>
        </section>
      </div>

      {(e.blockE_personalization?.cvChanges?.length ?? 0) > 0 && (
        <section aria-labelledby="cv-h" className="rounded-[4px] border border-line bg-surface p-6">
          <h3 id="cv-h" className="font-display text-[22px] font-semibold text-fg">Resume changes for this role</h3>
          <p className="mt-1 mb-4 text-[14px] text-muted">Suggestions only for now. Tailored resumes, rewritten and compiled to PDF automatically, come with the next build.</p>
          <ol className="space-y-4">
            {e.blockE_personalization?.cvChanges?.map((c, i) => (
              <li key={i} className="grid gap-1 text-[14px] leading-relaxed">
                <span className="text-[12px] tracking-wide text-subtle uppercase">{c.section}</span>
                {c.currentState && <span className="text-muted line-through decoration-danger/60">{c.currentState}</span>}
                {c.proposedChange && <span className="text-fg">{c.proposedChange}</span>}
                {c.why && <span className="text-[13px] text-subtle">{c.why}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {(e.atsKeywords?.length ?? 0) > 0 && (
        <section aria-labelledby="kw-h">
          <h3 id="kw-h" className="mb-3 font-display text-[20px] font-semibold text-fg">Keywords the resume should mirror</h3>
          <ul className="flex flex-wrap gap-2">
            {e.atsKeywords?.map(k => <li key={k} className="rounded-full border border-line-strong px-3 py-1 text-[13px] text-muted">{k}</li>)}
          </ul>
        </section>
      )}
    </article>
  )
}

export default function EvaluatePage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [input, setInput] = useState(() => params.get('url') ?? '')
  const id = Number(params.get('id')) || null

  const resume = useQuery({ queryKey: qk.resume, queryFn: api.resumeStatus })
  const recent = useQuery({ queryKey: qk.evaluations, queryFn: api.evaluations })
  const detail = useQuery({ queryKey: qk.evaluation(id ?? 0), queryFn: () => api.evaluation(id as number), enabled: id != null })

  const evaluate = useMutation({
    mutationFn: (text: string) => api.evaluate(looksLikeUrl(text) ? { jobUrl: text.trim() } : { jobDescription: text.trim() }),
    onSuccess: r => {
      setInput('')
      setParams({ id: String(r.evalId) })
      void qc.invalidateQueries({ queryKey: qk.evaluations })
      void qc.invalidateQueries({ queryKey: qk.pipeline })
    },
    onError: (err: Error) => toast.error(/AI providers failed|API key|quota/i.test(err.message)
      ? 'Scoring is down right now: the server’s AI service isn’t available. Nothing was saved; try again later.'
      : err.message),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    if (!looksLikeUrl(text) && text.length < 200) { toast.error('Paste the job link, or the whole job description'); return }
    evaluate.mutate(text)
  }

  const noResume = resume.isSuccess && !resume.data.hasResume

  return (
    <Page>
      <PageHeader title="Is this role worth your time?" description="Paste a job link or the whole description. It’s scored out of 10 against your master resume." />

      {noResume ? (
        <div className="rounded-[4px] border border-warning/40 bg-warning-soft px-5 py-4 text-[14px] text-fg">
          Upload your resume first, so there’s something to score against. <Link to="/profile/resume" className="font-medium text-accent hover:underline">Upload resume</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Textarea value={input} onChange={e => setInput(e.target.value)} rows={looksLikeUrl(input) || !input ? 2 : 8} disabled={evaluate.isPending}
            aria-label="Job link or description" placeholder="https://job-boards.greenhouse.io/…  or paste the full description" className="font-mono text-[13px]" />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" loading={evaluate.isPending} disabled={!input.trim()}>Evaluate</Button>
            {evaluate.isPending && <span className="inline-flex items-center gap-2 text-[14px] text-muted"><Spinner size={14} /> Reading the posting and scoring it. This takes up to a minute.</span>}
          </div>
        </form>
      )}

      <div className="mt-10">
        {id != null && (detail.error ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : detail.isLoading ? <Skeleton className="h-72" /> : detail.data ? <Report detail={detail.data} /> : null)}
      </div>

      <section aria-labelledby="recent-h" className="mt-12">
        <h2 id="recent-h" className="mb-2 font-display text-[22px] font-semibold text-fg">Recent evaluations</h2>
        {recent.isLoading ? <Skeleton className="h-24" /> : !recent.data?.length ? (
          <p className="border-t border-rule pt-4 text-[14px] text-subtle">Nothing evaluated yet.</p>
        ) : (
          <ul className="border-t border-rule">
            {recent.data.slice(0, 12).map(r => {
              const s = scoreOutOf10(r.score)
              return (
                <li key={r.id}>
                  <Link to={`/applications/evaluate?id=${r.id}`} aria-current={r.id === id ? 'true' : undefined}
                    className={cn('grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-3 hover:bg-hover/50', r.id === id && 'bg-hover/60')}>
                    <span className={cn('font-mono text-[15px]', TONE_TEXT[scoreTone(s)])}>{s ?? '—'}</span>
                    <span className="min-w-0 truncate"><b className="font-medium text-fg">{r.company_name}</b> <span className="text-muted">· {r.job_title}</span></span>
                    <span className="text-[13px] text-subtle">{timeAgo(r.created_at)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        {(recent.data?.length ?? 0) > 12 && <ButtonLink to="/applications/pipeline" variant="ghost" size="sm" className="mt-2">See all in Pipeline</ButtonLink>}
      </section>
    </Page>
  )
}

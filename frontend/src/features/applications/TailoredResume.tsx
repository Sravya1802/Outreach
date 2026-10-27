import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileCode, FileText, RefreshCw } from 'lucide-react'
import { api, type ProposedProject, type Tailoring, type TailoringState } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge, Button, ButtonLink, Field, Input, Spinner, useToast } from '@/ui'
import { VERDICT_LABEL, atsTone, callbackTone, tailoringHeadline } from './tailoring'

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
      if (d?.resume?.status === 'running' && d.resume.batch) return 60_000
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
            Rewritten for this job from your master resume and GitHub projects, in your own template and resume rules. It’s fact-checked so nothing is invented, scored against the posting’s keywords and by a recruiter check, and made into a one-page PDF.
          </p>
        </div>
        {r && !running && (
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={tailor.isPending} onClick={() => tailor.mutate()}>Tailor again</Button>
        )}
      </div>

      {state.isLoading ? <div className="mt-5"><Spinner /></div> : !hasResume ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="text-[14px] text-muted">Upload your master resume first.</p>
          <ButtonLink to="/profile/resume" size="sm">Go to Profile → Master resume</ButtonLink>
        </div>
      ) : !r ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<FileText className="size-4" />} loading={tailor.isPending} onClick={() => tailor.mutate()}>Tailor my resume for {company}</Button>
          <span className="text-[13px] text-subtle">A few minutes · roughly $0.10–0.25 of your AI budget</span>
        </div>
      ) : running ? (
        <p className="mt-5 flex items-center gap-2 text-[14px] text-muted" role="status"><Spinner />
          {r.batch
            ? `In tonight’s resume batch (half price). ${r.batch.phase.startsWith('revis') ? 'Revising it to meet your rules' : 'Writing it'}; usually ready within an hour.`
            : `Writing your resume for ${company}… a few minutes, with a revision if a rule or target is missed.`}
        </p>
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
  const pendingProject = rep.proposedProject?.status === 'suggested' && rep.proposedProject.onPage !== false
  const cb = rep.callback ?? null
  const failed = (a?.checks ?? []).filter(x => !x.ok)
  const gaps = rep.gaps?.length ? rep.gaps : (a?.missingYouDont ?? []).map(m => ({ term: m.term, why: m.importance === 'required' ? 'Required, and nothing you’ve shared shows it.' : 'Preferred, and nothing you’ve shared shows it.' }))

  return (
    <div className="mt-6 space-y-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <ScoreBlock label="ATS match" before={a?.before ?? null} after={score} rule={`must be above ${target}%`} tone={atsTone(score, target)} why={rep.atsWhy} />
        <ScoreBlock label="Interview callback" before={cb?.before ?? null} after={cb?.after ?? null} rule={`target ${cb?.target ?? 20}%`} tone={callbackTone(cb?.after, cb?.target ?? 20)} why={cb?.why} empty="Not estimated for this resume" />
      </div>

      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-2">
          {t.status === 'ready' ? <Badge tone="success">Ready to send</Badge>
            : t.approved_at ? <Badge tone="accent">You approved it</Badge>
            : <Badge tone="warning">Waiting on you</Badge>}
          {rep.verdict && <Badge tone={rep.verdict === 'skip' ? 'danger' : rep.verdict === 'apply' ? 'success' : 'accent'}>Verdict: {VERDICT_LABEL[rep.verdict]}</Badge>}
          <span className="text-[13px] text-subtle">Made {timeAgo(t.finished_at || t.created_at)} · cost ${Number(t.cost_usd || 0).toFixed(2)}{rep.revised ? ' · revised once to meet the rules' : ''}</span>
        </p>
        <p className="text-[14px] leading-relaxed text-muted">{tailoringHeadline(t)}</p>
        {rep.verdictWhy && rep.verdict !== 'skip' && <p className="text-[14px] leading-relaxed text-muted">{rep.verdictWhy}</p>}
        {(rep.blockers?.length ?? 0) > 0 && (
          <ul className="space-y-1 text-[14px] text-danger">{rep.blockers?.map(b => <li key={b}>· {b}</li>)}</ul>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {t.file_id && <Button icon={<Download className="size-4" />} onClick={onDownload}>Download PDF</Button>}
          {rep.tex && <Button variant="ghost" icon={<FileCode className="size-4" />} onClick={() => saveText(rep.tex ?? '', (t.filename || 'resume.pdf').replace(/\.pdf$/i, '.tex'))}>LaTeX</Button>}
          {t.status === 'needs_review' && !t.approved_at && !pendingProject && <Button variant="ghost" loading={approving} onClick={onApprove}>Send it anyway</Button>}
        </div>
      </div>

      {(rep.focus?.length ?? 0) > 0 && (
        <div>
          <h4 className="mb-2 font-medium text-fg">What {rep.title ? `the ${rep.title} role` : 'this role'} is really hiring for</h4>
          <ol className="list-decimal space-y-1 pl-5 text-[14px] leading-relaxed text-muted">{rep.focus?.map(f => <li key={f}>{f}</li>)}</ol>
        </div>
      )}

      {rep.proposedProject && <ProposedProjectCard p={rep.proposedProject} />}

      {((rep.topChanges?.length ?? 0) > 0 || rep.nextChange) && (
        <div>
          <h4 className="mb-2 font-medium text-fg">What raised the scores</h4>
          <ol className="list-decimal space-y-1 pl-5 text-[14px] leading-relaxed text-muted">{rep.topChanges?.map(c => <li key={c}>{c}</li>)}</ol>
          {rep.nextChange && <p className="mt-3 text-[14px] leading-relaxed"><span className="text-fg">One more that would raise them:</span> <span className="text-muted">{rep.nextChange}</span></p>}
        </div>
      )}

      {(a?.places?.length ?? 0) > 0 ? (
        <div>
          <h4 className="mb-2 font-medium text-fg">Keywords <span className="font-normal text-subtle">· {a?.matched.length} of {a?.keywords.length} on the page</span></h4>
          <table className="w-full text-left text-[14px]">
            <thead><tr className="border-b border-line-strong text-[12px] tracking-wide text-subtle uppercase"><th className="py-1.5 pr-3 font-normal">Keyword</th><th className="py-1.5 font-normal">Where it appears</th></tr></thead>
            <tbody>
              {a?.places?.map(p => (
                <tr key={p.term} className="border-b border-line align-top">
                  <td className="py-1.5 pr-3 text-fg">{p.term}{p.importance === 'required' && <span className="text-subtle"> · required</span>}</td>
                  <td className={cn('py-1.5', p.where.length ? 'text-muted' : 'text-danger')}>{p.where.length ? p.where.join(', ') : 'Not on the page'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (a?.matched?.length ?? 0) > 0 && (
        <div>
          <h4 className="mb-2 font-medium text-fg">Keywords on the page <span className="font-normal text-subtle">· {a?.matched.length} of {a?.keywords.length}</span></h4>
          <ul className="flex flex-wrap gap-2">
            {a?.matched.map(k => <li key={k} className="rounded-full bg-success-soft px-3 py-1 text-[13px] text-success">{k}</li>)}
          </ul>
        </div>
      )}

      {gaps.length > 0 && <MissingSkills t={t} gaps={gaps} />}

      {(rep.ruleIssues?.length ?? 0) > 0 && (
        <div>
          <h4 className="mb-2 font-medium text-fg">Resume rules still not met</h4>
          <ul className="space-y-2 text-[14px] leading-relaxed">
            {rep.ruleIssues?.map((x, i) => <li key={i}><span className="text-muted">{x.where}:</span> <span className="text-fg">{x.why}</span>{x.bullet && <span className="block text-[13px] text-subtle">{x.bullet}</span>}</li>)}
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
        <h4 className="mb-1 font-medium text-fg">Every change for this role</h4>
        {rep.notes && <p className="mb-4 text-[14px] leading-relaxed text-muted">{rep.notes}</p>}
        {(rep.projects?.length ?? 0) > 0 && (
          <div className="mb-5">
            <p className="mb-2 text-[12px] tracking-wide text-subtle uppercase">Projects chosen</p>
            <ul className="space-y-2 text-[14px] leading-relaxed">
              {rep.projects?.map(p => (
                <li key={p.name}><span className="text-fg">{p.name}</span> <span className="text-subtle">· {p.source === 'github' ? 'from GitHub' : p.source === 'planned' ? 'a project you built' : 'from your resume'}</span>{p.why && <span className="block text-muted">{p.why}</span>}</li>
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
            <p className="mb-2 text-[12px] tracking-wide text-subtle uppercase">Removed by the fact check and the rules</p>
            <ul className="space-y-2 text-[14px] leading-relaxed">
              {rep.removed?.map((x, i) => <li key={i}><span className="text-muted">{x.where}:</span> <span className="text-fg">{x.what}</span> <span className="block text-[13px] text-subtle">{x.why}</span></li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * JD skills nothing you've shared shows. Tick the ones you know: they go on
 * this resume (re-rendered and re-scored, no AI rewrite) and count as yours
 * on every resume after.
 */
function MissingSkills({ t, gaps }: { t: Tailoring; gaps: { term: string; why: string }[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [picked, setPicked] = useState<string[]>([])
  const soft = new Set((t.ats?.keywords ?? []).filter(k => k.kind === 'soft').map(k => k.term.toLowerCase()))
  const askable = gaps.filter(g => !soft.has(g.term.toLowerCase()))
  const add = useMutation({
    mutationFn: () => api.approveSkills(t.id, picked),
    onSuccess: (r) => {
      toast.success(`Added ${picked.join(', ')}. ${r.tailoring?.ats_score != null ? `ATS now ${r.tailoring.ats_score}%.` : ''}`)
      setPicked([])
      void qc.invalidateQueries({ queryKey: ['tailoring'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const toggle = (term: string) => setPicked(p => (p.includes(term) ? p.filter(x => x !== term) : [...p, term]))
  return (
    <div>
      <h4 className="mb-2 font-medium text-fg">Skills the job asks for that your resume doesn’t show</h4>
      <p className="mb-3 text-[13px] text-muted">Tick the ones you know and could talk about in an interview. They’re added to this resume and used on your next ones too.</p>
      <ul className="space-y-2 text-[14px] leading-relaxed">
        {askable.map(g => (
          <li key={g.term}>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--ui-accent)]" checked={picked.includes(g.term)} onChange={() => toggle(g.term)} />
              <span><span className="text-fg">{g.term}</span> <span className="block text-[13px] text-subtle">{g.why}</span></span>
            </label>
          </li>
        ))}
        {gaps.filter(g => soft.has(g.term.toLowerCase())).map(g => (
          <li key={g.term} className="pl-6"><span className="text-muted">{g.term}</span> <span className="block text-[13px] text-subtle">A soft skill: show it in your bullets rather than listing it.</span></li>
        ))}
      </ul>
      {askable.length > 0 && (
        <Button className="mt-3" disabled={!picked.length} loading={add.isPending} onClick={() => add.mutate()}>
          {picked.length ? `Add ${picked.length} I know` : 'Tick the ones you know'}
        </Button>
      )}
    </div>
  )
}

/** Save text as a file (the resume's .tex for Overleaf). */
function saveText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-tex' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ScoreBlock({ label, before, after, rule, tone, why, empty }: { label: string; before: number | null; after: number | null; rule: string; tone: keyof typeof TONE_TEXT; why?: string; empty?: string }) {
  return (
    <div className="rounded-[4px] border border-line bg-raised p-4">
      <p className="text-[12px] tracking-wide text-subtle uppercase">{label}</p>
      {after == null ? <p className="mt-2 text-[14px] text-subtle">{empty ?? '—'}</p> : (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span className={cn('font-display text-[48px] leading-none', TONE_TEXT[tone])}>{after}<span className="text-[22px]">%</span></span>
            {before != null && <span className="text-[13px] text-subtle">before: {before}%</span>}
          </p>
          <p className="mt-1 font-mono text-[12px] text-subtle">{rule}</p>
        </>
      )}
      {why && <p className="mt-2 text-[13px] leading-relaxed text-muted">{why}</p>}
    </div>
  )
}

/** A project the engine suggests building when the fit is weak; it goes on the resume once it's pushed. */
function ProposedProjectCard({ p }: { p: ProposedProject }) {
  const onPage = p.onPage !== false
  const qc = useQueryClient()
  const toast = useToast()
  const [repo, setRepo] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // Bracketed targets in the bullets ("[1,000]"): the user confirms the real number for each.
  const targets = p.bullets.flatMap(b => [...b.matchAll(/\[([^[\]]{1,40})\]/g)].map(m => (m[1] ?? '').trim()))
  const [values, setValues] = useState<string[]>(() => targets.map(() => ''))
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['tailoring'] }); void qc.invalidateQueries({ queryKey: qk.resumeHistory }) }
  const built = useMutation({
    mutationFn: () => api.markProjectBuilt(p.id, { repo_url: repo.trim(), start: from.trim(), end: to.trim(), values: values.map(v => v.trim()) }),
    onSuccess: (r) => { toast.success(r.tailoring ? 'Added to your resume and scored again' : 'Saved. It will be used in your next tailored resumes.'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const dismiss = useMutation({ mutationFn: () => api.dismissProject(p.id), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) })

  return (
    <section aria-labelledby={`proj-${p.id}`} className="rounded-[4px] border border-accent/40 bg-accent-soft/40 p-5">
      <p className="text-[12px] tracking-wide text-subtle uppercase">{p.status === 'suggested' && p.onPage !== false ? 'On this resume · build it before it goes out' : 'A project to build for this role'}</p>
      <h4 id={`proj-${p.id}`} className="mt-1 font-medium text-fg">{p.name}</h4>
      {p.tech.length > 0 && <p className="text-[13px] text-muted">{p.tech.join(', ')}</p>}
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        {p.why}{p.covers.length > 0 && <> Adds <span className="text-fg">{p.covers.join(', ')}</span>.</>}
        {p.projectedAts != null && p.status === 'suggested' && (p.onPage !== false && p.withoutAts != null
          ? <> It takes the ATS match from <span className="text-fg">{p.withoutAts}%</span> to <span className="text-fg">{p.projectedAts}%</span>.</>
          : p.withoutAts != null && p.projectedAts < p.withoutAts
            ? <> It isn’t on the resume yet: adding it now would push other keywords off the page (ATS {p.withoutAts}% → {p.projectedAts}%). Once it’s built, it goes on with its link and dates.</>
            : <> With it on the page, the ATS match would be <span className="text-fg">{p.projectedAts}%</span>.</>)}
      </p>
      <p className="mt-3 text-[12px] tracking-wide text-subtle uppercase">{onPage || p.status === 'built' ? 'On your resume it reads' : 'On your resume it would read'}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-fg">{p.bullets.map(b => <li key={b}>{b}</li>)}</ul>
      {p.plan.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[14px] text-accent">Build plan ({p.plan.length} steps)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px] leading-relaxed text-muted">{p.plan.map(s => <li key={s}>{s}</li>)}</ol>
        </details>
      )}
      {p.status === 'suggested' ? (
        <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); built.mutate() }}>
          <p className="text-[13px] text-muted">
            Build it from the plan, then add the dates to show and press “I built it”. The GitHub link is optional.
            {onPage ? ' Until then this resume waits for you; it’s never sent with a project you haven’t built.' : ' This resume can go out without it meanwhile.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
            <Field label="GitHub repo (optional)">{f => <Input {...f} value={repo} onChange={e => setRepo(e.target.value)} placeholder="https://github.com/you/project" inputMode="url" />}</Field>
            <Field label="Start">{f => <Input {...f} value={from} onChange={e => setFrom(e.target.value)} placeholder="Jun 2026" required />}</Field>
            <Field label="End">{f => <Input {...f} value={to} onChange={e => setTo(e.target.value)} placeholder="Aug 2026 or Present" required />}</Field>
          </div>
          {targets.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-[13px] text-muted">Your real numbers. The bullets have targets in [brackets]; enter what you actually measured for each.</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {targets.map((t, i) => (
                  <Field key={`${t}-${i}`} label={`Target ${t}`}>
                    {f => <Input {...f} value={values[i] ?? ''} onChange={e => setValues(v => v.map((x, j) => (j === i ? e.target.value : x)))} placeholder={t} required />}
                  </Field>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={built.isPending}>I built it, add it</Button>
            <Button type="button" variant="ghost" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>{onPage ? 'Take it off the resume' : 'Not for me'}</Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 text-[14px] text-muted">{p.status === 'built' ? `Built and on this resume${p.addedAt ? ` (${timeAgo(p.addedAt)})` : ''}.` : 'You passed on it. It won’t be suggested again.'}</p>
      )}
    </section>
  )
}

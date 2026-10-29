import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Sparkles } from 'lucide-react'
import { api, type PlannedProject } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { Button, EmptyState, ErrorState, Field, Input, Page, PageHeader, Skeleton, useToast } from '@/ui'

/** Profile → Projects: projects to build, picked from what your listed roles keep asking for. */
export default function ProjectsPage() {
  const qc = useQueryClient()
  const toast = useToast()
  // The server reports `suggesting` from the moment a run starts, so polling follows it.
  const state = useQuery({
    queryKey: qk.projects,
    queryFn: api.plannedProjects,
    refetchInterval: q => (q.state.data?.suggesting ? 5000 : false),
  })
  const suggest = useMutation({
    mutationFn: api.suggestProjects,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.projects }),
    onError: (e: Error) => toast.error(e.message),
  })
  const d = state.data
  const busy = suggest.isPending || Boolean(d?.suggesting)
  const toBuild = (d?.projects ?? []).filter(p => p.status === 'suggested')
  const built = (d?.projects ?? []).filter(p => p.status === 'built')

  return (
    <Page>
      <PageHeader
        title="Projects to build"
        description="Picked from the skills your recent evening-list roles keep asking for that your resume and GitHub don’t show yet. Build one and mark it built (a GitHub link is optional); from then on every tailored resume can use it."
        actions={<Button variant="primary" icon={<Sparkles className="size-4" />} loading={busy} onClick={() => suggest.mutate()}>{busy ? 'Reading your roles…' : 'Suggest from my roles'}</Button>}
      />
      {state.error ? <ErrorState error={state.error} onRetry={() => void state.refetch()} /> : state.isLoading ? <Skeleton className="h-60" /> : (
        <div className="space-y-8">
          <p className="text-[13px] text-subtle">
            {busy ? 'Reading the roles on your last two weeks of lists and what they ask for. This takes a few minutes.'
              : d?.lastRunAt ? `Last checked ${timeAgo(d.lastRunAt)}. Refreshed every Sunday morning.` : 'Refreshed every Sunday morning, or press the button.'}
            {!busy && d?.note && <span className="block text-muted">{d.note}.</span>}
          </p>

          {toBuild.length === 0 ? (
            <EmptyState title="No projects waiting" description={busy ? 'Working on it…' : 'Press “Suggest from my roles” to see what your listed roles ask for that a project could show.'} />
          ) : (
            <section aria-labelledby="build-h" className="space-y-4">
              <h2 id="build-h" className="font-display text-[20px] font-semibold text-fg">To build <span className="font-sans text-[14px] font-normal text-subtle">· {toBuild.length}</span></h2>
              {toBuild.map(p => <IdeaCard key={p.id} p={p} />)}
            </section>
          )}

          {built.length > 0 && (
            <section aria-labelledby="built-h">
              <h2 id="built-h" className="mb-2 font-display text-[20px] font-semibold text-fg">Built</h2>
              <ul className="border-t border-line">
                {built.map(p => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-3 text-[14px]">
                    <span className="font-medium text-fg">{p.name}</span>
                    <span className="text-subtle">{[p.start_date, p.end_date].filter(Boolean).join(' – ')}</span>
                    {p.repo_url && <a href={p.repo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">{p.repo_url.replace(/^https:\/\/github\.com\//, '')}<ExternalLink className="size-3" aria-hidden="true" /></a>}
                    <span className="basis-full text-[13px] text-muted">Your tailored resumes can use it where a role asks for {p.covers.slice(0, 4).join(', ') || 'what it shows'}.</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Page>
  )
}

function IdeaCard({ p }: { p: PlannedProject }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [repo, setRepo] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const refresh = () => { void qc.invalidateQueries({ queryKey: qk.projects }); void qc.invalidateQueries({ queryKey: ['tailoring'] }) }
  const built = useMutation({
    mutationFn: () => api.markProjectBuilt(p.id, { repo_url: repo.trim(), start: from.trim(), end: to.trim() }),
    onSuccess: () => { toast.success('Marked built. Your resumes can use it now.'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const dismiss = useMutation({ mutationFn: () => api.dismissProject(p.id), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) })
  const dm = p.demand

  return (
    <article className="rounded-[4px] border border-line bg-surface p-5">
      <h3 className="font-medium text-fg">{p.name}</h3>
      {p.tech.length > 0 && <p className="text-[13px] text-muted">{p.tech.join(', ')}</p>}
      {dm ? (
        <div className="mt-3">
          <p className="text-[14px] text-fg">Asked for by {dm.roles} of your {dm.of} listed roles</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {dm.keywords.map(k => <li key={k.term} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] text-accent">{k.term} · {k.roles}</li>)}
          </ul>
          {dm.examples.length > 0 && <p className="mt-2 text-[13px] text-subtle">For example {dm.examples.join('; ')}</p>}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-subtle">Suggested while tailoring a resume for one role.</p>
      )}
      {p.why && <p className="mt-3 text-[14px] leading-relaxed text-muted">{p.why}</p>}
      <p className="mt-4 text-[12px] tracking-wide text-subtle uppercase">On your resume it would read</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-fg">{p.bullets.map(b => <li key={b}>{b}</li>)}</ul>
      {p.plan.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[14px] text-accent">Build plan ({p.plan.length} steps)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px] leading-relaxed text-muted">{p.plan.map(s => <li key={s}>{s}</li>)}</ol>
        </details>
      )}
      <form className="mt-5 space-y-3 border-t border-line pt-4" onSubmit={e => { e.preventDefault(); built.mutate() }}>
        <p className="text-[13px] text-muted">Built it? Add the dates to show on your resume. The GitHub link is optional.</p>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Field label="GitHub repo (optional)">{f => <Input {...f} value={repo} onChange={e => setRepo(e.target.value)} placeholder="https://github.com/you/project" inputMode="url" />}</Field>
          <Field label="Start">{f => <Input {...f} value={from} onChange={e => setFrom(e.target.value)} placeholder="Jun 2026" required />}</Field>
          <Field label="End">{f => <Input {...f} value={to} onChange={e => setTo(e.target.value)} placeholder="Aug 2026 or Present" required />}</Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={built.isPending}>I built it</Button>
          <Button type="button" variant="ghost" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>Not for me</Button>
        </div>
      </form>
    </article>
  )
}

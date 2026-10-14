import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, CalendarClock, Download, ExternalLink, NotebookPen, Search, Trash2 } from 'lucide-react'
import { api, type EvaluationSummary, type Pipeline, type PipelineColumn } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { percent, timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, ButtonLink, ConfirmDialog, EmptyState, ErrorState, Input, Page, PageHeader, Select, Skeleton, useToast } from '@/ui'
import { STAGES, scoreOutOf10, scoreTone, stageFor } from './score'
import { FOLLOW_UP_DAYS, applyNote, followUpDays, funnel, matchesSearch, nextStepDue, updatedAt, type DueState, type Funnel } from './pipeline'
import { NotesDialog } from './NotesDialog'

const TONE_TEXT = { strong: 'text-success', ok: 'text-warning', weak: 'text-danger', none: 'text-subtle' } as const

function allItems(p: Pipeline | undefined): EvaluationSummary[] {
  return p ? STAGES.flatMap(s => p.columns[s.id]?.items ?? []) : []
}

/** Where to look for a referral: the tracked company's people, else track it first. */
function peopleLink(r: EvaluationSummary): { to: string; text: string } {
  return r.company_id
    ? { to: `/company/${r.company_id}`, text: `Find someone at ${r.company_name}` }
    : { to: `/jobs/companies?q=${encodeURIComponent(r.company_name)}`, text: `Track ${r.company_name} to find people` }
}

const FOLLOW_UP = 'followup'

function FunnelStrip({ f }: { f: Funnel }) {
  const stats = [
    { label: 'Applied', value: String(f.applied), sub: null },
    { label: 'Heard back', value: `${percent(f.heardBack, f.applied)}%`, sub: `${f.heardBack} of ${f.applied}` },
    { label: 'Interviews', value: `${percent(f.interviews, f.applied)}%`, sub: `${f.interviews} of ${f.applied}` },
    { label: 'Offers', value: String(f.offers), sub: null },
  ]
  return (
    <dl className="mb-6 grid grid-cols-2 border-y border-rule sm:grid-cols-4">
      {stats.map((st, i) => (
        <div key={st.label} className={cn('py-3', i % 2 === 1 && 'pl-4 sm:pl-0', i > 0 && 'sm:border-l sm:border-line sm:pl-5', i > 1 && 'border-t border-line sm:border-t-0')}>
          <dt className="text-[13px] text-muted">{st.label}</dt>
          <dd className="mt-0.5 font-mono text-[22px] text-fg">
            {st.value}{st.sub && <span className="ml-2 text-[12px] text-subtle">{st.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const DUE_TEXT: Record<DueState, string> = { overdue: 'text-danger', today: 'text-warning', soon: 'text-fg', later: 'text-muted' }

export default function PipelinePage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [confirm, setConfirm] = useState<EvaluationSummary | null>(null)
  const [editing, setEditing] = useState<EvaluationSummary | null>(null)
  const pipeline = useQuery({ queryKey: qk.pipeline, queryFn: api.pipeline })

  const stageParam = params.get('stage')
  const followUpOnly = stageParam === FOLLOW_UP
  const stage = STAGES.some(s => s.id === stageParam) ? stageParam as PipelineColumn : null
  const sort = params.get('sort') === 'score' ? 'score' : 'recent'
  const query = params.get('q') ?? ''

  // When the list was fetched; keeps render pure and the day counts stable.
  const now = pipeline.dataUpdatedAt
  const everything = allItems(pipeline.data)
  const followUpCount = everything.filter(r => followUpDays(r, now) != null).length
  const items = everything
    .filter(r => followUpOnly ? followUpDays(r, now) != null : !stage || stageFor(r.apply_status) === stage)
    .filter(r => matchesSearch(r, query))
    .sort((a, b) => sort === 'score'
      ? (b.score ?? 0) - (a.score ?? 0)
      : new Date(updatedAt(b)).getTime() - new Date(updatedAt(a)).getTime())

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.pipeline })
    void qc.invalidateQueries({ queryKey: qk.evaluations })
  }
  const move = useMutation({
    mutationFn: ({ id, column }: { id: number; column: PipelineColumn }) => api.setApplyStatus(id, STAGES.find(s => s.id === column)?.status ?? 'not_started'),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  })
  const download = useMutation({
    mutationFn: (r: EvaluationSummary) => api.downloadResumeFile(r.resume_file_id ?? 0, r.resume_filename || 'resume.pdf'),
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteEvaluation(id),
    onSuccess: () => { setConfirm(null); toast.success('Removed'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })

  const totals = pipeline.data?.totals
  const stats = funnel(everything)

  return (
    <Page wide>
      <PageHeader
        title="Pipeline"
        description="Every role you’ve evaluated or applied to, in one list. Change a stage when you hear back."
        actions={<ButtonLink to="/applications/evaluate" variant="primary">Evaluate a role</ButtonLink>}
      />

      {stats.applied > 0 && <FunnelStrip f={stats} />}

      {followUpCount > 0 && !followUpOnly && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-warning/40 bg-warning-soft px-4 py-3 text-[14px]">
          <p className="flex items-start gap-2.5 text-fg">
            <BellRing className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <span>
              <b className="font-medium">{followUpCount} {followUpCount === 1 ? 'application hasn’t' : 'applications haven’t'} heard back in over a week.</b>{' '}
              <span className="text-muted">A referral or a short follow-up note often gets a reply.</span>
            </span>
          </p>
          <Button size="sm" onClick={() => set('stage', FOLLOW_UP)}>Show {followUpCount === 1 ? 'it' : 'them'}</Button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Stage" className="flex flex-wrap gap-2 text-[14px]">
          <button type="button" onClick={() => set('stage', null)} aria-pressed={!stage && !followUpOnly}
            className={cn('rounded-full px-3.5 py-1.5', !stage && !followUpOnly ? 'bg-fg text-canvas' : 'border border-line-strong text-muted hover:text-fg')}>
            All · {pipeline.data?.total ?? 0}
          </button>
          {STAGES.map(s => (
            <button key={s.id} type="button" onClick={() => set('stage', s.id)} aria-pressed={stage === s.id}
              className={cn('rounded-full px-3.5 py-1.5', stage === s.id ? 'bg-fg text-canvas' : 'border border-line-strong text-muted hover:text-fg')}>
              {s.label} · {totals?.[s.id] ?? 0}
            </button>
          ))}
          {followUpCount > 0 && (
            <button type="button" onClick={() => set('stage', FOLLOW_UP)} aria-pressed={followUpOnly}
              className={cn('flex items-center gap-1.5 rounded-full px-3.5 py-1.5', followUpOnly ? 'bg-warning text-canvas' : 'border border-warning/50 text-warning hover:bg-warning-soft')}>
              <BellRing className="size-3.5" aria-hidden="true" /> Follow up · {followUpCount}
            </button>
          )}
        </nav>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <label className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
            <span className="sr-only">Search applications</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <Input type="search" value={query} placeholder="Search company, role, notes" className="pl-9"
              onChange={e => set('q', e.target.value || null)} />
          </label>
          <div className="w-40">
          <Select value={sort} onChange={e => set('sort', e.target.value === 'score' ? 'score' : null)} aria-label="Sort">
            <option value="recent">Most recent</option>
            <option value="score">Highest score</option>
          </Select>
          </div>
        </div>
      </div>

      {pipeline.error ? <ErrorState error={pipeline.error} onRetry={() => pipeline.refetch()} /> : pipeline.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : items.length === 0 ? (
        <div className="border-t border-rule">
          {query && everything.length > 0 ? (
            <EmptyState title={`Nothing matches “${query}”`} action={<Button size="sm" onClick={() => set('q', null)}>Clear search</Button>} />
          ) : (
            <EmptyState title={followUpOnly ? 'Nothing to follow up on' : stage ? 'Nothing at this stage' : 'No applications yet'}
              description={followUpOnly ? `Applications show up here after ${FOLLOW_UP_DAYS} days with no reply.` : stage ? undefined : 'Evaluate a role, or track one from Jobs → Roles, and it shows up here.'}
              action={!stage && !followUpOnly ? <ButtonLink to="/jobs/roles/intern" size="sm">Browse roles</ButtonLink> : undefined} />
          )}
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse border-t border-rule text-[14px]">
            <thead>
              <tr className="text-left text-[13px] text-subtle">
                <th className="py-3 pr-3 font-medium">Score</th>
                <th className="px-3 py-3 font-medium">Company and role</th>
                <th className="px-3 py-3 font-medium">Resume</th>
                <th className="px-3 py-3 font-medium">Stage</th>
                <th className="px-3 py-3 font-medium">Updated</th>
                <th className="py-3 pl-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => {
                const s = scoreOutOf10(r.score)
                const col = stageFor(r.apply_status)
                const quiet = followUpDays(r, now)
                const people = peopleLink(r)
                const due = nextStepDue(r.next_step_at)
                const how = applyNote(r)
                return (
                  <tr key={r.id} className="border-t border-line">
                    <td className={cn('py-3 pr-3 font-mono text-[15px]', TONE_TEXT[scoreTone(s)])}>{s ?? '—'}</td>
                    <td className="px-3 py-3">
                      <Link to={`/applications/evaluate?id=${r.id}`} className="hover:text-accent">
                        <b className="font-medium text-fg">{r.company_name}</b> <span className="text-muted">· {r.job_title}</span>
                      </Link>
                      {quiet != null && (
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px]">
                          <span className="text-warning">No reply in {quiet} days</span>
                          <span className="text-subtle" aria-hidden="true">·</span>
                          <Link to={people.to} className="text-accent hover:underline">{people.text}</Link>
                        </p>
                      )}
                      {(r.next_step || due) && (
                        <p className={cn('mt-1 flex items-center gap-1.5 text-[13px]', due ? DUE_TEXT[due.state] : 'text-muted')}>
                          <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                          <span>{r.next_step || 'Next step'}{due && <> · {due.state === 'overdue' ? `was due ${due.label === 'Yesterday' ? 'yesterday' : due.label}` : due.label}</>}</span>
                        </p>
                      )}
                      {how && <p className={cn('mt-0.5 text-[12px]', how.tone === 'danger' ? 'text-danger' : 'text-subtle')}>{how.text}</p>}
                      {r.notes && <p className="mt-0.5 max-w-[420px] truncate text-[13px] text-subtle" title={r.notes}>{r.notes}</p>}
                    </td>
                    <td className="max-w-[220px] px-3 py-3">
                      {r.resume_file_id ? (
                        <button type="button" onClick={() => download.mutate(r)} title={`Download ${r.resume_filename}`}
                          className="flex max-w-full items-center gap-1.5 text-left text-[13px] text-muted hover:text-accent">
                          <Download className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{r.resume_filename}</span>
                        </button>
                      ) : <span className="text-[13px] text-subtle">—</span>}
                      {r.resume_file_id && <p className="mt-0.5 text-[12px] text-subtle">{r.resume_sent ? 'Sent with the application' : 'Ready to send'}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <Select value={col} aria-label={`Stage for ${r.company_name}`} className="h-8 w-40 text-[13px]"
                        disabled={move.isPending} onChange={e => move.mutate({ id: r.id, column: e.target.value as PipelineColumn })}>
                        {STAGES.map(st => <option key={st.id} value={st.id}>{st.label}</option>)}
                      </Select>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-subtle">{timeAgo(updatedAt(r))}</td>
                    <td className="py-3 pl-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" aria-label={`Notes and next step for ${r.company_name}`} title="Notes and next step" onClick={() => setEditing(r)}
                          className={r.notes || r.next_step || r.next_step_at ? 'text-accent!' : undefined} icon={<NotebookPen className="size-3.5" />} />
                        {r.job_url && (
                          <a href={r.job_url} target="_blank" rel="noreferrer" aria-label={`Open the ${r.company_name} posting`}
                            className="grid size-8 place-items-center rounded-[4px] text-subtle hover:bg-hover hover:text-fg"><ExternalLink className="size-4" /></a>
                        )}
                        <Button variant="ghost" size="sm" aria-label={`Remove ${r.company_name}`} onClick={() => setConfirm(r)} icon={<Trash2 className="size-3.5" />} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <NotesDialog key={editing.id} row={editing} onClose={() => setEditing(null)} onSaved={refresh} />}

      <ConfirmDialog
        open={confirm != null}
        title="Remove from your pipeline?"
        description={confirm ? `${confirm.company_name} · ${confirm.job_title} and its evaluation are deleted.` : ''}
        confirmLabel="Remove"
        danger
        busy={remove.isPending}
        onConfirm={() => confirm && remove.mutate(confirm.id)}
        onCancel={() => setConfirm(null)}
      />
    </Page>
  )
}

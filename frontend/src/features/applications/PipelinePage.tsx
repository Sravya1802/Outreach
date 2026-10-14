import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, Trash2 } from 'lucide-react'
import { api, type EvaluationSummary, type Pipeline, type PipelineColumn } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, ButtonLink, ConfirmDialog, EmptyState, ErrorState, Page, PageHeader, Select, Skeleton, useToast } from '@/ui'
import { STAGES, scoreOutOf10, scoreTone, stageFor } from './score'

const TONE_TEXT = { strong: 'text-success', ok: 'text-warning', weak: 'text-danger', none: 'text-subtle' } as const

function allItems(p: Pipeline | undefined): EvaluationSummary[] {
  return p ? STAGES.flatMap(s => p.columns[s.id]?.items ?? []) : []
}

export default function PipelinePage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [confirm, setConfirm] = useState<EvaluationSummary | null>(null)
  const pipeline = useQuery({ queryKey: qk.pipeline, queryFn: api.pipeline })

  const stageParam = params.get('stage') as PipelineColumn | null
  const stage = STAGES.some(s => s.id === stageParam) ? stageParam : null
  const sort = params.get('sort') === 'score' ? 'score' : 'recent'

  const items = allItems(pipeline.data)
    .filter(r => !stage || stageFor(r.apply_status) === stage)
    .sort((a, b) => sort === 'score'
      ? (b.score ?? 0) - (a.score ?? 0)
      : new Date(b.applied_at || b.created_at).getTime() - new Date(a.applied_at || a.created_at).getTime())

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

  return (
    <Page wide>
      <PageHeader
        title="Pipeline"
        description="Every role you’ve evaluated or applied to, in one list. Change a stage when you hear back."
        actions={<ButtonLink to="/applications/evaluate" variant="primary">Evaluate a role</ButtonLink>}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Stage" className="flex flex-wrap gap-2 text-[14px]">
          <button type="button" onClick={() => set('stage', null)} aria-pressed={!stage}
            className={cn('rounded-full px-3.5 py-1.5', !stage ? 'bg-fg text-canvas' : 'border border-line-strong text-muted hover:text-fg')}>
            All · {pipeline.data?.total ?? 0}
          </button>
          {STAGES.map(s => (
            <button key={s.id} type="button" onClick={() => set('stage', s.id)} aria-pressed={stage === s.id}
              className={cn('rounded-full px-3.5 py-1.5', stage === s.id ? 'bg-fg text-canvas' : 'border border-line-strong text-muted hover:text-fg')}>
              {s.label} · {totals?.[s.id] ?? 0}
            </button>
          ))}
        </nav>
        <Select value={sort} onChange={e => set('sort', e.target.value === 'score' ? 'score' : null)} aria-label="Sort" className="w-44">
          <option value="recent">Most recent</option>
          <option value="score">Highest score</option>
        </Select>
      </div>

      {pipeline.error ? <ErrorState error={pipeline.error} onRetry={() => pipeline.refetch()} /> : pipeline.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : items.length === 0 ? (
        <div className="border-t border-rule">
          <EmptyState title={stage ? 'Nothing at this stage' : 'No applications yet'}
            description={stage ? undefined : 'Evaluate a role, or track one from Jobs → Roles, and it shows up here.'}
            action={!stage ? <ButtonLink to="/jobs/roles/intern" size="sm">Browse roles</ButtonLink> : undefined} />
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
                return (
                  <tr key={r.id} className="border-t border-line">
                    <td className={cn('py-3 pr-3 font-mono text-[15px]', TONE_TEXT[scoreTone(s)])}>{s ?? '—'}</td>
                    <td className="px-3 py-3">
                      <Link to={`/applications/evaluate?id=${r.id}`} className="hover:text-accent">
                        <b className="font-medium text-fg">{r.company_name}</b> <span className="text-muted">· {r.job_title}</span>
                      </Link>
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
                    <td className="px-3 py-3 text-[13px] text-subtle">{timeAgo(r.applied_at || r.created_at)}</td>
                    <td className="py-3 pl-3">
                      <div className="flex justify-end gap-1">
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

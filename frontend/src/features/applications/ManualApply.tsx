import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Button, ConfirmDialog, Spinner, useToast } from '@/ui'
import { appCouldNotSend, appliedLabel, autoSite, isApplying } from './applied'

/**
 * How to apply to one role: the app does it (Apply for me, on sites it can
 * submit to), or you do (Apply opens the employer's form, then I applied).
 */
export function ManualApply({ evalId, company, jobUrl, applied, appliedAt, applyStatus, compact = false, className }: {
  evalId: number
  company?: string
  jobUrl: string | null | undefined
  applied: boolean
  appliedAt?: string | null
  /** evaluations.apply_status, to show the app's progress. */
  applyStatus?: string | null
  compact?: boolean
  className?: string
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const site = autoSite(jobUrl)
  const refresh = () => {
    for (const key of [qk.evaluation(evalId), qk.resumeJobs, qk.resumeHistory, qk.pipeline, qk.tracker, qk.dailyPlan, qk.evaluations, qk.jobMetrics]) {
      void qc.invalidateQueries({ queryKey: key })
    }
  }
  const mark = useMutation({
    mutationFn: () => api.markApplied(evalId),
    onSuccess: () => { toast.success('Marked as applied. The resume for this role is recorded as sent.'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const auto = useMutation({
    mutationFn: () => api.applyForMe(evalId),
    onSuccess: () => {
      setConfirm(false)
      toast.success(`Applying${company ? ` to ${company}` : ''}. It takes a minute or two, then it moves to Applied.`)
      refresh()
      // The submit runs on the server; look again once it has had time to finish.
      window.setTimeout(refresh, 90_000)
    },
    onError: (e: Error) => { setConfirm(false); toast.error(e.message) },
  })
  // Rows in clickable tables open the job; these buttons shouldn't.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  const small = compact ? 'h-7 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[14px]'

  if (applied) {
    return <span className={cn('inline-flex items-center gap-1 text-[13px] whitespace-nowrap text-success', className)}><Check className="size-3.5" aria-hidden="true" />{appliedLabel(appliedAt)}</span>
  }
  if (isApplying(applyStatus) || auto.isSuccess) {
    return <span className={cn('inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-muted', className)}><Spinner size={12} /> Applying for you…</span>
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5', compact ? 'flex-nowrap' : 'flex-wrap', className)} onClick={stop}>
      {site && (
        <button type="button" onClick={() => setConfirm(true)} title={`The app fills in the ${site} form and submits it`}
          className={cn('inline-flex items-center rounded-[4px] bg-accent font-semibold whitespace-nowrap text-on-accent hover:bg-accent-hover', small)}>
          Apply for me
        </button>
      )}
      {jobUrl && (
        <a href={jobUrl} target="_blank" rel="noreferrer" onClick={stop} title="Open the employer’s application and apply yourself"
          className={cn('inline-flex items-center gap-1 rounded-[4px] font-semibold whitespace-nowrap',
            site ? 'border border-line-strong text-fg hover:bg-hover' : 'bg-accent text-on-accent hover:bg-accent-hover', small)}>
          Apply <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      )}
      <Button size="sm" variant="ghost" loading={mark.isPending} onClick={() => mark.mutate()}
        className={compact ? 'h-7 px-2 text-[12px]' : undefined}>I applied</Button>
      {appCouldNotSend(applyStatus) && <span className="text-[12px] whitespace-nowrap text-warning" title="The app tried and couldn’t send this one. Apply yourself.">App couldn’t send it</span>}
      <ConfirmDialog
        open={confirm}
        title={`Apply${company ? ` to ${company}` : ''} for you?`}
        description={<>Scout’n’Jobs fills in the {site} form with your details and saved answers, attaches the resume set for this role, and submits it. Once sent, it can’t be taken back. If the form asks something new, it stops and asks you instead.</>}
        confirmLabel="Apply for me"
        busy={auto.isPending}
        onConfirm={() => auto.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </span>
  )
}

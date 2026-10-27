import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Button, useToast } from '@/ui'
import { appliedLabel } from './applied'

/**
 * Apply yourself: open the employer's application, then mark it applied.
 * Marking records the resume set for this role as the one sent.
 */
export function ManualApply({ evalId, jobUrl, applied, appliedAt, compact = false, className }: {
  evalId: number
  jobUrl: string | null | undefined
  applied: boolean
  appliedAt?: string | null
  compact?: boolean
  className?: string
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const mark = useMutation({
    mutationFn: () => api.markApplied(evalId),
    onSuccess: () => {
      toast.success('Marked as applied. The resume for this role is recorded as sent.')
      for (const key of [qk.evaluation(evalId), qk.resumeJobs, qk.resumeHistory, qk.pipeline, qk.tracker, qk.dailyPlan, qk.evaluations, qk.jobMetrics]) {
        void qc.invalidateQueries({ queryKey: key })
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })
  // Rows in clickable tables open the job; these buttons shouldn't.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  if (applied) {
    return <span className={cn('inline-flex items-center gap-1 text-[13px] whitespace-nowrap text-success', className)}><Check className="size-3.5" aria-hidden="true" />{appliedLabel(appliedAt)}</span>
  }
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)} onClick={stop}>
      {jobUrl && (
        <a href={jobUrl} target="_blank" rel="noreferrer" onClick={stop}
          className={cn('inline-flex items-center gap-1 rounded-[4px] bg-accent font-semibold whitespace-nowrap text-on-accent hover:bg-accent-hover',
            compact ? 'h-7 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[14px]')}>
          Apply <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      )}
      <Button size="sm" variant={compact ? 'ghost' : 'secondary'} loading={mark.isPending} onClick={() => mark.mutate()}
        className={compact ? 'h-7 px-2 text-[12px]' : undefined}>I applied</Button>
    </span>
  )
}

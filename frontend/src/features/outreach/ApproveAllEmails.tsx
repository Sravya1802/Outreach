import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { Button, ConfirmDialog, useToast } from '@/ui'
import { approveAllLabel, approveAllText, approvedLine, skipLine } from './scheduled'

/**
 * Approve all: schedules every outreach email Claude has finished writing, for
 * one role (`role`) or all of them. Skipped ones are counted with the reason.
 */
export function ApproveAllEmails({ role, onDone }: { role?: string; onDone?: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const preview = useQuery({ queryKey: ['approve-all-preview', role ?? 'all'], queryFn: () => api.approveAllPreview(role), staleTime: 60_000, refetchInterval: 5 * 60_000 })
  const approve = useMutation({
    mutationFn: () => api.approveAllOutreach(role),
    onSuccess: r => {
      setOpen(false)
      if (r.approved) toast.success(approvedLine(r))
      else toast.error(approvedLine(r))
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['approve-all-preview'] })
      void qc.invalidateQueries({ queryKey: qk.outbox })
      void qc.invalidateQueries({ queryKey: qk.review })
      onDone?.()
    },
  })
  const p = preview.data
  if (!p || (!p.approved && !p.skipped)) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button size="sm" variant="primary" disabled={!p.approved || !gmail.data?.connected} loading={approve.isPending} onClick={() => setOpen(true)}>
        {approveAllLabel(p)}
      </Button>
      {!gmail.data?.connected && <span className="text-[13px] text-warning">Connect Gmail under Integrations → Gmail first.</span>}
      {p.skipped > 0 && <span className="text-[13px] text-muted">{skipLine(p)}</span>}
      <ConfirmDialog
        open={open}
        title={`Approve ${p.approved === 1 ? 'this email' : `all ${p.approved} emails`}?`}
        description={approveAllText(p, gmail.data?.daily_cap ?? 450)}
        confirmLabel="Approve and schedule"
        busy={approve.isPending}
        onConfirm={() => approve.mutate()}
        onCancel={() => { if (!approve.isPending) setOpen(false) }}
      />
    </div>
  )
}

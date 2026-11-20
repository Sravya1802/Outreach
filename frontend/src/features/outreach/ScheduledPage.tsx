import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type OutboxItem } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { Button, ButtonLink, ConfirmDialog, EmptyState, ErrorState, Page, PageHeader, Skeleton, useToast } from '@/ui'
import { notSent, scheduledDays, sendTimeLabel } from './scheduled'
import { ApproveAllEmails } from './ApproveAllEmails'

/** Every approved email waiting for its send time, with Cancel and Send now. */
export default function ScheduledPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const outbox = useQuery({ queryKey: qk.outbox, queryFn: api.outbox, enabled: Boolean(gmail.data?.connected), refetchInterval: 30_000 })
  const [cancelling, setCancelling] = useState<OutboxItem | null>(null)
  const [sending, setSending] = useState<OutboxItem | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.outbox })
    void qc.invalidateQueries({ queryKey: ['approve-all-preview'] })
  }
  const cancel = useMutation({
    mutationFn: (id: number) => api.cancelOutbox(id),
    onSuccess: () => { setCancelling(null); toast.success('Cancelled. It won’t be sent.'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const sendNow = useMutation({
    mutationFn: (id: number) => api.sendOutboxNow(id),
    onSuccess: r => { setSending(null); toast.success(`Sent to ${r.to_name || r.to_email}.`); refresh() },
    onError: (e: Error) => { setSending(null); toast.error(e.message); refresh() },
  })

  if (gmail.isLoading) return <Page><Skeleton className="h-64" /></Page>
  if (!gmail.data?.connected) {
    return (
      <Page>
        <PageHeader title="Scheduled" description="Approved emails waiting for their send time." />
        <div className="border-t border-rule">
          <EmptyState title="Connect your Gmail first" description="Outreach sends from your own address." action={<ButtonLink to="/integrations/gmail" variant="primary" size="sm">Connect Gmail</ButtonLink>} />
        </div>
      </Page>
    )
  }
  const items = outbox.data ?? []
  const days = scheduledDays(items)
  const total = days.reduce((n, d) => n + d.items.length, 0)
  const held = notSent(items)
  const cap = gmail.data.daily_cap ?? 450

  return (
    <Page>
      <PageHeader
        title="Scheduled"
        description={`${total} approved ${total === 1 ? 'email' : 'emails'} from ${gmail.data.email}. Each goes on a business morning, 8–10 AM in the recipient’s time zone, 2 to 4 minutes apart, at most ${cap} a day. Each carries its role’s latest tailored resume.`}
      />
      <div className="mb-6"><ApproveAllEmails onDone={refresh} /></div>

      {outbox.error ? <ErrorState error={outbox.error} onRetry={() => outbox.refetch()} /> : outbox.isLoading ? <Skeleton className="h-40" /> : total === 0 ? (
        <div className="border-t border-rule">
          <EmptyState title="Nothing scheduled" description="Approve the emails your Claude run has written, on the Review queue or a role’s page, and they show here with their send times." action={<ButtonLink to="/review" size="sm">Review queue</ButtonLink>} />
        </div>
      ) : days.map(d => (
        <section key={d.day} className="mb-8" aria-label={d.day}>
          <h2 className="border-b border-rule pb-2 font-display text-[18px] font-semibold text-fg">
            {d.day} <span className="text-[14px] font-normal text-muted">· {d.items.length} {d.items.length === 1 ? 'email' : 'emails'}{d.items.length >= cap ? ' (the day’s limit)' : ''}</span>
          </h2>
          <ul>
            {d.items.map(i => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px]">
                    <b className="font-medium text-fg">{i.to_name || i.to_email}</b>
                    {i.company_name && <span className="text-muted"> · {i.company_name}</span>}
                  </p>
                  <p className="text-[13px] text-subtle">{i.to_email}{i.email_guessed && <span className="text-warning"> · guessed address, may bounce</span>}</p>
                  {i.role_title && (
                    <p className="text-[13px] text-muted">
                      {i.role_id ? <Link to={`/review/${i.role_id}`} className="hover:text-accent">{i.role_title}</Link> : i.role_title}
                      {i.resume_version ? ` · resume v${i.resume_version}` : ''}
                    </p>
                  )}
                  <p className="mt-1 truncate text-[13px] text-subtle">{i.subject}</p>
                  {i.error && <p className="mt-1 text-[13px] text-warning">{i.error}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <p className="font-mono text-[13px] text-fg">{sendTimeLabel(i)}</p>
                  {i.status === 'scheduled' && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setCancelling(i)}>Cancel</Button>
                      <Button size="sm" onClick={() => setSending(i)}>Send now</Button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {held.length > 0 && (
        <section className="mb-8" aria-labelledby="held-h">
          <h2 id="held-h" className="border-b border-rule pb-2 font-display text-[18px] font-semibold text-fg">Held back before sending</h2>
          <ul>
            {held.slice(0, 20).map(i => (
              <li key={i.id} className="border-b border-line py-3 text-[14px]">
                <b className="font-medium text-fg">{i.to_name || i.to_email}</b>{i.company_name && <span className="text-muted"> · {i.company_name}</span>}
                <p className="text-[13px] text-danger">{i.error}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={cancelling != null}
        title="Cancel this email?"
        description={cancelling ? `To ${cancelling.to_name || cancelling.to_email}: “${cancelling.subject}”. It won’t be sent.` : ''}
        confirmLabel="Cancel it"
        danger
        busy={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        onCancel={() => setCancelling(null)}
      />
      <ConfirmDialog
        open={sending != null}
        title="Send this email now?"
        description={sending ? `To ${sending.to_name || sending.to_email} at ${sending.to_email}, from your Gmail, right away instead of ${sendTimeLabel(sending)}. It counts toward today’s ${cap}.` : ''}
        confirmLabel="Send now"
        busy={sendNow.isPending}
        onConfirm={() => sending && sendNow.mutate(sending.id)}
        onCancel={() => { if (!sendNow.isPending) setSending(null) }}
      />
    </Page>
  )
}

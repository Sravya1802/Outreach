import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api, type OutboxItem } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { Badge, Button, ButtonLink, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, Page, PageHeader, Skeleton, Textarea, useToast } from '@/ui'
import { STEP_LABEL, groupThreads, itemStatus, replyText } from './outbox'

export default function OutboxPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const outbox = useQuery({ queryKey: qk.outbox, queryFn: api.outbox, enabled: Boolean(gmail.data?.connected), refetchInterval: 60_000 })
  const replies = useQuery({ queryKey: qk.replies, queryFn: api.replies, enabled: Boolean(gmail.data?.connected), refetchInterval: 120_000 })
  const [editing, setEditing] = useState<OutboxItem | null>(null)
  const [cancelling, setCancelling] = useState<OutboxItem | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.outbox })
    void qc.invalidateQueries({ queryKey: qk.replies })
    void qc.invalidateQueries({ queryKey: qk.gmail })
  }

  const check = useMutation({
    mutationFn: api.checkReplies,
    onSuccess: r => { toast.success(r.events ? `${r.events} new` : 'No new replies'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const cancel = useMutation({
    mutationFn: (id: number) => api.cancelOutbox(id),
    onSuccess: () => { setCancelling(null); toast.success('Cancelled'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })

  if (gmail.isLoading) return <Page><Skeleton className="h-64" /></Page>
  if (!gmail.data?.connected) {
    return (
      <Page>
        <PageHeader title="Outbox" description="Emails scheduled from your Gmail, their follow-ups, and the replies that came back." />
        <div className="border-t border-rule">
          <EmptyState title="Connect your Gmail first" description="Outreach sends from your own address, so replies come to you and can be tracked here."
            action={<ButtonLink to="/settings/gmail" variant="primary" size="sm">Connect Gmail</ButtonLink>} />
        </div>
      </Page>
    )
  }

  const threads = groupThreads(outbox.data ?? [])
  const scheduled = (outbox.data ?? []).filter(i => i.status === 'scheduled').length
  const replyList = replies.data ?? []

  return (
    <Page>
      <PageHeader
        title="Outbox"
        description={`From ${gmail.data.email}. ${scheduled} scheduled · inbox checked ${timeAgo(gmail.data.last_checked_at)}.`}
        actions={<Button icon={<RefreshCw className="size-4" />} loading={check.isPending} onClick={() => check.mutate()}>Check for replies</Button>}
      />

      <section aria-labelledby="replies-h" className="mb-10">
        <h2 id="replies-h" className="mb-2 font-display text-[20px] font-semibold text-fg">Replies</h2>
        {replies.error ? <ErrorState error={replies.error} onRetry={() => replies.refetch()} /> : replies.isLoading ? <Skeleton className="h-16" /> : replyList.length === 0 ? (
          <p className="border-t border-rule py-4 text-[14px] text-subtle">Nothing yet. Replies, LinkedIn messages and accepted invitations show up here within 10 minutes.</p>
        ) : (
          <ul className="border-t border-rule">
            {replyList.map(r => (
              <li key={r.id} className="border-b border-line py-3">
                <p className="flex flex-wrap items-center gap-2 text-[14px]">
                  <span className="font-medium text-fg">{replyText(r)}</span>
                  {r.company_name && (r.company_id ? <Link to={`/company/${r.company_id}`} className="text-muted hover:text-accent">{r.company_name}</Link> : <span className="text-muted">{r.company_name}</span>)}
                  <Badge tone={r.kind === 'reply' || r.kind === 'linkedin_message' ? 'success' : r.kind === 'bounce' ? 'danger' : 'neutral'}>{r.channel === 'linkedin' ? 'LinkedIn' : 'Email'}</Badge>
                  <span className="text-[13px] text-subtle">{timeAgo(r.received_at)}</span>
                </p>
                {r.snippet && r.kind !== 'linkedin_accept' && <p className="mt-1 text-[14px] leading-relaxed text-muted">{r.snippet}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="threads-h">
        <h2 id="threads-h" className="mb-2 font-display text-[20px] font-semibold text-fg">Emails</h2>
        {outbox.error ? <ErrorState error={outbox.error} onRetry={() => outbox.refetch()} /> : outbox.isLoading ? <Skeleton className="h-32" /> : threads.length === 0 ? (
          <div className="border-t border-rule">
            <EmptyState title="No emails yet" description="Write to someone from a company’s People list and choose “Send at the best time”."
              action={<ButtonLink to="/jobs/companies" size="sm">Browse companies</ButtonLink>} />
          </div>
        ) : (
          <ul className="border-t border-rule">
            {threads.map(t => (
              <li key={t.root.id} className="border-b border-line py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[15px]">
                    <b className="font-medium text-fg">{t.root.to_name || t.root.to_email}</b>
                    {t.root.company_name && <span className="text-muted"> · {t.root.company_id ? <Link to={`/company/${t.root.company_id}`} className="hover:text-accent">{t.root.company_name}</Link> : t.root.company_name}</span>}
                  </p>
                  {t.root.contact_status === 'replied' && <Badge tone="success">Replied</Badge>}
                </div>
                <p className="truncate text-[13px] text-subtle">{t.root.subject}</p>
                <ol className="mt-3 space-y-1.5">
                  {[t.root, ...t.followups].map(it => {
                    const st = itemStatus(it)
                    return (
                      <li key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                        <span className="w-24 shrink-0 text-subtle">{STEP_LABEL[it.step]}</span>
                        <span className={st.tone === 'success' ? 'text-success' : st.tone === 'danger' ? 'text-danger' : st.tone === 'warning' ? 'text-fg' : 'text-muted'}>{st.text}</span>
                        {it.status === 'scheduled' && (
                          <span className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>Edit</Button>
                            <Button size="sm" variant="ghost" onClick={() => setCancelling(it)}>Cancel</Button>
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <EditDialog item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
      <ConfirmDialog
        open={cancelling != null}
        title={cancelling?.step === 0 ? 'Cancel this email and its follow-ups?' : 'Cancel this follow-up?'}
        description={cancelling ? `To ${cancelling.to_name || cancelling.to_email}: “${cancelling.subject}”` : ''}
        confirmLabel="Cancel it"
        danger
        busy={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        onCancel={() => setCancelling(null)}
      />
    </Page>
  )
}

function EditDialog({ item, onClose, onSaved }: { item: OutboxItem; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [subject, setSubject] = useState(item.subject)
  const [body, setBody] = useState(item.body)
  const save = useMutation({
    mutationFn: () => api.editOutbox(item.id, { subject, body }),
    onSuccess: () => { toast.success('Saved'); onSaved() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onClose={onClose} label="Edit email" className="max-w-xl">
      <div className="space-y-3 p-5">
        <h3 className="font-display text-[20px] font-semibold text-fg">Edit {STEP_LABEL[item.step].toLowerCase()}</h3>
        <Field label="Subject">{f => <Input {...f} value={subject} onChange={e => setSubject(e.target.value)} />}</Field>
        <Field label="Message">{f => <Textarea {...f} rows={10} value={body} onChange={e => setBody(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  )
}

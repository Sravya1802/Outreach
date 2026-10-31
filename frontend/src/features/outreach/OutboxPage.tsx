import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Paperclip, RefreshCw } from 'lucide-react'
import { api, type OutboxItem } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { Badge, Button, ButtonLink, ConfirmDialog, EmptyState, ErrorState, Page, PageHeader, Skeleton, useToast } from '@/ui'
import { STEP_LABEL, cityOf, draftsOf, groupThreads, itemStatus, replyText } from './outbox'
import { EditEmailDialog } from './EditEmailDialog'

export default function OutboxPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const gmail = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const outbox = useQuery({ queryKey: qk.outbox, queryFn: api.outbox, enabled: Boolean(gmail.data?.connected), refetchInterval: 60_000 })
  const replies = useQuery({ queryKey: qk.replies, queryFn: api.replies, enabled: Boolean(gmail.data?.connected), refetchInterval: 120_000 })
  const [editing, setEditing] = useState<OutboxItem | null>(null)
  const [cancelling, setCancelling] = useState<OutboxItem | null>(null)
  const [approvingAll, setApprovingAll] = useState<{ company: string; items: OutboxItem[] } | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
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
    onSuccess: r => { setCancelling(null); toast.success(r.cancel_reason === 'You discarded it' ? 'Discarded' : 'Cancelled'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })

  // One at a time: each approval reads (and removes) the draft's copy in Gmail.
  const approveAll = useMutation({
    mutationFn: async (items: OutboxItem[]) => {
      let done = 0
      const failed: string[] = []
      for (const item of items) {
        setProgress(`Approving ${done + failed.length + 1} of ${items.length}…`)
        try { await api.approveOutbox(item.id); done += 1 } catch { failed.push(item.to_name || item.to_email) }
      }
      return { done, failed }
    },
    onSuccess: r => {
      setApprovingAll(null)
      if (r.failed.length) toast.error(`Approved ${r.done}. Couldn’t approve ${r.failed.join(', ')}; try those one by one.`)
      else toast.success(`Approved ${r.done}. They go out in each person’s morning, at most ${gmail.data?.daily_cap ?? 20} a day.`)
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => { setProgress(null); refresh() },
  })

  if (gmail.isLoading) return <Page><Skeleton className="h-64" /></Page>
  if (!gmail.data?.connected) {
    return (
      <Page>
        <PageHeader title="Outbox" description="Emails scheduled from your Gmail, their follow-ups, and the replies that came back." />
        <div className="border-t border-rule">
          <EmptyState title="Connect your Gmail first" description="Outreach sends from your own address, so replies come to you and can be tracked here."
            action={<ButtonLink to="/integrations/gmail" variant="primary" size="sm">Connect Gmail</ButtonLink>} />
        </div>
      </Page>
    )
  }

  const drafts = draftsOf(outbox.data ?? [])
  const threads = groupThreads((outbox.data ?? []).filter(i => i.status !== 'draft'))
  const scheduled = (outbox.data ?? []).filter(i => i.status === 'scheduled').length
  const replyList = replies.data ?? []

  return (
    <Page>
      <PageHeader
        title="Outbox"
        description={`From ${gmail.data.email}. ${drafts.length ? `${drafts.length} waiting for your OK · ` : ''}${scheduled} scheduled · inbox checked ${timeAgo(gmail.data.last_checked_at)}.`}
        actions={<Button icon={<RefreshCw className="size-4" />} loading={check.isPending} onClick={() => check.mutate()}>Check for replies</Button>}
      />

      {drafts.length > 0 && (
        <section aria-labelledby="drafts-h" className="mb-10">
          <h2 id="drafts-h" className="font-display text-[20px] font-semibold text-fg">Waiting for your OK</h2>
          <p className="mb-3 mt-1 max-w-[70ch] text-[14px] leading-relaxed text-muted">
            Referral emails for roles you approved, each with that role’s tailored resume attached. Nothing is sent until you approve it.
            A copy is also in your Gmail Drafts. If you edit it there, your edited version is the one that goes out.
          </p>
          {draftGroups(drafts).map(([company, items]) => (
            <div key={company} className="mb-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3">
                <h3 className="text-[15px] font-medium text-fg">{company} <span className="font-normal text-muted">· {items.length} {items.length === 1 ? 'draft' : 'drafts'}</span></h3>
                {items.length > 1 && (
                  <Button size="sm" variant="primary" disabled={approveAll.isPending} onClick={() => setApprovingAll({ company, items })}>Approve all {items.length}</Button>
                )}
              </div>
              <ul>
                {items.map(d => <DraftRow key={d.id} item={d} onEdit={() => setEditing(d)} onDiscard={() => setCancelling(d)} onDone={refresh} />)}
              </ul>
            </div>
          ))}
        </section>
      )}

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

      {editing && <EditEmailDialog item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
      <ConfirmDialog
        open={Boolean(approvingAll)}
        title={approvingAll ? `Approve all ${approvingAll.items.length} emails to ${approvingAll.company}?` : ''}
        description={approvingAll ? approveAllText(approvingAll.company, approvingAll.items, gmail.data?.daily_cap ?? 20) + (progress ? ` ${progress}` : '') : ''}
        confirmLabel="Approve all"
        busy={approveAll.isPending}
        onConfirm={() => approvingAll && approveAll.mutate(approvingAll.items)}
        onCancel={() => { if (!approveAll.isPending) setApprovingAll(null) }}
      />
      <ConfirmDialog
        open={cancelling != null}
        title={cancelling?.status === 'draft' ? 'Discard this draft?' : cancelling?.step === 0 ? 'Cancel this email and its follow-ups?' : 'Cancel this follow-up?'}
        description={cancelling ? `To ${cancelling.to_name || cancelling.to_email}: “${cancelling.subject}”${cancelling.status === 'draft' && cancelling.in_gmail_drafts ? '. It’s removed from your Gmail Drafts too.' : ''}` : ''}
        confirmLabel={cancelling?.status === 'draft' ? 'Discard' : 'Cancel it'}
        danger
        busy={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        onCancel={() => setCancelling(null)}
      />
    </Page>
  )
}

function DraftRow({ item, onEdit, onDiscard, onDone }: { item: OutboxItem; onEdit: () => void; onDiscard: () => void; onDone: () => void }) {
  const toast = useToast()
  const approve = useMutation({
    mutationFn: () => api.approveOutbox(item.id),
    onSuccess: r => { toast.success(`Approved. It goes ${r.when} ${cityOf(item.recipient_tz)} time${r.edited_in_gmail ? ', with your Gmail edits' : ''}.`); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  const download = useMutation({
    mutationFn: () => api.downloadResumeFile(item.attachment_file_id as number, item.attachment_name || 'resume.pdf'),
    onError: (e: Error) => toast.error(e.message),
  })
  const first = (item.to_name || '').split(/\s+/)[0]
  return (
    <li className="border-b border-line py-4">
      <p className="text-[15px]">
        <b className="font-medium text-fg">{item.to_name || item.to_email}</b>
        {item.contact_title && <span className="text-muted">, {item.contact_title}</span>}
        {item.company_name && <span className="text-muted"> · {item.company_id ? <Link to={`/company/${item.company_id}`} className="hover:text-accent">{item.company_name}</Link> : item.company_name}</span>}
      </p>
      <p className="text-[13px] text-subtle">{item.to_email}{item.email_guessed && <span className="text-warning"> · guessed from the company’s email pattern, may bounce</span>}</p>
      <div className="mt-3 rounded-[4px] border border-line bg-raised p-3">
        <p className="text-[14px] font-medium text-fg">{item.subject}</p>
        <p className="mt-2 whitespace-pre-line break-words text-[14px] leading-relaxed text-fg">{item.body}</p>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2 text-[13px]">
          {item.attachment_file_id ? (
            <button type="button" onClick={() => download.mutate()} className="inline-flex min-w-0 items-center gap-1.5 text-accent hover:underline" title="Download the attached resume">
              <Paperclip className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{item.attachment_name || 'resume.pdf'}</span>
            </button>
          ) : <span className="text-subtle">No resume attached</span>}
          <span className="text-subtle">{item.in_gmail_drafts ? 'Also in your Gmail Drafts' : 'Not in Gmail Drafts (Gmail couldn’t be reached)'}</span>
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" loading={approve.isPending} onClick={() => approve.mutate()}>Approve</Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button>
        <span className="text-[13px] text-subtle">Once approved, it goes on {first ? `${first}’s` : 'their'} next weekday morning, 8–11 AM {cityOf(item.recipient_tz)} time.</span>
      </div>
    </li>
  )
}

function approveAllText(company: string, items: OutboxItem[], cap: number) {
  const guessed = items.filter(i => i.email_guessed).length
  return `${items.length} different people at ${company}${items.every(i => i.attachment_file_id) ? ', each with your tailored resume' : ''}. `
    + `They go out in each person’s morning, at most ${cap} a day, and stop by themselves if someone replies.`
    + (guessed ? ` ${guessed === 1 ? '1 goes to a guessed address' : `${guessed} go to guessed addresses`} that may bounce.` : '')
}

/** Drafts by company, in the order they arrived. */
function draftGroups(drafts: OutboxItem[]): [string, OutboxItem[]][] {
  const groups = new Map<string, OutboxItem[]>()
  for (const d of drafts) {
    const k = d.company_name || 'Other'
    groups.set(k, [...(groups.get(k) ?? []), d])
  }
  return [...groups.entries()]
}

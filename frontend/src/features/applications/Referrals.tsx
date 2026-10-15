import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, Mail } from 'lucide-react'
import { api, type ActivePlanItem, type ReferralAction, type ReferralAsk } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { Button, Input, useToast } from '@/ui'
import { inZone } from '@/features/outreach/outbox'

function askLine(a: ReferralAsk): string {
  if (a.channel === 'search') return 'Nobody you know there yet. Find someone on LinkedIn and send this note:'
  const who = `${a.person_name || 'Someone'}${a.person_title ? `, ${a.person_title}` : ''}`
  if (a.channel === 'email') {
    if (a.status === 'replied' || a.contact_status === 'replied') return `${who} replied by email. Read it in Gmail.`
    if (a.email_status === 'sent') return `Emailed ${who} ${timeAgo(a.sent_at)}.`
    if (a.email_status === 'cancelled') return `Email to ${who} was cancelled.`
    if (a.email_status === 'failed') return `Email to ${who} failed to send.`
    return `Email to ${who} goes ${a.send_after && a.recipient_tz ? inZone(a.send_after, a.recipient_tz) : 'at their next morning'}.`
  }
  if (a.status === 'marked_sent') return `You sent ${who} a LinkedIn note.`
  if (a.status === 'replied') return `${who} replied.`
  return `Send ${who} this LinkedIn note:`
}

function AskRow({ a }: { a: ReferralAsk }) {
  const qc = useQueryClient()
  const toast = useToast()
  const sent = useMutation({
    mutationFn: () => api.markAskSent(a.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.dailyPlan }),
    onError: (e: Error) => toast.error(e.message),
  })
  const needsSending = a.channel !== 'email' && a.status === 'to_send'
  async function copyAndOpen() {
    try { await navigator.clipboard.writeText(a.message); toast.success('Note copied. Paste it into LinkedIn.') } catch { toast.error('Couldn’t copy; select the note instead') }
    if (a.linkedin_url) window.open(a.linkedin_url, '_blank', 'noopener')
  }
  return (
    <li className="space-y-1.5 py-2">
      <p className="flex items-center gap-1.5 text-[13px] text-muted">
        {a.channel === 'email' && <Mail className="size-3.5 shrink-0" aria-hidden="true" />}{askLine(a)}
      </p>
      {needsSending && (
        <>
          <p className="rounded-[4px] border border-line bg-raised p-3 text-[13px] leading-relaxed text-fg">{a.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={<Copy className="size-3.5" />} onClick={() => void copyAndOpen()}>
              {a.channel === 'search' ? 'Copy note & search LinkedIn' : 'Copy note & open profile'}
            </Button>
            <Button size="sm" variant="ghost" loading={sent.isPending} onClick={() => sent.mutate()}>I sent it</Button>
          </div>
        </>
      )}
    </li>
  )
}

/** Asks + the user's referral buttons on one approved role. */
export function ReferralPanel({ item }: { item: ActivePlanItem }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [link, setLink] = useState('')
  const [askingLink, setAskingLink] = useState(false)
  const act = useMutation({
    mutationFn: ({ action, link: l }: { action: ReferralAction; link?: string }) => api.referralAction(item.id, action, l),
    onSuccess: (_r, v) => {
      setAskingLink(false)
      setLink('')
      toast.success({ link: 'Saved. We’ll apply through it.', submitted: 'Marked as referred.', declined: 'Okay. Applying in their morning.', apply_now: 'Applying now.', applied_myself: 'Marked as applied.' }[v.action])
      void qc.invalidateQueries({ queryKey: qk.dailyPlan })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const waiting = item.stage === 'waiting_referral'
  const canApplyMyself = item.stage === 'needs_you' || item.stage === 'ready_to_apply'

  return (
    <div className="mt-2 space-y-2">
      {item.asks.length > 0 && <ul className="divide-y divide-line border-y border-line">{item.asks.map(a => <AskRow key={a.id} a={a} />)}</ul>}
      {waiting && (
        askingLink ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); act.mutate({ action: 'link', link }) }}>
            <Input value={link} onChange={e => setLink(e.target.value)} placeholder="Paste the referral link or code" aria-label="Referral link or code" className="h-8 min-w-0 flex-1 basis-60 text-[13px]" autoFocus />
            <Button size="sm" type="submit" variant="primary" loading={act.isPending} disabled={!link.trim()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setAskingLink(false)}>Cancel</Button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAskingLink(true)}>Got a link or code</Button>
            <Button size="sm" onClick={() => act.mutate({ action: 'submitted' })} loading={act.isPending && act.variables?.action === 'submitted'}>They submitted me</Button>
            <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: 'declined' })} loading={act.isPending && act.variables?.action === 'declined'}>They said no</Button>
            <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: 'apply_now' })} loading={act.isPending && act.variables?.action === 'apply_now'}>Apply now</Button>
          </div>
        )
      )}
      {canApplyMyself && (
        <div className="flex flex-wrap gap-2">
          <a href={item.referral_link && /^https?:/i.test(item.referral_link) ? item.referral_link : item.apply_url} target="_blank" rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong px-3 text-[13px] text-fg hover:bg-hover">Open the posting <ExternalLink className="size-3.5" /></a>
          <Button size="sm" onClick={() => act.mutate({ action: 'applied_myself' })} loading={act.isPending && act.variables?.action === 'applied_myself'}>I applied</Button>
        </div>
      )}
    </div>
  )
}

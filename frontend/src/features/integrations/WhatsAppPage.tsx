import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, MessageCircle } from 'lucide-react'
import { api, type WhatsAppKind, type WhatsAppStatus } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { formatPhone } from './phone'
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Page, PageHeader, Skeleton, useToast } from '@/ui'

const KINDS: { key: WhatsAppKind; label: string; hint: string }[] = [
  { key: 'list', label: 'The evening list', hint: 'Tonight’s roles to approve. Reply YES or YES 1 3.' },
  { key: 'replies', label: 'Replies to your outreach', hint: 'Someone answered your email or messaged you on LinkedIn.' },
  { key: 'needs', label: 'Roles that need you', hint: 'A low ATS score, a referral code to enter, or one to apply to yourself.' },
  { key: 'summary', label: 'Morning summary', hint: 'What was applied and what’s waiting, around 11 AM.' },
  { key: 'skills', label: 'Skills to check', hint: 'After a resume is tailored: the job’s skills your resume doesn’t show. Reply ADD 1 3 for the ones you know.' },
  { key: 'projects', label: 'New projects to build', hint: 'Whenever new project ideas come in from your listed roles (weekly), or for one role’s resume.' },
]

const COMMANDS = [
  ['YES', 'approve all of tonight’s list'],
  ['YES 1 3', 'approve some, by number'],
  ['SKIP 2', 'skip one'],
  ['LIST', 'send tonight’s list again'],
  ['STOP / START', 'pause or resume messages'],
]

export default function WhatsAppPage() {
  const status = useQuery({
    queryKey: qk.whatsapp,
    queryFn: api.whatsappStatus,
    // While a code is out, watch for the JOIN message to land.
    refetchInterval: q => ((q.state.data as WhatsAppStatus | undefined)?.pending && !(q.state.data as WhatsAppStatus).linked ? 4000 : false),
  })
  return (
    <Page>
      <PageHeader title="WhatsApp" description="Get your evening list, reply alerts, roles that need you and the morning summary on WhatsApp, and approve roles by replying." />
      {status.error ? <ErrorState error={status.error} onRetry={() => status.refetch()} /> : !status.data ? <Skeleton className="h-64" /> : (
        <div className="space-y-4">
          {!status.data.configured ? <NotSetUp /> : status.data.linked ? <Linked s={status.data} /> : <Link s={status.data} />}
          <OwnerSetup configured={status.data.configured} />
        </div>
      )}
    </Page>
  )
}

function NotSetUp() {
  return (
    <Card>
      <CardHeader title="Not set up yet" description="WhatsApp needs Scout’n’Jobs’s business number connected on the server first. The steps are below." />
    </Card>
  )
}

function Link({ s }: { s: WhatsAppStatus }) {
  const qc = useQueryClient()
  const toast = useToast()
  const join = useMutation({
    mutationFn: api.whatsappJoin,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.whatsapp }),
    onError: (e: Error) => toast.error(e.message),
  })
  const code = join.data?.code ?? s.pending?.code
  const link = join.data?.link ?? (s.businessNumber && code ? `https://wa.me/${s.businessNumber.replace(/\D/g, '')}?text=${encodeURIComponent(`JOIN ${code}`)}` : null)
  return (
    <Card>
      <CardHeader title="Link your WhatsApp" description="You send one message from your phone. That proves the number is yours and lets Scout’n’Jobs message you." />
      <CardBody className="space-y-4">
        {!code ? (
          <Button variant="primary" icon={<MessageCircle className="size-4" />} loading={join.isPending} onClick={() => join.mutate()}>Get my code</Button>
        ) : (
          <>
            <p className="text-[14px] text-muted">
              Send <b className="font-mono text-fg">JOIN {code}</b> to <b className="text-fg">{s.businessNumber || 'the Scout’n’Jobs number'}</b> on WhatsApp. The code works for 30 minutes.
            </p>
            <div className="flex flex-wrap gap-2">
              {link && <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[4px] bg-accent px-4 text-[14px] font-semibold text-on-accent hover:bg-accent-hover"><MessageCircle className="size-4" /> Open WhatsApp with the message</a>}
              <Button variant="ghost" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(`JOIN ${code}`).then(() => toast.success('Copied'))}>Copy</Button>
            </div>
            <p className="text-[13px] text-subtle" role="status">Waiting for your message… this page updates when it arrives.</p>
          </>
        )}
      </CardBody>
    </Card>
  )
}

function Linked({ s }: { s: WhatsAppStatus }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const set = (next: WhatsAppStatus) => qc.setQueryData(qk.whatsapp, next)
  const prefs = useMutation({ mutationFn: api.whatsappPrefs, onSuccess: set, onError: (e: Error) => toast.error(e.message) })
  const test = useMutation({ mutationFn: api.whatsappTest, onSuccess: () => toast.success('Test message sent'), onError: (e: Error) => toast.error(e.message) })
  const unlink = useMutation({
    mutationFn: api.whatsappUnlink,
    onSuccess: () => { setConfirm(false); toast.success('Unlinked'); void qc.invalidateQueries({ queryKey: qk.whatsapp }) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <>
      <Card>
        <CardHeader title={formatPhone(s.phone)} description={`Linked ${timeAgo(s.verifiedAt)}`}
          actions={<Badge tone={s.enabled ? 'success' : 'neutral'}>{s.enabled ? 'On' : 'Paused'}</Badge>} />
        <CardBody className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="mb-1 text-[13px] text-subtle">Send me</legend>
            {KINDS.map(k => (
              <label key={k.key} className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--ui-accent)]" checked={s.prefs[k.key] !== false}
                  onChange={e => prefs.mutate({ prefs: { [k.key]: e.target.checked } })} />
                <span><span className="text-[14px] text-fg">{k.label}</span><span className="block text-[13px] text-muted">{k.hint}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button onClick={() => test.mutate()} loading={test.isPending}>Send a test message</Button>
            <Button variant="ghost" onClick={() => prefs.mutate({ enabled: !s.enabled })}>{s.enabled ? 'Pause messages' : 'Resume messages'}</Button>
            <Button variant="ghost" onClick={() => setConfirm(true)}>Unlink</Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Reply to Scout’n’Jobs" description="Send these to the Scout’n’Jobs number any time." />
        <CardBody>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14px]">
            {COMMANDS.map(([c, d]) => <div key={c} className="contents"><dt className="font-mono text-fg">{c}</dt><dd className="text-muted">{d}</dd></div>)}
          </dl>
        </CardBody>
      </Card>
      <ConfirmDialog open={confirm} title="Unlink WhatsApp?" description="Scout’n’Jobs stops messaging this number. You can link again any time."
        confirmLabel="Unlink" danger busy={unlink.isPending} onConfirm={() => unlink.mutate()} onCancel={() => setConfirm(false)} />
    </>
  )
}

/** For whoever runs the server: connect the business number once. */
function OwnerSetup({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(!configured)
  const templates = useQuery({ queryKey: ['whatsapp-templates'], queryFn: api.whatsappTemplates, enabled: open })
  const webhook = 'https://outreach-jt.duckdns.org/api/whatsapp/webhook'
  return (
    <Card>
      <CardHeader title="Set up the business number" description={configured ? 'Done. Kept here for reference.' : 'One-time, for whoever runs Scout’n’Jobs.'}
        actions={<Button size="sm" variant="ghost" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</Button>} />
      {open && (
        <CardBody className="space-y-4 text-[14px] leading-relaxed text-muted">
          <ol className="list-decimal space-y-2 pl-5">
            <li>At <a className="text-accent hover:underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps</a>, create an app (type <b className="text-fg">Business</b>) and add <b className="text-fg">WhatsApp</b>. Meta gives you a free test number right away; add your own phone as a test recipient to try it.</li>
            <li>In <b className="text-fg">WhatsApp → API Setup</b>, copy the <b className="text-fg">Phone number ID</b>. Create a <b className="text-fg">System user</b> in Business Settings with a permanent token that has <span className="font-mono">whatsapp_business_messaging</span>.</li>
            <li>In <b className="text-fg">WhatsApp → Configuration</b>, set the webhook URL to <span className="font-mono text-fg">{webhook}</span>, pick any verify token, and subscribe to <span className="font-mono">messages</span>.</li>
            <li>Put these in the server’s <span className="font-mono">.env</span>: <span className="font-mono text-fg">WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_NUMBER, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET</span> (App settings → Basic).</li>
            <li>In <b className="text-fg">WhatsApp Manager → Message templates</b>, these four are created for you through Meta’s API (category Utility, English US). Shown here for reference:</li>
          </ol>
          {templates.data && (
            <ul className="space-y-3">
              {Object.values(templates.data).map(t => (
                <li key={t.name} className="rounded-[4px] border border-line bg-raised p-3">
                  <p className="font-mono text-[13px] text-fg">{t.name}</p>
                  <p className="mt-2 text-[13px] font-semibold text-fg">{t.header}</p>
                  <p className="mt-1 text-[13px] whitespace-pre-line text-fg">{t.body}</p>
                  <p className="mt-1 text-[12px] text-subtle">{t.footer} · button: “{t.button}”</p>
                  <p className="mt-1 text-[12px] text-subtle">Example values: {t.example.join(' | ')}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-subtle">Messages you reply to within 24 hours are free; templates outside that window cost about $0.01–0.03 each after Meta’s free tier.</p>
        </CardBody>
      )}
    </Card>
  )
}

import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Mail } from 'lucide-react'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Field, Input, Skeleton, useToast } from '@/ui'

const APP_PASSWORDS_URL = 'https://myaccount.google.com/apppasswords'

/** Connect your own Gmail: outreach, follow-ups, your evening list and reply alerts all use it. */
export function GmailTab() {
  const qc = useQueryClient()
  const toast = useToast()
  const status = useQuery({ queryKey: qk.gmail, queryFn: api.gmailStatus })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [cap, setCap] = useState('')
  const [confirm, setConfirm] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.gmail })

  const connect = useMutation({
    mutationFn: () => api.connectGmail({ email, appPassword: password, displayName: name || undefined }),
    onSuccess: () => { setPassword(''); toast.success('Gmail connected'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const test = useMutation({
    mutationFn: api.testGmail,
    onSuccess: r => toast.success(`Test email sent to ${r.to}`),
    onError: (e: Error) => toast.error(e.message),
  })
  const save = useMutation({
    mutationFn: () => api.gmailSettings({ displayName: name || undefined, dailyCap: cap ? Number(cap) : undefined }),
    onSuccess: () => { toast.success('Saved'); setName(''); setCap(''); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const disconnect = useMutation({
    mutationFn: api.disconnectGmail,
    onSuccess: () => { setConfirm(false); toast.success('Gmail disconnected'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    connect.mutate()
  }

  if (status.error) return <ErrorState error={status.error} onRetry={() => status.refetch()} />
  if (status.isLoading) return <Skeleton className="h-64" />
  const s = status.data

  if (s?.connected) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader title="Gmail" description="Outreach, follow-ups, your evening list and reply alerts come from this account." />
          <CardBody className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Mail className="size-5 text-subtle" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">{s.display_name ? `${s.display_name} <${s.email}>` : s.email}</p>
                <p className="text-[13px] text-muted">
                  Connected {timeAgo(s.connected_at)}{s.last_checked_at ? ` · inbox checked ${timeAgo(s.last_checked_at)}` : ''} · up to {s.daily_cap ?? 20} emails a day
                </p>
              </div>
              <Badge tone={s.status === 'ok' ? 'success' : 'danger'}>{s.status === 'ok' ? 'Working' : 'Needs attention'}</Badge>
            </div>
            {s.status === 'error' && s.last_error && (
              <p className="rounded-[4px] border border-danger/40 bg-danger-soft p-3 text-[14px] text-fg">{s.last_error} Make a new app password and connect again below.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => test.mutate()} loading={test.isPending}>Send me a test email</Button>
              <Button variant="ghost" onClick={() => setConfirm(true)}>Disconnect</Button>
            </div>
            <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-[1fr_160px_auto] sm:items-end">
              <Field label="Name people see" hint="Shown as the sender, e.g. “Sravya Rachakonda”.">
                {f => <Input {...f} value={name} onChange={e => setName(e.target.value)} placeholder={s.display_name || 'Your name'} />}
              </Field>
              <Field label="Emails a day" hint="1 to 40">
                {f => <Input {...f} type="number" min={1} max={40} value={cap} onChange={e => setCap(e.target.value)} placeholder={String(s.daily_cap ?? 20)} />}
              </Field>
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name && !cap}>Save</Button>
            </div>
          </CardBody>
        </Card>
        {s.status === 'error' && <ConnectForm {...{ email, setEmail, password, setPassword, name, setName, submit, busy: connect.isPending }} />}
        <ConfirmDialog
          open={confirm}
          title="Disconnect Gmail?"
          description="Scheduled emails and follow-ups that haven’t gone out are cancelled, and replies stop being tracked. Emails already sent stay in your Gmail."
          confirmLabel="Disconnect"
          danger
          busy={disconnect.isPending}
          onConfirm={() => disconnect.mutate()}
          onCancel={() => setConfirm(false)}
        />
      </div>
    )
  }

  return <ConnectForm {...{ email, setEmail, password, setPassword, name, setName, submit, busy: connect.isPending }} />
}

function ConnectForm({ email, setEmail, password, setPassword, name, setName, submit, busy }: {
  email: string; setEmail: (v: string) => void; password: string; setPassword: (v: string) => void
  name: string; setName: (v: string) => void; submit: (e: FormEvent) => void; busy: boolean
}) {
  return (
    <Card>
      <CardHeader title="Connect your Gmail" description="Emails go out from your own address, so replies land in your inbox. OutreachOS reads only replies to what it sent, plus LinkedIn’s notification emails." />
      <CardBody>
        <ol className="mb-6 space-y-2 text-[14px] leading-relaxed text-muted">
          <li><b className="font-medium text-fg">1.</b> Turn on 2-Step Verification for your Google account, if it isn’t on.</li>
          <li>
            <b className="font-medium text-fg">2.</b> Open{' '}
            <a href={APP_PASSWORDS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Google app passwords <ExternalLink className="size-3" /></a>,
            name it “OutreachOS” and click Create.
          </li>
          <li><b className="font-medium text-fg">3.</b> Copy the 16-letter password Google shows and paste it below. It’s stored encrypted, and you can revoke it at Google any time.</li>
        </ol>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Gmail address">{f => <Input {...f} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@gmail.com" />}</Field>
          <Field label="App password" hint="16 letters; spaces are fine">
            {f => <Input {...f} type="password" autoComplete="off" required value={password} onChange={e => setPassword(e.target.value)} placeholder="abcd efgh ijkl mnop" />}
          </Field>
          <Field label="Name people see (optional)">{f => <Input {...f} value={name} onChange={e => setName(e.target.value)} placeholder="Sravya Rachakonda" />}</Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" loading={busy}>Connect Gmail</Button>
          </div>
        </form>
        <p className="mt-4 text-[13px] text-subtle">Some school or work Google accounts don’t allow app passwords. If Google won’t create one, use a personal Gmail.</p>
      </CardBody>
    </Card>
  )
}

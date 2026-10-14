import { useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, LogOut, Moon, RefreshCw, ShieldAlert, Sun } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { useProviderUsage, useServiceHealth } from '@/app/queries'
import { useTheme, type Theme } from '@/app/theme'
import { qk } from '@/app/queryClient'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { validatePassword } from '@/lib/password'
import { supabase } from '@/lib/supabase'
import { GmailTab } from './GmailTab'
import {
  Badge, Button, ButtonLink, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Field, Input, Page, PageHeader,
  Skeleton, StatusDot, useToast, type Tone,
} from '@/ui'

// Absolute paths: relative links inside a splat route (/settings/*) resolve
// against the full URL in React Router v7 and would never match.
const TABS = [
  { to: '/settings/account', label: 'Account' },
  { to: '/settings/gmail', label: 'Gmail' },
  { to: '/settings/integrations', label: 'Integrations' },
  { to: '/settings/privacy', label: 'Privacy' },
]

function PasswordForm() {
  const toast = useToast()
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const change = useMutation({
    mutationFn: async (password: string) => {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
    },
    onSuccess: () => { setNext(''); setConfirm(''); toast.success('Password updated') },
    onError: (err: Error) => setError(err.message),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validatePassword(next, confirm)
    setError(problem)
    if (!problem) change.mutate(next)
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Field label="New password">
        {p => <Input {...p} type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />}
      </Field>
      <Field label="Confirm new password" error={error}>
        {p => <Input {...p} type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />}
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" loading={change.isPending} disabled={!next || !confirm}>Update password</Button>
      </div>
    </form>
  )
}

const TASK_LABELS: Record<string, string> = {
  score: 'Quick scores', evaluate: 'Job evaluations', email: 'Emails', categorize: 'Company labels',
  resume: 'Tailored resumes', cover_letter: 'Cover letters',
}

function AiSpendCard() {
  const usage = useQuery({ queryKey: qk.aiUsage, queryFn: api.aiUsage })
  const u = usage.data
  const bar = (spent: number, cap: number) => {
    const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0
    return (
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
        <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-accent')} style={{ width: `${pct}%` }} />
      </div>
    )
  }
  return (
    <Card>
      <CardHeader title="AI spending this month"
        description="Every AI call is metered. When a limit is reached, AI work pauses until the 1st, with nothing charged beyond it." />
      {usage.isError ? <ErrorState compact error={usage.error} onRetry={() => void usage.refetch()} /> : usage.isLoading || !u ? (
        <div className="p-5"><Skeleton className="h-16" /></div>
      ) : (
        <div className="space-y-5 p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="flex justify-between text-[14px]"><span className="text-fg">You</span><span className="font-mono text-muted">${u.spent.mine.toFixed(2)} / ${u.caps.user.toFixed(0)}</span></div>
              {bar(u.spent.mine, u.caps.user)}
            </div>
            <div>
              <div className="flex justify-between text-[14px]"><span className="text-fg">Whole site</span><span className="font-mono text-muted">${u.spent.site.toFixed(2)} / ${u.caps.site.toFixed(0)}</span></div>
              {bar(u.spent.site, u.caps.site)}
            </div>
          </div>
          {u.byTask.length > 0 && (
            <dl className="divide-y divide-line border-t border-line text-[14px]">
              {u.byTask.map(t => (
                <div key={t.task} className="flex justify-between py-2">
                  <dt className="text-muted">{TASK_LABELS[t.task] ?? t.task} <span className="text-subtle">· {t.calls}</span></dt>
                  <dd className="font-mono text-fg">${t.cost.toFixed(t.cost < 0.1 ? 3 : 2)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-[13px] text-subtle">Resumes and cover letters use Claude Opus 5.5; scoring and emails use Groq, with OpenAI as backup.</p>
        </div>
      )}
    </Card>
  )
}

function AccountTab() {
  const { email, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'light', label: 'Light', icon: Sun },
  ]
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Account" description="You sign in with this email." />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-fg">{email}</span>
          <Button icon={<LogOut className="size-3.5" />} onClick={() => void signOut()}>Sign out</Button>
        </CardBody>
      </Card>
      <AiSpendCard />
      <Card>
        <CardHeader title="Password" />
        <CardBody><PasswordForm /></CardBody>
      </Card>
      <Card>
        <CardHeader title="Appearance" />
        <CardBody>
          <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-line bg-canvas p-0.5">
            {options.map(o => (
              <button key={o.value} type="button" role="radio" aria-checked={theme === o.value} onClick={() => setTheme(o.value)}
                className={cn('flex h-7 items-center gap-1.5 rounded px-3 text-[13px] font-medium transition-colors',
                  theme === o.value ? 'bg-raised text-fg shadow-sm' : 'text-subtle hover:text-muted')}>
                <o.icon className="size-3.5" /> {o.label}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Application profile"
          description="Contact details, work authorization, education and your saved answers to form questions." />
        <CardBody><ButtonLink to="/profile/details" size="sm">Open profile</ButtonLink></CardBody>
      </Card>
    </div>
  )
}

const stateTone: Record<string, Tone> = { ok: 'success', warn: 'warning', down: 'danger', off: 'neutral' }
const stateLabel: Record<string, string> = { ok: 'Working', warn: 'Attention', down: 'Unavailable', off: 'Not set up' }

const USAGE_LABELS = { hunter: 'Hunter', prospeo: 'Prospeo', apollo: 'Apollo', serper: 'Google search' } as const

function UsageCard() {
  const usage = useProviderUsage()
  return (
    <Card>
      <CardHeader title="Your lookups this month" description="Contact and email lookups share the server's keys, so each account has a monthly allowance. Resets on the 1st." />
      {usage.isError ? <ErrorState compact error={usage.error} onRetry={() => void usage.refetch()} /> : (
        <ul className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
          {(Object.keys(USAGE_LABELS) as (keyof typeof USAGE_LABELS)[]).map(k => {
            const u = usage.data?.[k]
            const pct = u && u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0
            return (
              <li key={k}>
                <div className="mb-1.5 flex justify-between text-[13px]">
                  <span className="text-fg">{USAGE_LABELS[k]}</span>
                  {usage.isLoading ? <Skeleton className="h-4 w-12" /> : <span className="tabular-nums text-muted">{u?.used ?? 0} / {u?.limit ?? 0}</span>}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
                  <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-accent')} style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function IntegrationsTab() {
  const { services, isLoading, error, checkedAt, refetch } = useServiceHealth()
  return (
    <div className="space-y-4">
    <UsageCard />
    <Card>
      <CardHeader
        title="Integrations"
        description={checkedAt ? `Checked ${timeAgo(checkedAt)}. Keys are set on the server.` : 'Keys are set on the server.'}
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={refetch}>Recheck</Button>}
      />
      {error ? <ErrorState compact error={error} onRetry={refetch} /> : (
        <ul className="divide-y divide-line">
          {services.map(s => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <StatusDot tone={isLoading ? 'neutral' : stateTone[s.state] ?? 'neutral'} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-fg">{s.name}</p>
                <p className="truncate text-xs text-subtle">{s.purpose}</p>
              </div>
              {isLoading ? <Skeleton className="h-5 w-20" /> : (
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                  {s.note && <span className="hidden max-w-72 truncate text-xs text-subtle sm:block" title={s.note}>{s.note}</span>}
                  <Badge tone={stateTone[s.state] ?? 'neutral'}>{stateLabel[s.state]}</Badge>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
    </div>
  )
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function PrivacyTab() {
  const toast = useToast()
  const [pending, setPending] = useState<number | null>(null)

  const exportData = useMutation({
    mutationFn: api.exportData,
    onSuccess: data => { downloadJson(data, `outreachos-export-${new Date().toISOString().slice(0, 10)}.json`); toast.success('Export downloaded') },
    onError: (e: Error) => toast.error(e.message || 'Export failed'),
  })
  const preview = useMutation({
    mutationFn: () => api.eraseSensitiveProfile(true),
    onSuccess: res => {
      const count = (res.profileFields?.length ?? 0) + (res.metaKeys?.length ?? 0)
      if (count === 0) toast.info('No saved sensitive profile fields to erase')
      else setPending(count)
    },
    onError: (e: Error) => toast.error(e.message || 'Couldn’t check your profile'),
  })
  const erase = useMutation({
    mutationFn: () => api.eraseSensitiveProfile(false),
    onSuccess: res => {
      const n = (res.erased?.profileFields?.length ?? 0) + (res.erased?.metaKeys?.length ?? 0)
      setPending(null)
      toast.success(`Erased ${n} field${n === 1 ? '' : 's'}`)
    },
    onError: (e: Error) => toast.error(e.message || 'Erase failed'),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Export your data" description="Download everything stored for your account as JSON." />
        <CardBody>
          <Button icon={<Download className="size-3.5" />} loading={exportData.isPending} onClick={() => exportData.mutate()}>Export data</Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Erase sensitive profile"
          description="Clears saved application answers (contact, EEO, work authorization), auto-apply consent and resume text. Job history is kept." />
        <CardBody>
          <Button variant="danger" icon={<ShieldAlert className="size-3.5" />} loading={preview.isPending} onClick={() => preview.mutate()}>
            Erase sensitive profile…
          </Button>
        </CardBody>
      </Card>
      <ConfirmDialog
        open={pending !== null}
        title="Erase sensitive profile?"
        description={<>This permanently erases {pending} saved field{pending === 1 ? '' : 's'} and turns off auto-apply until you fill your profile in again.</>}
        confirmLabel="Erase"
        danger
        busy={erase.isPending}
        onConfirm={() => erase.mutate()}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Page>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-6 md:flex-row">
        <nav aria-label="Settings" className="flex shrink-0 gap-1 overflow-x-auto md:w-44 md:flex-col">
          {TABS.map(t => (
            <NavLink key={t.to} to={t.to}
              className={({ isActive }) => cn('flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                isActive ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg')}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Routes>
            <Route index element={<Navigate to="account" replace />} />
            <Route path="account" element={<AccountTab />} />
            <Route path="gmail" element={<GmailTab />} />
            <Route path="integrations" element={<IntegrationsTab />} />
            <Route path="privacy" element={<PrivacyTab />} />
            <Route path="*" element={<Navigate to="account" replace />} />
          </Routes>
        </div>
      </div>
    </Page>
  )
}

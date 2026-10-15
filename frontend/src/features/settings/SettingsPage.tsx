import { useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Download, LogOut, Moon, ShieldAlert, Sun } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { useTheme, type Theme } from '@/app/theme'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { validatePassword } from '@/lib/password'
import { supabase } from '@/lib/supabase'
import {
  Button, ButtonLink, Card, CardBody, CardHeader, ConfirmDialog, Field, Input, Page, PageHeader,
  useToast,
} from '@/ui'

// Absolute paths: relative links inside a splat route (/settings/*) resolve
// against the full URL in React Router v7 and would never match.
const TABS = [
  { to: '/settings/account', label: 'Account' },
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
            <Route path="privacy" element={<PrivacyTab />} />
            <Route path="gmail" element={<Navigate to="/integrations/gmail" replace />} />
            <Route path="integrations" element={<Navigate to="/usage" replace />} />
            <Route path="*" element={<Navigate to="account" replace />} />
          </Routes>
        </div>
      </div>
    </Page>
  )
}

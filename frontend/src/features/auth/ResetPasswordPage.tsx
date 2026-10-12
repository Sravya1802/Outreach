import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/app/auth'
import { MIN_PASSWORD_LENGTH, validatePassword } from '@/lib/password'
import { supabase } from '@/lib/supabase'
import { Button, Field, Input, Spinner } from '@/ui'
import { AuthLayout, FormMessage } from './AuthLayout'

/**
 * Target of the password-recovery email. Supabase restores a recovery session
 * from the URL hash on load; until it does there is nothing to update.
 */
export default function ResetPasswordPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validatePassword(password, confirm)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      setDone(true)
      window.setTimeout(() => navigate('/home', { replace: true }), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t update your password.')
    } finally {
      setBusy(false)
    }
  }

  if (session === undefined) {
    return <AuthLayout title="Reset your password"><div className="flex justify-center py-4 text-subtle"><Spinner /></div></AuthLayout>
  }

  if (!session) {
    return (
      <AuthLayout title="Link expired" subtitle="This reset link is invalid or has already been used."
        footer={<button type="button" className="text-accent hover:underline" onClick={() => navigate('/', { replace: true })}>Back to sign in</button>}>
        <p className="text-center text-[13px] text-muted">Request a new link from the sign-in page using “Forgot password?”.</p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Choose a new password" subtitle={session.user.email}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
          {p => <Input {...p} type="password" autoComplete="new-password" autoFocus value={password} onChange={e => setPassword(e.target.value)} />}
        </Field>
        <Field label="Confirm new password">
          {p => <Input {...p} type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />}
        </Field>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        {done && <FormMessage tone="info">Password updated. Taking you in…</FormMessage>}
        <Button type="submit" variant="primary" className="h-9 w-full" loading={busy} disabled={done}>Update password</Button>
      </form>
    </AuthLayout>
  )
}

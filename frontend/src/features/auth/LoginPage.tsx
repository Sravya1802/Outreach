import { useState, type FormEvent } from 'react'
import { MailCheck } from 'lucide-react'
import { MIN_PASSWORD_LENGTH } from '@/lib/password'
import { supabase } from '@/lib/supabase'
import { Button, Field, Input } from '@/ui'
import type { Market } from '@/lib/markets'
import { AuthLayout, FormMessage } from './AuthLayout'
import { MarketOptions } from './MarketOptions'
import { useOAuthProviders, type OAuthProvider } from './providers'

type Mode = 'signin' | 'signup' | 'magic' | 'forgot'

const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  signin: { title: 'Sign in to OutreachOS', subtitle: 'Your internship and new-grad job search, automated.', submit: 'Sign in' },
  signup: { title: 'Create your account', subtitle: 'Free while in beta. Roles, alerts and auto-apply follow the country you pick.', submit: 'Create account' },
  magic: { title: 'Sign in with a link', subtitle: 'We’ll email you a one-time sign-in link.', submit: 'Email me a link' },
  forgot: { title: 'Reset your password', subtitle: 'We’ll email you a link to choose a new one.', submit: 'Send reset link' },
}

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.'
  if (/email not confirmed/i.test(message)) return 'Confirm your email first — check your inbox for the link.'
  if (/rate limit/i.test(message)) return 'Too many emails sent. Wait a few minutes and try again, or sign in with your password.'
  if (/already registered/i.test(message)) return 'An account with this email already exists. Sign in instead.'
  return message
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [market, setMarket] = useState<Market | null>(null)
  const [busy, setBusy] = useState(false)
  const providers = useOAuthProviders()
  const [oauthBusy, setOauthBusy] = useState<OAuthProvider | null>(null)

  async function continueWith(provider: OAuthProvider) {
    setError(null)
    setOauthBusy(provider)
    // Leaves the page for the provider; the country question comes after, on first sign-in.
    const { error: err } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } })
    if (err) { setError(friendly(err.message)); setOauthBusy(null) }
  }
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const needsPassword = mode === 'signin' || mode === 'signup'
  const copy = COPY[mode]

  function switchTo(next: Mode) {
    setMode(next); setError(null); setInfo(null); setSentTo(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const addr = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(addr)) { setError('Enter a valid email address.'); return }
    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) { setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`); return }
    if (mode === 'signin' && !password) { setError('Enter your password.'); return }
    if (mode === 'signup' && !market) { setError('Pick where you’re looking for jobs.'); return }

    setBusy(true); setError(null); setInfo(null)
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: addr, password })
        if (err) throw err
      } else if (mode === 'signup') {
        // Kept on the account until the profile exists; saved to it on first sign-in.
        const { data, error: err } = await supabase.auth.signUp({
          email: addr, password,
          options: { data: { job_market: market }, emailRedirectTo: window.location.origin },
        })
        if (err) throw err
        if (!data.session) setInfo('Check your inbox to confirm your email, then sign in.')
      } else if (mode === 'magic') {
        const { error: err } = await supabase.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: window.location.origin } })
        if (err) throw err
        setSentTo(addr)
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: `${window.location.origin}/reset-password` })
        if (err) throw err
        setSentTo(addr)
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : 'Something went wrong.'))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" subtitle={<>We sent a link to <span className="text-fg">{sentTo}</span>.</>}
        footer={<button type="button" className="text-accent hover:underline" onClick={() => switchTo('signin')}>Back to sign in</button>}>
        <div className="flex flex-col items-center gap-3 py-2 text-center text-[13px] text-muted">
          <MailCheck className="size-8 text-accent" />
          {mode === 'forgot' ? 'Open it to choose a new password.' : 'Open it on this device to sign in.'} It can take a minute to arrive.
        </div>
      </AuthLayout>
    )
  }

  const footer = mode === 'signup'
    ? <>Already have an account? <button type="button" className="text-accent hover:underline" onClick={() => switchTo('signin')}>Sign in</button></>
    : mode === 'signin'
      ? <>New here? <button type="button" className="text-accent hover:underline" onClick={() => switchTo('signup')}>Create an account</button></>
      : <button type="button" className="text-accent hover:underline" onClick={() => switchTo('signin')}>Back to sign in</button>

  const showOAuth = (mode === 'signin' || mode === 'signup') && (providers.google || providers.github)

  return (
    <AuthLayout title={copy.title} subtitle={copy.subtitle} footer={footer}>
      {showOAuth && (
        <div className="mb-5 space-y-2">
          {providers.google && (
            <Button className="h-9 w-full" loading={oauthBusy === 'google'} onClick={() => void continueWith('google')} icon={<GoogleMark />}>Continue with Google</Button>
          )}
          {providers.github && (
            <Button className="h-9 w-full" loading={oauthBusy === 'github'} onClick={() => void continueWith('github')}>Continue with GitHub</Button>
          )}
          <p className="flex items-center gap-3 pt-2 text-xs text-subtle" aria-hidden="true"><span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" /></p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email">
          {p => <Input {...p} type="email" autoComplete="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="you@school.edu" />}
        </Field>
        {needsPassword && (
          <Field label="Password" hint={mode === 'signup' ? `At least ${MIN_PASSWORD_LENGTH} characters` : undefined}>
            {p => <Input {...p} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} />}
          </Field>
        )}
        {mode === 'signup' && <MarketOptions value={market} onChange={setMarket} />}
        {error && <FormMessage tone="error">{error}</FormMessage>}
        {info && <FormMessage tone="info">{info}</FormMessage>}
        <Button type="submit" variant="primary" className="h-9 w-full" loading={busy}>{copy.submit}</Button>
        {mode === 'signin' && (
          <div className="flex justify-between text-xs">
            <button type="button" className="text-muted hover:text-fg" onClick={() => switchTo('magic')}>Email me a sign-in link</button>
            <button type="button" className="text-muted hover:text-fg" onClick={() => switchTo('forgot')}>Forgot password?</button>
          </div>
        )}
      </form>
    </AuthLayout>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.55 10.55 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}

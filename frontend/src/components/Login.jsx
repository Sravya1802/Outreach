import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Login() {
  const [mode, setMode]       = useState('password') // 'password' | 'magic' | 'signup' | 'forgot'
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState(null)
  const [info, setInfo]       = useState(null)

  async function submit(e) {
    e.preventDefault()
    setSending(true); setError(null); setInfo(null)
    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) throw error
        if (data.session) {
          // auto-signed in (email confirmation disabled)
        } else {
          setInfo('Check your inbox to confirm your email, then sign in with your password.')
        }
      } else if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        setSent(true)
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error
        setSent(true)
      }
    } catch (err) {
      setError(err.message || 'Failed')
    }
    setSending(false)
  }

  const label = { password: 'Sign in', signup: 'Create account', magic: 'Send magic link', forgot: 'Send reset link' }[mode]
  const switchTo = (m) => () => { setMode(m); setError(null); setInfo(null); setSent(false) }
  const tabStyle = (active) => ({
    flex: 1,
    padding: '9px 12px',
    border: 'none',
    borderRadius: 8,
    background: active ? '#fff' : 'transparent',
    color: active ? '#0f172a' : '#64748b',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: active ? '0 1px 3px rgba(15,23,42,0.12)' : 'none',
  })

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#0f172a,#1e293b)', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:16, padding:'40px 36px', width:'100%', maxWidth:420, boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ fontSize:22, fontWeight:800, color:'#0f172a', marginBottom:6 }}>
            <span style={{ color:'#6366f1' }}>◈</span> Scout’n’Jobs
          </div>
          <div style={{ fontSize:13, color:'#64748b' }}>
            {mode === 'signup' ? 'Create an account' : 'Sign in to continue'}
          </div>
          <div style={{ marginTop:10, fontSize:11, color:'#475569', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:8, padding:'6px 10px', display:'inline-block' }}>
            Currently US-only — international support coming soon
          </div>
        </div>

        {!sent && (
          <div style={{ display:'flex', gap:4, padding:4, background:'#f1f5f9', borderRadius:10, marginBottom:20 }}>
            <button type="button" onClick={switchTo('password')} style={tabStyle(mode !== 'signup')}>
              Sign in
            </button>
            <button type="button" onClick={switchTo('signup')} style={tabStyle(mode === 'signup')}>
              Sign up
            </button>
          </div>
        )}

        {sent ? (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ fontSize:15, fontWeight:700, color:'#0f172a', marginBottom:6 }}>Check your email</div>
            <div style={{ fontSize:12, color:'#64748b', lineHeight:1.5 }}>
              {mode === 'forgot' ? 'Password reset link sent to' : 'Magic link sent to'}<br/>
              <span style={{ color:'#0f172a', fontWeight:600 }}>{email}</span>
            </div>
            <button onClick={switchTo('password')}
              style={{ marginTop:20, padding:'8px 16px', background:'#f1f5f9', color:'#475569', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }}>Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" disabled={sending} autoComplete="email"
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1px solid #e2e8f0', fontSize:14, color:'#0f172a', outline:'none', boxSizing:'border-box', marginBottom:14 }} />

            {mode !== 'magic' && mode !== 'forgot' && (
              <>
                <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }}>Password</label>
                <input type="password" required minLength={6} value={password} onChange={e => setPass(e.target.value)}
                  placeholder="••••••••" disabled={sending}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1px solid #e2e8f0', fontSize:14, color:'#0f172a', outline:'none', boxSizing:'border-box', marginBottom:14 }} />
              </>
            )}

            {error && <div style={{ padding:'10px 12px', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:8, fontSize:12, color:'#dc2626', marginBottom:14 }}>{error}</div>}
            {info  && <div style={{ padding:'10px 12px', background:'#ecfdf5', border:'1px solid #a7f3d0', borderRadius:8, fontSize:12, color:'#047857', marginBottom:14 }}>{info}</div>}

            <button type="submit" disabled={sending || !email || ((mode !== 'magic' && mode !== 'forgot') && !password)}
              style={{ width:'100%', padding:'12px', background: sending ? '#cbd5e1' : 'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor: sending ? 'default' : 'pointer' }}>
              {sending ? 'Working…' : label}
            </button>

            <div style={{ marginTop:18, display:'flex', justifyContent:'center', gap:6, flexWrap:'wrap', fontSize:11 }}>
              {(mode === 'magic' || mode === 'forgot') && (
                <button type="button" onClick={switchTo('password')}
                  style={{ background:'none', border:'none', color:'#6366f1', cursor:'pointer', fontWeight:700, padding:'4px 8px' }}>
                  Sign in with password
                </button>
              )}
              {mode === 'password' && (
                <>
                  <button type="button" onClick={switchTo('magic')}
                    style={{ background:'none', border:'none', color:'#6366f1', cursor:'pointer', fontWeight:700, padding:'4px 8px' }}>
                    Email me a magic link
                  </button>
                  <button type="button" onClick={switchTo('forgot')}
                    style={{ background:'none', border:'none', color:'#6366f1', cursor:'pointer', fontWeight:700, padding:'4px 8px' }}>
                    Forgot password?
                  </button>
                </>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

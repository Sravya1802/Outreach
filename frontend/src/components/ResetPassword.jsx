import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function ResetPassword() {
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState(null)
  const [info, setInfo]           = useState(null)
  const [hasSession, setHasSession] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    // Supabase places the recovery session into the URL hash on click.
    // detectSessionInUrl picks it up automatically; we just wait for it.
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => {
      setHasSession(!!sess)
    })
    return () => subscription?.unsubscribe()
  }, [])

  async function submit(e) {
    e.preventDefault()
    setError(null); setInfo(null)
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setSubmitting(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setInfo('Password updated. Redirecting…')
      setTimeout(() => navigate('/', { replace: true }), 1200)
    } catch (err) {
      setError(err.message || 'Failed to update password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#0f172a,#1e293b)', padding:20 }}>
      <div style={{ background:'#fff', borderRadius:16, padding:'40px 36px', width:'100%', maxWidth:420, boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <div style={{ fontSize:22, fontWeight:800, color:'#0f172a', marginBottom:6 }}>
            <span style={{ color:'#6366f1' }}>◈</span> Scout’n’Jobs
          </div>
          <div style={{ fontSize:13, color:'#64748b' }}>Set a new password</div>
        </div>

        {!hasSession ? (
          <div style={{ padding:'14px 16px', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, fontSize:12, color:'#92400e' }}>
            Recovery link not detected. Open the password-reset email again and click the most recent link, then return here.
          </div>
        ) : (
          <form onSubmit={submit}>
            <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }}>New password</label>
            <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" disabled={submitting} autoComplete="new-password"
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1px solid #e2e8f0', fontSize:14, color:'#0f172a', outline:'none', boxSizing:'border-box', marginBottom:14 }} />

            <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }}>Confirm password</label>
            <input type="password" required minLength={6} value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••" disabled={submitting} autoComplete="new-password"
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1px solid #e2e8f0', fontSize:14, color:'#0f172a', outline:'none', boxSizing:'border-box', marginBottom:14 }} />

            {error && <div style={{ padding:'10px 12px', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:8, fontSize:12, color:'#dc2626', marginBottom:14 }}>{error}</div>}
            {info  && <div style={{ padding:'10px 12px', background:'#ecfdf5', border:'1px solid #a7f3d0', borderRadius:8, fontSize:12, color:'#047857', marginBottom:14 }}>{info}</div>}

            <button type="submit" disabled={submitting || !password || !confirm}
              style={{ width:'100%', padding:'12px', background: submitting ? '#cbd5e1' : 'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor: submitting ? 'default' : 'pointer' }}>
              {submitting ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { api } from '../api'

function Spin({ color = '#6366f1', size = 18 }) {
  return <span style={{ display:'inline-block', width:size, height:size, border:`2px solid ${color}30`, borderTopColor:color, borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
}

// Small segmented control matching the app's light theme.
function Seg({ value, onChange, options }) {
  return (
    <div style={{ display:'inline-flex', background:'#f1f5f9', borderRadius:8, padding:3, gap:2 }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          style={{ padding:'7px 14px', border:'none', borderRadius:6, fontSize:13, fontWeight:700, cursor:'pointer',
            background: value === v ? '#fff' : 'transparent', color: value === v ? '#4f46e5' : '#64748b',
            boxShadow: value === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
          {l}
        </button>
      ))}
    </div>
  )
}

const LABEL = { fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }

export default function JobAlerts() {
  const [sub, setSub]             = useState(null)
  const [emailConfigured, setEmailConfigured] = useState(true)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [testing, setTesting]     = useState(false)
  const [msg, setMsg]             = useState(null)

  useEffect(() => {
    api.alerts.get()
      .then(d => { setSub(d.subscription); setEmailConfigured(d.emailConfigured) })
      .catch(err => setMsg({ ok: false, text: err.message }))
      .finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setSub(s => ({ ...s, [k]: v }))

  async function save(nextSubscribed) {
    const payload = nextSubscribed === undefined ? sub : { ...sub, subscribed: nextSubscribed }
    setSaving(true); setMsg(null)
    try {
      const d = await api.alerts.save(payload)
      setSub(d.subscription)
      setMsg({ ok: true, text: d.subscription.subscribed ? '✓ Subscribed — you’ll get role alerts by email' : 'Unsubscribed — alerts paused' })
    } catch (err) { setMsg({ ok: false, text: err.message }) }
    setSaving(false)
  }

  async function test() {
    setTesting(true); setMsg(null)
    try {
      const r = await api.alerts.test(sub.email)
      setMsg({ ok: true, text: `Test sent — ${r.total ?? 0} matching roles to ${r.to || sub.email}` })
    } catch (err) { setMsg({ ok: false, text: err.message }) }
    setTesting(false)
  }

  return (
    <div style={{ flex:1, overflowY:'auto', background:'#f8fafc' }}>
      {/* Header */}
      <div style={{ padding:'24px 40px 18px', background:'#fff', borderBottom:'1px solid #e2e8f0' }}>
        <h1 style={{ fontSize:22, fontWeight:800, color:'#0f172a', margin:'0 0 4px' }}>🔔 Job Alerts</h1>
        <p style={{ fontSize:13, color:'#64748b', margin:0 }}>
          Subscribe to get newly-scraped intern / new-grad roles emailed to you — filtered to what you care about.
        </p>
      </div>

      <div style={{ padding:'28px 40px', maxWidth:620, margin:'0 auto' }}>
        {loading || !sub ? (
          <div style={{ display:'flex', justifyContent:'center', padding:'60px 0' }}><Spin size={28} /></div>
        ) : (
          <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, padding:24 }}>
            {!emailConfigured && (
              <div style={{ padding:'10px 12px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:9, fontSize:12, color:'#92400e', marginBottom:18, lineHeight:1.5 }}>
                ⚠ Email sending isn’t configured on the server yet (<code>GMAIL_USER</code> / <code>GMAIL_APP_PASSWORD</code>). You can save your preferences now; delivery starts once it’s set.
              </div>
            )}

            {/* Subscribe toggle */}
            <label style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', background: sub.subscribed ? '#f0fdf4' : '#f8fafc', border:`1px solid ${sub.subscribed ? '#bbf7d0' : '#e2e8f0'}`, borderRadius:10, cursor:'pointer', marginBottom:20 }}>
              <input type="checkbox" checked={sub.subscribed} onChange={e => set('subscribed', e.target.checked)} style={{ width:18, height:18, cursor:'pointer' }} />
              <span style={{ fontSize:14, fontWeight:700, color: sub.subscribed ? '#15803d' : '#475569' }}>
                {sub.subscribed ? 'Subscribed to email alerts' : 'Subscribe to email alerts'}
              </span>
            </label>

            <div style={{ marginBottom:16 }}>
              <label style={LABEL}>Send to</label>
              <input type="email" value={sub.email} onChange={e => set('email', e.target.value)} placeholder="you@example.com"
                style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box' }} />
            </div>

            <div style={{ display:'flex', gap:24, marginBottom:16, flexWrap:'wrap' }}>
              <div>
                <label style={LABEL}>Frequency</label>
                <Seg value={sub.frequency} onChange={v => set('frequency', v)} options={[['daily','Daily'],['weekly','Weekly']]} />
              </div>
              <div>
                <label style={LABEL}>Roles</label>
                <Seg value={sub.roleType} onChange={v => set('roleType', v)} options={[['all','All'],['intern','Intern'],['new_grad','New grad']]} />
              </div>
            </div>

            <div style={{ marginBottom:22 }}>
              <label style={LABEL}>Keyword filter <span style={{ textTransform:'none', fontWeight:500, color:'#94a3b8' }}>(optional)</span></label>
              <input value={sub.keywords} onChange={e => set('keywords', e.target.value)} placeholder="e.g. machine learning, backend, data"
                style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box' }} />
              <div style={{ fontSize:11, color:'#94a3b8', marginTop:5 }}>Comma-separated. Matches role titles; leave blank for everything.</div>
            </div>

            {msg && (
              <div style={{ padding:'10px 12px', borderRadius:8, fontSize:13, fontWeight:600, marginBottom:16,
                background: msg.ok ? '#f0fdf4' : '#fef2f2', color: msg.ok ? '#15803d' : '#dc2626', border:`1px solid ${msg.ok ? '#bbf7d0' : '#fecaca'}` }}>
                {msg.text}
              </div>
            )}

            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              <button onClick={() => save()} disabled={saving}
                style={{ flex:1, minWidth:140, padding:'11px 18px', background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor: saving ? 'default':'pointer' }}>
                {saving ? 'Saving…' : (sub.subscribed ? 'Save alert' : 'Subscribe')}
              </button>
              <button onClick={test} disabled={testing || !emailConfigured}
                title={!emailConfigured ? 'Server email not configured yet' : 'Send a test alert now'}
                style={{ padding:'11px 18px', background:'#fff', color:'#4f46e5', border:'1px solid #c7d2fe', borderRadius:10, fontSize:14, fontWeight:700, cursor: (testing || !emailConfigured) ? 'default':'pointer', opacity: emailConfigured ? 1 : 0.5 }}>
                {testing ? 'Sending…' : 'Send test'}
              </button>
            </div>
            {sub.subscribed && (
              <button onClick={() => save(false)} disabled={saving}
                style={{ width:'100%', marginTop:12, padding:'8px', background:'none', color:'#94a3b8', border:'none', fontSize:13, fontWeight:600, cursor:'pointer', textDecoration:'underline' }}>
                Unsubscribe
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

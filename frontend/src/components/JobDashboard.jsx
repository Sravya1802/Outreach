import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useMediaQuery } from '../hooks'

const GRADE_COLOR = { A:'#16a34a', B:'#0d9488', C:'#d97706', D:'#ea580c', F:'#dc2626' }

function Spin({ color = '#6366f1', size = 18 }) {
  return <span style={{ display:'inline-block', width:size, height:size, border:`2px solid ${color}30`, borderTopColor:color, borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
}

function KPICard({ label, value, sub, tint, onClick, compact = false }) {
  return (
    <div onClick={onClick}
      style={{ padding: compact ? '14px 14px' : '16px 18px', background:'#fff', border:'1px solid #e8ebf0', borderRadius:14, boxShadow:'0 1px 2px rgba(16,24,40,0.04)', cursor: onClick ? 'pointer' : 'default', transition:'all 0.15s' }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.borderColor = tint+'55'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(16,24,40,0.08)' } }}
      onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.borderColor = '#e8ebf0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,0.04)' }}>
      <div style={{ fontSize: compact ? 20 : 25, fontWeight:800, color: tint, lineHeight:1 }}>{value}</div>
      <div style={{ fontSize: compact ? 11 : 12.5, fontWeight:700, color:'#0f172a', marginTop:6 }}>{label}</div>
      {sub && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sub}</div>}
    </div>
  )
}

function FunnelBar({ label, count, max, tint }) {
  const pct = max > 0 ? Math.max(3, Math.round((count / max) * 100)) : 0
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
        <span style={{ color:'#475569', fontWeight:600 }}>{label}</span>
        <span style={{ color: tint, fontWeight:800 }}>{count}</span>
      </div>
      <div style={{ height:8, background:'#f1f5f9', borderRadius:4, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background: tint, borderRadius:4, transition:'width 0.5s' }} />
      </div>
    </div>
  )
}

function timeAgo(iso) {
  if (!iso) return ''
  const h = Math.floor((Date.now() - new Date(iso)) / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  if (h < 168) return `${Math.floor(h / 24)}d ago`
  return `${Math.floor(h / 168)}w ago`
}

// Stale-while-revalidate cache for the dashboard payload. Lives for the
// session — first paint after the very first visit is instant, and each
// reload fires a background refresh that updates the UI when it lands.
const CACHE_KEY = 'jobDashboardMetrics:v1'
function readCachedMetrics() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { ts, data } = JSON.parse(raw)
    if (!data || Date.now() - ts > 5 * 60 * 1000) return null
    return data
  } catch { return null }
}
function writeCachedMetrics(data) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })) } catch {}
}

export default function JobDashboard() {
  const navigate = useNavigate()
  const cached = readCachedMetrics()
  const [m, setM]             = useState(cached)
  const [loading, setLoading] = useState(!cached)
  const [refreshing, setRefreshing] = useState(false)
  const isPhone = useMediaQuery('(max-width: 480px)')

  const load = useCallback(async () => {
    if (m) setRefreshing(true); else setLoading(true)
    try {
      const fresh = await api.jobMetrics()
      setM(fresh)
      writeCachedMetrics(fresh)
    } catch (_) { if (!m) setM(null) }
    finally { setLoading(false); setRefreshing(false) }
  }, [m])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !m) {
    return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}><Spin size={28} /></div>
  }
  if (!m) {
    return <div style={{ flex:1, padding:40 }}>Failed to load metrics</div>
  }

  const { summary, applyFunnel, applyModes, gradeDist } = m
  const funnelMax = Math.max(applyFunnel.evaluated, applyFunnel.applied, applyFunnel.responded, applyFunnel.interview, applyFunnel.offer, applyFunnel.rejected, 1)
  const gradeMax  = Math.max(...Object.values(gradeDist), 1)
  const gradedTotal = Object.values(gradeDist).reduce((a, b) => a + b, 0)
  // Linear funnel stages (Rejected is a terminal outcome, shown separately).
  const stages = [
    { label:'Evaluated',    count: applyFunnel.evaluated, tint:'#6366f1' },
    { label:'Applied',      count: applyFunnel.applied,   tint:'#0891b2' },
    { label:'Responded',    count: applyFunnel.responded, tint:'#ca8a04' },
    { label:'Interviewing', count: applyFunnel.interview, tint:'#7c3aed' },
    { label:'Offer',        count: applyFunnel.offer,     tint:'#16a34a' },
  ]
  const topCount = Math.max(stages[0].count, 1)

  const panelStyle = { background:'#fff', border:'1px solid #e8ebf0', borderRadius:16, boxShadow:'0 1px 2px rgba(16,24,40,0.04)', padding: isPhone ? '18px' : '22px 24px', display:'flex', flexDirection:'column' }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflowY:'auto', background:'#f8fafc' }}>
      {/* Header */}
      <div style={{ padding: isPhone ? '14px 14px' : '24px 40px', background:'#fff', borderBottom:'1px solid #e2e8f0', flexShrink:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
          <div style={{ flex:'1 1 200px', minWidth:0 }}>
            <h1 style={{ fontSize: isPhone ? 18 : 22, fontWeight:800, color:'#0f172a', margin: isPhone ? 0 : '0 0 4px' }}>Analytics</h1>
            {!isPhone && (
              <p style={{ fontSize:13, color:'#64748b', margin:0 }}>Your job search, tracked end-to-end — funnel, fit-scores & outreach.</p>
            )}
          </div>
          <button onClick={load}
            style={{ padding:'8px 14px', fontSize:12, fontWeight:700, background:'#fff', color:'#475569', border:'1px solid #e2e8f0', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap', flexShrink:0 }}>
            {refreshing ? <Spin size={12} color="#475569" /> : '↻'} Refresh
          </button>
        </div>
      </div>

      <div style={{ flex:1, display:'flex', flexDirection:'column', padding: isPhone ? '14px 12px' : '24px 40px', gap: isPhone ? 14 : 20 }}>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: isPhone ? 8 : 12, flexShrink:0 }}>
          <KPICard label="Companies" value={summary.totalCompanies.toLocaleString()} sub="in database" tint="#6366f1" compact={isPhone} onClick={() => navigate('/discover/companies')} />
          <KPICard label="Evaluations" value={summary.totalEvaluations} sub={gradedTotal > 0 ? `${gradedTotal} A–F graded` : 'queued, not graded'} tint="#7c3aed" compact={isPhone} onClick={() => navigate('/discover/evaluate')} />
          <KPICard label="Applied" value={applyFunnel.applied} sub={`${applyModes.manual} manual · ${applyModes.auto} auto`} tint="#0891b2" compact={isPhone} onClick={() => navigate('/apply/pipeline')} />
          <KPICard label="Contacts" value={summary.totalContacts} sub={`${summary.contactsWithEmail} with email`} tint="#059669" compact={isPhone} onClick={() => navigate('/outreach/messages')} />
          <KPICard label="Outreach Sent" value={summary.outreachSent} sub={`${summary.outreachGenerated} drafted`} tint="#d97706" compact={isPhone} onClick={() => navigate('/outreach/messages')} />
          <KPICard label="Response Rate" value={`${summary.responseRate}%`} sub={`${summary.outreachReplied}/${summary.outreachSent} replied`} tint="#dc2626" compact={isPhone} />
        </div>

        {/* Funnel + Fit-Score — fills the rest of the screen */}
        <div style={{ flex:1, display:'grid', gridTemplateColumns: isPhone ? '1fr' : '1.15fr 1fr', gap: isPhone ? 14 : 20, minHeight: isPhone ? 'auto' : 340 }}>

          {/* Application Funnel */}
          <div style={panelStyle}>
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:18 }}>
              <h2 style={{ fontSize:15, fontWeight:800, color:'#0f172a', margin:0 }}>Application Funnel</h2>
              <span style={{ fontSize:12, color:'#64748b' }}><strong style={{ color:'#0891b2' }}>{summary.applyRate}%</strong> evaluated → applied</span>
            </div>
            <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
              {stages.map((s, i) => {
                const pct  = Math.round((s.count / topCount) * 100)
                const conv = i > 0 ? (stages[i-1].count > 0 ? Math.round((s.count / stages[i-1].count) * 100) : 0) : null
                return (
                  <div key={s.label}>
                    {i > 0 && <div style={{ fontSize:10, color:'#cbd5e1', fontWeight:700, padding:'1px 0 1px 102px' }}>↓ {conv}%</div>}
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <span style={{ width:90, fontSize:12.5, fontWeight:700, color:'#475569', flexShrink:0 }}>{s.label}</span>
                      <div style={{ flex:1, height:22, background:'#f1f5f9', borderRadius:6, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${Math.max(pct, s.count > 0 ? 6 : 0)}%`, background:s.tint, borderRadius:6, transition:'width 0.5s' }} />
                      </div>
                      <span style={{ width:26, textAlign:'right', fontSize:16, fontWeight:800, color: s.count > 0 ? s.tint : '#cbd5e1', flexShrink:0 }}>{s.count}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            {applyFunnel.rejected > 0 && (
              <div style={{ marginTop:14, fontSize:12, fontWeight:600, color:'#dc2626' }}>✗ {applyFunnel.rejected} rejected</div>
            )}
          </div>

          {/* Fit-Score */}
          <div style={panelStyle}>
            <h2 style={{ fontSize:15, fontWeight:800, color:'#0f172a', margin:'0 0 18px' }}>Fit-Score Distribution</h2>
            {gradedTotal === 0 ? (
              <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', gap:10 }}>
                <div style={{ fontSize:40 }}>🎯</div>
                <div style={{ fontSize:14, fontWeight:700, color:'#475569' }}>No graded roles yet</div>
                <div style={{ fontSize:12.5, color:'#94a3b8', maxWidth:250, lineHeight:1.5 }}>Evaluate roles in Career Ops to see your A–F fit breakdown and surface your best bets.</div>
                <button onClick={() => navigate('/discover/evaluate')} style={{ marginTop:6, padding:'9px 18px', fontSize:12.5, fontWeight:700, background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:10, cursor:'pointer' }}>Evaluate roles →</button>
              </div>
            ) : (
              <>
                <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
                  {['A','B','C','D','F'].map(g => {
                    const n = gradeDist[g] || 0
                    const pct = Math.round((n / gradeMax) * 100)
                    return (
                      <div key={g} style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <span style={{ width:62, fontSize:12.5, fontWeight:700, color:'#475569', flexShrink:0 }}>Grade {g}</span>
                        <div style={{ flex:1, height:22, background:'#f1f5f9', borderRadius:6, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${Math.max(pct, n > 0 ? 6 : 0)}%`, background:GRADE_COLOR[g], borderRadius:6 }} />
                        </div>
                        <span style={{ width:26, textAlign:'right', fontSize:16, fontWeight:800, color: n > 0 ? GRADE_COLOR[g] : '#cbd5e1', flexShrink:0 }}>{n}</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop:14, padding:'10px 12px', background:'#f0fdf4', borderRadius:8, fontSize:12, color:'#166534', border:'1px solid #bbf7d0' }}>
                  <strong>{(gradeDist.A || 0) + (gradeDist.B || 0)}</strong> roles scored A or B — your best bets to apply first.
                </div>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

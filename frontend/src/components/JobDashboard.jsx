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

  const { summary, applyFunnel, applyModes, gradeDist, topOutreachCompanies = [], recentEvals = [], recentApplied = [] } = m
  const funnelMax = Math.max(applyFunnel.evaluated, applyFunnel.applied, applyFunnel.responded, applyFunnel.interview, applyFunnel.offer, applyFunnel.rejected, 1)
  const gradeMax  = Math.max(...Object.values(gradeDist), 1)
  const gradedTotal = Object.values(gradeDist).reduce((a, b) => a + b, 0)

  // Stage-to-stage conversion rates — the analytical heart of the page.
  const rate = (num, den) => (den > 0 ? Math.round((num / den) * 100) : 0)
  const conversions = [
    { label:'Apply rate',     value: rate(applyFunnel.applied,   applyFunnel.evaluated), sub:'evaluated → applied', tint:'#0891b2' },
    { label:'Response rate',  value: rate(applyFunnel.responded, applyFunnel.applied),   sub:'applied → responded', tint:'#ca8a04' },
    { label:'Interview rate', value: rate(applyFunnel.interview, applyFunnel.applied),   sub:'applied → interview', tint:'#7c3aed' },
    { label:'Offer rate',     value: rate(applyFunnel.offer,     applyFunnel.applied),   sub:'applied → offer',     tint:'#16a34a' },
  ]
  const autoPct = rate(applyModes.auto, applyModes.manual + applyModes.auto)
  const panelStyle = { background:'#fff', border:'1px solid #e8ebf0', borderRadius:14, boxShadow:'0 1px 2px rgba(16,24,40,0.04)', padding:18 }

  return (
    <div style={{ flex:1, overflowY:'auto', background:'#f8fafc' }}>
      {/* Header — tighter padding + hidden subtitle on phone for breathing room. */}
      <div style={{ padding: isPhone ? '14px 14px' : '24px 40px', background:'#fff', borderBottom:'1px solid #e2e8f0' }}>
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

      <div style={{ padding: isPhone ? '14px 12px' : '24px 40px', display:'flex', flexDirection:'column', gap: isPhone ? 14 : 24 }}>

        {/* Top-level KPIs — tighter cards on phone so 2 fit per row legibly */}
        <div style={{ display:'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(150px, 1fr))', gap: isPhone ? 8 : 12 }}>
          <KPICard label="Companies" value={summary.totalCompanies.toLocaleString()} sub="in database" tint="#6366f1" compact={isPhone} onClick={() => navigate('/discover/companies')} />
          <KPICard label="Evaluations" value={summary.totalEvaluations} sub={gradedTotal > 0 ? `${gradedTotal} A–F graded` : 'queued, not graded'} tint="#7c3aed" compact={isPhone} onClick={() => navigate('/discover/evaluate')} />
          <KPICard label="Applied" value={applyFunnel.applied} sub={`${applyModes.manual} manual · ${applyModes.auto} auto`} tint="#0891b2" compact={isPhone} onClick={() => navigate('/apply/pipeline')} />
          <KPICard label="Contacts" value={summary.totalContacts} sub={`${summary.contactsWithEmail} with email`} tint="#059669" compact={isPhone} onClick={() => navigate('/outreach/messages')} />
          <KPICard label="Outreach Sent" value={summary.outreachSent} sub={`${summary.outreachGenerated} drafted`} tint="#d97706" compact={isPhone} onClick={() => navigate('/outreach/messages')} />
          <KPICard label="Response Rate" value={`${summary.responseRate}%`} sub={`${summary.outreachReplied}/${summary.outreachSent} replied`} tint="#dc2626" compact={isPhone} />
        </div>

        {/* Conversion rates — stage-to-stage */}
        <div style={{ display:'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: isPhone ? 8 : 12 }}>
          {conversions.map(c => (
            <div key={c.label} style={panelStyle}>
              <div style={{ fontSize:26, fontWeight:800, color:c.tint, lineHeight:1 }}>{c.value}%</div>
              <div style={{ fontSize:12.5, fontWeight:700, color:'#0f172a', marginTop:6 }}>{c.label}</div>
              <div style={{ fontSize:10.5, color:'#94a3b8', marginTop:1 }}>{c.sub}</div>
              <div style={{ marginTop:10, height:6, background:'#f1f5f9', borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${c.value}%`, background:c.tint, borderRadius:3, transition:'width 0.5s' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Funnel + Fit-Score + Apply method — three compact panels */}
        <div style={{ display:'grid', gridTemplateColumns: isPhone ? '1fr' : '1.15fr 1fr 0.85fr', gap: isPhone ? 14 : 16 }}>
          <div style={panelStyle}>
            <h2 style={{ fontSize:14, fontWeight:800, color:'#0f172a', margin:'0 0 14px' }}>Application Funnel</h2>
            <FunnelBar label="Evaluated"    count={applyFunnel.evaluated} max={funnelMax} tint="#6366f1" />
            <FunnelBar label="Applied"      count={applyFunnel.applied}   max={funnelMax} tint="#0891b2" />
            <FunnelBar label="Responded"    count={applyFunnel.responded} max={funnelMax} tint="#ca8a04" />
            <FunnelBar label="Interviewing" count={applyFunnel.interview} max={funnelMax} tint="#7c3aed" />
            <FunnelBar label="Offer"        count={applyFunnel.offer}     max={funnelMax} tint="#16a34a" />
            <FunnelBar label="Rejected"     count={applyFunnel.rejected}  max={funnelMax} tint="#dc2626" />
          </div>

          <div style={panelStyle}>
            <h2 style={{ fontSize:14, fontWeight:800, color:'#0f172a', margin:'0 0 14px' }}>Fit-Score Distribution</h2>
            {['A','B','C','D','F'].map(g => (
              <FunnelBar key={g} label={`Grade ${g}`} count={gradeDist[g] || 0} max={gradeMax} tint={GRADE_COLOR[g]} />
            ))}
            <div style={{ marginTop:12, fontSize:11.5, color:'#64748b', lineHeight:1.5 }}>
              {gradedTotal === 0 ? 'No graded roles yet — evaluate in Career Ops.' : <><strong>{(gradeDist.A || 0) + (gradeDist.B || 0)}</strong> scored A or B — apply to those first.</>}
            </div>
          </div>

          <div style={{ ...panelStyle, display:'flex', flexDirection:'column', alignItems:'center' }}>
            <h2 style={{ fontSize:14, fontWeight:800, color:'#0f172a', margin:'0 0 18px', alignSelf:'flex-start' }}>Apply Method</h2>
            <div style={{ width:118, height:118, borderRadius:'50%', background:`conic-gradient(#0891b2 0% ${autoPct}%, #e2e8f0 ${autoPct}% 100%)`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <div style={{ width:78, height:78, borderRadius:'50%', background:'#fff', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                <div style={{ fontSize:22, fontWeight:800, color:'#0f172a', lineHeight:1 }}>{applyFunnel.applied}</div>
                <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>applied</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:16, marginTop:18, fontSize:11.5, color:'#475569' }}>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:9, height:9, borderRadius:2, background:'#0891b2' }} /> Auto {applyModes.auto}</span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:9, height:9, borderRadius:2, background:'#cbd5e1' }} /> Manual {applyModes.manual}</span>
            </div>
          </div>
        </div>

        {/* Where your outreach effort went */}
        <div style={panelStyle}>
          <h2 style={{ fontSize:14, fontWeight:800, color:'#0f172a', margin:'0 0 4px' }}>Where your outreach effort went</h2>
          <p style={{ fontSize:11, color:'#94a3b8', margin:'0 0 14px' }}>Top companies across contacts, evaluations, and tracked applications.</p>
          {topOutreachCompanies.length === 0 ? (
            <div style={{ fontSize:13, color:'#94a3b8', padding:'14px 0' }}>No activity yet — find contacts, evaluate a role, or track an application to start.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#f8fafc' }}>
                  {['Company','Contacts','Emails','Sent','Replied','Evals','Tracked'].map(h => (
                    <th key={h} style={{ padding:'8px 12px', textAlign:h === 'Company' ? 'left' : 'right', fontWeight:700, color:'#475569', fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topOutreachCompanies.map((c, i) => (
                  <tr key={i} style={{ borderTop:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'10px 12px', color:'#0f172a', fontWeight:600 }}>{c.name}{c.category && <div style={{ fontSize:11, color:'#94a3b8', fontWeight:400 }}>{c.category}</div>}</td>
                    <td style={{ padding:'10px 12px', textAlign:'right', color: c.contact_count ? '#475569' : '#cbd5e1', fontWeight:600 }}>{c.contact_count || '—'}</td>
                    <td style={{ padding:'10px 12px', textAlign:'right', color: c.email_count ? '#16a34a' : '#cbd5e1', fontWeight:600 }}>{c.email_count || '—'}</td>
                    <td style={{ padding:'10px 12px', textAlign:'right', color: c.sent_count ? '#0891b2' : '#cbd5e1', fontWeight:600 }}>{c.sent_count || '—'}</td>
                    <td style={{ padding:'10px 12px', textAlign:'right', color: c.replied_count ? '#dc2626' : '#cbd5e1', fontWeight:600 }}>{c.replied_count || '—'}</td>
                    <td style={{ padding:'10px 12px', textAlign:'right', color: c.eval_count ? '#7c3aed' : '#cbd5e1', fontWeight:600 }}>{c.eval_count || '—'}</td>
                    <td style={{ padding:'10px 12px', textAlign:'right', color: c.app_count ? '#d97706' : '#cbd5e1', fontWeight:600 }}>{c.app_count || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent timeline — two columns */}
        <div style={{ display:'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: isPhone ? 14 : 16 }}>
          <div style={panelStyle}>
            <h2 style={{ fontSize:14, fontWeight:800, color:'#0f172a', margin:'0 0 14px' }}>Recent Evaluations</h2>
            {recentEvals.length === 0 ? (
              <div style={{ fontSize:13, color:'#94a3b8' }}>No evaluations yet.</div>
            ) : recentEvals.slice(0, 6).map((e, i) => (
              <button key={i} type="button"
                onClick={async () => { try { await api.career.openReportTab(e.id) } catch (err) { alert('Could not open report: ' + err.message) } }}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', textAlign:'left', background:'none', border:'none', borderBottom: i < Math.min(recentEvals.length, 6) - 1 ? '1px solid #f1f5f9' : 'none', cursor:'pointer', width:'100%' }}>
                <div style={{ width:26, height:26, borderRadius:'50%', border:`2px solid ${GRADE_COLOR[e.grade] || '#94a3b8'}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <span style={{ fontSize:11, fontWeight:900, color: GRADE_COLOR[e.grade] || '#94a3b8' }}>{e.grade || '—'}</span>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.job_title}</div>
                  <div style={{ fontSize:11, color:'#94a3b8' }}>{e.company_name} · {timeAgo(e.created_at)}</div>
                </div>
              </button>
            ))}
          </div>

          <div style={panelStyle}>
            <h2 style={{ fontSize:14, fontWeight:800, color:'#0f172a', margin:'0 0 14px' }}>Recently Applied</h2>
            {recentApplied.length === 0 ? (
              <div style={{ fontSize:13, color:'#94a3b8' }}>No applications submitted yet.</div>
            ) : recentApplied.slice(0, 6).map((e, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom: i < Math.min(recentApplied.length, 6) - 1 ? '1px solid #f1f5f9' : 'none' }}>
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'#ecfeff', color:'#0891b2', flexShrink:0 }}>{e.apply_status}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.job_title}</div>
                  <div style={{ fontSize:11, color:'#94a3b8' }}>{e.company_name} · {timeAgo(e.applied_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

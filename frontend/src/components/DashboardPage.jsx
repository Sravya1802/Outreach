import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useMediaQuery } from '../hooks'

const CATEGORIES = [
  { label:'YC Startups',              slug:'yc-startups',                  tint:'#F26625', bg:'rgba(242,102,37,0.08)' },
  { label:'Tech & Software',          slug:'Tech%20%26%20Software',        tint:'#2563eb', bg:'rgba(37,99,235,0.08)' },
  { label:'Finance & Investing',      slug:'Finance%20%26%20Investing',    tint:'#059669', bg:'rgba(5,150,105,0.08)' },
  { label:'AI & Research',            slug:'AI%20%26%20Research',          tint:'#7c3aed', bg:'rgba(124,58,237,0.08)' },
  { label:'Healthcare & Life Sciences',slug:'Healthcare%20%26%20Life%20Sciences', tint:'#dc2626', bg:'rgba(220,38,38,0.08)' },
  { label:'Data & Analytics',         slug:'Data%20%26%20Analytics',       tint:'#4f46e5', bg:'rgba(79,70,229,0.08)' },
]

function Spin({ color = '#6366f1', size = 20 }) {
  return <span style={{ display:'inline-block', width:size, height:size, border:`2px solid ${color}30`, borderTopColor:color, borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
}

function timeAgo(iso) {
  if (!iso) return ''
  const h = Math.floor((Date.now() - new Date(iso)) / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  if (h < 24 * 7) return `${Math.floor(h / 24)}d ago`
  return `${Math.floor(h / 168)}w ago`
}

// activity_log.details is JSONB in Supabase — it comes back as an object,
// not a string. Rendering the object directly throws React error #31 and
// blanks the dashboard. Flatten to a short human-readable summary.
function formatActivityDetails(a) {
  const d = a.details
  if (!d) return a.action || ''
  if (typeof d === 'string') return d
  try {
    const parts = []
    if (d.subcategory) parts.push(d.subcategory)
    if (d.source)      parts.push(d.source)
    if (d.added != null || d.imported != null) parts.push(`+${d.added ?? d.imported} new`)
    if (d.updated)     parts.push(`${d.updated} updated`)
    if (d.skipped)     parts.push(`${d.skipped} skipped`)
    return parts.length ? parts.join(' · ') : (a.action || 'activity')
  } catch {
    return a.action || 'activity'
  }
}

// One "Daily updates" row — a role type with its 24h count + a few fresh roles.
function DailySection({ icon, label, tint, count, recent, onClick }) {
  return (
    <div style={{ padding:'12px 16px', borderBottom:'1px solid #f1f5f9' }}>
      <div onClick={onClick}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', margin:'-4px -8px 6px', padding:'6px 8px', borderRadius:8, transition:'background 0.12s' }}
        onMouseEnter={e => e.currentTarget.style.background = '#f6f7fb'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:14 }}>{icon}</span>
          <span style={{ fontSize:12, fontWeight:700, color:'#0f172a' }}>{label}</span>
          <span style={{ fontSize:12, color: tint, fontWeight:800 }}>›</span>
        </div>
        <span style={{ fontSize:13, fontWeight:800, color: tint }}>
          +{count ?? 0}<span style={{ fontSize:10, color:'#94a3b8', fontWeight:600, marginLeft:4 }}>today</span>
        </span>
      </div>
      {recent && recent.length > 0 ? (
        recent.slice(0, 4).map((r, i) => (
          <a key={i} href={r.apply_url} target="_blank" rel="noreferrer"
            title={`${r.title} · ${r.company_name}`}
            style={{ display:'block', fontSize:11, color:'#475569', textDecoration:'none', padding:'2px 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            · {r.title} <span style={{ color:'#94a3b8' }}>· {r.company_name}</span>
          </a>
        ))
      ) : (
        <div style={{ fontSize:11, color:'#cbd5e1' }}>Nothing new in the last 24h</div>
      )}
    </div>
  )
}

export default function DashboardPage({ onStatsChange }) {
  const navigate = useNavigate()
  // Three-tier breakpoints. iPad portrait (768) and iPad Pro portrait (1024)
  // both fall into "narrow" — the 1fr+320px sidebar grid clips Recent
  // Activity at those widths, so we collapse to a single column ≤1100.
  const isPhone   = useMediaQuery('(max-width: 480px)')
  const isNarrow  = useMediaQuery('(max-width: 1100px)')
  const [stats, setStats]       = useState(null)
  const [activity, setActivity] = useState([])
  // null sentinel = "still loading" so cards can render '—' instead of a
  // misleading '0' before the request resolves. Same fix the Companies page
  // got earlier — empty {} let the renderer fall through to (catCounts[k] || 0).
  const [catCounts, setCatCounts] = useState(null)
  const [queue, setQueue]       = useState(null)
  const [daily, setDaily]       = useState(null)
  const [health, setHealth]     = useState(null)
  const [now, setNow]           = useState(() => Date.now())

  useEffect(() => {
    const loadStats = () => {
      api.stats().then(s => { setStats(s); onStatsChange?.(s) }).catch(() => {})
      api.unified.categoryCounts().then(d => {
        const map = {}
        for (const r of (d.counts || [])) map[r.category] = r.count
        setCatCounts(map)
      }).catch(() => {})
      api.career.autoApplyQueue().then(q => setQueue(q)).catch(() => setQueue(null))
    }
    loadStats()
    api.activity().then(d => setActivity(d.activity || [])).catch(() => {})
    api.dailyUpdates().then(setDaily).catch(() => {})
    api.health().then(setHealth).catch(() => {})
    window.addEventListener('stats-refresh', loadStats)
    return () => window.removeEventListener('stats-refresh', loadStats)
  // onStatsChange is a parent setter; rerunning this effect for identity churn
  // would refetch the dashboard unnecessarily.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])

  const statCards = stats ? [
    { icon:'🏢', label:'Companies',    value: stats.totalCompanies?.toLocaleString() ?? '—',  sub:'in database',   tint:'#6366f1', action: () => navigate('/discover/companies') },
    { icon:'👥', label:'Contacts',     value: stats.totalContacts?.toLocaleString() ?? '—',   sub: stats.contactsWithEmail != null ? `${stats.contactsWithEmail.toLocaleString()} with email` : 'people found', tint:'#059669', action: () => navigate('/outreach/messages') },
    { icon:'📤', label:'Sent',         value: stats.totalSent?.toLocaleString() ?? '—',       sub:'outreach sent', tint:'#0891b2', action: () => navigate('/outreach/messages') },
    { icon:'💬', label:'Response Rate',value: stats.responseRate != null ? `${stats.responseRate}%` : '—', sub:'reply rate', tint:'#d97706', action: null },
    { icon:'🎯', label:'Evaluated',    value: stats.totalApplications?.toLocaleString() ?? '—', sub:'roles scored', tint:'#9333ea', action: () => navigate('/discover/evaluate') },
  ] : []

  const activityIcons = {
    yc_import: '⭐', yc_import_all: '⭐', scrape: '🔍', find_people: '👤',
    email_found: '✉', outreach_sent: '📤', yc_waas_scrape: '🌐',
  }

  return (
    <div style={{ flex:1, overflowY:'auto', background:'#f8fafc' }}>
      {/* Header */}
      <div style={{ padding: isPhone ? '16px 14px 14px' : '32px 40px 24px', background:'#fff', borderBottom:'1px solid #e2e8f0' }}>
        <h1 style={{ fontSize: isPhone ? 18 : 24, fontWeight:800, color:'#0f172a', margin:'0 0 4px' }}>Dashboard</h1>
        <p style={{ fontSize: isPhone ? 12 : 13, color:'#64748b', margin:0 }}>Your Job search at a glance</p>

        {/* Stats row — 5-up on desktop, 3-up on tablet/iPad, 2-up on phone */}
        {stats ? (
          <div style={{ display:'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : isNarrow ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)', gap: isPhone ? 8 : 12, marginTop: isPhone ? 14 : 24 }}>
            {statCards.map(s => (
              <div key={s.label}
                onClick={s.action}
                style={{ padding:'16px 18px', background:'#fff', borderRadius:14, border:'1px solid #e8ebf0', boxShadow:'0 1px 2px rgba(16,24,40,0.04)', cursor: s.action ? 'pointer' : 'default', transition:'all 0.15s' }}
                onMouseEnter={e => { if (s.action) { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 8px 20px rgba(16,24,40,0.08)'; e.currentTarget.style.borderColor = s.tint+'55' } }}
                onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 1px 2px rgba(16,24,40,0.04)'; e.currentTarget.style.borderColor='#e8ebf0' }}>
                <div style={{ fontSize:26, fontWeight:800, color: s.tint, lineHeight:1 }}>{s.value}</div>
                <div style={{ fontSize:12.5, fontWeight:700, color:'#0f172a', marginTop:7 }}>{s.label}</div>
                <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop:24, display:'flex', justifyContent:'center' }}><Spin /></div>
        )}
      </div>

      <div style={{ padding: isPhone ? '20px 14px' : '28px 40px', display:'grid', gridTemplateColumns: isNarrow ? '1fr' : 'minmax(0, 1fr) 340px', gap: isPhone ? 18 : 28 }}>

        {/* Left column */}
        <div>

          {/* Auto-Apply Queue summary — bubbles up needs_review urgency. */}
          {queue && (queue.counts?.needs_review > 0 || queue.counts?.queued > 0 || queue.counts?.failed > 0) && (() => {
            const c = queue.counts || {}
            const urgent = (c.needs_review || 0) > 0
            const tint = urgent ? '#dc2626' : c.queued > 0 ? '#7c3aed' : '#64748b'
            return (
              <div onClick={() => navigate('/apply/auto-apply')}
                style={{ marginBottom:24, padding:'14px 18px', background:'#fff', border:`1px solid ${tint}30`, borderLeft:`3px solid ${tint}`, borderRadius:12, boxShadow:'0 1px 2px rgba(16,24,40,0.04)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:3 }}>
                    Auto-Apply Queue {urgent && <span style={{ color:'#dc2626' }}>· needs attention</span>}
                  </div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#0f172a', display:'flex', gap:10, flexWrap:'wrap' }}>
                    {c.needs_review > 0 && <span style={{ color:'#dc2626' }}>⚠ {c.needs_review} needs review</span>}
                    {c.queued > 0       && <span style={{ color:'#7c3aed' }}>{c.queued} queued</span>}
                    {c.submitted > 0    && <span style={{ color:'#16a34a' }}>{c.submitted} submitted</span>}
                    {c.failed > 0       && <span style={{ color:'#d97706' }}>{c.failed} failed</span>}
                    {c.unsupported > 0  && <span style={{ color:'#64748b' }}>{c.unsupported} unsupported</span>}
                  </div>
                </div>
                <div style={{ fontSize:11, fontWeight:700, color: tint }}>
                  {urgent ? '→ Fix profile' : '→ Open queue'}
                </div>
              </div>
            )
          })()}

          {/* Last scrape — populated by /jobs/scrape (writes meta.last_scrape_summary) */}
          {stats?.lastScrape && (() => {
            const ls = stats.lastScrape
            const ageMs = now - new Date(ls.at).getTime()
            const ageStr = ageMs < 60000 ? 'just now'
              : ageMs < 3600000 ? `${Math.floor(ageMs / 60000)}m ago`
              : ageMs < 86400000 ? `${Math.floor(ageMs / 3600000)}h ago`
              : `${Math.floor(ageMs / 86400000)}d ago`
            const allInDb = ls.added === 0 && ls.found > 0
            const tint = allInDb ? '#94a3b8' : ls.added > 0 ? '#16a34a' : '#dc2626'
            return (
              <div style={{ marginBottom:24, padding:'14px 18px', background:'#fff', border:`1px solid ${tint}30`, borderLeft:`3px solid ${tint}`, borderRadius:12, boxShadow:'0 1px 2px rgba(16,24,40,0.04)', display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:3 }}>
                      Last scrape · {ageStr}
                    </div>
                    <div style={{ fontSize:13, fontWeight:600, color:'#0f172a' }}>
                      Found <strong>{ls.found}</strong>
                      {ls.added > 0 && <> · <span style={{ color:'#16a34a' }}>+{ls.added} new</span></>}
                      {ls.alreadyInDb > 0 && <> · <span style={{ color:'#64748b' }}>{ls.alreadyInDb} already in DB</span></>}
                    </div>
                  </div>
                  <button onClick={() => navigate('/scraper')}
                    style={{ background:'transparent', border:'none', fontSize:11, fontWeight:700, color: tint, cursor:'pointer', padding:0 }}>
                    ↻ Scrape again
                  </button>
                </div>

                {/* Names of newly added companies — concrete proof of what happened */}
                {(ls.newCompanyNames || []).length > 0 && (
                  <div style={{ fontSize:12, color:'#475569', lineHeight:1.5 }}>
                    <span style={{ color:'#94a3b8', fontWeight:600 }}>New: </span>
                    {ls.newCompanyNames.slice(0, 8).map((n, i) => (
                      <span key={i}>
                        <button onClick={() => navigate(`/companies?search=${encodeURIComponent(n)}`)}
                          style={{ background:'transparent', border:'none', padding:0, color:'#0f172a', fontWeight:600, cursor:'pointer', textDecoration:'underline' }}>
                          {n}
                        </button>
                        {i < Math.min(7, ls.newCompanyNames.length - 1) && ', '}
                      </span>
                    ))}
                    {ls.newCompanyNames.length > 8 && <span style={{ color:'#94a3b8' }}> + {ls.added - 8} more</span>}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Quick Actions — 6-up desktop, 3-up tablet, 2-up phone. */}
          <div style={{ marginBottom:28 }}>
            <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:14 }}>Quick Actions</div>
            <div style={{ display:'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, minmax(0, 1fr))', gap: isPhone ? 8 : 12 }}>
              {[
                { icon:'🔍', label:'Browse Companies', sub:'Search & explore by category',  action: () => navigate('/discover/companies'), tint:'#6366f1' },
                { icon:'📥', label:'Job Scraper',       sub:'Scrape roles across sources',   action: () => navigate('/discover/scraper'),   tint:'#059669' },
                { icon:'⚡', label:'Auto-Apply',        sub:'Queue & auto-apply to roles',   action: () => navigate('/apply/auto-apply'),   tint:'#e11d48' },
                { icon:'✉',  label:'Write Outreach',   sub:'Find contacts & draft emails',  action: () => navigate('/outreach/messages'),  tint:'#0891b2' },
              ].map(q => (
                <div key={q.label} onClick={q.action}
                  style={{ padding:'18px', background:'#fff', border:'1px solid #e8ebf0', borderRadius:14, boxShadow:'0 1px 2px rgba(16,24,40,0.04)', cursor:'pointer', transition:'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.borderColor = q.tint+'55'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(16,24,40,0.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.borderColor = '#e8ebf0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,0.04)' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                    <span style={{ fontSize:22 }}>{q.icon}</span>
                    <span style={{ fontSize:16, fontWeight:800, color: q.tint }}>→</span>
                  </div>
                  <div style={{ fontSize:14, fontWeight:700, color:'#0f172a', marginBottom:3 }}>{q.label}</div>
                  <div style={{ fontSize:11, color:'#94a3b8', lineHeight:1.4 }}>{q.sub}</div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Right rail — API Status + Daily Updates (#1e) + Recent Activity */}
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:14 }}>API Status</div>
          <div style={{ background:'#fff', border:'1px solid #e8ebf0', borderRadius:14, boxShadow:'0 1px 2px rgba(16,24,40,0.04)', padding:'10px 16px', marginBottom:28 }}>
            {[['Gemini AI', health?.has_gemini], ['Apify', health?.has_apify], ['Apollo', health?.has_apollo], ['LinkedIn', health?.has_linkedin]].map(([label, ok]) => (
              <div key={label} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0' }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background: ok ? '#22c55e' : '#cbd5e1', flexShrink:0 }} />
                <span style={{ fontSize:12, color:'#475569', flex:1 }}>{label}</span>
                <span style={{ fontSize:11, fontWeight:700, color: ok ? '#16a34a' : '#94a3b8' }}>{ok ? 'Connected' : '—'}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:14 }}>Daily Updates</div>
          <div style={{ background:'#fff', border:'1px solid #e8ebf0', borderRadius:14, boxShadow:'0 1px 2px rgba(16,24,40,0.04)', overflow:'hidden' }}>
            <DailySection icon="🎓" label="Intern roles" tint="#6366f1"
              count={daily?.intern?.today} recent={daily?.intern?.recent}
              onClick={() => navigate('/apply/intern-roles')} />
            <DailySection icon="💼" label="New grad roles" tint="#10b981"
              count={daily?.newGrad?.today} recent={daily?.newGrad?.recent}
              onClick={() => navigate('/apply/new-grad-roles')} />
            <div onClick={() => navigate('/discover/evaluate')} style={{ padding:'12px 16px', cursor:'pointer' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:14 }}>🎯</span>
                  <span style={{ fontSize:12, fontWeight:700, color:'#0f172a' }}>Career Ops</span>
                </div>
                <span style={{ fontSize:13, fontWeight:800, color:'#7c3aed' }}>
                  {daily?.careerOps?.evaluatedToday ?? 0}<span style={{ fontSize:10, color:'#94a3b8', fontWeight:600, marginLeft:4 }}>today</span>
                </span>
              </div>
              <div style={{ fontSize:11, color:'#94a3b8', marginTop:6, lineHeight:1.5 }}>
                {daily?.careerOps?.queued ?? 0} queued for auto-apply<br/>
                {daily?.careerOps?.totalEvaluations ?? 0} total evaluations
              </div>
            </div>
          </div>

          <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', margin:'28px 0 14px' }}>Recent Activity</div>
          <div style={{ background:'#fff', border:'1px solid #e8ebf0', borderRadius:14, boxShadow:'0 1px 2px rgba(16,24,40,0.04)', overflow:'hidden' }}>
            {activity.length === 0 ? (
              <div style={{ padding:'32px 20px', textAlign:'center', color:'#94a3b8', fontSize:13 }}>
                No activity yet. Start scraping companies!
              </div>
            ) : (
              activity.slice(0, 12).map((a, i) => (
                <div key={a.id || i} style={{ padding:'12px 16px', borderBottom: i < activity.length - 1 ? '1px solid #f1f5f9' : 'none', display:'flex', gap:10, alignItems:'flex-start' }}>
                  <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{activityIcons[a.action] || '•'}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, color:'#0f172a', lineHeight:1.4 }}>{formatActivityDetails(a)}</div>
                    {a.created_at && (
                      <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{timeAgo(a.created_at)}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

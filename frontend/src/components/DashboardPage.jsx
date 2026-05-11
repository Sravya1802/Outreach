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
// ── Automation card — surfaces the three "make it run automatically" toggles
// (auto-queue threshold, nightly pipeline, auto-apply consent) so the user
// doesn't have to dig into Auto-Apply → Setup to find them.
function AutomationCard({ navigate }) {
  const [autoQueue, setAutoQueue]   = useState(null) // { minGrade } | null while loading
  const [nightly, setNightly]       = useState(null) // full settings | null
  const [profile, setProfile]       = useState(null)
  const [savingAQ, setSavingAQ]     = useState(false)
  const [savingNightly, setSavingNightly] = useState(false)

  useEffect(() => {
    api.career.autoQueueSettings().then(setAutoQueue).catch(() => setAutoQueue({ minGrade: '' }))
    api.career.nightlySettings().then(setNightly).catch(() => setNightly({ enabled: false }))
    api.career.profile().then(setProfile).catch(() => setProfile({}))
  }, [])

  async function changeAutoQueue(minGrade) {
    setSavingAQ(true)
    try {
      const r = await api.career.saveAutoQueueSettings({ minGrade })
      setAutoQueue(r)
    } catch { /* keep prior state on failure */ }
    finally { setSavingAQ(false) }
  }

  async function toggleNightly() {
    if (!nightly) return
    setSavingNightly(true)
    try {
      const next = { ...nightly, enabled: !nightly.enabled }
      const r = await api.career.saveNightlySettings(next)
      setNightly(r || next)
    } catch { /* keep prior state on failure */ }
    finally { setSavingNightly(false) }
  }

  const consent = !!profile?.auto_apply_consent
  const aqMin   = autoQueue?.minGrade || ''
  const nightlyOn = !!nightly?.enabled

  // Tint reflects degree of automation enabled — green if all three are on.
  const fullyOn  = consent && aqMin && nightlyOn
  const partlyOn = consent || aqMin || nightlyOn
  const tint = fullyOn ? '#16a34a' : partlyOn ? '#7c3aed' : '#94a3b8'

  return (
    <div style={{ marginBottom:24, padding:'14px 18px', background:'#fff', border:`1px solid ${tint}30`, borderLeft:`3px solid ${tint}`, borderRadius:10, display:'flex', alignItems:'center', gap:18, flexWrap:'wrap' }}>
      <div style={{ minWidth:160 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:3 }}>
          Automation
        </div>
        <div style={{ fontSize:13, fontWeight:600, color:'#0f172a' }}>
          {fullyOn ? '✓ Fully automated'
            : partlyOn ? 'Partially on'
            : 'Off — fully manual'}
        </div>
      </div>

      {/* Auto-queue threshold */}
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em' }}>
          Auto-queue when grade ≥
        </label>
        <select value={aqMin} onChange={e => changeAutoQueue(e.target.value)} disabled={savingAQ || autoQueue == null}
          style={{ padding:'6px 10px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff', fontSize:12, fontWeight:600, color:'#0f172a', cursor:'pointer', minWidth:120 }}>
          <option value="">Off</option>
          <option value="A">A only</option>
          <option value="B">A or B</option>
          <option value="C">A / B / C</option>
          <option value="D">A / B / C / D</option>
          <option value="F">All grades</option>
        </select>
      </div>

      {/* Nightly pipeline toggle */}
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em' }}>
          🌙 Nightly pipeline
        </label>
        <button onClick={toggleNightly} disabled={savingNightly || nightly == null}
          style={{ padding:'6px 14px', borderRadius:8, fontSize:12, fontWeight:700, cursor: savingNightly ? 'default' : 'pointer',
            background: nightlyOn ? '#dcfce7' : '#f1f5f9',
            color:      nightlyOn ? '#15803d' : '#64748b',
            border:    `1px solid ${nightlyOn ? '#86efac' : '#e2e8f0'}` }}>
          {savingNightly ? '…' : nightlyOn ? '✓ Enabled' : 'Disabled'}
        </button>
      </div>

      {/* Consent — read-only indicator with deep-link */}
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <label style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em' }}>
          Auto-apply consent
        </label>
        <button onClick={() => navigate('/apply/auto-apply')}
          title={consent ? 'Required for auto-apply' : 'Click to give consent in Setup'}
          style={{ padding:'6px 14px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer',
            background: consent ? '#dcfce7' : '#fee2e2',
            color:      consent ? '#15803d' : '#991b1b',
            border:    `1px solid ${consent ? '#86efac' : '#fca5a5'}` }}>
          {consent ? '✓ Given' : '✗ Required → Setup'}
        </button>
      </div>

      <div style={{ flex:1, minWidth:120, fontSize:11, color:'#64748b', lineHeight:1.5 }}>
        {!consent && '⚠ Auto-apply needs explicit consent before anything queues.'}
        {consent && aqMin && nightlyOn && 'Each scraped role gets evaluated, queued if grade clears your threshold, and submitted nightly.'}
        {consent && aqMin && !nightlyOn && 'Roles you evaluate auto-queue, but the worker only runs on demand.'}
        {consent && !aqMin && nightlyOn && 'Nightly pipeline runs but evaluations are still queued by hand.'}
      </div>
    </div>
  )
}

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
    { label:'Companies',    value: stats.totalCompanies?.toLocaleString() ?? '—',  sub:'in database',       tint:'#6366f1', action: () => navigate('/companies') },
    { label:'Contacts',     value: stats.totalContacts?.toLocaleString() ?? '—',   sub: stats.contactsWithEmail != null ? `${stats.contactsWithEmail.toLocaleString()} emails found` : 'people found', tint:'#059669', action: () => navigate('/outreach') },
    { label:'Sent',         value: stats.totalSent?.toLocaleString() ?? '—',       sub:'outreach emails',   tint:'#0891b2', action: null },
    { label:'Response Rate',value: stats.responseRate != null ? `${stats.responseRate}%` : '—', sub:'reply rate', tint:'#d97706', action: null },
    { label:'Evaluated',    value: stats.totalApplications?.toLocaleString() ?? '—', sub:'applications',   tint:'#9333ea', action: () => navigate('/career-ops') },
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
                style={{ padding:'16px 18px', background:'#f8fafc', borderRadius:12, border:'1px solid #e2e8f0', cursor: s.action ? 'pointer' : 'default', transition:'all 0.15s' }}
                onMouseEnter={e => { if (s.action) { e.currentTarget.style.borderColor = s.tint; e.currentTarget.style.background = '#fff' } }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc' }}>
                <div style={{ fontSize:22, fontWeight:800, color: s.tint }}>{s.value}</div>
                <div style={{ fontSize:12, fontWeight:700, color:'#0f172a', marginTop:2 }}>{s.label}</div>
                <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop:24, display:'flex', justifyContent:'center' }}><Spin /></div>
        )}
      </div>

      <div style={{ padding: isPhone ? '20px 14px' : '28px 40px', display:'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 320px', gap: isPhone ? 18 : 28 }}>

        {/* Left column */}
        <div>

          {/* Auto-Apply Queue summary — bubbles up needs_review urgency. */}
          {queue && (queue.counts?.needs_review > 0 || queue.counts?.queued > 0 || queue.counts?.failed > 0) && (() => {
            const c = queue.counts || {}
            const urgent = (c.needs_review || 0) > 0
            const tint = urgent ? '#dc2626' : c.queued > 0 ? '#7c3aed' : '#64748b'
            return (
              <div onClick={() => navigate('/career-ops')}
                style={{ marginBottom:24, padding:'14px 18px', background:'#fff', border:`1px solid ${tint}30`, borderLeft:`3px solid ${tint}`, borderRadius:10, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
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

          {/* Automation toggles — surfaces auto-queue + nightly pipeline + consent */}
          <AutomationCard navigate={navigate} />

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
            const sourceEntries = Object.entries(ls.bySource || {})
              .filter(([, n]) => n > 0)
              .sort((a, b) => b[1] - a[1])
            const failedSources = Object.keys(ls.errors || {})
            return (
              <div style={{ marginBottom:24, padding:'14px 18px', background:'#fff', border:`1px solid ${tint}30`, borderLeft:`3px solid ${tint}`, borderRadius:10, display:'flex', flexDirection:'column', gap:10 }}>
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

                {/* Per-source breakdown — confirms which scrapers are actually working */}
                {sourceEntries.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                    {sourceEntries.map(([src, n]) => (
                      <span key={src} style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:6, background:'#f0fdf4', color:'#166534', border:'1px solid #bbf7d0' }}>
                        {src}: {n}
                      </span>
                    ))}
                    {failedSources.map(src => (
                      <span key={src} title={ls.errors[src]} style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:6, background:'#fef2f2', color:'#991b1b', border:'1px solid #fecaca' }}>
                        {src}: failed
                      </span>
                    ))}
                  </div>
                )}

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
            <div style={{ display:'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : isNarrow ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: isPhone ? 8 : 12 }}>
              {[
                { icon:'🔍', label:'Browse Companies', sub:'Search & explore by category',   action: () => navigate('/companies'),  tint:'#6366f1' },
                { icon:'🎓', label:'Intern Roles',      sub:'Daily-scraped open internships', action: () => navigate('/apply/intern-roles'),   tint:'#f59e0b' },
                { icon:'💼', label:'New Grad Roles',    sub:'Daily-scraped new grad roles',   action: () => navigate('/apply/new-grad-roles'), tint:'#10b981' },
                { icon:'📥', label:'Scrape New Roles',  sub:'Bulk scraping across sources',   action: () => navigate('/scraper'),    tint:'#059669' },
                { icon:'✉',  label:'Write Outreach',   sub:'Find contacts & draft emails',   action: () => navigate('/outreach'),   tint:'#0891b2' },
                { icon:'🎯', label:'Career Ops',        sub:'Evaluate & track applications',  action: () => navigate('/career-ops'), tint:'#7c3aed' },
              ].map(q => (
                <div key={q.label} onClick={q.action}
                  style={{ padding:'18px 20px', background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, cursor:'pointer', transition:'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = q.tint; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}>
                  <div style={{ fontSize:24, marginBottom:8 }}>{q.icon}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', marginBottom:3 }}>{q.label}</div>
                  <div style={{ fontSize:11, color:'#94a3b8', lineHeight:1.4 }}>{q.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Categories */}
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div style={{ fontSize:14, fontWeight:800, color:'#0f172a' }}>Top Categories</div>
              <button onClick={() => navigate('/companies')}
                style={{ fontSize:12, color:'#6366f1', background:'none', border:'none', cursor:'pointer', fontWeight:600 }}>
                View all →
              </button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: isPhone ? 8 : 10 }}>
              {CATEGORIES.map(cat => {
                // YC card shows actual imported YC startups in YOUR DB (not the global YC API list).
                // Return null while the relevant state is still loading so the cell renders
                // '—' instead of a flickering '0'.
                const count = cat.label === 'YC Startups'
                  ? (stats == null ? null : (stats.ycImported ?? 0))
                  : (catCounts == null ? null : (catCounts[cat.label] ?? 0))
                return (
                  <div key={cat.label}
                    onClick={() => navigate(`/category/${cat.slug}`)}
                    style={{ padding:'14px 16px', background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, cursor:'pointer', transition:'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = cat.tint; e.currentTarget.style.transform = 'translateY(-2px)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.transform = 'none' }}>
                    <div style={{ fontSize:18, fontWeight:800, color: cat.tint, marginBottom:2 }}>
                      {count != null ? count.toLocaleString() : '—'}
                    </div>
                    <div style={{ fontSize:11, fontWeight:700, color:'#0f172a', lineHeight:1.3 }}>{cat.label}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right column — Activity feed */}
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:14 }}>Recent Activity</div>
          <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, overflow:'hidden' }}>
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

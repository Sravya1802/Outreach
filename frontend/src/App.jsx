import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { api } from './api'
import { supabase } from './supabaseClient'
import Spin from './components/Spin'
import { timeAgo } from './utils/time'
// Top-level routes that are always reachable from the sidebar load eagerly.
import CompanyDashboard from './components/CompanyDashboard'
import DashboardPage    from './components/DashboardPage'
import Login            from './components/Login'
// Heavy / detail-only routes are lazy — the initial bundle was a single 728 KB
// chunk because everything was eager. Splitting the largest leaves
// (CompanyDetail, CareerOps, AutoApplyPage, etc.) brings the first paint down.
//
// `lazyWithRetry` survives the classic post-redeploy crash where the user's
// open tab still references the old hashed chunk URL but Vercel/CDN only
// serves the new one. On import failure we retry once after a short backoff;
// if that also fails we hard-reload the page so they pick up the new HTML
// + matching chunk URLs. Not catching this just dumps them into ErrorBoundary
// for what's actually a stale-cache case.
function lazyWithRetry(importFn, name = 'chunk') {
  return lazy(async () => {
    const flagKey = `chunk-reload:${name}`
    try {
      const mod = await importFn()
      sessionStorage.removeItem(flagKey)
      return mod
    } catch (err) {
      const msg = String(err?.message || '')
      const isChunkErr = /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(msg)
      if (isChunkErr && !sessionStorage.getItem(flagKey)) {
        sessionStorage.setItem(flagKey, '1')
        window.location.reload()
        // Suspense will show the loader until the page reloads.
        return new Promise(() => {})
      }
      throw err
    }
  })
}

const CategoryView        = lazyWithRetry(() => import('./components/CategoryView'),        'CategoryView')
const CompanyDetail       = lazyWithRetry(() => import('./components/CompanyDetail'),       'CompanyDetail')
const OutreachPage        = lazyWithRetry(() => import('./components/OutreachPage'),        'OutreachPage')
const ScraperPage         = lazyWithRetry(() => import('./components/ScraperPage'),         'ScraperPage')
const CareerOpsPage       = lazyWithRetry(() => import('./components/CareerOpsPage'),       'CareerOpsPage')
const CareerOps           = lazyWithRetry(() => import('./components/CareerOps'),           'CareerOps')
const ApplicationPipeline = lazyWithRetry(() => import('./components/ApplicationPipeline'), 'ApplicationPipeline')
const JobDashboard        = lazyWithRetry(() => import('./components/JobDashboard'),        'JobDashboard')
const AutoApplyPage       = lazyWithRetry(() => import('./components/AutoApplyPage'),       'AutoApplyPage')
const TemplatesPage       = lazyWithRetry(() => import('./components/TemplatesPage'),       'TemplatesPage')
const ResetPassword       = lazyWithRetry(() => import('./components/ResetPassword'),       'ResetPassword')
const RolesPage           = lazyWithRetry(() => import('./components/RolesPage'),           'RolesPage')
const JobAlerts           = lazyWithRetry(() => import('./components/JobAlerts'),           'JobAlerts')


// ── Settings page ─────────────────────────────────────────────────────────────
function Settings({ name, setName, aiProvider, setAiProvider, onSignOut, userEmail }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const [privacyStatus, setPrivacyStatus] = useState(null)
  const [privacyBusy, setPrivacyBusy] = useState(false)

  async function exportMyData() {
    setPrivacyBusy(true)
    setPrivacyStatus(null)
    try {
      const data = await api.career.exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `outreachos-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      setPrivacyStatus({ ok: true, text: 'Export downloaded' })
    } catch (err) {
      setPrivacyStatus({ ok: false, text: err.message || 'Export failed' })
    } finally {
      setPrivacyBusy(false)
    }
  }

  async function eraseSensitiveProfile() {
    setPrivacyBusy(true)
    setPrivacyStatus(null)
    try {
      const preview = await api.career.eraseSensitiveProfile(true)
      const count = (preview.profileFields?.length || 0) + (preview.metaKeys?.length || 0)
      if (count === 0) {
        setPrivacyStatus({ ok: true, text: 'No sensitive profile fields found' })
        return
      }
      const confirmed = window.confirm(`Erase ${count} sensitive profile/resume field(s)? This clears Auto Apply consent and saved resume text but does not delete job history.`)
      if (!confirmed) {
        setPrivacyStatus({ ok: true, text: 'Erase cancelled' })
        return
      }
      const result = await api.career.eraseSensitiveProfile(false)
      const erased = (result.erased?.profileFields?.length || 0) + (result.erased?.metaKeys?.length || 0)
      setPrivacyStatus({ ok: true, text: `Erased ${erased} sensitive field(s)` })
    } catch (err) {
      setPrivacyStatus({ ok: false, text: err.message || 'Erase failed' })
    } finally {
      setPrivacyBusy(false)
    }
  }

  return (
    <div style={{ flex:1, overflowY:'auto', padding:40, maxWidth:520 }}>
      <h2 style={{ fontSize:22, fontWeight:800, color:'#0f172a', marginBottom:4 }}>Settings</h2>
      <p style={{ fontSize:13, color:'#64748b', marginBottom:32 }}>Profile and API configuration</p>

      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:28, padding:18, background:'#f8fafc', borderRadius:12, border:'1px solid #e2e8f0' }}>
        <div style={{ width:52, height:52, borderRadius:'50%', background:'linear-gradient(135deg,#6366f1,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:18, fontWeight:800, flexShrink:0 }}>
          {initials}
        </div>
        <div>
          <div style={{ fontWeight:700, color:'#0f172a', fontSize:15 }}>{name}</div>
          <div style={{ fontSize:12, color:'#94a3b8', marginTop:2 }}>CS Intern Candidate · Summer 2026</div>
        </div>
      </div>

      <div style={{ marginBottom:18 }}>
        <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }}>Display Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
          style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:14, color:'#0f172a', outline:'none', boxSizing:'border-box' }} />
      </div>

      <div style={{ marginBottom:28 }}>
        <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }}>AI Provider</label>
        <select value={aiProvider} onChange={e => setAiProvider(e.target.value)}
          style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:14, color:'#0f172a', outline:'none' }}>
          <option value="gemini">Gemini 2.0 Flash (default · free tier)</option>
          <option value="anthropic">Claude Haiku 4.5 (Anthropic)</option>
          <option value="openai">GPT-4o Mini (OpenAI)</option>
        </select>
        <p style={{ fontSize:11, color:'#94a3b8', marginTop:6 }}>Set AI_PROVIDER in .env — restart backend to apply.</p>
      </div>

      <div style={{ padding:16, background:'#eff6ff', borderRadius:10, border:'1px solid #bfdbfe', marginBottom:20 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#1d4ed8', marginBottom:8 }}>API Keys (set in .env)</div>
        {[['GEMINI_API_KEY', 'Gemini AI (free tier available)'], ['APIFY_API_TOKEN', 'Apify (web scraping)'], ['APOLLO_API_KEY', 'Apollo.io (contact enrichment)'], ['LINKEDIN_SESSION_COOKIE', 'LinkedIn li_at cookie'], ['SERPER_API_KEY', 'Serper.dev (Google search)']].map(([key, label]) => (
          <div key={key} style={{ fontSize:11, color:'#3b82f6', marginBottom:3 }}>
            <code style={{ background:'#dbeafe', padding:'1px 5px', borderRadius:3 }}>{key}</code> — {label}
          </div>
        ))}
      </div>

      <div style={{ padding:16, background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0', marginBottom:20 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#0f172a', marginBottom:6 }}>Privacy controls</div>
        <p style={{ fontSize:11, color:'#64748b', margin:'0 0 12px' }}>
          Export your account data, or erase saved Auto Apply profile fields and resume text.
        </p>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={exportMyData} disabled={privacyBusy}
            style={{ padding:'7px 12px', background:'#fff', color:'#1d4ed8', border:'1px solid #bfdbfe', borderRadius:8, fontSize:12, fontWeight:700, cursor:privacyBusy ? 'default' : 'pointer' }}>
            Export data
          </button>
          <button onClick={eraseSensitiveProfile} disabled={privacyBusy}
            style={{ padding:'7px 12px', background:'#fff', color:'#b91c1c', border:'1px solid #fecaca', borderRadius:8, fontSize:12, fontWeight:700, cursor:privacyBusy ? 'default' : 'pointer' }}>
            Erase sensitive profile
          </button>
        </div>
        {privacyStatus && (
          <div style={{ marginTop:10, fontSize:11, color:privacyStatus.ok ? '#15803d' : '#b91c1c' }}>{privacyStatus.text}</div>
        )}
      </div>

      {onSignOut && (
        <div style={{ padding:16, background:'#fef2f2', borderRadius:10, border:'1px solid #fecaca' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#b91c1c', marginBottom:4 }}>Account</div>
          {userEmail && <div style={{ fontSize:11, color:'#7f1d1d', marginBottom:10 }}>{userEmail}</div>}
          <button onClick={onSignOut}
            style={{ padding:'7px 14px', background:'#fff', color:'#dc2626', border:'1px solid #fca5a5', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer' }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// ── Refresh badge ─────────────────────────────────────────────────────────────
function RefreshBadge() {
  const [lastRefresh, setLastRefresh] = useState(null)
  const [refreshing, setRefreshing]   = useState(false)
  const [progress, setProgress]       = useState('')
  // Lazy initializer is allowed for impure values (React calls it once on
  // mount, not on every render). Direct `useState(Date.now())` is flagged
  // by react-hooks/purity because it re-evaluates Date.now() every render.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])

  // Pull the true last-refresh timestamp from the backend on mount (the badge
  // previously rendered 'never' because setLastRefresh was never wired).
  useEffect(() => {
    api.jobs.lastRefresh()
      .then(d => setLastRefresh(d?.lastRefresh || d?.timestamp || null))
      .catch(() => {})
  }, [])

  // Bulk refresh isn't available on the serverless deployment; keep badge read-only.
  async function refresh() {
    setRefreshing(true); setProgress('Not available on this deployment')
    setTimeout(() => { setRefreshing(false); setProgress('') }, 1500)
  }

  const isStale = useMemo(() => lastRefresh && (now - new Date(lastRefresh)) > 48 * 3600000, [lastRefresh, now])

  return (
    <div style={{ padding:'10px 14px', borderTop:'1px solid #1e293b' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
        <span style={{ fontSize:11, color:'#475569' }}>
          Updated: <span style={{ color: isStale ? '#f59e0b' : '#64748b' }}>{timeAgo(lastRefresh, now)}</span>
        </span>
        <button onClick={refresh} disabled={refreshing}
          style={{ fontSize:11, padding:'3px 9px', borderRadius:6, background:'#1e293b', color: refreshing ? '#64748b' : '#94a3b8', border:'1px solid #334155', cursor: refreshing ? 'default' : 'pointer', fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
          {refreshing ? <Spin color="#94a3b8" size={10} /> : '↻'} {refreshing ? 'Syncing' : 'Sync'}
        </button>
      </div>
      {refreshing && progress && (
        <div style={{ fontSize:10, color:'#475569', marginTop:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{progress}</div>
      )}
    </div>
  )
}

function serviceStatus(configured, detail = null) {
  if (!configured) return { status: 'off', note: 'Not configured' }
  if (detail?.critical || detail?.error) return { status: 'down', note: detail.error || 'Quota exhausted or unavailable' }
  if (detail?.warning || detail?.rateLimited) return { status: 'warn', note: 'Low quota or rate limited' }
  return { status: 'ok', note: 'Available' }
}

function StatusDot({ status }) {
  const color = status === 'ok' ? '#22c55e' : status === 'warn' ? '#f59e0b' : status === 'down' ? '#ef4444' : '#475569'
  return <span style={{ width:7, height:7, borderRadius:'50%', background: color, display:'inline-block', flexShrink:0 }} />
}

function NavBadge({ n }) {
  if (!n || n < 1) return null
  return (
    <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:10, background:'#1e293b', color:'#64748b' }}>
      {n.toLocaleString()}
    </span>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession]         = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [health, setHealth]           = useState(null)
  const [credits, setCredits]         = useState(null)
  const [stats, setStats]             = useState(null)
  const [profileName, setProfileName] = useState('')
  const [aiProvider, setAiProvider]   = useState('gemini')
  // Mobile drawer state. CSS hides the hamburger and pins the sidebar in
  // place on screens ≥ 900px, so this only has user-visible effect on phones.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  useEffect(() => { setSidebarOpen(false) }, [location.pathname])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess))
    return () => subscription?.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    const email = session.user?.email || ''
    setProfileName(email.split('@')[0] || 'User')
  }, [session])

  useEffect(() => {
    if (!session) return
    const refreshCredits = () => {
      api.health().then(setHealth).catch(() => {})
      api.credits.status(true).then(setCredits).catch(() => {})
    }
    refreshCredits()
    window.addEventListener('credits-refresh', refreshCredits)
    return () => window.removeEventListener('credits-refresh', refreshCredits)
  }, [session])
  useEffect(() => {
    if (!session) return
    const refresh = () => api.stats().then(setStats).catch(() => {})
    refresh()
    window.addEventListener('stats-refresh', refresh)
    return () => window.removeEventListener('stats-refresh', refresh)
  }, [session])

  if (authLoading) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f172a' }}>
        <Spin size={28} color="#a5b4fc" />
      </div>
    )
  }
  // /reset-password is the redirect target for password-recovery emails. The
  // user may or may not have a session yet (Supabase recovers it from the URL
  // hash on mount), so render the page outside the session gate.
  if (typeof window !== 'undefined' && window.location.pathname === '/reset-password') {
    return (
      <Suspense fallback={<div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f172a' }}><Spin size={28} color="#a5b4fc" /></div>}>
        <ResetPassword />
      </Suspense>
    )
  }
  if (!session) return <Login />

  async function signOut() {
    await supabase.auth.signOut()
  }

  const initials = profileName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const navStyle = (isActive) => ({
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'8px 12px', borderRadius:8, marginBottom:2,
    fontSize:13, fontWeight:600, cursor:'pointer', border:'none', width:'100%', textAlign:'left',
    background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
    color: isActive ? '#a5b4fc' : '#94a3b8',
    textDecoration:'none', transition:'all 0.12s',
  })

  const sectionLabel = (text) => (
    <div style={{ fontSize:10, fontWeight:700, color:'#334155', textTransform:'uppercase', letterSpacing:'0.1em', padding:'12px 6px 6px' }}>
      {text}
    </div>
  )

  return (
    <div className="app-shell" style={{ height:'100vh', display:'flex', overflow:'hidden', fontFamily:'var(--font)', background:'var(--bg)' }}>

      {/* ── Mobile hamburger (CSS-hidden ≥900px) ── */}
      <button
        type="button"
        className="app-hamburger"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open navigation"
        style={{ display: sidebarOpen ? 'none' : undefined }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* ── Mobile backdrop — taps close the drawer ── */}
      <div
        className={`app-backdrop ${sidebarOpen ? 'is-open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* ── Sidebar ── */}
      <aside className={`app-sidebar ${sidebarOpen ? 'is-open' : ''}`} style={{ width:228, background:'#0f172a', display:'flex', flexDirection:'column', flexShrink:0, borderRight:'1px solid #1e293b', position:'relative', zIndex:60 }}>

        {/* Logo */}
        <div style={{ padding:'20px 18px 16px', borderBottom:'1px solid #1e293b' }}>
          <div style={{ fontSize:16, fontWeight:800, letterSpacing:'-0.01em', color:'#f8fafc', marginBottom:1 }}>
            <span style={{ color:'#818cf8' }}>◈</span> OutreachOS
          </div>
          <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>Internship + New Grad Pipeline</div>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:'4px 10px', overflowY:'auto' }}>

          {/* DASHBOARD (top-level, no section heading) */}
          <NavLink to="/dashboard" end style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Dashboard</span>
          </NavLink>

          <NavLink to="/job-dashboard" style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Job Dashboard</span>
          </NavLink>

          {/* DISCOVER — find roles + score them */}
          {sectionLabel('Discover')}

          <NavLink to="/discover/companies" style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Companies</span>
            <NavBadge n={stats?.totalCompanies} />
          </NavLink>

          <NavLink to="/discover/scraper" style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Job Scraper</span>
          </NavLink>

          <NavLink to="/discover/evaluate" style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Career Ops</span>
          </NavLink>

          <NavLink to="/discover/alerts" style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Job Alerts</span>
          </NavLink>

          {/* APPLY — decide, apply, track */}
          {sectionLabel('Apply')}

          <NavLink to="/apply/auto-apply" style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Auto Apply</span>
          </NavLink>

          <NavLink to="/apply/pipeline" style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Pipeline</span>
          </NavLink>

          <NavLink to="/apply/ranked" style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Ranked Roles</span>
            <NavBadge n={stats?.totalApplications} />
          </NavLink>

          {/* OUTREACH — cold reach-outs */}
          {sectionLabel('Outreach')}

          <NavLink to="/outreach/messages" style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Messages</span>
            <NavBadge n={stats?.totalContacts} />
          </NavLink>

          <NavLink to="/outreach/templates" style={({ isActive }) => navStyle(isActive)}>
            <span style={{ flex:1 }}>Templates</span>
          </NavLink>

        </nav>

        {/* Refresh */}
        <RefreshBadge />

        {/* Settings link at bottom */}
        <NavLink to="/settings"
          style={{ margin:'10px', padding:'11px 12px', borderRadius:10, border:'1px solid #1e293b', background:'#111827', cursor:'pointer', display:'flex', alignItems:'center', gap:10, textDecoration:'none', transition:'all 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.background='#1e293b'}
          onMouseLeave={e => e.currentTarget.style.background='#111827'}>
          <div style={{ width:34, height:34, borderRadius:'50%', background:'linear-gradient(135deg,#6366f1,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:13, fontWeight:800, flexShrink:0 }}>
            {initials}
          </div>
          <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{profileName}</div>
            <div style={{ fontSize:10, color:'#475569' }}>Settings & profile</div>
          </div>
          <span style={{ fontSize:14, color:'#334155' }}>⚙</span>
        </NavLink>
      </aside>

      {/* ── Main content ── */}
      <main className="app-main" style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
        {/* Mobile top bar — only visible at ≤900px (CSS-gated). Replaces
            the floating hamburger that was overlapping page titles. Sticky
            so it stays in place while content scrolls. */}
        <header className="app-mobile-topbar" aria-hidden="true">
          <button
            type="button"
            className="app-mobile-topbar__menu"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <div className="app-mobile-topbar__brand">
            <span className="app-mobile-topbar__logo">◈</span> OutreachOS
          </div>
          <div style={{ width:40, flexShrink:0 }} aria-hidden="true" />
        </header>

        <Suspense fallback={<div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}><Spin size={24} color="#6366f1" /></div>}>
        <Routes>
          {/* Top-level */}
          <Route path="/"               element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"      element={<DashboardPage onStatsChange={setStats} />} />
          <Route path="/job-dashboard"  element={<JobDashboard />} />

          {/* DISCOVER section */}
          <Route path="/discover/companies"  element={<CompanyDashboard key={session.user?.id || 'companies'} onStatsChange={setStats} statsSnapshot={stats} userId={session.user?.id} />} />
          <Route path="/discover/scraper"    element={<ScraperPage />} />
          <Route path="/discover/evaluate"   element={<CareerOps />} />
          <Route path="/discover/alerts"     element={<JobAlerts />} />

          {/* APPLY section */}
          <Route path="/apply/auto-apply"    element={<AutoApplyPage />} />
          <Route path="/apply/pipeline"      element={<ApplicationPipeline />} />
          <Route path="/apply/ranked"        element={<CareerOpsPage />} />
          <Route path="/apply/intern-roles"   element={<RolesPage defaultRoleType="intern" />} />
          <Route path="/apply/new-grad-roles" element={<RolesPage defaultRoleType="new_grad" />} />

          {/* OUTREACH section */}
          <Route path="/outreach/messages"   element={<OutreachPage />} />
          <Route path="/outreach/templates"  element={<TemplatesPage />} />

          {/* Detail/utility routes (used by deep links from cards/buttons) */}
          <Route path="/category/:name"    element={<CategoryView />} />
          <Route path="/company/:id"       element={<CompanyDetail />} />

          {/* Settings */}
          <Route path="/settings"          element={<Settings name={profileName} setName={setProfileName} aiProvider={aiProvider} setAiProvider={setAiProvider} onSignOut={signOut} userEmail={session.user?.email} />} />

          {/* Legacy redirects — keep bookmarks alive after the IA refactor */}
          <Route path="/companies"            element={<Navigate to="/discover/companies" replace />} />
          <Route path="/scraper"              element={<Navigate to="/discover/scraper" replace />} />
          <Route path="/career-ops-workflow"  element={<Navigate to="/discover/evaluate" replace />} />
          <Route path="/pipeline"             element={<Navigate to="/apply/pipeline" replace />} />
          <Route path="/career-ops"           element={<Navigate to="/apply/ranked" replace />} />
          <Route path="/outreach"             element={<Navigate to="/outreach/messages" replace />} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  )
}

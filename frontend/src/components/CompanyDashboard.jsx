import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import Dropdown from './Dropdown'
import { useMediaQuery } from '../hooks'

// Category taxonomy — labels match DB values
const CATEGORIES = [
  { id:'finance',      label:'Finance & Investing',         abbr:'FI', tint:'#059669', bg:'rgba(5,150,105,0.07)',  border:'rgba(5,150,105,0.2)',  desc:'Quant funds, investment banks, fintech, crypto' },
  { id:'tech',         label:'Tech & Software',             abbr:'TS', tint:'#2563eb', bg:'rgba(37,99,235,0.07)', border:'rgba(37,99,235,0.2)',  desc:'Big Tech, enterprise software, cloud, SaaS' },
  { id:'startups',     label:'Startups',                    abbr:'ST', tint:'#7c3aed', bg:'rgba(124,58,237,0.07)',border:'rgba(124,58,237,0.2)', desc:'YC companies, seed to series B startups' },
  { id:'ai',           label:'AI & Research',               abbr:'AI', tint:'#6d28d9', bg:'rgba(109,40,217,0.07)',border:'rgba(109,40,217,0.2)', desc:'AI labs, AI infra, applied AI, robotics AI' },
  { id:'hardware',     label:'Hardware & Semiconductors',   abbr:'HW', tint:'#6b7280', bg:'rgba(107,114,128,0.07)',border:'rgba(107,114,128,0.2)',desc:'Chip makers, consumer electronics, networking' },
  { id:'data',         label:'Data & Analytics',            abbr:'DA', tint:'#4f46e5', bg:'rgba(79,70,229,0.07)', border:'rgba(79,70,229,0.2)',  desc:'Data infra, BI platforms, market data' },
  { id:'auto',         label:'Automotive & Mobility',       abbr:'AM', tint:'#0f172a', bg:'rgba(15,23,42,0.07)',  border:'rgba(15,23,42,0.2)',   desc:'EV, autonomous vehicles, aerospace' },
  { id:'health',       label:'Healthcare & Life Sciences',  abbr:'HL', tint:'#dc2626', bg:'rgba(220,38,38,0.07)', border:'rgba(220,38,38,0.2)',  desc:'Pharma, biotech, health tech, medical devices' },
  { id:'energy',       label:'Energy & Climate',            abbr:'EC', tint:'#15803d', bg:'rgba(21,128,61,0.07)', border:'rgba(21,128,61,0.2)',  desc:'Renewables, energy storage, climate tech' },
  { id:'consumer',     label:'Consumer & Retail',           abbr:'CR', tint:'#ea580c', bg:'rgba(234,88,12,0.07)', border:'rgba(234,88,12,0.2)',  desc:'E-commerce, CPG, retail, food delivery' },
  { id:'food',         label:'Food & Beverage',             abbr:'FB', tint:'#d97706', bg:'rgba(217,119,6,0.07)', border:'rgba(217,119,6,0.2)',  desc:'Food tech, restaurant chains, alt protein' },
  { id:'fashion',      label:'Fashion & Apparel',           abbr:'FA', tint:'#db2777', bg:'rgba(219,39,119,0.07)',border:'rgba(219,39,119,0.2)', desc:'Fast fashion, sportswear, fashion tech' },
  { id:'media',        label:'Media & Entertainment',       abbr:'ME', tint:'#9333ea', bg:'rgba(147,51,234,0.07)',border:'rgba(147,51,234,0.2)', desc:'Gaming, streaming, social media, ad tech' },
  { id:'sports',       label:'Sports & Fitness',            abbr:'SF', tint:'#16a34a', bg:'rgba(22,163,74,0.07)', border:'rgba(22,163,74,0.2)',  desc:'Sports tech, fitness wearables, esports' },
  { id:'travel',       label:'Travel & Hospitality',        abbr:'TH', tint:'#0891b2', bg:'rgba(8,145,178,0.07)', border:'rgba(8,145,178,0.2)',  desc:'Airlines, hotels, travel agencies' },
  { id:'logistics',    label:'Logistics & Supply Chain',    abbr:'LS', tint:'#92400e', bg:'rgba(146,64,14,0.07)', border:'rgba(146,64,14,0.2)',  desc:'Shipping, delivery, supply chain tech' },
  { id:'manufacturing',label:'Manufacturing & Industrials', abbr:'MI', tint:'#475569', bg:'rgba(71,85,105,0.07)', border:'rgba(71,85,105,0.2)',  desc:'Heavy manufacturing, industrial automation' },
  { id:'defense',      label:'Defense & Government',        abbr:'DG', tint:'#1e3a8a', bg:'rgba(30,58,138,0.07)', border:'rgba(30,58,138,0.2)',  desc:'Defense contractors, GovTech' },
  { id:'hr',           label:'HR & Workforce',              abbr:'HR', tint:'#7c3aed', bg:'rgba(124,58,237,0.05)',border:'rgba(124,58,237,0.15)',desc:'HR tech, staffing, payroll platforms' },
  { id:'marketing',    label:'Marketing & Creative',        abbr:'MC', tint:'#be185d', bg:'rgba(190,24,93,0.07)', border:'rgba(190,24,93,0.2)',  desc:'Agencies, PR, market research, creator platforms' },
  { id:'legal',        label:'Legal & Compliance',          abbr:'LC', tint:'#1e40af', bg:'rgba(30,64,175,0.07)', border:'rgba(30,64,175,0.2)',  desc:'Law firms, compliance tech, LegalTech' },
  { id:'education',    label:'Education',                   abbr:'ED', tint:'#7c3aed', bg:'rgba(124,58,237,0.05)',border:'rgba(124,58,237,0.15)',desc:'EdTech, academic research institutions' },
  { id:'emerging',     label:'Emerging & Niche',            abbr:'EN', tint:'#ea580c', bg:'rgba(234,88,12,0.07)', border:'rgba(234,88,12,0.2)',  desc:'SpaceTech, AgriTech, BioInformatics, PropTech' },
]

const DASH_CSS = `
  .dash-cat-card { transition: all 0.18s; cursor: pointer; }
  .dash-cat-card:hover { transform: translateY(-3px) !important; box-shadow: 0 16px 40px rgba(0,0,0,0.1) !important; }
  .dash-search-result { transition: background 0.1s; cursor: pointer; }
  .dash-search-result:hover { background: #f1f5f9 !important; }
  .dash-stat-card { transition: all 0.15s; }
`

function Spin({ color = '#6366f1', size = 14 }) {
  return <span style={{ display:'inline-block', width:size, height:size, border:`2px solid ${color}30`, borderTopColor:color, borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />
}

const CACHE_TTL_MS = 10 * 60 * 1000
const cacheKey = (userId) => `outreachos:companies-dashboard:${userId || 'anonymous'}`

function readCache(userId) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey(userId)) || 'null')
    if (!cached?.savedAt || Date.now() - cached.savedAt > CACHE_TTL_MS) return null
    return cached
  } catch {
    return null
  }
}

function writeCache(userId, next) {
  try {
    sessionStorage.setItem(cacheKey(userId), JSON.stringify({ ...next, savedAt: Date.now() }))
  } catch {}
}

function countsToMap(data) {
  const map = {}
  for (const row of (data?.counts || [])) map[row.category] = row.count
  return map
}

export default function CompanyDashboard({ onStatsChange, statsSnapshot = null, userId = '' }) {
  const navigate = useNavigate()
  const cached = readCache(userId)
  const [stats, setStats]         = useState(statsSnapshot || cached?.stats || null)
  const [catCounts, setCatCounts] = useState(cached?.catCounts || null)
  const [statsLoaded, setStatsLoaded] = useState(Boolean(statsSnapshot || cached?.stats))
  const [catCountsLoaded, setCatCountsLoaded] = useState(Boolean(cached?.catCounts))
  const [ycCount, setYcCount]     = useState(null)
  const [search, setSearch]       = useState('')
  const [results, setResults]     = useState([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [hideEmpty, setHideEmpty] = useState(false)
  const [sortBy, setSortBy]       = useState('count') // count | az | za
  const [scrapeCat, setScrapeCat] = useState('')      // category to scrape into
  const [scraping, setScraping]   = useState(null)    // source key currently scraping
  const [scrapeMsg, setScrapeMsg] = useState(null)    // { ok, text }
  const [catalog, setCatalog]     = useState(null)    // { intern, newgrad } daily-scraped catalog summary
  const isPhone = useMediaQuery('(max-width: 480px)')
  const searchRef  = useRef(null)
  const debounce   = useRef(null)

  async function refreshCounts() {
    const [statsResult, countsResult] = await Promise.allSettled([
      api.stats(),
      api.unified.categoryCounts(),
    ])

    const nextStats = statsResult.status === 'fulfilled' ? statsResult.value : stats
    const nextCounts = countsResult.status === 'fulfilled' ? countsToMap(countsResult.value) : catCounts

    if (statsResult.status === 'fulfilled') {
      setStats(nextStats)
      onStatsChange?.(nextStats)
      setStatsLoaded(true)
    } else if (!statsLoaded) {
      setStatsLoaded(true)
    }

    if (countsResult.status === 'fulfilled') {
      setCatCounts(nextCounts)
      setCatCountsLoaded(true)
    } else if (!catCountsLoaded) {
      setCatCountsLoaded(true)
    }

    if (nextStats || nextCounts) {
      writeCache(userId, { stats: nextStats, catCounts: nextCounts })
    }
  }

  // Scrape companies straight from the dashboard into the chosen category.
  // Reuses the same endpoints CategoryView uses; result is surfaced inline and
  // the category grid counts refresh so "what got scraped" is visible at once.
  async function scrapeInto(srcKey) {
    if (!scrapeCat) { setScrapeMsg({ ok:false, text:'Pick a category first' }); return }
    setScraping(srcKey)
    setScrapeMsg(null)
    const subcategory = `${scrapeCat.toLowerCase()} intern 2026`
    try {
      const r = srcKey === 'all_sources'
        ? await api.companies.scrape({ category: scrapeCat, subcategory })
        : await api.companies.scrapeSource(srcKey, { category: scrapeCat, subcategory })
      const added = r.added || 0
      const total = r.deduped || r.total || 0
      const skipped = Math.max(0, total - added)
      const parts = [`${total} found`, `+${added} new`]
      if (skipped > 0) parts.push(`${skipped} already saved`)
      setScrapeMsg({ ok:true, text:parts.join(' · '), cat:scrapeCat })
      refreshCounts()
    } catch (err) { setScrapeMsg({ ok:false, text: err.message }) }
    setScraping(null)
    setTimeout(() => setScrapeMsg(null), 9000)
  }

  // Inject CSS
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = DASH_CSS
    document.head.appendChild(el)
    return () => el.remove()
  }, [])

  // Load stats + category counts (re-runs on `stats-refresh` events)
  useEffect(() => {
    refreshCounts()
    fetch('https://yc-oss.github.io/api/companies/hiring.json')
      .then(r => r.json()).then(d => setYcCount(Array.isArray(d) ? d.length : null))
      .catch(() => setYcCount(null))
    api.scrapedRoles.sources()
      .then(d => {
        const rows = d.sources || []
        const intern  = rows.filter(r => r.role_type === 'intern').reduce((a, r) => a + (r.n || 0), 0)
        const newgrad = rows.filter(r => r.role_type !== 'intern').reduce((a, r) => a + (r.n || 0), 0)
        setCatalog({ intern, newgrad })
      })
      .catch(() => {})
    window.addEventListener('stats-refresh', refreshCounts)
    return () => window.removeEventListener('stats-refresh', refreshCounts)
  // refreshCounts intentionally reads the current cached state; userId is the
  // only key that should reset the dashboard cache subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    if (!statsSnapshot) return
    setStats(statsSnapshot)
    setStatsLoaded(true)
    writeCache(userId, { stats: statsSnapshot, catCounts: catCounts || readCache(userId)?.catCounts || null })
  // Existing catCounts are only used as a cache fallback here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsSnapshot, userId])

  // Debounced search
  const doSearch = useCallback((q) => {
    clearTimeout(debounce.current)
    if (!q.trim()) { setResults([]); setShowDropdown(false); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const rows = await api.jobs.search(q)
        setResults(rows)
        setShowDropdown(true)
      } catch (e) { console.warn('Search error:', e) }
      setSearching(false)
    }, 280)
  }, [])

  function onSearchChange(e) {
    const v = e.target.value
    setSearch(v)
    doSearch(v)
  }

  function goToCompany(id) {
    setShowDropdown(false)
    setSearch('')
    navigate(`/company/${id}`)
  }

  function goToCategory(label) {
    const slug = label === 'YC Startups' ? 'yc-startups' : encodeURIComponent(label)
    navigate(`/category/${slug}`)
  }

  // Build sorted category list with counts.
  // Use stats.totalCompanies (authoritative COUNT(*) from jobs table) as the
  // single source of truth so the header count matches the stats card below.
  const countsLoading = !statsLoaded || !catCountsLoaded
  const cc = catCounts || {}
  const totalInDb = stats?.totalCompanies ?? (statsLoaded ? Object.values(cc).reduce((a, b) => a + b, 0) : 0)
  const maxCount  = Math.max(...CATEGORIES.map(c => cc[c.label] || 0), 1)

  const sortedCats = [...CATEGORIES]
    .map(c => ({ ...c, count: cc[c.label] || 0 }))
    .sort((a, b) => {
      if (sortBy === 'az') return a.label.localeCompare(b.label)
      if (sortBy === 'za') return b.label.localeCompare(a.label)
      return b.count - a.count // 'count' default
    })
    .filter(c => !hideEmpty || c.count > 0)

  return (
    <div style={{ flex:1, overflowY:'auto', background:'#f8fafc' }}>
      {/* Header — tighter padding + smaller H1 on phone for vertical breathing room. */}
      <div style={{ padding: isPhone ? '14px 14px 12px' : '32px 40px 20px', background:'#fff', borderBottom:'1px solid #e2e8f0' }}>
        <div style={{ marginBottom:4 }}>
          <h1 style={{ fontSize: isPhone ? 18 : 24, fontWeight:800, color:'#0f172a', margin:0 }}>Companies</h1>
          {!isPhone && (
            <p style={{ fontSize:13, color:'#64748b', margin:'4px 0 0' }}>
              {countsLoading
                ? ' '
                : `${totalInDb.toLocaleString()} companies · ${sortedCats.filter(c => c.count > 0).length} industries`}
            </p>
          )}
        </div>

        {/* KPI row — each metric gets a tinted icon chip + accent so the
            numbers read as a scannable dashboard, not a flat strip. Phone:
            horizontal scroll-snap row. Desktop: auto-fit grid (wraps if narrow). */}
        {stats && (
          <div style={{
            display: isPhone ? 'flex' : 'grid',
            gridTemplateColumns: isPhone ? undefined : 'repeat(auto-fit, minmax(132px, 1fr))',
            gap: isPhone ? 8 : 12,
            marginTop: isPhone ? 10 : 20,
            overflowX: isPhone ? 'auto' : 'visible',
            scrollSnapType: isPhone ? 'x mandatory' : undefined,
            paddingBottom: isPhone ? 4 : 0,
          }}>
            {[
              { icon:'🏢', label:'Companies',  value: stats.totalCompanies?.toLocaleString() ?? '—', tint:'#6366f1', bg:'#eef2ff' },
              { icon:'🗂️', label:'Industries',  value: catCountsLoaded ? sortedCats.filter(c => c.count > 0).length : '—', tint:'#0891b2', bg:'#ecfeff' },
              { icon:'👥', label:'Contacts',   value: stats.totalContacts?.toLocaleString() ?? '—', tint:'#7c3aed', bg:'#f5f3ff' },
              { icon:'✉️', label:'Sent',        value: stats.totalSent?.toLocaleString() ?? '—', tint:'#0d9488', bg:'#f0fdfa' },
              { icon:'↩️', label:'Reply Rate',  value: stats.responseRate != null ? `${stats.responseRate}%` : '—', tint:'#16a34a', bg:'#f0fdf4' },
              { icon:'🔌', label:'Sources',    value: stats.activeSources?.toLocaleString() ?? '—', tint:'#ea580c', bg:'#fff7ed' },
            ].map(s => (
              <div key={s.label} className="dash-stat-card"
                style={{
                  padding: isPhone ? '8px 10px' : '12px 14px',
                  background:'#fff', borderRadius:12, border:'1px solid #e2e8f0',
                  display:'flex', alignItems:'center', gap: isPhone ? 8 : 10,
                  flex: isPhone ? '0 0 auto' : undefined,
                  minWidth: isPhone ? 124 : undefined,
                  scrollSnapAlign: isPhone ? 'start' : undefined,
                }}>
                <div style={{ width: isPhone ? 28 : 34, height: isPhone ? 28 : 34, borderRadius:9, background:s.bg, color:s.tint, display:'flex', alignItems:'center', justifyContent:'center', fontSize: isPhone ? 14 : 16, flexShrink:0 }}>{s.icon}</div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize: isPhone ? 16 : 19, fontWeight:800, color:'#0f172a', lineHeight:1.1 }}>{s.value}</div>
                  <div style={{ fontSize: isPhone ? 10 : 11, color:'#94a3b8', marginTop:1, fontWeight:600, whiteSpace:'nowrap' }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Search bar */}
        <div style={{ position:'relative', marginTop:20 }} ref={searchRef}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 16px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, transition:'border-color 0.15s' }}
            onFocus={() => search && setShowDropdown(true)}>
            {searching ? <Spin color="#64748b" size={15} /> : <span style={{ fontSize:15, color:'#94a3b8' }}>⌕</span>}
            <input value={search} onChange={onSearchChange}
              onFocus={() => search && results.length > 0 && setShowDropdown(true)}
              placeholder="Search companies by name…"
              style={{ flex:1, border:'none', background:'transparent', outline:'none', fontSize:14, color:'#0f172a' }} />
            {search && <button onClick={() => { setSearch(''); setResults([]); setShowDropdown(false) }}
              style={{ border:'none', background:'none', color:'#94a3b8', cursor:'pointer', fontSize:16, padding:0 }}>×</button>}
          </div>

          {showDropdown && (
            <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, right:0, background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.08)', zIndex:50, overflow:'hidden' }}>
              {results.length === 0 ? (
                <div style={{ padding:'14px 18px' }}>
                  <div style={{ fontSize:13, color:'#64748b', marginBottom:10 }}>No companies found for "{search}"</div>
                  <button
                    onClick={async () => {
                      setShowDropdown(false)
                      setSearching(true)
                      try {
                        const r = await api.companies.searchByName(search)
                        if (r.company) {
                          // find in DB now and navigate
                          const rows2 = await api.jobs.search(r.company.name)
                          if (rows2?.[0]) navigate(`/company/${rows2[0].id}`)
                        }
                      } catch (_) {}
                      setSearching(false)
                      setSearch('')
                    }}
                    style={{ padding:'7px 14px', background:'#6366f1', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                    Search & scrape "{search}" →
                  </button>
                </div>
              ) : (
                results.map(r => {
                  const label = r.name || r.company_name || r.title || '?'
                  return (
                    <div key={r.id} className="dash-search-result"
                      onClick={() => goToCompany(r.id)}
                      style={{ padding:'11px 18px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{ width:32, height:32, borderRadius:7, background:'#e0e7ff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color:'#4f46e5', flexShrink:0 }}>
                        {label.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>{label}</div>
                        <div style={{ fontSize:11, color:'#94a3b8' }}>{r.category} {r.location ? `· ${r.location}` : ''}</div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Category grid */}
      <div style={{ padding: isPhone ? '14px 12px 24px' : '24px 40px 40px' }}>
        {/* Scrape panel — scrape fresh companies into a category straight from
            the dashboard, plus a live read on what's already been auto-scraped. */}
        <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, padding: isPhone ? 16 : 20, marginBottom: isPhone ? 16 : 24, boxShadow:'0 1px 3px rgba(16,24,40,0.04)' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <div>
              <h2 style={{ fontSize:15, fontWeight:800, color:'#0f172a', margin:0 }}>⚡ Scrape new companies</h2>
              <p style={{ fontSize:12, color:'#64748b', margin:'3px 0 0' }}>Pick a category, then pull fresh companies from any source.</p>
            </div>
            {catalog && (
              <button onClick={() => navigate('/apply/intern-roles')}
                title="Roles auto-scraped daily from GitHub job boards — view the catalog"
                style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, fontSize:11, fontWeight:700, color:'#475569', cursor:'pointer' }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:'#16a34a', flexShrink:0 }} />
                Auto-scraped daily · {catalog.intern.toLocaleString()} intern · {catalog.newgrad.toLocaleString()} new-grad →
              </button>
            )}
          </div>
          <div style={{ display:'flex', gap:8, marginTop:14, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ minWidth: isPhone ? '100%' : 210 }}>
              <Dropdown
                ariaLabel="Category to scrape into"
                value={scrapeCat}
                onChange={setScrapeCat}
                options={[{ value:'', label:'Choose a category…' }, ...CATEGORIES.map(c => ({ value:c.label, label:c.label }))]}
              />
            </div>
            {[['all_sources','All Sources'],['linkedin','LinkedIn'],['wellfound','Wellfound'],['google_jobs','Google Jobs'],['github','GitHub']].map(([key, label]) => {
              const isLoading = scraping === key
              const disabled = !!scraping || !scrapeCat
              return (
                <button key={key} disabled={disabled} onClick={() => scrapeInto(key)}
                  style={{ padding:'8px 14px', borderRadius:9, border:`1px solid ${key === 'all_sources' ? '#c7d2fe' : '#e2e8f0'}`, background: isLoading ? '#eef2ff' : (key === 'all_sources' ? '#eef2ff' : '#f8fafc'), color: disabled && !isLoading ? '#cbd5e1' : (key === 'all_sources' ? '#4f46e5' : '#475569'), fontSize:12, fontWeight:700, cursor: disabled ? 'default' : 'pointer', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}>
                  {isLoading && <Spin color="#4f46e5" size={11} />}
                  {label}
                </button>
              )
            })}
          </div>
          {scrapeMsg && (
            <div style={{ marginTop:12, fontSize:12, fontWeight:600, color: scrapeMsg.ok ? '#16a34a' : '#dc2626', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <span>{scrapeMsg.ok ? '✓ ' : '✗ '}{scrapeMsg.text}</span>
              {scrapeMsg.ok && scrapeMsg.cat && (
                <button onClick={() => goToCategory(scrapeMsg.cat)}
                  style={{ background:'none', border:'none', color:'#6366f1', fontWeight:700, cursor:'pointer', fontSize:12, padding:0 }}>
                  View {scrapeMsg.cat} →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Controls — single row that wraps on phone so the count label,
            sort dropdown, and Hide-empty toggle each get full-width when
            stacked. Themed Dropdown matches the indigo aesthetic instead
            of falling back to the OS picker. */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, gap:10, flexWrap:'wrap' }}>
          <span style={{ fontSize:13, color:'#64748b', fontWeight:600, flex:'1 1 auto' }}>
            {!catCountsLoaded
              ? ' '
              : `${sortedCats.filter(c => c.count > 0).length} active${!hideEmpty ? ` · ${sortedCats.filter(c => c.count === 0).length} empty` : ''}`}
          </span>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <div style={{ minWidth:170 }}>
              <Dropdown
                ariaLabel="Sort categories"
                value={sortBy}
                onChange={setSortBy}
                options={[
                  { value:'count', label:'↓ Most companies' },
                  { value:'az',    label:'A → Z' },
                  { value:'za',    label:'Z → A' },
                ]}
              />
            </div>
            <button onClick={() => setHideEmpty(v => !v)}
              style={{ padding:'9px 14px', borderRadius:9, border:`1px solid ${hideEmpty ? '#c7d2fe' : '#e2e8f0'}`, background: hideEmpty ? '#eef2ff' : '#fff', color: hideEmpty ? '#4f46e5' : '#64748b', fontSize:13, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
              {hideEmpty ? '✓ Hide empty' : 'Hide empty'}
            </button>
          </div>
        </div>

        <div style={{
          display:'grid',
          gridTemplateColumns: isPhone ? 'repeat(3, 1fr)' : 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: isPhone ? 8 : 16,
        }}>
          {/* YC Startups — phone: minimal Option-B tile. Desktop keeps the
              original 'featured' card with full description + progress. */}
          {isPhone ? (
            <div className="dash-cat-row" onClick={() => goToCategory('YC Startups')}
              style={{ display:'flex', flexDirection:'column', gap:4, padding:'14px 10px', cursor:'pointer', background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, textAlign:'center' }}>
              <div style={{ fontSize:20, fontWeight:800, color:'#F26625', lineHeight:1.1 }}>
                {statsLoaded ? (stats?.ycImported ?? 0).toLocaleString() : '·'}
              </div>
              <div style={{ fontSize:11, fontWeight:700, color:'#0f172a', lineHeight:1.25, overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                YC Startups
              </div>
            </div>
          ) : (
            <div className="dash-cat-card" onClick={() => goToCategory('YC Startups')}
              style={{ background:'#fff', border:'1px solid rgba(242,102,37,0.3)', borderLeft:'4px solid #F26625', borderRadius:12, padding:'18px 20px', boxShadow:'0 1px 4px rgba(0,0,0,0.05)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                <div style={{ width:38, height:38, borderRadius:8, background:'rgba(242,102,37,0.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800, color:'#F26625', flexShrink:0 }}>
                  YC
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight:800, color:'#0f172a' }}>YC Startups</div>
                  <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, background:'rgba(242,102,37,0.1)', color:'#F26625', border:'1px solid rgba(242,102,37,0.25)' }}>
                    In your DB
                  </span>
                </div>
              </div>
              <div style={{ fontSize:24, fontWeight:800, color:'#F26625', marginBottom:4 }}>
                {statsLoaded ? (stats?.ycImported ?? 0).toLocaleString() : ' '}
              </div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:12, lineHeight:1.4 }}>
                YC-backed companies you've imported
                {ycCount != null && <> · <span style={{ color:'#94a3b8' }}>{ycCount.toLocaleString()} available on YC</span></>}
              </div>
              <div style={{ height:4, background:'#f1f5f9', borderRadius:2 }}>
                <div style={{ height:'100%', background:'#F26625', borderRadius:2, width:'100%' }} />
              </div>
            </div>
          )}

          {/* Regular categories */}
          {sortedCats.map((cat) => {
            const barW = Math.max(cat.count > 0 ? 3 : 0, Math.round((cat.count / maxCount) * 100))
            // Phone (Option B): minimal tile — big tinted count, then a
            // 2-line truncated label below. No badge, no progress bar,
            // no description. 3 per row.
            if (isPhone) {
              return (
                <div key={cat.id} className="dash-cat-row"
                  onClick={() => cat.count > 0 && goToCategory(cat.label)}
                  style={{
                    display:'flex', flexDirection:'column', gap:4,
                    padding:'14px 10px',
                    cursor: cat.count > 0 ? 'pointer' : 'default',
                    background:'#fff', border:'1px solid #e2e8f0', borderRadius:10,
                    textAlign:'center',
                    opacity: cat.count === 0 ? 0.5 : 1,
                  }}>
                  <div style={{ fontSize:20, fontWeight:800, color: cat.count === 0 ? '#94a3b8' : cat.tint, lineHeight:1.1 }}>
                    {!catCountsLoaded ? '·' : cat.count.toLocaleString()}
                  </div>
                  <div style={{ fontSize:11, fontWeight:700, color:'#0f172a', lineHeight:1.25, overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                    {cat.label}
                  </div>
                </div>
              )
            }
            const sharePct = totalInDb > 0 ? Math.round((cat.count / totalInDb) * 100) : 0
            return (
              <div key={cat.id} className="dash-cat-card"
                onClick={() => goToCategory(cat.label)}
                style={{ background:'#fff', border:`1px solid ${cat.count === 0 ? '#f1f5f9' : cat.border}`, borderLeft:`3px solid ${cat.count === 0 ? '#e2e8f0' : cat.tint}`, borderRadius:12, padding:'16px 18px', boxShadow:'0 1px 4px rgba(0,0,0,0.04)', opacity: cat.count === 0 ? 0.55 : 1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:36, height:36, borderRadius:9, background:cat.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:cat.tint, flexShrink:0 }}>
                    {cat.abbr}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', lineHeight:1.25, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cat.label}</div>
                    <div style={{ fontSize:10.5, color:'#94a3b8', marginTop:1 }}>
                      {!catCountsLoaded ? ' ' : (cat.count > 0 ? `${sharePct}% of all companies` : 'none yet')}
                    </div>
                  </div>
                  <div style={{ fontSize:22, fontWeight:800, color: cat.count === 0 ? '#cbd5e1' : cat.tint, lineHeight:1, flexShrink:0 }}>
                    {!catCountsLoaded ? ' ' : cat.count.toLocaleString()}
                  </div>
                </div>
                <div style={{ fontSize:11, color:'#64748b', margin:'10px 0', lineHeight:1.4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden', minHeight:31 }}>
                  {cat.desc}
                </div>
                <div style={{ height:4, background:'#f1f5f9', borderRadius:2 }}>
                  <div style={{ height:'100%', background: cat.count === 0 ? '#e2e8f0' : cat.tint, borderRadius:2, width:`${barW}%`, transition:'width 0.5s' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Close dropdown on outside click */}
      {showDropdown && <div onClick={() => setShowDropdown(false)} style={{ position:'fixed', inset:0, zIndex:40 }} />}
    </div>
  )
}

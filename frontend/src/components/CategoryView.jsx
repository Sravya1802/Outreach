import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api'
import Dropdown from './Dropdown'

const CAT_CSS = `
  .cv-company-row { transition: all 0.12s; cursor: pointer; }
  .cv-company-row:hover { border-color: #a5b4fc !important; box-shadow: 0 2px 12px rgba(99,102,241,0.08) !important; background: #fafafe !important; }
  .cv-source-pill { display:inline-flex; align-items:center; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; }
  .cv-status-pill { display:inline-flex; align-items:center; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; cursor:pointer; }
`

const SOURCE_COLORS = {
  linkedin: { bg:'#eff6ff', color:'#2563eb', border:'#bfdbfe' },
  wellfound: { bg:'#fdf4ff', color:'#9333ea', border:'#f0abfc' },
  yc:        { bg:'#fff7ed', color:'#c2410c', border:'#fed7aa' },
  github:    { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0' },
  google_jobs:{ bg:'#eff6ff', color:'#1d4ed8', border:'#bfdbfe' },
  manual_search:{ bg:'#f8fafc', color:'#475569', border:'#e2e8f0' },
  startup_sheet:{ bg:'#fefce8', color:'#ca8a04', border:'#fde68a' },
}

const STATUS_COLORS = {
  new:         { bg:'#eff6ff', color:'#2563eb', border:'#bfdbfe' },
  researching: { bg:'#fdf4ff', color:'#9333ea', border:'#f0abfc' },
  contacted:   { bg:'#fefce8', color:'#ca8a04', border:'#fde68a' },
  responded:   { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0' },
  skip:        { bg:'#f8fafc', color:'#64748b', border:'#e2e8f0' },
}

const CATEGORY_QUERIES = {
  'Finance & Investing': 'fintech quant trading intern 2026',
  'Tech & Software': 'software engineer intern 2026',
  'AI & Research': 'AI machine learning intern 2026',
  'Healthcare & Life Sciences': 'health tech biotech intern 2026',
  'Data & Analytics': 'data engineering analytics intern 2026',
  'Automotive & Mobility': 'automotive EV software intern 2026',
  'Energy & Climate': 'clean energy climate tech intern 2026',
  'Defense & Government': 'defense tech software intern 2026',
  'Hardware & Semiconductors': 'hardware semiconductor intern 2026',
}

function Spin({ color = '#6366f1', size = 14 }) {
  return <span style={{ display:'inline-block', width:size, height:size, border:`2px solid ${color}30`, borderTopColor:color, borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />
}

function timeAgo(iso) {
  if (!iso) return ''
  const h = Math.floor((Date.now() - new Date(iso)) / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  if (h < 24 * 7) return `${Math.floor(h / 24)}d ago`
  return `${Math.floor(h / 168)}w ago`
}

// ── YC Category View ──────────────────────────────────────────────────────────
function YCCategoryView() {
  const navigate = useNavigate()
  const [companies, setCompanies]   = useState([])
  const [total, setTotal]           = useState(0)
  const [loading, setLoading]       = useState(true)
  const [page, setPage]             = useState(0)
  const [filters, setFilters]       = useState({ location:'US', industry:'', maxTeamSize:'', q:'' })
  const [industries, setIndustries] = useState([])
  const [scraping, setScraping]     = useState(false)
  const [scrapeMsg, setScrapeMsg]   = useState(null)
  const [navigating, setNavigating] = useState(null)

  const load = useCallback(async (pg = 0, flt = filters) => {
    setLoading(true)
    try {
      const params = { page: pg, pageSize: 50, ...Object.fromEntries(Object.entries(flt).filter(([, v]) => v)) }
      const d = await api.yc.companies(params)
      if (pg === 0) setCompanies(d.companies || [])
      else setCompanies(prev => [...prev, ...(d.companies || [])])
      setTotal(d.total || 0)
      if (d.industries?.length) setIndustries(d.industries)
    } catch (_) {}
    setLoading(false)
  }, [filters])

  // Initial YC load only; filter changes call load() through applyFilter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(0, filters) }, [])

  function applyFilter(key, val) {
    const next = { ...filters, [key]: val }
    setFilters(next)
    setPage(0)
    load(0, next)
  }

  async function openCompany(c) {
    if (navigating) return
    setNavigating(c.slug)
    try {
      // Import (or find existing) — upsert returns the id either way
      const imported = await api.yc.import([c.slug])
      const row = imported?.companies?.find(r => r.name === c.name) || imported?.companies?.[0]
      if (row?.id) {
        navigate(`/company/${row.id}`)
        return
      }
      console.warn('[YC navigate] no id returned from import:', imported)
    } catch (err) {
      console.error('[YC navigate] ERROR:', err)
    } finally {
      setNavigating(null)
    }
  }

  async function importAll() {
    setScraping(true)
    try {
      const r = await api.yc.importAll({ filters })
      setScrapeMsg(`✓ Imported ${r.imported} companies`)
    } catch (e) { setScrapeMsg('Import failed'); console.warn('Import error:', e) }
    setScraping(false)
    setTimeout(() => setScrapeMsg(null), 5000)
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Breadcrumb + header */}
      <div style={{ padding:'18px 32px', background:'#fff', borderBottom:'1px solid #e2e8f0' }}>
        <div style={{ fontSize:12, color:'#94a3b8', marginBottom:6 }}>
          <Link to="/companies" style={{ color:'#6366f1', textDecoration:'none', fontWeight:600 }}>← Companies</Link>
          {' / '}
          <span style={{ color:'#F26625', fontWeight:700 }}>YC Startups</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <h2 style={{ fontSize:20, fontWeight:800, color:'#0f172a', margin:0 }}>YC Startups</h2>
            <p style={{ fontSize:12, color:'#64748b', margin:'3px 0 0' }}>
              {total.toLocaleString()} companies currently hiring · live from YC API
              <span style={{ marginLeft:8, fontSize:10, padding:'2px 7px', borderRadius:10, background:'rgba(21,128,61,0.1)', color:'#15803d', fontWeight:700 }}>Live</span>
            </p>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {scrapeMsg && <span style={{ fontSize:12, color:'#22c55e', fontWeight:600 }}>{scrapeMsg}</span>}
            <button onClick={importAll} disabled={scraping}
              style={{ padding:'8px 16px', background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor: scraping ? 'default' : 'pointer', display:'flex', alignItems:'center', gap:6 }}>
              {scraping ? <><Spin color="#fff" size={11} /> Importing…</> : 'Import All Filtered'}
            </button>
          </div>
        </div>

        {/* Filters — themed Dropdowns so mobile doesn't fire the iOS picker. */}
        <div style={{ display:'flex', gap:10, marginTop:16, flexWrap:'wrap' }}>
          {[
            { key:'location',    ariaLabel:'Filter by location',  opts2:[['US','US Only'],['','All']] },
            { key:'industry',    ariaLabel:'Filter by industry',  opts2:[['','All Industries'], ...industries.slice(0,20).map(i => [i,i])] },
            { key:'maxTeamSize', ariaLabel:'Filter by team size', opts2:[['','Any Size'],['10','≤10'],['50','≤50'],['200','≤200']] },
          ].map(f => (
            <div key={f.key} style={{ minWidth: 140 }}>
              <Dropdown
                ariaLabel={f.ariaLabel}
                value={filters[f.key]}
                onChange={(v) => applyFilter(f.key, v)}
                options={f.opts2.map(([v, l]) => ({ value: v, label: l }))}
              />
            </div>
          ))}
          <input value={filters.q} onChange={e => applyFilter('q', e.target.value)}
            placeholder="Search by name…"
            style={{ padding:'7px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, color:'#0f172a', background:'#f8fafc', outline:'none', minWidth:160 }} />
        </div>
      </div>

      {/* List */}
      <div style={{ flex:1, overflowY:'auto', padding:'16px 32px' }}>
        {loading && companies.length === 0 ? (
          <div style={{ display:'flex', justifyContent:'center', paddingTop:60 }}>
            <Spin size={28} />
          </div>
        ) : (
          <>
            {companies.map(c => {
              const isNav = navigating === c.slug
              return (
                <div key={c.slug} onClick={() => openCompany(c)}
                  style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'16px 20px', marginBottom:10, cursor: isNav ? 'wait' : 'pointer', transition:'all 0.12s', display:'flex', alignItems:'center', gap:16 }}
                  onMouseEnter={e => { if (!isNav) { e.currentTarget.style.borderColor='#a5b4fc'; e.currentTarget.style.boxShadow='0 2px 12px rgba(99,102,241,0.08)' } }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.boxShadow='none' }}>
                  <div style={{ width:38, height:38, borderRadius:9, background:'rgba(242,102,37,0.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800, color:'#F26625', flexShrink:0 }}>
                    {c.name[0]}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                      <div style={{ fontWeight:800, fontSize:14, color:'#0f172a' }}>{c.name}</div>
                      {c.batch && <span style={{ fontSize:9, padding:'2px 6px', background:'rgba(242,102,37,0.1)', color:'#F26625', borderRadius:4, fontWeight:700 }}>{c.batch}</span>}
                    </div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginBottom:5 }}>
                      {[c.team_size && `${c.team_size} people`, c.all_locations?.split(';')[0]?.trim()].filter(Boolean).join(' · ')}
                    </div>
                    <p style={{ fontSize:12, color:'#475569', margin:'0 0 6px', lineHeight:1.4 }}>{c.one_liner || c.long_description?.slice(0, 100)}</p>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                      {(c.tags || []).slice(0,4).map(t => (
                        <span key={t} style={{ padding:'2px 7px', background:'#f1f5f9', color:'#475569', borderRadius:20, fontSize:10, fontWeight:600 }}>{t}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ flexShrink:0, fontSize:16, color: isNav ? '#6366f1' : '#94a3b8', fontWeight:700 }}>
                    {isNav ? <Spin color="#6366f1" size={16} /> : '→'}
                  </div>
                </div>
              )
            })}

            {companies.length < total && (
              <div style={{ textAlign:'center', paddingTop:16 }}>
                <button onClick={() => { const np = page + 1; setPage(np); load(np) }}
                  style={{ padding:'9px 24px', background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer', color:'#475569' }}>
                  Load more ({total - companies.length} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Thin wrapper ──────────────────────────────────────────────────────────────
// Routes to YC-specific view for the 'yc-startups' slug, otherwise the regular
// category view. Splitting this way ensures the regular view's hooks run
// unconditionally — previously the YC early-return sat between hook calls,
// which violates React's rules-of-hooks and made the hook order unstable.
export default function CategoryView() {
  const { name: encodedName } = useParams()
  const categoryName = decodeURIComponent(encodedName)
  if (categoryName === 'yc-startups') return <YCCategoryView />
  return <RegularCategoryView categoryName={categoryName} />
}

// ── Regular Category View ─────────────────────────────────────────────────────
function RegularCategoryView({ categoryName }) {
  const navigate = useNavigate()

  const [companies, setCompanies] = useState([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [page, setPage]           = useState(0)
  const [search, setSearch]       = useState('')
  const [source, setSource]       = useState('')
  const [status, setStatus]       = useState('')
  const [sortBy, setSortBy]       = useState('hiring')
  const [scraping, setScraping]   = useState(null)
  // Active pile selector — 'unchecked' (default) or 'checked'. User picks
  // one via the segmented button choice below; the list shows that pile
  // full-width instead of two side-by-side sections.
  const [activePile, setActivePile] = useState('unchecked')
  const [scrapeMsg, setScrapeMsg] = useState(null)
  const debounce = useRef(null)

  const load = useCallback(async (pg = 0, q = search, src = source, st = status, sb = sortBy) => {
    setLoading(true)
    try {
      const params = { category: categoryName, page: pg, pageSize: 50, sort: sb }
      if (q)   params.search = q
      if (src) params.source = src
      if (st)  params.status = st
      const d = await api.unified.companies(params)
      const rows = d.companies || d || []
      if (pg === 0) setCompanies(rows)
      else setCompanies(prev => [...prev, ...rows])
      setTotal(d.total || rows.length)
    } catch (e) { console.warn('Companies load error:', e) }
    setLoading(false)
  }, [categoryName, search, source, status, sortBy])

  useEffect(() => { load(0, search, source, status, sortBy) }, [categoryName, search, source, status, sortBy, load])

  function onSearch(e) {
    const q = e.target.value
    setSearch(q)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setPage(0); load(0, q, source, status, sortBy) }, 300)
  }

  async function scrapeSource(src) {
    setScraping(src)
    const subcategory = CATEGORY_QUERIES[categoryName] || `${categoryName.toLowerCase()} intern 2026`
    try {
      const r = src === 'all_sources'
        ? await api.companies.scrape({ category: categoryName, subcategory })
        : await api.companies.scrapeSource(src, { category: categoryName, subcategory })
      const added = r.added || 0
      const total = r.deduped || r.total || 0
      const skipped = Math.max(0, total - added)
      const parts = [`${total} scraped`, `+${added} new`]
      if (skipped > 0) parts.push(`${skipped} already in DB`)
      if (r.updated) parts.push(`${r.updated} updated`)
      setScrapeMsg({ ok: true, text: parts.join(' · ') })
      load(0, search, source, status)
    } catch (err) { setScrapeMsg({ ok: false, text: err.message }) }
    setScraping(null)
    setTimeout(() => setScrapeMsg(null), 8000)
  }

  // Inline status update
  async function updateStatus(id, newStatus, e) {
    e.stopPropagation()
    try { await api.jobs.updateStatus(id, newStatus) } catch (e) { console.warn('Status update error:', e) }
    setCompanies(cs => cs.map(c => c.id === id ? { ...c, status: newStatus } : c))
  }

  const sources = [...new Set(companies.map(c => c.source).filter(Boolean))]

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'18px 32px 16px', background:'#fff', borderBottom:'1px solid #e2e8f0' }}>
        <div style={{ fontSize:12, color:'#94a3b8', marginBottom:6 }}>
          <Link to="/companies" style={{ color:'#6366f1', textDecoration:'none', fontWeight:600 }}>← Companies</Link>
          {' / '}
          <span style={{ color:'#0f172a', fontWeight:700 }}>{categoryName}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <div>
            <h2 style={{ fontSize:20, fontWeight:800, color:'#0f172a', margin:0 }}>{categoryName}</h2>
            <p style={{ fontSize:12, color:'#64748b', margin:'3px 0 0' }}>{total.toLocaleString()} companies</p>
          </div>
        </div>

        {/* Filters + Sort — themed Dropdown so the OS picker doesn't appear
            on mobile and the look stays consistent with the rest of the app. */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8, alignItems:'center' }}>
          <input value={search} onChange={onSearch} placeholder="Filter by name…"
            style={{ padding:'9px 12px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:13, color:'#0f172a', outline:'none', boxSizing:'border-box', width:'100%' }} />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <Dropdown
              ariaLabel="Filter by status"
              value={status}
              onChange={(v) => { setStatus(v); setPage(0); load(0, search, source, v, sortBy) }}
              options={[
                { value:'',           label:'All Statuses' },
                { value:'new',        label:'New' },
                { value:'researching',label:'Researching' },
                { value:'contacted',  label:'Contacted' },
                { value:'responded',  label:'Responded' },
                { value:'skip',       label:'Skip' },
              ]}
            />
            <Dropdown
              ariaLabel="Sort by"
              value={sortBy}
              onChange={(v) => { setSortBy(v); setPage(0); load(0, search, source, status, v) }}
              options={[
                { value:'hiring',   label:'⭐ Top Companies' },
                { value:'contacts', label:'👥 Most Contacts' },
                { value:'recent',   label:'📅 Recent First' },
                { value:'az',       label:'A → Z' },
                { value:'za',       label:'Z → A' },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Company list */}
      <div style={{ flex:1, overflowY:'auto', padding:'12px 32px' }}>
        {loading && companies.length === 0 ? (
          <div style={{ display:'flex', justifyContent:'center', paddingTop:60 }}><Spin size={28} /></div>
        ) : companies.length === 0 ? (
          <div style={{ textAlign:'center', paddingTop:60, color:'#94a3b8' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🏢</div>
            <div style={{ fontSize:16, fontWeight:700, color:'#475569', marginBottom:8 }}>No companies found</div>
            <div style={{ fontSize:13, marginBottom:20 }}>Scrape external sources to find companies in this category</div>
          </div>
        ) : (() => {
          const sorted = [...companies].sort((a, b) => {
            if (sortBy === 'az') return (a.name || '').localeCompare(b.name || '')
            if (sortBy === 'za') return (b.name || '').localeCompare(a.name || '')
            if (sortBy === 'contacts') return (b.total_contacts || 0) - (a.total_contacts || 0)
            if (sortBy === 'recent') {
              const ac = a.created_at || '', bc = b.created_at || ''
              if (ac && bc) return bc.localeCompare(ac)
              return (b.id || 0) - (a.id || 0)
            }
            if (sortBy === 'hiring') {
              const aHiring = a.is_hiring || 0, bHiring = b.is_hiring || 0
              if (aHiring !== bHiring) return bHiring - aHiring
              return (b.total_contacts || 0) - (a.total_contacts || 0)
            }
            return 0
          })

          // Split: "checked" = the company has been scraped at least once
          // (intern_roles_checked_at is set), regardless of whether roles
          // were found. "Yet to check" = never scraped. This matches the
          // user's mental model: "I either looked at this one or I didn't",
          // not "I changed its status pill". User-set status (researching /
          // contacted / etc.) still surfaces visually on the row but no
          // longer drives the section split.
          const isChecked = (c) => !!c.intern_roles_checked_at
          const unchecked = sorted.filter(c => !isChecked(c))
          const checked   = sorted.filter(c =>  isChecked(c))

          // Unified button family — same pill shape (radius 20), same
          // height (padding 5×14), same font (11/700). Difference is
          // only fill vs outline so the hierarchy is fill-strength only:
          //   primary  → indigo filled (the main action — Apply)
          //   ghost    → indigo-outlined (secondary — Careers)
          // Reads as one consistent set of action chips next to the
          // status pill instead of three competing button shapes.
          const btnBase = {
            padding:'5px 14px', borderRadius:20, fontSize:11, fontWeight:700,
            cursor:'pointer', whiteSpace:'nowrap', display:'inline-flex',
            alignItems:'center', gap:5, transition:'all 0.12s', lineHeight:1.5,
          }
          const btnPrimary = { ...btnBase, border:'1px solid #4f46e5',
            background:'#4f46e5', color:'#fff' }
          const btnGhost   = { ...btnBase, border:'1px solid #c7d2fe',
            background:'#fff', color:'#4f46e5', textDecoration:'none' }

          const renderRow = (c) => {
            const srcColor = SOURCE_COLORS[c.source?.split(',')[0]] || SOURCE_COLORS.manual_search
            return (
              // Row layout: avatar | content | right-rail.
              // The right rail is a flex column, status pill on top and the
              // Apply/Careers actions below it — so the status sits in the
              // visual top-right corner of the card on every breakpoint, and
              // the two action buttons read as one consistent set below it.
              // alignItems:flex-start keeps the rail pinned to the top so the
              // status pill never floats down beside the avatar.
              <div key={c.id} className="cv-company-row"
                onClick={() => navigate(`/company/${c.id}`)}
                style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, padding:'14px 16px', marginBottom:8, display:'flex', alignItems:'flex-start', gap:12, flexWrap:'wrap', rowGap:10 }}>
                <div style={{ width:38, height:38, borderRadius:8, background:'#eff6ff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:800, color:'#4f46e5', flexShrink:0 }}>
                  {(c.name || '?')[0].toUpperCase()}
                </div>
                <div style={{ flex:'1 1 200px', minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                    <span style={{ fontWeight:700, fontSize:14, color:'#0f172a' }}>{c.name}</span>
                    {c.yc_batch && <span style={{ fontSize:9, padding:'2px 6px', borderRadius:4, background:'rgba(242,102,37,0.1)', color:'#F26625', fontWeight:700 }}>{c.yc_batch}</span>}
                    {c.source && c.source.split(',')[0] !== 'job' && (
                      <span className="cv-source-pill" style={{ background:srcColor.bg, color:srcColor.color, border:`1px solid ${srcColor.border}` }}>
                        {c.source.split(',')[0]}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:11, color:'#64748b' }}>
                    {(c.roles && c.roles !== 'job') || c.role_title} {c.location ? `· ${c.location}` : ''}
                    {c.created_at && <span style={{ marginLeft:8, color:'#94a3b8' }}>{timeAgo(c.created_at)}</span>}
                  </div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8, marginLeft:'auto', flexShrink:0 }}>
                  <div onClick={e => e.stopPropagation()}>
                    <Dropdown
                      compact
                      colorMap={STATUS_COLORS}
                      ariaLabel={`Status for ${c.name}`}
                      value={c.status || 'new'}
                      onChange={(v) => updateStatus(c.id, v, { stopPropagation: () => {} })}
                      options={[
                        { value:'new',         label:'new' },
                        { value:'researching', label:'researching' },
                        { value:'contacted',   label:'contacted' },
                        { value:'responded',   label:'responded' },
                        { value:'skip',        label:'skip' },
                      ]}
                    />
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', justifyContent:'flex-end' }}>
                    <button onClick={async (e) => {
                        e.stopPropagation()
                        try {
                          const r = await api.career.autoApplyCompanyQueue(c.id)
                          if (r.queued > 0) alert(`✓ Queued ${r.queued} role(s) for auto-apply${r.skippedAlreadyInFlight ? ` (skipped ${r.skippedAlreadyInFlight} already in queue)` : ''}. Run "Auto-Apply Setup → Run Queue" to process now.`)
                          else alert(`No scraped roles for ${r.company || c.name}. Open the company page and click Scrape, or use the larger "Scrape & Queue" button there.`)
                        } catch (err) { alert('Auto-Apply failed: ' + err.message) }
                      }}
                      title="Queue all known scraped intern roles for auto-apply"
                      style={btnPrimary}>
                      Apply
                    </button>
                    {(c.url || c.domain) && (
                      <a href={c.url || `https://${c.domain}/careers`} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        title="Open careers page"
                        style={btnGhost}>
                        Careers ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          }

          const emptyState = (msg) => (
            <div style={{ padding:'24px 16px', fontSize:12, color:'#94a3b8', fontStyle:'italic', textAlign:'center', background:'#fff', border:'1px dashed #e2e8f0', borderRadius:10 }}>
              {msg}
            </div>
          )

          // Button-choice toggle: pick which pile to view (unchecked vs
          // checked). One list at a time, full width — cleaner than the
          // two-column split on every screen size.
          const pileButton = (key, icon, label, count, accent) => {
            const active = activePile === key
            return (
              <button type="button" onClick={() => setActivePile(key)}
                style={{
                  display:'flex', alignItems:'center', gap:8, padding:'9px 16px',
                  fontSize:13, fontWeight:700, cursor:'pointer',
                  border:'1px solid', borderColor: active ? accent : '#e2e8f0',
                  background: active ? accent : '#fff',
                  color: active ? '#fff' : '#475569',
                  borderRadius:10, transition:'all 0.12s',
                  flex:'1 1 auto', justifyContent:'center', whiteSpace:'nowrap',
                }}>
                <span aria-hidden="true">{icon}</span>
                <span>{label}</span>
                <span style={{
                  fontSize:11, fontWeight:800, padding:'2px 8px', borderRadius:20,
                  background: active ? 'rgba(255,255,255,0.25)' : `${accent}15`,
                  color: active ? '#fff' : accent,
                }}>
                  {count}
                </span>
              </button>
            )
          }

          const visible = activePile === 'unchecked' ? unchecked : checked

          return (
            <div>
              <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
                {pileButton('unchecked', '🔍', 'Yet to check', unchecked.length, '#6366f1')}
                {pileButton('checked',   '✓',  'Already checked', checked.length, '#16a34a')}
              </div>
              {visible.length > 0
                ? visible.map(renderRow)
                : emptyState(activePile === 'unchecked'
                    ? 'All companies in this category have been checked. 🎉'
                    : 'No companies scraped yet. Click ↻ Scrape on a company to move it here.')}
            </div>
          )
        })()}

        {companies.length > 0 && companies.length < total && (
          <div style={{ textAlign:'center', padding:'12px 0' }}>
            <button onClick={() => { const np = page + 1; setPage(np); load(np) }}
              style={{ padding:'8px 20px', background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer', color:'#475569' }}>
              Load more ({total - companies.length} remaining)
            </button>
          </div>
        )}

        {/* Scrape more section */}
        <div style={{ marginTop:24, padding:20, background:'#fff', borderRadius:12, border:'1px solid #e2e8f0' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', marginBottom:4 }}>
            Scrape more companies for "{categoryName}"
          </div>
          <div style={{ fontSize:11, color:'#64748b', marginBottom:14 }}>
            Search external sources for new companies to add to this category
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            {['All Sources','LinkedIn','Wellfound','Google Jobs','GitHub'].map(src => {
              const key = src.toLowerCase().replace(' ','_')
              const isLoading = scraping === key
              return (
                <button key={src} onClick={() => scrapeSource(key)} disabled={!!scraping}
                  style={{ padding:'7px 14px', borderRadius:8, border:'1px solid #e2e8f0', background: isLoading ? '#eff6ff' : '#f8fafc', color: isLoading ? '#4f46e5' : '#475569', fontSize:12, fontWeight:600, cursor: scraping ? 'default' : 'pointer', display:'flex', alignItems:'center', gap:5 }}>
                  {isLoading && <Spin color="#4f46e5" size={11} />}
                  {src}
                </button>
              )
            })}
          </div>
          {scrapeMsg && (
            <div style={{ marginTop:10, fontSize:12, fontWeight:600, color: scrapeMsg.ok ? '#22c55e' : '#ef4444' }}>
              {scrapeMsg.ok ? '✓ ' : '✗ '}{scrapeMsg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

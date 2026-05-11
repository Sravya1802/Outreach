import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useMediaQuery } from '../hooks'
import Dropdown from './Dropdown'

const SOURCES = [
  { key:'linkedin',    label:'LinkedIn Jobs',  desc:'Software engineering intern roles from LinkedIn',  color:'#0891b2', bg:'#ecfeff' },
  { key:'wellfound',   label:'Wellfound',       desc:'Startup jobs from Wellfound (AngelList)',           color:'#9333ea', bg:'#fdf4ff' },
  { key:'google_jobs', label:'Google Jobs',     desc:'Aggregated listings from Google search',            color:'#2563eb', bg:'#eff6ff' },
  { key:'github',      label:'GitHub',          desc:'Internship lists from the GitHub community repos',  color:'#16a34a', bg:'#f0fdf4' },
  { key:'yc',          label:'YC Startups',     desc:'All YC companies currently hiring (free API)',      color:'#F26625', bg:'#fff7ed' },
  { key:'handshake',   label:'Handshake',       desc:'School portal — needs HANDSHAKE_SESSION_COOKIE on the VM', color:'#7c3aed', bg:'#f5f3ff' },
]

const CATEGORIES = [
  'AI & Research', 'Tech & Software', 'Finance & Investing',
  'Healthcare & Life Sciences', 'Data & Analytics', 'Automotive & Mobility',
  'Defense & Government', 'Hardware & Semiconductors', 'Energy & Climate',
]

const CAT_COLORS = {
  'AI & Research':              '#7c3aed',
  'Tech & Software':            '#2563eb',
  'Finance & Investing':        '#059669',
  'Healthcare & Life Sciences': '#dc2626',
  'Data & Analytics':           '#4f46e5',
}

function Spin({ color = '#6366f1', size = 14 }) {
  return <span style={{ display:'inline-block', width:size, height:size, border:`2px solid ${color}30`, borderTopColor:color, borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />
}

export default function ScraperPage() {
  const navigate = useNavigate()
  // Tablet and below collapses the 1fr+340px sidebar; phone tightens
  // padding and reflows the source-row controls.
  const isPhone   = useMediaQuery('(max-width: 480px)')
  const isNarrow  = useMediaQuery('(max-width: 1100px)')
  const [scraping, setScraping]         = useState(null)
  const [results, setResults]           = useState({})
  const [category, setCategory]         = useState('')
  const [log, setLog]                   = useState([])
  const [newCompanies, setNewCompanies] = useState([])

  async function scrape(src) {
    setScraping(src)
    setLog(l => [...l, `Starting ${src === 'all' ? 'all sources' : src}…`])
    try {
      const r = src === 'all'
        ? await api.jobs.scrape({ category, subcategory: category })
        : await api.jobs.scrape({ category, subcategory: category, source: src })
      // Response shape varies between /jobs/scrape and /companies/scrape/:src.
      // Normalize so the activity log reads honestly regardless of path:
      //   - found   = total companies returned by all scrapers this run
      //   - added   = newly inserted into DB
      //   - inDb    = found that already existed (dedupe)
      const added = r.added ?? r.imported ?? r.inserted ?? 0
      const found = r.found ?? r.total ?? r.rawTotal ?? added
      const inDb  = r.alreadyInDb ?? r.skipped ?? Math.max(0, found - added)
      setResults(prev => ({ ...prev, [src]: { ok: true, added, found, inDb } }))
      let line
      if (added > 0 && inDb > 0)      line = `✓ ${src}: found ${found} (+${added} new, ${inDb} already in DB)`
      else if (added > 0)             line = `✓ ${src}: +${added} companies added`
      else if (found > 0)             line = `✓ ${src}: found ${found} — all already in DB`
      else if (r.failedSrc > 0)        line = `✗ ${src}: no companies found — ${r.failedSrc} source${r.failedSrc === 1 ? '' : 's'} failed`
      else                            line = `✓ ${src}: no companies found`
      setLog(l => [...l, line])
      if (r.errors && Object.keys(r.errors).length > 0) {
        const details = Object.entries(r.errors).slice(0, 4).map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`)
        setLog(l => [...l, ...details.map(d => `✗ ${d}`)])
        window.dispatchEvent(new Event('credits-refresh'))
      }
      if (r.newCompanies?.length) {
        setNewCompanies(prev => {
          const existing = new Set(prev.map(c => c.name.toLowerCase()))
          const fresh = r.newCompanies.filter(c => !existing.has(c.name.toLowerCase()))
          return [...fresh, ...prev]
        })
      }
    } catch (err) {
      setResults(prev => ({ ...prev, [src]: { ok: false, error: err.message } }))
      setLog(l => [...l, `✗ ${src}: ${err.message}`])
      window.dispatchEvent(new Event('credits-refresh'))
    }
    setScraping(null)
  }

  async function scrapeYC() {
    setScraping('yc')
    setLog(l => [...l, 'Importing YC companies (free API)…'])
    try {
      const r = await api.yc.scrapeWaas()
      setResults(prev => ({ ...prev, yc: { ok: true, added: r.imported || 0 } }))
      setLog(l => [...l, `✓ YC: +${r.imported || 0} companies imported`])
      if (r.newCompanies?.length) {
        setNewCompanies(prev => {
          const existing = new Set(prev.map(c => c.name.toLowerCase()))
          const fresh = r.newCompanies.filter(c => !existing.has(c.name.toLowerCase()))
          return [...fresh, ...prev]
        })
      }
    } catch (err) {
      setResults(prev => ({ ...prev, yc: { ok: false, error: err.message } }))
      setLog(l => [...l, `✗ YC: ${err.message}`])
    }
    setScraping(null)
  }

  return (
    <div style={{ flex:1, overflowY:'auto', background:'#f8fafc' }}>
      {/* Header */}
      <div style={{ padding: isPhone ? '14px 14px 12px' : '24px 40px 20px', background:'#fff', borderBottom:'1px solid #e2e8f0' }}>
        <h1 style={{ fontSize: isPhone ? 18 : 22, fontWeight:800, color:'#0f172a', margin:'0 0 4px' }}>Job Scraper</h1>
        <p style={{ fontSize: isPhone ? 12 : 13, color:'#64748b', margin:'0 0 14px' }}>Bulk scrape intern roles across all job sources</p>

        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 200px', minWidth:0 }}>
            <Dropdown
              ariaLabel="Filter by category"
              value={category}
              onChange={(v) => setCategory(v)}
              options={[{ value:'', label:'All Categories' }, ...CATEGORIES.map(c => ({ value: c, label: c }))]}
            />
          </div>
          <button onClick={() => scrape('all')} disabled={!!scraping}
            style={{ padding:'9px 18px', background: scraping ? '#f1f5f9' : 'linear-gradient(135deg,#6366f1,#7c3aed)', color: scraping ? '#64748b' : '#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:700, cursor: scraping ? 'default':'pointer', display:'flex', alignItems:'center', gap:7, whiteSpace:'nowrap', flexShrink:0 }}>
            {scraping === 'all' ? <><Spin color="#64748b" /> Scraping…</> : '↺ Scrape All'}
          </button>
        </div>
      </div>

      <div style={{ padding: isPhone ? '18px 14px' : '28px 40px', display:'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 340px', gap: isPhone ? 18 : 28 }}>

        {/* Source grid */}
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:16 }}>Sources</div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {SOURCES.map(src => {
              const res = results[src.key]
              const isScraping = scraping === src.key
              return (
                <div key={src.key} style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding: isPhone ? '14px 14px' : '18px 20px', display:'flex', alignItems:'center', gap: isPhone ? 12 : 16, flexWrap:'wrap' }}>
                  <div style={{ width:42, height:42, borderRadius:9, background:src.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:src.color, flexShrink:0 }}>
                    {src.key === 'linkedin' ? 'in' : src.key === 'wellfound' ? 'WF' : src.key === 'google_jobs' ? 'G' : src.key === 'github' ? 'GH' : src.key === 'handshake' ? 'HS' : 'YC'}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:14, color:'#0f172a', marginBottom:2 }}>{src.label}</div>
                    <div style={{ fontSize:12, color:'#64748b' }}>{src.desc}</div>
                    {res && (
                      <div style={{ marginTop:6, fontSize:12, fontWeight:600, color: res.ok ? '#15803d' : '#dc2626' }}>
                        {res.ok
                          ? (res.added > 0 && res.inDb > 0
                              ? `✓ found ${res.found} (+${res.added} new, ${res.inDb} already in DB)`
                              : res.added > 0
                                ? `✓ +${res.added} companies added`
                                : res.found > 0
                                  ? `✓ found ${res.found} — all already in DB`
                                  : '✓ no companies found')
                          : `✗ ${res.error}`}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => src.key === 'yc' ? scrapeYC() : scrape(src.key)}
                    disabled={!!scraping}
                    style={{ padding:'8px 18px', background: isScraping ? '#f1f5f9' : src.bg, color: isScraping ? '#64748b' : src.color, border:`1px solid ${src.color}40`, borderRadius:8, fontSize:12, fontWeight:700, cursor: scraping ? 'default':'pointer', display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                    {isScraping ? <><Spin color={src.color} /> Scraping…</> : '↺ Scrape'}
                  </button>
                </div>
              )
            })}
          </div>

          <div style={{ marginTop:20, padding:16, background:'#fff', border:'1px solid #e2e8f0', borderRadius:12 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', marginBottom:8 }}>After scraping</div>
            <div style={{ fontSize:12, color:'#64748b', marginBottom:12 }}>New companies appear in the Companies grid, organized by category. All roles are filtered for intern/new grad/entry-level positions only.</div>
            <button onClick={() => navigate('/companies')}
              style={{ padding:'8px 16px', background:'#6366f1', color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer' }}>
              Browse Companies →
            </button>
          </div>
        </div>

        {/* Right column: log + new companies */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

          {/* Activity Log */}
          <div>
            <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:14 }}>Activity Log</div>
            <div style={{ background:'#0f172a', borderRadius:12, padding:'16px 18px', minHeight:160, fontFamily:'monospace', maxHeight:260, overflowY:'auto' }}>
              {log.length === 0 ? (
                <div style={{ fontSize:12, color:'#475569' }}>Ready to scrape. Select a source above.</div>
              ) : (
                log.map((line, i) => (
                  <div key={i} style={{ fontSize:12, color: line.startsWith('✓') ? '#4ade80' : line.startsWith('✗') ? '#f87171' : '#94a3b8', marginBottom:4, lineHeight:1.5 }}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* New Companies Found */}
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <div style={{ fontSize:14, fontWeight:800, color:'#0f172a' }}>
                Companies Found
                {newCompanies.length > 0 && (
                  <span style={{ marginLeft:8, fontSize:11, fontWeight:700, background:'#eff6ff', color:'#6366f1', padding:'2px 8px', borderRadius:10 }}>
                    {newCompanies.length} new
                  </span>
                )}
              </div>
              {newCompanies.length > 0 && (
                <button onClick={() => setNewCompanies([])}
                  style={{ fontSize:11, color:'#94a3b8', background:'none', border:'none', cursor:'pointer' }}>
                  Clear
                </button>
              )}
            </div>

            {newCompanies.length === 0 ? (
              <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'24px 16px', textAlign:'center', color:'#94a3b8', fontSize:12 }}>
                {log.length === 0 ? 'Scraped companies will appear here' : 'No new companies this run — all already in DB'}
              </div>
            ) : (
              <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, overflow:'hidden', maxHeight:400, overflowY:'auto' }}>
                {newCompanies.map((c, i) => {
                  const catColor = CAT_COLORS[c.category] || '#6366f1'
                  return (
                    <div key={i} style={{ padding:'10px 14px', borderBottom: i < newCompanies.length - 1 ? '1px solid #f1f5f9' : 'none', display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:30, height:30, borderRadius:7, background:`${catColor}15`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:catColor, flexShrink:0 }}>
                        {(c.name || '?')[0].toUpperCase()}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</div>
                        <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>
                          {c.category}{c.location && c.location !== 'USA' ? ` · ${c.location}` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize:9, padding:'2px 6px', borderRadius:5, background:`${catColor}15`, color:catColor, fontWeight:700, flexShrink:0 }}>
                        {c.source?.split(',')[0] || 'scrape'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

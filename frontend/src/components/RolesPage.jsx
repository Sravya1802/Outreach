import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useMediaQuery } from '../hooks'
import Spin from './Spin'

const SOURCE_LABELS = {
  greenhouse:        'Greenhouse',
  lever:             'Lever',
  ashby:             'Ashby',
  linkedin:          'LinkedIn',
  wellfound:         'Wellfound',
  ai_jobs:           'ai-jobs.net',
  jobspresso:        'Jobspresso',
  remote_rocketship: 'Remote Rocketship',
  internshipdaily:   'InternshipDaily',
}

function fmtPosted(iso, scrapedAt) {
  const ts = iso ? new Date(iso) : (scrapedAt ? new Date(scrapedAt) : null)
  if (!ts || isNaN(ts)) return '—'
  const days = Math.floor((Date.now() - ts.getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  return ts.toISOString().slice(0, 10)
}

function levelsFyiUrl(company) {
  const slug = String(company || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug ? `https://www.levels.fyi/companies/${slug}/salaries` : null
}

/**
 * RolesPage — daily-scraped role catalog. The route decides role_type:
 *   /apply/intern-roles    → role_type='intern'
 *   /apply/new-grad-roles  → role_type='new_grad'
 */
export default function RolesPage({ defaultRoleType = 'intern' }) {
  const params = useParams()
  // The router renders the same component for both routes; allow URL to override.
  const roleType = params.kind === 'new-grad-roles' ? 'new_grad' : (params.kind === 'intern-roles' ? 'intern' : defaultRoleType)
  // Three-tier breakpoints: phone gets a stacked card layout (the 5-col
  // grid table doesn't fit ≤480), tablet/narrow tightens columns, desktop
  // keeps the full grid.
  const isPhone  = useMediaQuery('(max-width: 480px)')
  const isNarrow = useMediaQuery('(max-width: 900px)')

  const [rows, setRows]               = useState([])
  const [total, setTotal]             = useState(0)
  const [page, setPage]               = useState(0)
  const [search, setSearch]           = useState('')
  const [source, setSource]           = useState('')
  const [sourceCounts, setSourceCounts] = useState({})
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [actionRow, setActionRow]     = useState(null)
  const [refreshing, setRefreshing]   = useState(false)
  const [toast, setToast]             = useState(null)

  const pageSize = 25
  const heading  = roleType === 'new_grad' ? '💼 New Grad Roles' : '🎓 Intern Roles'
  const subtitle = roleType === 'new_grad'
    ? 'Entry-level roles scraped daily from LinkedIn, Wellfound, Greenhouse / Lever / Ashby, ai-jobs.net, Jobspresso, Remote Rocketship, and InternshipDaily.'
    : 'Internships scraped daily from LinkedIn, Wellfound, Greenhouse / Lever / Ashby, ai-jobs.net, Jobspresso, Remote Rocketship, and InternshipDaily.'

  // Load page of roles
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    api.scrapedRoles.list({ roleType, source, search, page, pageSize })
      .then(d => { if (!cancelled) { setRows(d.rows || []); setTotal(d.total || 0) } })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load roles') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [roleType, source, search, page])

  // Load per-source counts (independent of search/page)
  useEffect(() => {
    api.scrapedRoles.sources()
      .then(d => {
        const counts = {}
        for (const r of d.sources || []) {
          counts[r.source] = counts[r.source] || { intern: 0, new_grad: 0 }
          counts[r.source][r.role_type] = r.n
        }
        setSourceCounts(counts)
      })
      .catch(() => {})
  }, [roleType, refreshing])

  // Track / auto-apply actions
  async function track(row) {
    setActionRow({ id: row.id, action: 'track' })
    try {
      await api.scrapedRoles.track(row.id)
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, tracked: true } : r))
      flash(`Tracked: ${row.title}`)
    } catch (e) {
      flash(`✗ ${e.message}`)
    }
    setActionRow(null)
  }

  async function autoApply(row) {
    setActionRow({ id: row.id, action: 'auto' })
    try {
      await api.scrapedRoles.autoApply(row.id)
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, autoQueued: true } : r))
      flash(`Queued for Auto Apply: ${row.title}`)
    } catch (e) {
      flash(`✗ ${e.message}`)
    }
    setActionRow(null)
  }

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  async function refreshNow() {
    setRefreshing(true)
    try {
      const r = await api.scrapedRoles.refresh()
      flash(`Scrape done — ${r.summary?.total || 0} roles processed.`)
      // Reset to page 0 to show newest
      setPage(0)
      const d = await api.scrapedRoles.list({ roleType, source, search, page: 0, pageSize })
      setRows(d.rows || []); setTotal(d.total || 0)
    } catch (e) {
      flash(`✗ ${e.message}`)
    }
    setRefreshing(false)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const sourcePills = useMemo(() => {
    const allSources = Object.keys(SOURCE_LABELS)
    return allSources.map(s => ({
      key: s,
      label: SOURCE_LABELS[s],
      count: sourceCounts[s]?.[roleType] || 0,
    })).filter(s => s.count > 0)
  }, [sourceCounts, roleType])

  return (
    // App.jsx wraps every page in <main className="app-main" overflow:hidden>,
    // so each page provides its own vertical scroll container. Without
    // overflowY:auto here the table just gets clipped at the viewport edge.
    <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc' }}>
    <div style={{ padding: isPhone ? '14px 14px' : '20px 32px', maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h1 style={{ fontSize: isPhone ? 18 : 24, fontWeight: 800, color: '#0f172a', margin: 0 }}>{heading}</h1>
          <p style={{ fontSize: isPhone ? 12 : 13, color: '#64748b', margin: '6px 0 0', maxWidth: 720, lineHeight: 1.5 }}>{subtitle}</p>
        </div>
        <button onClick={refreshNow} disabled={refreshing}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 700, cursor: refreshing ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {refreshing ? <Spin /> : '🔄'} Refresh now
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, marginBottom: 12 }}>
        <Link to="/apply/intern-roles" style={tabStyle(roleType === 'intern')}>🎓 Intern</Link>
        <Link to="/apply/new-grad-roles" style={tabStyle(roleType === 'new_grad')}>💼 New Grad</Link>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          value={search}
          onChange={e => { setPage(0); setSearch(e.target.value) }}
          placeholder="Search title or company…"
          style={{ flex: '1 1 280px', maxWidth: 360, padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, color: '#0f172a' }}
        />
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}><Spin /> Loading…</div>}
      {error  && <div style={{ padding: 14, borderRadius: 8, background: '#fee2e2', color: '#7f1d1d', fontSize: 13 }}>Error: {error}</div>}

      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 12, border: '1px dashed #cbd5e1' }}>
          <div style={{ fontSize: 28 }}>🌙</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginTop: 8 }}>No {roleType === 'new_grad' ? 'new grad' : 'intern'} roles yet</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>The catalog refreshes daily at 06:15 UTC. Click "Refresh now" to seed it manually.</div>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 12, color: '#64748b' }}>
          <span>
            Showing <b style={{ color: '#0f172a' }}>{page * pageSize + 1}</b>–
            <b style={{ color: '#0f172a' }}>{Math.min(total, (page + 1) * pageSize)}</b> of{' '}
            <b style={{ color: '#0f172a' }}>{total.toLocaleString()}</b>
            {source ? ` · ${SOURCE_LABELS[source] || source}` : ''}
          </span>
          {total > pageSize && (
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={navBtn(page === 0)}>‹ Prev</button>
              <span>Page {page + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={navBtn(page >= totalPages - 1)}>Next ›</button>
            </span>
          )}
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          {/* Header row hidden on phone — the stacked card layout below
              already labels itself, so a separate column header is just
              noise on a single-column list. */}
          {!isPhone && (
            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1.6fr 1.2fr 90px 150px' : '2fr 1.2fr 1fr 110px 200px', padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <div>Role</div>
              <div>Company</div>
              {!isNarrow && <div>Location</div>}
              <div>Posted</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>
          )}
          {rows.map((r, i) => isPhone ? (
            // Phone: each role is a stacked card. Title + source on top,
            // company + location + posted in the middle metadata row,
            // action buttons full-width on the bottom.
            <div key={r.id} style={{ padding: '12px 14px', borderBottom: i < rows.length - 1 ? '1px solid #f1f5f9' : 'none', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: '#0f172a' }}>
              <div style={{ minWidth: 0 }}>
                <a href={r.apply_url} target="_blank" rel="noreferrer" style={{ color: '#0f172a', fontWeight: 700, fontSize: 14, textDecoration: 'none', wordBreak: 'break-word' }}>
                  {r.title}
                </a>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{SOURCE_LABELS[r.source] || r.source}</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: 12, color: '#64748b' }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>
                  {r.company_name}
                  {levelsFyiUrl(r.company_name) && (
                    <a href={levelsFyiUrl(r.company_name)} target="_blank" rel="noreferrer"
                       title="View salaries on levels.fyi"
                       style={{ marginLeft: 4, fontSize: 11, color: '#10b981', textDecoration: 'none', fontWeight: 700 }}>
                      💰
                    </a>
                  )}
                </span>
                {r.location && <span>· {r.location}</span>}
                <span>· {fmtPosted(r.posted_at, r.scraped_at)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => track(r)}
                  disabled={r.tracked || actionRow?.id === r.id}
                  style={{ ...btnStyle(r.tracked, '#6366f1'), flex: 1, minWidth: 0 }}>
                  {actionRow?.id === r.id && actionRow?.action === 'track' ? <Spin /> : (r.tracked ? '✓ Tracked' : 'Track')}
                </button>
                <button
                  onClick={() => autoApply(r)}
                  disabled={r.autoQueued || actionRow?.id === r.id}
                  style={{ ...btnStyle(r.autoQueued, '#10b981'), flex: 1, minWidth: 0 }}>
                  {actionRow?.id === r.id && actionRow?.action === 'auto' ? <Spin /> : (r.autoQueued ? '✓ Queued' : '🤖 Auto')}
                </button>
              </div>
            </div>
          ) : (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1.6fr 1.2fr 90px 150px' : '2fr 1.2fr 1fr 110px 200px', padding: '12px 14px', borderBottom: i < rows.length - 1 ? '1px solid #f1f5f9' : 'none', alignItems: 'center', fontSize: 13, color: '#0f172a', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <a href={r.apply_url} target="_blank" rel="noreferrer" style={{ color: '#0f172a', fontWeight: 600, textDecoration: 'none' }}>
                  {r.title}
                </a>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  {SOURCE_LABELS[r.source] || r.source}
                  {/* On tablet (no Location column) fold location in here so
                      the user still sees it without horizontal scroll. */}
                  {isNarrow && r.location && <> · {r.location}</>}
                </div>
              </div>
              <div style={{ color: '#475569', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.company_name}
                {levelsFyiUrl(r.company_name) && (
                  <a href={levelsFyiUrl(r.company_name)} target="_blank" rel="noreferrer"
                     title="View salaries on levels.fyi"
                     style={{ display: 'inline-block', marginLeft: 6, fontSize: 10, color: '#10b981', textDecoration: 'none', fontWeight: 700 }}>
                    💰
                  </a>
                )}
              </div>
              {!isNarrow && <div style={{ color: '#64748b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.location || '—'}</div>}
              <div style={{ color: '#64748b', fontSize: 12 }}>{fmtPosted(r.posted_at, r.scraped_at)}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => track(r)}
                  disabled={r.tracked || actionRow?.id === r.id}
                  style={btnStyle(r.tracked, '#6366f1')}>
                  {actionRow?.id === r.id && actionRow?.action === 'track' ? <Spin /> : (r.tracked ? '✓ Tracked' : 'Track')}
                </button>
                <button
                  onClick={() => autoApply(r)}
                  disabled={r.autoQueued || actionRow?.id === r.id}
                  style={btnStyle(r.autoQueued, '#10b981')}>
                  {actionRow?.id === r.id && actionRow?.action === 'auto' ? <Spin /> : (r.autoQueued ? '✓ Queued' : '🤖 Auto')}
                </button>
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {!loading && !error && total > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 16, fontSize: 12, color: '#64748b' }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={navBtn(page === 0)}>‹ Prev</button>
          <span>Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={navBtn(page >= totalPages - 1)}>Next ›</button>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, padding: '10px 14px', background: '#0f172a', color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 600, boxShadow: '0 6px 20px rgba(0,0,0,0.2)', zIndex: 1000 }}>
          {toast}
        </div>
      )}
    </div>
    </div>
  )
}

const tabStyle = (active) => ({
  padding: '7px 14px',
  borderRadius: 8,
  background: active ? '#0f172a' : '#f1f5f9',
  color:      active ? '#fff'    : '#475569',
  fontSize: 12,
  fontWeight: 700,
  textDecoration: 'none',
  border: 'none',
})

const pillStyle = (active) => ({
  padding: '5px 11px',
  borderRadius: 999,
  border: `1px solid ${active ? '#6366f1' : '#e2e8f0'}`,
  background: active ? '#eef2ff' : '#fff',
  color:      active ? '#4f46e5' : '#475569',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
})

const btnStyle = (done, color) => ({
  padding: '5px 10px',
  borderRadius: 6,
  border: 'none',
  background: done ? '#f1f5f9' : color,
  color:      done ? '#64748b' : '#fff',
  fontSize: 11,
  fontWeight: 700,
  cursor: done ? 'default' : 'pointer',
  minWidth: 76,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
})

const navBtn = (disabled) => ({
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid #e2e8f0',
  background: disabled ? '#f8fafc' : '#fff',
  color: disabled ? '#94a3b8' : '#475569',
  fontSize: 12,
  fontWeight: 700,
  cursor: disabled ? 'default' : 'pointer',
})

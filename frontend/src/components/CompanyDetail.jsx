import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api, rawApiFetch } from '../api'
import { useMediaQuery } from '../hooks'
import TabPicker from './TabPicker'
import Dropdown from './Dropdown'

const CD_CSS = `
  .cd-tab { cursor:pointer; padding:10px 20px; font-size:13px; font-weight:700; border:none; background:transparent; color:#64748b; border-bottom:3px solid transparent; transition:all 0.15s; white-space:nowrap; }
  .cd-tab.active { color:#4f46e5; border-bottom-color:#4f46e5; }
  .cd-tab:hover:not(.active) { color:#475569; background:#f8fafc; }
  .cd-contact-card { transition:border-color 0.12s; }
  .cd-contact-card:hover { border-color:#c7d2fe !important; }
  .cd-action-btn { display:inline-flex; align-items:center; gap:5px; padding:6px 12px; border-radius:7px; font-size:11px; font-weight:700; cursor:pointer; border-width:1px; border-style:solid; transition:all 0.12s; }
  .cd-action-btn:hover:not(:disabled) { filter:brightness(0.96); transform:translateY(-1px); }
  .cd-action-btn:disabled { opacity:0.6; cursor:default; }
  .cd-role-card { transition:border-color 0.12s; }
  .cd-role-card:hover { border-color:#a5b4fc !important; }
`

const STATUS_COLORS = {
  new:         { bg:'#eff6ff', color:'#2563eb', border:'#bfdbfe' },
  researching: { bg:'#fdf4ff', color:'#9333ea', border:'#f0abfc' },
  contacted:   { bg:'#fefce8', color:'#ca8a04', border:'#fde68a' },
  responded:   { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0' },
  skip:        { bg:'#f8fafc', color:'#64748b', border:'#e2e8f0' },
}

const COMPANY_DESCRIPTIONS = {
  'Amazon':    'Amazon is a global technology company specializing in e-commerce, cloud computing (AWS), AI, and digital streaming.',
  'Google':    'Google (Alphabet) is a technology leader in internet search, advertising, cloud computing (GCP), and AI/ML research.',
  'Microsoft': 'Microsoft builds software (Windows, Office 365), cloud services (Azure), developer tools, and AI products including Copilot.',
  'Meta':      'Meta builds social technology including Facebook, Instagram, and WhatsApp, with major investments in AI and the metaverse.',
  'Apple':     'Apple designs iPhones, Macs, iPads, and services with a focus on hardware-software integration and consumer experience.',
  'Netflix':   'Netflix is a streaming entertainment platform with 250M+ subscribers, investing in original content and AI-driven recommendations.',
  'Nvidia':    'Nvidia designs GPUs and AI computing platforms used in deep learning, autonomous vehicles, robotics, and data centers.',
  'Salesforce':'Salesforce is the leading CRM platform offering cloud-based sales, marketing, and AI tools for enterprises.',
  'Adobe':     'Adobe makes creative software (Photoshop, Illustrator), document tools (Acrobat), and digital marketing analytics platforms.',
  'Intel':     'Intel manufactures CPUs, FPGAs, and AI accelerators used in PCs, servers, and edge computing devices.',
  'IBM':       'IBM offers cloud computing, AI (Watson/watsonx), and enterprise IT services for large organizations globally.',
  'Uber':      'Uber operates ride-hailing, food delivery (Uber Eats), and freight logistics platforms across 70+ countries.',
  'Airbnb':    'Airbnb is an online marketplace for short-term home rentals and travel experiences in 220+ countries.',
  'Twitter':   'X (formerly Twitter) is a social media platform for real-time public conversation and news.',
  'Stripe':    'Stripe builds payment infrastructure and financial APIs used by millions of businesses globally.',
  'Spotify':   'Spotify is a digital music streaming service with 600M+ users and a leading podcast platform.',
  'LinkedIn':  'LinkedIn is a professional networking platform owned by Microsoft, used for hiring, career development, and B2B marketing.',
}

function getDescription(company) {
  const known = COMPANY_DESCRIPTIONS[company.name]
  if (known) return known
  const raw = company.description || company.wikipedia_summary || ''
  if (!raw) return ''
  if (/most often refers to|may refer to|is a disambiguation|can refer to/i.test(raw)) return ''
  return raw
}

const AVATAR_COLORS = [
  '#6366f1','#0891b2','#059669','#dc2626','#d97706','#9333ea','#1d4ed8','#15803d'
]
function avatarColor(name) {
  return AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length]
}

function Spin({ color = '#6366f1', size = 14 }) {
  return <span style={{ display:'inline-block', width:size, height:size, border:`2px solid ${color}30`, borderTopColor:color, borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />
}

function timeAgo(iso) {
  if (!iso) return ''
  const h = Math.floor((Date.now() - new Date(iso)) / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function useCopy() {
  const [copied, setCopied] = useState('')
  const copy = (text, key) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(key)
    setTimeout(() => setCopied(''), 1800)
  }
  return [copied, copy]
}

// ── Inline Outreach Composer ──────────────────────────────────────────────────
function OutreachComposer({ contact, company, isYC, onClose }) {
  const [tab, setTab]           = useState('email')
  const [extraCtx, setExtraCtx] = useState('')
  const [email, setEmail]       = useState({ subject:'', body:'' })
  const [linkedin, setLinkedIn] = useState({ message:'' })
  const [waas, setWaaS]         = useState({ message:'' })
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [copied, copy]          = useCopy()

  const generate = useCallback(async (type) => {
    setLoading(true); setError('')
    try {
      if (type === 'email') {
        const r = await api.jobs.generate(contact.id, 'cold_email', extraCtx)
        setEmail({ subject: r.subject || '', body: r.body || '' })
        setTab('email')
      } else if (type === 'linkedin') {
        const r = await api.jobs.generate(contact.id, 'linkedin', extraCtx)
        setLinkedIn({ message: r.message || r.body || r.dm || '' })
        setTab('linkedin')
      } else if (type === 'waas') {
        const r = await api.generate.waas({ companyName: company.name, companyDescription: company.description || company.wikipedia_summary, contactName: contact.name, extraContext: extraCtx })
        setWaaS({ message: r.message || '' })
        setTab('waas')
      }
    } catch (err) { setError(err.message) }
    setLoading(false)
  }, [contact, company, extraCtx])

  const gmailUrl = email.subject && email.body
    ? `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}${contact.email ? `&to=${encodeURIComponent(contact.email)}` : ''}`
    : null

  return (
    <div style={{ marginTop:12, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:12, padding:'16px 20px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>
          Outreach to {contact.name}
          {contact.title && <span style={{ fontSize:11, color:'#64748b', fontWeight:500, marginLeft:6 }}>· {contact.title}</span>}
        </div>
        <button onClick={onClose} style={{ border:'none', background:'none', color:'#94a3b8', cursor:'pointer', fontSize:18 }}>×</button>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, background:'#fff', borderRadius:8, border:'1px solid #e2e8f0', padding:3, marginBottom:14, width:'fit-content' }}>
        {[['email','Email'],['linkedin','LinkedIn DM'], ...(isYC ? [['waas','WaaS Msg']] : [])].map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding:'6px 14px', borderRadius:6, border:'none', fontSize:12, fontWeight:700, cursor:'pointer', transition:'all 0.12s',
              background: tab === t ? '#4f46e5' : 'transparent', color: tab === t ? '#fff' : '#64748b' }}>
            {l}
          </button>
        ))}
      </div>

      {/* Extra context */}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600, marginBottom:4 }}>Extra context (optional)</div>
        <input value={extraCtx} onChange={e => setExtraCtx(e.target.value)}
          placeholder="e.g. they just launched Stripe Atlas for AI startups..."
          style={{ width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, color:'#0f172a', outline:'none', boxSizing:'border-box' }} />
      </div>

      {/* Generate buttons */}
      <div style={{ display:'flex', gap:7, marginBottom:14 }}>
        <button className="cd-action-btn" disabled={loading}
          onClick={() => generate(tab)}
          style={{ background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', fontSize:12, fontWeight:700, padding:'7px 16px', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
          {loading ? <><Spin color="#fff" size={11} /> Generating…</> : '✦ Generate'}
        </button>
        {tab !== 'email' && <button className="cd-action-btn" disabled={loading} onClick={() => generate('email')}
          style={{ background:'#fff', color:'#4f46e5', border:'1px solid #c7d2fe', fontSize:11 }}>Email</button>}
        {tab !== 'linkedin' && <button className="cd-action-btn" disabled={loading} onClick={() => generate('linkedin')}
          style={{ background:'#fff', color:'#0f172a', border:'1px solid #e2e8f0', fontSize:11 }}>LinkedIn DM</button>}
        {isYC && tab !== 'waas' && <button className="cd-action-btn" disabled={loading} onClick={() => generate('waas')}
          style={{ background:'#fff7ed', color:'#c2410c', border:'1px solid #fed7aa', fontSize:11 }}>WaaS Msg</button>}
      </div>

      {error && <div style={{ fontSize:12, color:'#ef4444', marginBottom:10 }}>{error}</div>}

      {/* Email tab content */}
      {tab === 'email' && (
        <div>
          <input value={email.subject} onChange={e => setEmail(em => ({...em, subject:e.target.value}))}
            placeholder="Subject line…"
            style={{ width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, color:'#0f172a', fontWeight:700, outline:'none', marginBottom:8, boxSizing:'border-box' }} />
          <textarea value={email.body} onChange={e => setEmail(em => ({...em, body:e.target.value}))}
            rows={7} placeholder="Email body will appear here after generating…"
            style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, color:'#0f172a', lineHeight:1.6, outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }} />
          {email.body && (
            <div style={{ fontSize:10, color:'#94a3b8', textAlign:'right', marginTop:4 }}>
              {email.body.split(/\s+/).filter(Boolean).length} words
            </div>
          )}
          <div style={{ display:'flex', gap:7, marginTop:10 }}>
            <button onClick={() => copy(`Subject: ${email.subject}\n\n${email.body}`, 'email-all')}
              style={{ padding:'7px 14px', background:'#6366f1', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>
              {copied === 'email-all' ? '✓ Copied' : 'Copy All'}
            </button>
            {gmailUrl && (
              <a href={gmailUrl} target="_blank" rel="noreferrer"
                style={{ padding:'7px 14px', background:'#fff', color:'#0f172a', border:'1px solid #e2e8f0', borderRadius:7, fontSize:11, fontWeight:700, textDecoration:'none' }}>
                Open in Gmail →
              </a>
            )}
          </div>
        </div>
      )}

      {/* LinkedIn tab content */}
      {tab === 'linkedin' && (
        <div>
          <textarea value={linkedin.message} onChange={e => setLinkedIn({message:e.target.value})}
            rows={5} placeholder="LinkedIn connection note will appear here…"
            style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, color:'#0f172a', lineHeight:1.6, outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }} />
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:4 }}>
            <span style={{ fontSize:10, color: (linkedin.message?.length||0) > 280 ? '#ef4444' : '#94a3b8' }}>
              {linkedin.message?.length || 0}/300 chars
            </span>
          </div>
          <div style={{ display:'flex', gap:7, marginTop:10 }}>
            <button onClick={() => copy(linkedin.message, 'li')}
              style={{ padding:'7px 14px', background:'#6366f1', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>
              {copied === 'li' ? '✓ Copied' : 'Copy'}
            </button>
            {contact.linkedin_url && (
              <a href={contact.linkedin_url} target="_blank" rel="noreferrer"
                style={{ padding:'7px 14px', background:'#fff', color:'#0f172a', border:'1px solid #e2e8f0', borderRadius:7, fontSize:11, fontWeight:700, textDecoration:'none' }}>
                Open LinkedIn Profile →
              </a>
            )}
          </div>
        </div>
      )}

      {/* WaaS tab content */}
      {tab === 'waas' && isYC && (
        <div>
          <textarea value={waas.message} onChange={e => setWaaS({message:e.target.value})}
            rows={5} placeholder="WaaS reach-out message will appear here…"
            style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, color:'#0f172a', lineHeight:1.6, outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }} />
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:4 }}>
            <span style={{ fontSize:10, color: (waas.message?.length||0) < 50 ? '#ef4444' : (waas.message?.length||0) > 300 ? '#f59e0b' : '#94a3b8' }}>
              {waas.message?.length || 0} chars {(waas.message?.length||0) < 50 ? '(min 50)' : ''}
            </span>
            <span style={{ fontSize:10, color:'#94a3b8' }}>Paste into the Reach out modal on WaaS</span>
          </div>
          <div style={{ display:'flex', gap:7, marginTop:10 }}>
            <button onClick={() => copy(waas.message, 'waas')}
              style={{ padding:'7px 14px', background:'#6366f1', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>
              {copied === 'waas' ? '✓ Copied' : 'Copy'}
            </button>
            {company.slug && (
              <a href={`https://www.workatastartup.com/companies/${company.slug}`} target="_blank" rel="noreferrer"
                style={{ padding:'7px 14px', background:'#fff7ed', color:'#c2410c', border:'1px solid #fed7aa', borderRadius:7, fontSize:11, fontWeight:700, textDecoration:'none' }}>
                Open on WaaS →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Outreach Tab ──────────────────────────────────────────────────────────────
function OutreachTab({ company }) {
  const isYC = !!(company.yc_batch || company.source?.includes('yc') || company.tags?.includes('YC'))
  const [contacts, setContacts]   = useState([])
  const [findingPeople, setFindingPeople]     = useState(false)
  const [findingEmailsBulk, setFindingEmailsBulk] = useState(false)
  const [findProgress, setFindProgress]        = useState([])
  const [findResultMsg, setFindResultMsg]      = useState(null)
  const [openComposer, setOpenComposer]        = useState(null)
  const [findingEmail, setFindingEmail]        = useState({}) // { [contactId]: true }
  const [section, setSection]                  = useState('both') // 'both' | 'email' | 'linkedin'

  const reload = useCallback(async () => {
    try {
      const c = await api.jobs.contacts(company.id)
      setContacts(Array.isArray(c) ? c : [])
    } catch {}
    // Tell the sidebar the counts changed — App listens for this
    try { window.dispatchEvent(new CustomEvent('stats-refresh')) } catch {}
  }, [company.id])

  useEffect(() => { reload() }, [reload])

  async function findPeople() {
    setFindingPeople(true)
    setFindProgress(['Searching for decision makers…'])
    setFindResultMsg(null)
    try {
      const res = await fetch(api.jobs.findPeopleStream(company.id))
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let currentEvent = 'message'
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value)
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (line.startsWith('event:')) { currentEvent = line.slice(6).trim(); continue }
          if (!line.startsWith('data:')) continue
          try {
            const d = JSON.parse(line.slice(5))
            if (d.message) setFindProgress(p => [...p.slice(-4), d.message])
            if (currentEvent === 'source' && d.source) {
              setFindProgress(p => [...p.slice(-4), `${d.source}: ${d.status}${d.count != null ? ` (${d.count})` : ''}`])
            }
            if (currentEvent === 'complete') {
              setFindResultMsg({ ok: true, text: `+${d.added || 0} new LinkedIn contacts (${d.total || 0} found)` })
            }
          } catch {}
        }
      }
    } catch (err) {
      setFindResultMsg({ ok: false, text: err.message })
    }
    await reload()
    setFindingPeople(false)
  }

  async function findEmailsBulk() {
    setFindingEmailsBulk(true)
    setFindResultMsg(null)
    try {
      const r = await api.jobs.findEmails(company.id)
      setFindResultMsg({ ok: true, text: `+${r.added || 0} new emails from ${r.domain || 'domain'}${r.filteredOut ? ` (${r.filteredOut} non-tech filtered)` : ''}` })
    } catch (err) {
      setFindResultMsg({ ok: false, text: err.message })
    }
    await reload()
    setFindingEmailsBulk(false)
  }

  async function findEmailForContact(contactId) {
    setFindingEmail(m => ({ ...m, [contactId]: true }))
    try {
      const r = await api.jobs.findEmailForContact(contactId)
      if (r.email) {
        setContacts(prev => prev.map(c => c.id === contactId ? { ...c, email: r.email, email_status: r.email_status } : c))
        try { window.dispatchEvent(new CustomEvent('stats-refresh')) } catch {}
      } else {
        setFindResultMsg({ ok: false, text: r.message || 'No email found for this person' })
      }
    } catch (err) {
      setFindResultMsg({ ok: false, text: err.message })
    }
    setFindingEmail(m => ({ ...m, [contactId]: false }))
  }

  const emailStatusBadge = (status) => {
    if (status === 'verified') return { bg:'#f0fdf4', color:'#15803d', label:'✓ verified' }
    if (status === 'valid')    return { bg:'#eff6ff', color:'#2563eb', label:'valid' }
    if (status === 'risky')    return { bg:'#fefce8', color:'#ca8a04', label:'risky' }
    if (status === 'invalid')  return { bg:'#fef2f2', color:'#dc2626', label:'invalid' }
    return null
  }

  // Partition contacts. A person with BOTH email + LinkedIn shows up in all
  // three tabs (per user spec: "duplicates go in a common section too").
  const buckets = {
    both:     contacts.filter(c => !!c.email && !!c.linkedin_url),
    email:    contacts.filter(c => !!c.email),
    linkedin: contacts.filter(c => !!c.linkedin_url),
  }
  // Contacts with neither — surfaced under the Both tab so they're never hidden
  const orphans = contacts.filter(c => !c.email && !c.linkedin_url)
  const shown = section === 'email'    ? buckets.email
              : section === 'linkedin' ? buckets.linkedin
              : [...buckets.both, ...orphans]

  const sections = [
    { id: 'both',     label: '🔗 Both',      count: buckets.both.length,     hint: 'Email + LinkedIn' },
    { id: 'email',    label: '📧 Emails',    count: buckets.email.length,    hint: 'All with email' },
    { id: 'linkedin', label: '👤 LinkedIn',  count: buckets.linkedin.length, hint: 'All with LinkedIn' },
  ]

  const busy = findingPeople || findingEmailsBulk

  return (
    <div style={{ padding:'20px 32px', maxWidth:820 }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16, gap:12, flexWrap:'wrap' }}>
        <div>
          <h3 style={{ fontSize:16, fontWeight:800, color:'#0f172a', margin:0 }}>Decision Makers at {company.name}</h3>
          <p style={{ fontSize:12, color:'#64748b', margin:'4px 0 0' }}>
            {contacts.length} contact{contacts.length !== 1 ? 's' : ''} · {buckets.email.length + buckets.both.length} with email · {buckets.linkedin.length + buckets.both.length} with LinkedIn
          </p>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={findPeople} disabled={busy}
            style={{ padding:'9px 14px', background: busy ? '#f1f5f9' : '#eff6ff', color: busy ? '#94a3b8' : '#2563eb', border:'1px solid #bfdbfe', borderRadius:9, fontSize:12, fontWeight:700, cursor: busy ? 'default':'pointer', display:'flex', alignItems:'center', gap:6 }}>
            {findingPeople ? <Spin color="#2563eb" size={11} /> : '👤'} Find LinkedIn Users
          </button>
          <button onClick={findEmailsBulk} disabled={busy}
            style={{ padding:'9px 14px', background: busy ? '#f1f5f9' : '#f0fdf4', color: busy ? '#94a3b8' : '#16a34a', border:'1px solid #bbf7d0', borderRadius:9, fontSize:12, fontWeight:700, cursor: busy ? 'default':'pointer', display:'flex', alignItems:'center', gap:6 }}>
            {findingEmailsBulk ? <Spin color="#16a34a" size={11} /> : '📧'} Find Emails
          </button>
        </div>
      </div>

      {/* Sub-section tabs */}
      <div style={{ display:'flex', gap:6, marginBottom:16, borderBottom:'1px solid #e2e8f0', paddingBottom:1 }}>
        {sections.map(s => {
          const on = section === s.id
          return (
            <button key={s.id} onClick={() => setSection(s.id)}
              style={{ padding:'8px 14px', border:'none', borderBottom: on ? '2px solid #4f46e5' : '2px solid transparent', background:'transparent', color: on ? '#4f46e5' : '#64748b', fontSize:12, fontWeight:700, cursor:'pointer', marginBottom:-1, display:'flex', alignItems:'center', gap:6 }}>
              {s.label}
              <span style={{ fontSize:10, fontWeight:700, padding:'1px 7px', borderRadius:10, background: on ? '#eef2ff' : '#f1f5f9', color: on ? '#4f46e5' : '#94a3b8' }}>{s.count}</span>
            </button>
          )
        })}
      </div>

      {/* Progress log while a bulk find is running */}
      {findingPeople && findProgress.length > 0 && (
        <div style={{ marginBottom:16, padding:12, background:'#f8fafc', borderRadius:8, border:'1px solid #e2e8f0' }}>
          {findProgress.map((msg, i) => (
            <div key={i} style={{ fontSize:11, color:'#475569', marginBottom:2 }}>
              {i === findProgress.length - 1 ? '→ ' : '✓ '}{msg}
            </div>
          ))}
        </div>
      )}

      {findResultMsg && !busy && (
        <div style={{ marginBottom:12, padding:'8px 12px', borderRadius:8, fontSize:12, fontWeight:600,
          background: findResultMsg.ok ? '#f0fdf4' : '#fef2f2',
          color: findResultMsg.ok ? '#15803d' : '#dc2626',
          border: `1px solid ${findResultMsg.ok ? '#bbf7d0' : '#fecaca'}` }}>
          {findResultMsg.ok ? '✓' : '✗'} {findResultMsg.text}
        </div>
      )}

      {/* Empty state */}
      {shown.length === 0 && !busy && (
        <div style={{ textAlign:'center', padding:'40px 20px', background:'#f8fafc', borderRadius:12, border:'1px solid #e2e8f0' }}>
          <div style={{ fontSize:32, marginBottom:10 }}>
            {section === 'email' ? '📭' : section === 'linkedin' ? '👤' : '👥'}
          </div>
          <div style={{ fontSize:14, fontWeight:700, color:'#475569', marginBottom:6 }}>
            {section === 'email' ? 'No email-only contacts yet' : section === 'linkedin' ? 'No LinkedIn-only contacts yet' : 'No contacts yet'}
          </div>
          <div style={{ fontSize:12, color:'#94a3b8', marginBottom:16 }}>
            Use the buttons above to search for contacts.
          </div>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {shown.map(c => {
          const isOpen = openComposer === c.id
          const aColor = avatarColor(c.name)
          const badge = emailStatusBadge(c.email_status)
          const hasBoth = !!c.email && !!c.linkedin_url
          return (
            <div key={c.id}>
              <div className="cd-contact-card" style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'16px 18px' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                  <div style={{ width:40, height:40, borderRadius:9, background:aColor, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:15, fontWeight:800, flexShrink:0 }}>
                    {(c.name||'?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                      <span style={{ fontWeight:700, fontSize:14, color:'#0f172a' }}>{c.name}</span>
                      {hasBoth && (
                        <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, background:'#f5f3ff', color:'#7c3aed', border:'1px solid #ddd6fe' }}>
                          🔗 both
                        </span>
                      )}
                      {c.linkedin_url && (
                        <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                          style={{ fontSize:10, color:'#2563eb', textDecoration:'none', fontWeight:600 }}>LinkedIn →</a>
                      )}
                    </div>
                    {c.title && <div style={{ fontSize:12, color:'#64748b', marginBottom:6 }}>{c.title}</div>}
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      {c.email ? (
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ fontSize:12, color:'#0f172a', fontFamily:'monospace' }}>{c.email}</span>
                          {badge && (
                            <span style={{ fontSize:9, padding:'2px 6px', borderRadius:4, background:badge.bg, color:badge.color, fontWeight:700 }}>{badge.label}</span>
                          )}
                        </div>
                      ) : (
                        <button onClick={() => findEmailForContact(c.id)} disabled={findingEmail[c.id]}
                          className="cd-action-btn"
                          style={{ background:'#eff6ff', color:'#2563eb', border:'1px solid #bfdbfe', fontSize:11 }}>
                          {findingEmail[c.id] ? <><Spin color="#2563eb" size={10} /> Finding…</> : '✉ Find Email for this person'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                    <button onClick={() => setOpenComposer(isOpen ? null : c.id)}
                      style={{ padding:'7px 14px', background: isOpen ? '#4f46e5' : '#eff6ff', color: isOpen ? '#fff' : '#4f46e5', border:`1px solid ${isOpen ? '#4f46e5' : '#c7d2fe'}`, borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                      {isOpen ? '↑ Close' : section === 'linkedin' ? '✦ Write DM' : section === 'email' ? '✉ Write Email' : '✦ Write Outreach'}
                    </button>
                  </div>
                </div>
              </div>
              {isOpen && (
                <OutreachComposer contact={c} company={company} isYC={isYC} onClose={() => setOpenComposer(null)} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Job Scraper Tab ───────────────────────────────────────────────────────────
const INTERN_RE = /\binterns?\b|\binternships?\b|\bco-op\b|\bcoop\b|\bsummer 202[456]\b/i
const ROLE_FILTERS = [
  { label: 'All',    test: () => true },
  { label: 'Intern', test: r => INTERN_RE.test(r.title) },
  { label: 'SWE',    test: r => /software engineer|SWE|SDE|developer/i.test(r.title) && !/data|ml|ai|machine/i.test(r.title) },
  { label: 'Data',   test: r => /data|analyst|analytics|BI|business intel/i.test(r.title) },
  { label: 'AI/ML',  test: r => /ai|ml|machine learning|deep learning|nlp|llm/i.test(r.title) },
  { label: 'Other',  test: r => !INTERN_RE.test(r.title) && !/software engineer|SWE|SDE|developer|data|analyst|analytics|BI|ai|ml|machine learning|deep learning|nlp|llm/i.test(r.title) },
]

function JobScraperTab({ company, onTabSwitch }) {
  const [roles, setRoles]     = useState([])
  const [loading, setLoading] = useState(false)
  const [tracking, setTracking] = useState(null)
  const [scrapeResult, setScrapeResult] = useState(null)
  const [activeFilter, setActiveFilter] = useState('All')
  const [sortOrder, setSortOrder] = useState('newest')
  const [careersPageUrl, setCareersPageUrl] = useState(null)
  const [manualUrlInput, setManualUrlInput] = useState('')
  const [savingUrl, setSavingUrl]           = useState(false)
  const [scrapingType, setScrapingType] = useState(null) // Track which scrape is running (intern, fulltime, or null)
  // Multi-select for "Send selected to Auto-Apply" — keyed by role id.
  const [selected, setSelected]   = useState(new Set())
  const [bulkBusy, setBulkBusy]   = useState(false)
  const [bulkMsg, setBulkMsg]     = useState(null)

  useEffect(() => {
    setLoading(true)
    api.jobs.roles(company.id).then(setRoles).catch(() => {}).finally(() => setLoading(false))
    api.jobs.careersUrl(company.id).then(r => { if (r.url) setCareersPageUrl(r.url) }).catch(() => {})
  }, [company.id])

  async function scrapeRoles(roleType = 'intern') {
    setScrapingType(roleType); setScrapeResult(null)
    try {
      const r = await api.jobs.scrapeRoles(company.id, roleType)
      setRoles(r.roles || [])
      if (r.careersPageUrl) setCareersPageUrl(r.careersPageUrl)
      const typeLabel = roleType === 'fulltime' ? 'full-time/new-grad' : 'intern'
      // Auto-queue the freshly scraped roles for auto-apply — every scrape
      // implicitly updates the auto-apply queue, so the user doesn't have to
      // remember to click a separate Queue button after each scrape.
      let queuedSummary = null
      try {
        const q = await api.career.autoApplyCompanyQueue(company.id, { roleType })
        queuedSummary = q
      } catch (qerr) {
        console.warn('[scrapeRoles] auto-queue failed (non-fatal):', qerr.message)
      }
      setScrapeResult({
        ok: true,
        added: r.added,
        found: r.found,
        careersPageUrl: r.careersPageUrl,
        typeLabel,
        message: r.added === 0
          ? `✓ No ${typeLabel} roles found — try the Careers Page link`
          : `✓ ${r.added} ${typeLabel} role${r.added !== 1 ? 's' : ''} scraped${queuedSummary && queuedSummary.queued > 0 ? ` · ${queuedSummary.queued} queued for auto-apply${queuedSummary.skippedAlreadyInFlight ? ` (${queuedSummary.skippedAlreadyInFlight} already in queue)` : ''}` : ''}`,
      })
    } catch (err) {
      setScrapeResult({ ok: false, error: err.message })
    }
    setScrapingType(null)
  }

  async function saveManualUrl() {
    const url = manualUrlInput.trim()
    if (!url) return
    setSavingUrl(true)
    try {
      await api.jobs.updateUrl(company.id, url)
      setCareersPageUrl(url)
      setManualUrlInput('')
      setScrapeResult({ ok: true, added: 0, found: roles.length, message: `✓ Careers URL saved — click Scrape to find roles` })
    } catch (err) {
      setScrapeResult({ ok: false, error: err.message })
    }
    setSavingUrl(false)
  }

  // Multi-select helpers — toggleable checkboxes per role row, plus a
  // bulk Queue Selected for Auto-Apply action that flips matching role
  // ids into the auto-apply queue in one round-trip.
  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function selectAllVisible(roleIds) {
    setSelected(new Set(roleIds))
  }
  function clearSelection() { setSelected(new Set()) }

  async function queueSelected() {
    if (selected.size === 0) return
    setBulkBusy(true); setBulkMsg(null)
    try {
      const ids = [...selected]
      const r = await api.career.autoApplyCompanyQueue(company.id, { roleIds: ids })
      const queued  = r?.queued ?? 0
      const skipped = r?.skippedAlreadyInFlight ?? 0
      setBulkMsg({ ok: true, text: `✓ Sent ${queued} role${queued === 1 ? '' : 's'} to Auto-Apply${skipped > 0 ? ` · ${skipped} already queued` : ''} — review & run them in the Job Automation tab.` })
      setSelected(new Set())
    } catch (err) {
      setBulkMsg({ ok: false, text: err.message || 'Queue failed' })
    }
    setBulkBusy(false)
    setTimeout(() => setBulkMsg(null), 6000)
  }

  async function trackRole(role) {
    setTracking(role.id)
    try {
      await api.career.updateCompany(company.id, {
        job_title: role.title,
        job_url: role.apply_url || null,
        job_source: SOURCE_LABELS[role.source] || role.source || 'Job Scraper',
      })
      // Check if resume already uploaded (per-company OR global) — if so, signal auto-analyze on tab switch
      let hasResume = false
      try {
        const [appData, globalResume] = await Promise.all([
          api.career.getCompany(company.id),
          api.career.resume().catch(() => ({})),
        ])
        hasResume = !!appData?.resume_original_name || !!globalResume?.hasResume
      } catch (_) {}

      const msg = hasResume
        ? `✓ "${role.title}" tracked — analyzing fit…`
        : `✓ "${role.title}" tracked — upload resume in Career Ops to get your fit score`
      setScrapeResult({ ok: true, added: 0, found: roles.length, message: msg })
      setTimeout(() => onTabSwitch?.('career-ops', { analyze: hasResume }), 700)
    } catch (err) {
      setScrapeResult({ ok: false, error: err.message })
    }
    setTracking(null)
  }

  const SOURCE_LABELS = { greenhouse:'Greenhouse', lever:'Lever', linkedin:'LinkedIn', workatastartup:'WaaS', google:'Google' }

  const filterFn = ROLE_FILTERS.find(f => f.label === activeFilter)?.test || (() => true)
  const displayedRoles = [...roles]
    .filter(filterFn)
    .sort((a, b) => {
      if (sortOrder === 'az') return a.title.localeCompare(b.title)
      if (sortOrder === 'oldest') return (a.posted_at || '') < (b.posted_at || '') ? -1 : 1
      // newest first (default) — null posted_at goes to bottom
      if (!a.posted_at && !b.posted_at) return 0
      if (!a.posted_at) return 1
      if (!b.posted_at) return -1
      return a.posted_at < b.posted_at ? 1 : -1
    })

  return (
    <div style={{ padding:'24px 32px', maxWidth:1000 }}>
      {/* Header section */}
      <div style={{ marginBottom:28 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:20, marginBottom:16 }}>
          <div>
            <h3 style={{ fontSize:18, fontWeight:800, color:'#0f172a', margin:0 }}>Open Roles at {company.name}</h3>
            <p style={{ fontSize:13, color:'#64748b', margin:'6px 0 0' }}>
              Scrape intern and full-time positions from company job boards
            </p>
          </div>
          {(careersPageUrl || company.url || company.domain) && (() => {
            let href = careersPageUrl || ''
            if (!href) {
              let base = company.url || ''
              if (!base && company.domain) base = `https://${company.domain}/careers`
              if (base && !base.startsWith('http')) base = `https://${base}`
              try {
                const u = new URL(base)
                const segments = u.pathname.split('/').filter(Boolean)
                const PORTAL_ROOTS = {
                  'jobs.apple.com':         '/en-us/search?search=intern',
                  'careers.google.com':     '/jobs/results/?q=intern&target_level=INTERN',
                  'amazon.jobs':            '/en/search?base_query=intern',
                  'metacareers.com':        '/jobs/?q=intern',
                  'www.metacareers.com':    '/jobs/?q=intern',
                  'careers.microsoft.com':  '/us/en/search-results?keywords=intern',
                  'jobs.netflix.com':       '/search?q=intern',
                }
                const portal = PORTAL_ROOTS[u.hostname]
                if (portal) {
                  href = `${u.origin}${portal}`
                } else {
                  const looksLikeRoleUrl = segments.length > 1 || /job[-_ ]?id|requisition|\/details\/|\/view\//i.test(base) || /\d{5,}/.test(base)
                  if (looksLikeRoleUrl) href = `${u.origin}/careers`
                  else if (/careers|jobs/i.test(base)) href = base
                  else href = `${u.origin}/careers`
                }
              } catch {
                href = base
              }
            }
            return (
              <a href={href} target="_blank" rel="noreferrer"
                style={{ padding:'9px 16px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, fontWeight:700, color:'#475569', textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}>
                🏢 Careers Page
              </a>
            )
          })()}
        </div>

        {/* Scrape buttons - side by side */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <button onClick={() => scrapeRoles('intern')} disabled={scrapingType !== null}
            style={{ padding:'11px 16px', background: scrapingType === 'intern' ? '#e0e7ff' : 'linear-gradient(135deg,#6366f1,#7c3aed)', color: scrapingType === 'intern' ? '#4f46e5' : '#fff', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor: scrapingType !== null ? 'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'all 0.2s' }}>
            {scrapingType === 'intern' ? <><Spin color="#4f46e5" size={16} /> Scraping…</> : '🎓 Scrape Intern Roles'}
          </button>
          <button onClick={() => scrapeRoles('fulltime')} disabled={scrapingType !== null}
            style={{ padding:'11px 16px', background: scrapingType === 'fulltime' ? '#d1fae5' : 'linear-gradient(135deg,#059669,#10b981)', color: scrapingType === 'fulltime' ? '#047857' : '#fff', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor: scrapingType !== null ? 'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'all 0.2s' }}>
            {scrapingType === 'fulltime' ? <><Spin color="#047857" size={16} /> Scraping…</> : '💼 Scrape Full-Time/New Grad'}
          </button>
        </div>

        {/* Manual careers URL override — for when auto-scraper can't find the right page */}
        <div style={{ marginTop:10, display:'flex', gap:8, alignItems:'center' }}>
          <input
            value={manualUrlInput}
            onChange={e => setManualUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveManualUrl()}
            placeholder={careersPageUrl ? `Current: ${careersPageUrl.slice(0, 60)}…` : 'Paste careers URL if scraper can\'t find it…'}
            style={{ flex:1, padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, color:'#0f172a', outline:'none' }}
          />
          <button onClick={saveManualUrl} disabled={savingUrl || !manualUrlInput.trim()}
            style={{ padding:'8px 14px', borderRadius:8, border:'none', background: manualUrlInput.trim() ? '#6366f1' : '#e2e8f0', color: manualUrlInput.trim() ? '#fff' : '#94a3b8', fontSize:12, fontWeight:700, cursor: manualUrlInput.trim() ? 'pointer' : 'default', whiteSpace:'nowrap' }}>
            {savingUrl ? 'Saving…' : '💾 Set URL'}
          </button>
        </div>

        {/* Auto-apply moved to the Job Automation tab. From here you scrape and
            select roles; select roles below to send them over to auto-apply. */}
      </div>

      {scrapeResult && (
        <div style={{ marginBottom:16, padding:12, borderRadius:8, background: scrapeResult.ok ? '#f0fdf4' : '#fef2f2', border:`1px solid ${scrapeResult.ok ? '#bbf7d0' : '#fecaca'}` }}>
          <span style={{ fontSize:12, fontWeight:600, color: scrapeResult.ok ? '#15803d' : '#dc2626' }}>
            {scrapeResult.ok
              ? (scrapeResult.message || (
                  scrapeResult.added === 0
                    ? `✓ No ${scrapeResult.typeLabel || 'intern'} roles found — try the Careers Page link`
                    : `✓ ${scrapeResult.added} ${scrapeResult.typeLabel || 'intern'} role${scrapeResult.added !== 1 ? 's' : ''} scraped`
                ))
              : `✗ ${scrapeResult.error}`}
          </span>
        </div>
      )}

      {/* Filter + Sort bar — pill row for filters and a matching pill-shaped
          sort selector. Wraps to multiple lines on narrow viewports without
          breaking the visual rhythm. */}
      {!loading && roles.length > 0 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:16, padding:'12px 0', borderBottom:'1px solid #f1f5f9', flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            {ROLE_FILTERS.map(f => (
              <button key={f.label} onClick={() => setActiveFilter(f.label)}
                style={{
                  padding:'6px 14px', borderRadius:20, fontSize:12, fontWeight:700,
                  cursor:'pointer', transition:'all 0.15s', whiteSpace:'nowrap',
                  border:'1px solid',
                  borderColor: activeFilter === f.label ? '#6366f1' : '#e2e8f0',
                  background:  activeFilter === f.label ? '#6366f1' : '#fff',
                  color:       activeFilter === f.label ? '#fff'    : '#64748b',
                }}>
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ minWidth:140 }}>
            <Dropdown
              ariaLabel="Sort roles"
              value={sortOrder}
              onChange={setSortOrder}
              options={[
                { value:'newest', label:'Newest first' },
                { value:'oldest', label:'Oldest first' },
                { value:'az',     label:'A → Z' },
              ]}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', paddingTop:40 }}><Spin size={28} /></div>
      ) : roles.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px 28px', background:'#f8fafc', borderRadius:12, border:'1px solid #e2e8f0' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
          <div style={{ fontSize:15, fontWeight:800, color:'#0f172a', marginBottom:6 }}>
            {scrapeResult ? 'No roles found' : 'No roles scraped yet'}
          </div>
          <div style={{ fontSize:13, color:'#64748b', marginBottom:24, maxWidth:400, margin:'0 auto' }}>
            {scrapeResult
              ? 'Try searching their careers page directly or check back later — they may not be hiring right now.'
              : 'Search Greenhouse, Lever, and the company careers page for open positions'}
          </div>
          <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' }}>
            <button onClick={() => scrapeRoles('intern')} style={{ padding:'11px 24px', background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', transition:'all 0.15s', boxShadow:'0 2px 8px rgba(99,102,241,0.2)' }} onMouseEnter={e => e.target.style.boxShadow='0 4px 12px rgba(99,102,241,0.3)'} onMouseLeave={e => e.target.style.boxShadow='0 2px 8px rgba(99,102,241,0.2)'}>
              🎓 Scrape Intern Roles
            </button>
            <button onClick={() => scrapeRoles('fulltime')} style={{ padding:'11px 24px', background:'linear-gradient(135deg,#059669,#10b981)', color:'#fff', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', transition:'all 0.15s', boxShadow:'0 2px 8px rgba(5,150,105,0.2)' }} onMouseEnter={e => e.target.style.boxShadow='0 4px 12px rgba(5,150,105,0.3)'} onMouseLeave={e => e.target.style.boxShadow='0 2px 8px rgba(5,150,105,0.2)'}>
              💼 Scrape Full-Time/New Grad
            </button>
            {(careersPageUrl || scrapeResult?.careersPageUrl) && (
              <a href={careersPageUrl || scrapeResult.careersPageUrl} target="_blank" rel="noreferrer"
                style={{ padding:'11px 24px', background:'#fff', color:'#475569', border:'1px solid #e2e8f0', borderRadius:10, fontSize:13, fontWeight:700, textDecoration:'none', transition:'all 0.15s' }} onMouseEnter={e => { e.currentTarget.style.borderColor='#cbd5e1'; e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)' }} onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.boxShadow='none' }}>
                🏢 Visit Careers Page
              </a>
            )}
          </div>
        </div>
      ) : displayedRoles.length === 0 ? (
        <div style={{ textAlign:'center', padding:'30px 20px', background:'#f8fafc', borderRadius:12, border:'1px solid #e2e8f0' }}>
          <div style={{ fontSize:13, color:'#94a3b8' }}>No roles match the "{activeFilter}" filter</div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          {/* Multi-select bulk action header — only renders when there are
              roles with apply_urls to queue. */}
          {(() => {
            const queueable = displayedRoles.filter(r => r.apply_url)
            if (queueable.length === 0) return null
            const allSelected = queueable.length > 0 && queueable.every(r => selected.has(r.id))
            return (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, padding:'10px 14px', background: selected.size > 0 ? '#eef2ff' : '#f8fafc', border:`1px solid ${selected.size > 0 ? '#a5b4fc' : '#e2e8f0'}`, borderRadius:10, transition:'all 0.12s' }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#475569' }}>
                  {selected.size > 0 ? `${selected.size} selected` : 'Select roles to send to Auto-Apply (run them in Job Automation)'}
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  <button onClick={() => allSelected ? clearSelection() : selectAllVisible(queueable.map(r => r.id))}
                    style={{ padding:'5px 11px', fontSize:11, fontWeight:600, background:'#fff', color:'#4f46e5', border:'1px solid #c7d2fe', borderRadius:7, cursor:'pointer' }}>
                    {allSelected ? 'Clear' : `Select all (${queueable.length})`}
                  </button>
                  <button onClick={queueSelected} disabled={!selected.size || bulkBusy}
                    style={{ padding:'7px 14px', fontSize:12, fontWeight:700, background: selected.size ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#f1f5f9', color: selected.size ? '#fff' : '#94a3b8', border:'none', borderRadius:8, cursor: selected.size && !bulkBusy ? 'pointer' : 'default', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}>
                    {bulkBusy ? 'Sending…' : `⚡ Send ${selected.size || ''} to Auto-Apply`}
                  </button>
                </div>
              </div>
            )
          })()}
          {bulkMsg && (
            <div style={{ padding:'10px 14px', background: bulkMsg.ok ? '#dcfce7' : '#fee2e2', color: bulkMsg.ok ? '#15803d' : '#991b1b', borderRadius:8, fontSize:12, fontWeight:600 }}>
              {bulkMsg.text}
            </div>
          )}

          {/* Intern Roles Section */}
          {displayedRoles.filter(r => r.role_type === 'intern').length > 0 && (
            <div>
              <h4 style={{ fontSize:13, fontWeight:800, color:'#1f2937', marginBottom:14, paddingBottom:10, borderBottom:'2px solid #6366f1', textTransform:'uppercase', letterSpacing:'0.05em' }}>🎓 Intern Roles ({displayedRoles.filter(r => r.role_type === 'intern').length})</h4>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {displayedRoles.filter(r => r.role_type === 'intern').map(r => (
            <div key={r.id} className="cd-role-card" style={{ background: selected.has(r.id) ? '#eef2ff' : '#fff', border:`1px solid ${selected.has(r.id) ? '#a5b4fc' : '#e2e8f0'}`, borderRadius:10, padding:'14px 18px', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', transition:'all 0.15s', cursor:'default' }} onMouseEnter={e => { if (!selected.has(r.id)) { e.currentTarget.style.borderColor='#cbd5e1'; e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.05)' } }} onMouseLeave={e => { if (!selected.has(r.id)) { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.boxShadow='none' } }}>
              {r.apply_url && (
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)}
                  style={{ width:18, height:18, cursor:'pointer', accentColor:'#7c3aed', flexShrink:0 }} />
              )}
              <div style={{ flex:'1 1 200px', minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:14, color:'#0f172a', marginBottom:3 }}>{r.title}</div>
                <div style={{ fontSize:11, color:'#64748b', display:'flex', flexWrap:'wrap', gap:10, alignItems:'center' }}>
                  {r.location && <span>📍 {r.location}</span>}
                  {r.posted_at && <span>{timeAgo(r.posted_at)}</span>}
                  {r.source && <span style={{ padding:'2px 7px', background:'#f1f5f9', borderRadius:4, fontSize:10, fontWeight:600, color:'#475569' }}>{SOURCE_LABELS[r.source] || r.source}</span>}
                </div>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                {r.apply_url && (
                  <a href={r.apply_url} target="_blank" rel="noreferrer"
                    style={{ padding:'7px 16px', background:'#eff6ff', color:'#2563eb', border:'1px solid #bfdbfe', borderRadius:8, fontSize:12, fontWeight:700, textDecoration:'none', whiteSpace:'nowrap', transition:'all 0.15s' }}>
                    Apply →
                  </a>
                )}
                <button onClick={() => trackRole(r)} disabled={tracking === r.id}
                  style={{ padding:'7px 16px', background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe', borderRadius:8, fontSize:12, fontWeight:700, cursor: tracking === r.id ? 'default' : 'pointer', whiteSpace:'nowrap', transition:'all 0.15s' }}>
                  {tracking === r.id ? 'Tracking…' : '+ Track'}
                </button>
              </div>
            </div>
                ))}
              </div>
            </div>
          )}

          {/* Full-Time/New Grad Roles Section */}
          {displayedRoles.filter(r => r.role_type === 'fulltime').length > 0 && (
            <div>
              <h4 style={{ fontSize:13, fontWeight:800, color:'#1f2937', marginBottom:14, paddingBottom:10, borderBottom:'2px solid #10b981', textTransform:'uppercase', letterSpacing:'0.05em' }}>💼 Full-Time & New Grad Roles ({displayedRoles.filter(r => r.role_type === 'fulltime').length})</h4>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {displayedRoles.filter(r => r.role_type === 'fulltime').map(r => (
            <div key={r.id} className="cd-role-card" style={{ background: selected.has(r.id) ? '#eef2ff' : '#fff', border:`1px solid ${selected.has(r.id) ? '#a5b4fc' : '#d1d5db'}`, borderRadius:10, padding:'14px 18px', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', transition:'all 0.15s', cursor:'default' }} onMouseEnter={e => { if (!selected.has(r.id)) { e.currentTarget.style.borderColor='#b4b8bf'; e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.05)' } }} onMouseLeave={e => { if (!selected.has(r.id)) { e.currentTarget.style.borderColor='#d1d5db'; e.currentTarget.style.boxShadow='none' } }}>
              {r.apply_url && (
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)}
                  style={{ width:18, height:18, cursor:'pointer', accentColor:'#7c3aed', flexShrink:0 }} />
              )}
              <div style={{ flex:'1 1 200px', minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:14, color:'#0f172a', marginBottom:3 }}>{r.title}</div>
                <div style={{ fontSize:11, color:'#64748b', display:'flex', flexWrap:'wrap', gap:10, alignItems:'center' }}>
                  {r.location && <span>📍 {r.location}</span>}
                  {r.posted_at && <span>{timeAgo(r.posted_at)}</span>}
                  {r.source && <span style={{ padding:'2px 7px', background:'#f1f5f9', borderRadius:4, fontSize:10, fontWeight:600, color:'#475569' }}>{SOURCE_LABELS[r.source] || r.source}</span>}
                </div>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                {r.apply_url && (
                  <a href={r.apply_url} target="_blank" rel="noreferrer"
                    style={{ padding:'7px 16px', background:'#ecfdf5', color:'#059669', border:'1px solid #a7f3d0', borderRadius:8, fontSize:12, fontWeight:700, textDecoration:'none', whiteSpace:'nowrap', transition:'all 0.15s' }}>
                    Apply →
                  </a>
                )}
                <button onClick={() => trackRole(r)} disabled={tracking === r.id}
                  style={{ padding:'7px 16px', background:'#f0f9ff', color:'#0369a1', border:'1px solid #bae6fd', borderRadius:8, fontSize:12, fontWeight:700, cursor: tracking === r.id ? 'default' : 'pointer', whiteSpace:'nowrap', transition:'all 0.15s' }}>
                  {tracking === r.id ? 'Tracking…' : '+ Track'}
                </button>
              </div>
            </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fallback links */}
      <div style={{ marginTop:28, padding:'20px 24px', background:'#fff', borderRadius:12, border:'1px solid #e2e8f0' }}>
        <div style={{ fontSize:12, fontWeight:800, color:'#0f172a', marginBottom:14, textTransform:'uppercase', letterSpacing:'0.05em' }}>Search Manually</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {[
            { label:'LinkedIn Jobs', url:`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(company.name + ' intern')}` },
            { label:'Google Jobs', url:`https://www.google.com/search?q=${encodeURIComponent('"'+company.name+'" intern 2026 site:greenhouse.io OR site:lever.co')}` },
            { label:'Greenhouse', url:`https://boards.greenhouse.io/${company.name.toLowerCase().replace(/\s+/g,'')}` },
            { label:'Lever', url:`https://jobs.lever.co/${company.name.toLowerCase().replace(/\s+/g,'')}` },
            { label:'💰 Salaries on Levels.fyi', url:`https://www.levels.fyi/companies/${company.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}/salaries` },
            { label:'💰 Salaries on Glassdoor',  url:`https://www.glassdoor.com/Salaries/${encodeURIComponent(company.name)}-salaries-SRCH.htm` },
          ].map(l => (
            <a key={l.label} href={l.url} target="_blank" rel="noreferrer"
              style={{ padding:'10px 14px', background:'#f8fafc', color:'#475569', border:'1px solid #e2e8f0', borderRadius:9, fontSize:12, fontWeight:600, textDecoration:'none', transition:'all 0.15s', display:'flex', alignItems:'center', justifyContent:'center' }} onMouseEnter={e => { e.currentTarget.style.borderColor='#cbd5e1'; e.currentTarget.style.background='#f1f5f9'; e.currentTarget.style.boxShadow='0 2px 6px rgba(0,0,0,0.05)' }} onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.background='#f8fafc'; e.currentTarget.style.boxShadow='none' }}>
              {l.label} →
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Job Automation Tab ────────────────────────────────────────────────────────
// Lightweight platform detection — mirrors backend services/resumeRegistry.js.
function detectPlatformClient(url = '') {
  const u = url.toLowerCase()
  if (!u) return 'unknown'
  if (u.includes('greenhouse.io') || u.includes('boards.greenhouse.io')) return 'greenhouse'
  if (u.includes('lever.co'))        return 'lever'
  if (u.includes('ashbyhq.com'))     return 'ashby'
  if (u.includes('myworkdayjobs.com') || u.includes('workday.com')) return 'workday'
  if (u.includes('linkedin.com/jobs')) return 'linkedin'
  if (u.includes('jobs.apple.com')) return 'apple'
  if (u.includes('amazon.jobs')) return 'amazon'
  return 'unknown'
}

const SUPPORTED_AUTO = new Set(['greenhouse', 'lever', 'ashby'])

function AutoApplyRoleRow({ role, company, preview, onApplied, profileComplete, selected = false, onToggleSelect }) {
  const [mode, setMode] = useState('manual') // manual | auto
  const [running, setRunning] = useState(false)
  const [result, setResult]   = useState(null)
  const platform = detectPlatformClient(role.apply_url || '')
  const canAuto  = SUPPORTED_AUTO.has(platform) && profileComplete

  async function handleApply() {
    if (!role.apply_url) return
    if (mode === 'manual') {
      window.open(role.apply_url, '_blank', 'noopener,noreferrer')
      return
    }
    if (!profileComplete) {
      alert('⚠️ Profile incomplete. Please fill in Name, Email, Phone, and LinkedIn in the Profile & Resumes section above.')
      return
    }
    setRunning(true); setResult(null)
    try {
      const r = await api.career.autoApplyDirect({
        jobUrl: role.apply_url,
        companyName: company.name,
        jobTitle: role.title,
      })
      setResult(r)
      if (r.ok) onApplied?.()
    } catch (err) {
      setResult({ ok: false, error: err.message })
    }
    setRunning(false)
  }

  const statusColor =
    result?.ok ? '#15803d'
    : result?.apply_status === 'captcha_needed' || result?.apply_status === 'login_needed' ? '#d97706'
    : result?.apply_status === 'platform_unsupported' ? '#64748b'
    : result?.error ? '#dc2626' : '#0f172a'

  return (
    <div style={{ padding:'12px 14px', background: selected ? '#eef2ff' : '#fff', border:`1px solid ${selected ? '#a5b4fc' : '#e2e8f0'}`, borderRadius:10, marginBottom:8, transition:'all 0.12s' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        {onToggleSelect && (
          <input type="checkbox" checked={selected} onChange={onToggleSelect}
            style={{ width:18, height:18, cursor:'pointer', accentColor:'#7c3aed', flexShrink:0 }} />
        )}
        <div style={{ flex:'1 1 180px', minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{role.title}</div>
          <div style={{ fontSize:11, color:'#64748b', display:'flex', alignItems:'center', gap:8, marginTop:2 }}>
            <span style={{ padding:'2px 8px', borderRadius:6, background: canAuto ? '#f0fdf4' : '#f8fafc', color: canAuto ? '#15803d' : '#94a3b8', fontWeight:700, fontSize:10 }}>
              {platform}{canAuto ? ' ✓' : ''}
            </span>
            {role.location && <span>📍 {role.location}</span>}
          </div>
        </div>

        <div style={{ display:'inline-flex', background:'#f1f5f9', borderRadius:8, padding:2 }}>
          {['manual','auto'].map(k => {
            const disabled = k === 'auto' && !canAuto;
            const title = k === 'auto' && !canAuto
              ? (!SUPPORTED_AUTO.has(platform) ? `Auto-apply not supported for ${platform}` : 'Complete your profile to enable auto-apply')
              : '';
            return (
              <button key={k} onClick={() => setMode(k)} disabled={disabled}
                title={title}
                style={{ padding:'5px 12px', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor: disabled ? 'not-allowed' : 'pointer',
                  background: mode === k ? '#fff' : 'transparent',
                  color: mode === k ? (k === 'auto' ? '#7c3aed' : '#4f46e5') : '#94a3b8',
                  opacity: disabled ? 0.4 : 1 }}>
                {k === 'manual' ? '👤 Manual' : '⚡ Auto'}
              </button>
            )
          })}
        </div>

        <button onClick={handleApply} disabled={running || !role.apply_url}
          style={{ padding:'7px 16px', background: running ? '#f1f5f9' : (mode === 'auto' ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : 'linear-gradient(135deg,#6366f1,#4f46e5)'),
            color: running ? '#64748b' : '#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor: running ? 'default' : 'pointer', whiteSpace:'nowrap',
            display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          {running ? <><Spin size={12} color="#64748b" /> Running…</> : (mode === 'auto' ? '⚡ Auto apply' : '↗ Open & apply')}
        </button>
      </div>

      {preview && (
        <div style={{ marginTop:8, padding:'7px 10px', borderRadius:6, fontSize:11,
          background: preview.source === 'tailored' ? '#f0fdf4'
                    : preview.source === 'tailored-pending' ? '#f5f3ff'
                    : '#fef3c7',
          color: preview.source === 'tailored' ? '#15803d'
               : preview.source === 'tailored-pending' ? '#7c3aed'
               : '#92400e',
          border: `1px solid ${preview.source === 'tailored' ? '#bbf7d0' : preview.source === 'tailored-pending' ? '#ddd6fe' : '#fde68a'}` }}>
          {preview.source === 'tailored' ? '📎 ' : preview.source === 'tailored-pending' ? '⚡ ' : '⚠ '}
          {preview.label}
        </div>
      )}

      {result && (
        <div style={{ marginTop:8, padding:'8px 10px', borderRadius:6, fontSize:11, background:'#f8fafc', color: statusColor }}>
          <strong>{result.apply_status || (result.ok ? 'submitted' : 'failed')}</strong>
          {result.apply_resume_used && ` · resume: ${result.apply_resume_used}`}
          {result.error && ` · ${result.error}`}
        </div>
      )}
    </div>
  )
}

function JobAutomationTab({ company, roles }) {
  const navigate = useNavigate()
  const [cover, setCover]       = useState({ subject:'', body:'' })
  const [roleTitle, setRoleTitle] = useState('')
  const [extraCtx, setExtraCtx] = useState('')
  const [loading, setLoading]   = useState(false)
  const [copied, copy]          = useCopy()
  // Profile/resume status only — the full editor lives on the Auto-Apply Setup
  // page (/apply/auto-apply); we just link out so this tab stays focused on
  // selecting roles and running auto-apply.
  const [profileMeta, setProfileMeta] = useState({ hasProfile: false, resumeCount: 0 })
  const [resumePreviews, setResumePreviews] = useState({}) // { [jobUrl]: { source, label, ... } }
  // Multi-select for queueing several roles to auto-apply at once.
  const [selected, setSelected] = useState(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMsg, setBulkMsg]   = useState(null)
  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  async function queueSelected() {
    if (selected.size === 0) return
    setBulkBusy(true); setBulkMsg(null)
    try {
      const r = await api.career.autoApplyCompanyQueue(company.id, { roleIds: [...selected] })
      const queued  = r?.queued ?? 0
      const skipped = r?.skippedAlreadyInFlight ?? 0
      setBulkMsg({ ok: true, text: `✓ Queued ${queued} role${queued === 1 ? '' : 's'} for auto-apply${skipped > 0 ? ` · ${skipped} already in queue` : ''}` })
      setSelected(new Set())
    } catch (err) {
      setBulkMsg({ ok: false, text: err.message || 'Queue failed' })
    }
    setBulkBusy(false)
    setTimeout(() => setBulkMsg(null), 6000)
  }

  useEffect(() => {
    (async () => {
      try {
        const [p, lib] = await Promise.all([api.career.profile(), api.career.resumesLibrary()])
        const hasProfile = !!(p?.first_name && p?.email)
        setProfileMeta({ hasProfile, resumeCount: (lib?.resumes || []).length })
      } catch (_) {}
    })()
  }, [])

  // Pre-fetch resume previews so each role row shows whether it'll use a
  // tailored PDF (from Career Ops) or fall back to the common-resumes folder.
  useEffect(() => {
    const urls = (roles || []).map(r => r.apply_url).filter(Boolean)
    if (urls.length === 0) return
    let cancelled = false
    api.career.autoApplyResumePreview(urls)
      .then(r => { if (!cancelled) setResumePreviews(r.previews || {}) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [roles])

  async function generateCover() {
    setLoading(true)
    try {
      const r = await api.generate.coverLetter({ companyId: company.id, roleTitle, extraContext: extraCtx })
      setCover({ subject: r.subject || '', body: r.body || '' })
    } catch (err) { setCover({ subject:'', body:`Error: ${err.message}` }) }
    setLoading(false)
  }

  const scrapedRoles = (roles || []).filter(r => r.apply_url)

  return (
    <div style={{ padding:'20px 32px', maxWidth:820 }}>
      <div style={{ marginBottom:20 }}>
        <h3 style={{ fontSize:16, fontWeight:800, color:'#0f172a', margin:0 }}>Auto-Apply for {company.name}</h3>
        <p style={{ fontSize:12, color:'#64748b', margin:'4px 0 0' }}>
          Toggle <strong>⚡ Auto</strong> on a role to let the Playwright worker fill and submit the form with your profile + the right resume. Supported platforms: Greenhouse, Lever, Ashby.
        </p>
      </div>

      {/* Profile & resumes status — the full editor lives on the Auto-Apply
          Setup page; this is just a status chip + link so the tab stays focused
          on roles and auto-apply (no embedded bio form). */}
      <button onClick={() => navigate('/apply/auto-apply')}
        style={{ width:'100%', textAlign:'left', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'13px 16px', marginBottom:20, background: profileMeta.hasProfile ? '#fff' : '#fffbeb', border:`1px solid ${profileMeta.hasProfile ? '#e2e8f0' : '#fde68a'}`, borderRadius:12, cursor:'pointer' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:16 }}>⚙</span>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>Profile & Resumes</div>
            <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
              {profileMeta.hasProfile
                ? <>✓ Profile ready · <strong>{profileMeta.resumeCount}</strong> resume{profileMeta.resumeCount !== 1 ? 's' : ''} · used to auto-fill applications</>
                : <span style={{ color:'#d97706', fontWeight:700 }}>⚠ Profile incomplete — set up name, email, phone & resume before auto-applying</span>}
            </div>
          </div>
        </div>
        <span style={{ fontSize:12, fontWeight:700, color:'#6366f1', whiteSpace:'nowrap' }}>
          {profileMeta.hasProfile ? 'Edit in Setup →' : 'Set up →'}
        </span>
      </button>

      {scrapedRoles.length === 0 ? (
        <div style={{ padding:20, background:'#fef3c7', borderRadius:12, border:'1px solid #fde68a', marginBottom:24 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#92400e', marginBottom:4 }}>No roles scraped yet</div>
          <div style={{ fontSize:12, color:'#92400e' }}>Go to the <strong>Job Scraper</strong> tab and click <strong>🎓 Intern Roles</strong> or <strong>💼 Full-Time/New Grad</strong> to discover open positions.</div>
        </div>
      ) : (
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>
            {scrapedRoles.length} open role{scrapedRoles.length !== 1 ? 's' : ''}
          </div>
          {!profileMeta.hasProfile && (
            <div style={{ marginBottom:12, padding:'10px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, fontSize:11, color:'#dc2626', fontWeight:600 }}>
              ⚠️ <strong>Profile incomplete:</strong> Fill in Name, Email, Phone, and LinkedIn in the Profile & Resumes section above to enable auto-apply.
            </div>
          )}

          {/* Multi-select bulk queue */}
          {scrapedRoles.length > 0 && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, padding:'10px 14px', marginBottom:12, background: selected.size > 0 ? '#eef2ff' : '#f8fafc', border:`1px solid ${selected.size > 0 ? '#a5b4fc' : '#e2e8f0'}`, borderRadius:10 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#475569' }}>
                {selected.size > 0 ? `${selected.size} selected` : 'Select roles to bulk-queue'}
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <button onClick={() => setSelected(selected.size === scrapedRoles.length ? new Set() : new Set(scrapedRoles.map(r => r.id)))}
                  style={{ padding:'5px 11px', fontSize:11, fontWeight:600, background:'#fff', color:'#4f46e5', border:'1px solid #c7d2fe', borderRadius:7, cursor:'pointer' }}>
                  {selected.size === scrapedRoles.length ? 'Clear' : `Select all (${scrapedRoles.length})`}
                </button>
                <button onClick={queueSelected} disabled={!selected.size || bulkBusy}
                  style={{ padding:'7px 14px', fontSize:12, fontWeight:700, background: selected.size ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#f1f5f9', color: selected.size ? '#fff' : '#94a3b8', border:'none', borderRadius:8, cursor: selected.size && !bulkBusy ? 'pointer' : 'default', whiteSpace:'nowrap' }}>
                  {bulkBusy ? 'Queuing…' : `⚡ Queue ${selected.size || ''} for Auto-Apply`}
                </button>
              </div>
            </div>
          )}
          {bulkMsg && (
            <div style={{ marginBottom:12, padding:'10px 14px', background: bulkMsg.ok ? '#dcfce7' : '#fee2e2', color: bulkMsg.ok ? '#15803d' : '#991b1b', borderRadius:8, fontSize:12, fontWeight:600 }}>
              {bulkMsg.text}
            </div>
          )}

          {scrapedRoles.map(r => (
            <AutoApplyRoleRow
              key={r.id}
              role={r}
              company={company}
              preview={resumePreviews[r.apply_url]}
              profileComplete={profileMeta.hasProfile}
              selected={selected.has(r.id)}
              onToggleSelect={() => toggleSelect(r.id)}
            />
          ))}
        </div>
      )}

      {/* Cover letter generator */}
      <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'20px 24px' }}>
        <div style={{ fontSize:15, fontWeight:800, color:'#0f172a', marginBottom:4 }}>Generate Cover Letter</div>
        <div style={{ fontSize:12, color:'#64748b', marginBottom:16 }}>300-500 words, tailored to {company.name}</div>

        <div style={{ display:'flex', gap:10, marginBottom:12 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600, marginBottom:4 }}>Role title (optional)</div>
            <input value={roleTitle} onChange={e => setRoleTitle(e.target.value)}
              placeholder={roles?.[0]?.title || 'Software Engineer Intern'}
              style={{ width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, outline:'none', boxSizing:'border-box' }} />
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600, marginBottom:4 }}>Extra context</div>
            <input value={extraCtx} onChange={e => setExtraCtx(e.target.value)}
              placeholder="e.g. focus on data infra experience"
              style={{ width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, outline:'none', boxSizing:'border-box' }} />
          </div>
        </div>

        <button onClick={generateCover} disabled={loading}
          style={{ padding:'9px 20px', background: loading ? '#f1f5f9' : 'linear-gradient(135deg,#6366f1,#7c3aed)', color: loading ? '#64748b' : '#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:700, cursor: loading ? 'default':'pointer', display:'flex', alignItems:'center', gap:7, marginBottom:16 }}>
          {loading ? <><Spin color="#64748b" /> Generating…</> : '✦ Generate Cover Letter'}
        </button>

        {cover.body && (
          <div>
            <input value={cover.subject} onChange={e => setCover(cv => ({...cv, subject:e.target.value}))}
              style={{ width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, fontWeight:700, outline:'none', marginBottom:8, boxSizing:'border-box' }} />
            <textarea value={cover.body} onChange={e => setCover(cv => ({...cv, body:e.target.value}))}
              rows={12} style={{ width:'100%', padding:'12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, lineHeight:1.7, outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }} />
            <div style={{ display:'flex', gap:8, marginTop:10 }}>
              <button onClick={() => copy(`${cover.subject}\n\n${cover.body}`, 'cv')}
                style={{ padding:'7px 14px', background:'#6366f1', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                {copied === 'cv' ? '✓ Copied' : 'Copy All'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Career Ops Tab ────────────────────────────────────────────────────────────
const PIPELINE_STATUSES = [
  { value:'evaluated',   label:'Evaluated',    color:'#7c3aed', bg:'#fdf4ff' },
  { value:'applied',     label:'Applied',      color:'#0284c7', bg:'#f0f9ff' },
  { value:'responded',   label:'Responded',    color:'#0369a1', bg:'#e0f2fe' },
  { value:'interview',   label:'Interview',    color:'#15803d', bg:'#f0fdf4' },
  { value:'offer',       label:'Offer',        color:'#166534', bg:'#dcfce7' },
  { value:'rejected',    label:'Rejected',     color:'#dc2626', bg:'#fef2f2' },
  { value:'discarded',   label:'Discarded',    color:'#94a3b8', bg:'#f8fafc' },
  { value:'skip',        label:'SKIP',         color:'#64748b', bg:'#f1f5f9' },
]

const SCORE_COLOR = s => s >= 4.2 ? '#16a34a' : s >= 3.8 ? '#ca8a04' : s >= 3 ? '#475569' : '#dc2626'

function CareerOpsTab({ company, roles = [], autoAnalyze, onAnalyzeDone }) {
  // Narrow viewport (phone OR tablet ≤900px): sidebar stacks above the
  // eval panel instead of sitting side by side. The 280px sidebar can't
  // fit alongside a meaningful eval panel below ~900px.
  const isCareerOpsNarrow = useMediaQuery('(max-width: 900px)')
  const [app, setApp]                     = useState(null)
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)
  const [analyzing, setAnalyzing]         = useState(false)
  const [evaluation, setEval]             = useState(null)
  const [evalError, setEvalErr]           = useState(null)
  const [resumeUploading, setResumeUp]    = useState(false)
  const [libraryItems, setLibraryItems]   = useState([])
  const [showLibraryPicker, setShowLibraryPicker] = useState(false)
  const [pickingLibrary, setPickingLibrary] = useState('')   // archetype/filename being saved
  const [resumeDeleting, setResumeDel]    = useState(false)
  const [activeBlock, setActiveBlock]     = useState('b')
  const [rightPanel, setRightPanel]       = useState('eval') // 'eval' | 'tracker' | 'reports'
  const [trackerRows, setTrackerRows]     = useState(null)
  const [reportFiles, setReportFiles]     = useState(null)
  const [trackerLoading, setTrackerLoad]  = useState(false)
  const [evalId, setEvalId]               = useState(null)
  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [pdfError, setPdfError]           = useState(null)

  useEffect(() => {
    api.career.getCompany(company.id)
      .then(d => {
        setApp(d)
        if (d?.fit_assessment) {
          try { setEval(JSON.parse(d.fit_assessment)) } catch (_) {}
        }
      })
      .catch(() => setApp({
        status:'evaluated', applied_date:'', follow_up_date:'', notes:'',
        fit_score:'', salary:'', location_type:'onsite', start_date:'', end_date:'',
        resume_original_name:'', resume_size:0, job_title:'', job_url:'', job_source:''
      }))
    // Load the user's storage-backed resume library so the picker can show options
    api.career.storageLibrary().then(d => setLibraryItems(d.items || [])).catch(() => {})
  }, [company.id])

  // Heuristic: best library archetype for a given role title. Mirrors the
  // backend resumeRegistry.pickResumeForRole logic in spirit (frontend-side
  // for the suggestion; backend does final selection at apply time).
  function suggestArchetype(roleTitle) {
    const t = (roleTitle || '').toLowerCase()
    if (/\b(ml|ai|nlp|llm|computer.?vision|deep.?learning|machine.?learning|research)\b/.test(t)) return 'aiml'
    if (/\b(data scien|data analyst|analytics|business intel)\b/.test(t)) return 'ds'
    if (/\b(devops|sre|infra|cloud|platform|reliability)\b/.test(t)) return 'devops'
    if (/\b(full.?stack|frontend|backend|web|mobile)\b/.test(t)) return 'fullstack'
    if (/\b(founding|startup|early.?stage)\b/.test(t)) return 'startup'
    if (/\b(software|engineer|swe|sde|developer|programmer)\b/.test(t)) return 'swe'
    return 'misc'
  }

  async function pickFromLibrary(archetype, filename) {
    setPickingLibrary(`${archetype}/${filename}`)
    try {
      const r = await api.career.setCompanyResumeFromLibrary(company.id, archetype, filename)
      setApp(prev => ({ ...prev, resume_path: r.resume?.resume_path || null, resume_original_name: filename, resume_size: 0 }))
      setShowLibraryPicker(false)
    } catch (err) {
      alert('Pick failed: ' + err.message)
    } finally {
      setPickingLibrary('')
    }
  }

  // Auto-trigger analysis when coming from Job Scraper "Track" with resume already uploaded
  // Works with both per-company resume (resume_original_name) and globally uploaded resume (hasGlobalResume)
  const [hasGlobalResume, setHasGlobalResume] = useState(false)
  useEffect(() => {
    api.career.resume().then(d => setHasGlobalResume(!!d?.hasResume)).catch(() => {})
  }, [])

  // Score-fit analysis — must be declared BEFORE the auto-trigger useEffect
  // below so that effect doesn't reference it in the temporal dead zone.
  // Wrapped in try/finally so that an early-return (parse error, API error)
  // never leaves `analyzing` stuck at true, which previously required a full
  // page refresh to recover.
  const runAnalysis = useCallback(async () => {
    if (!app?.job_title) return
    setAnalyzing(true)
    setEvalErr(null)
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 95000)
      const res  = await rawApiFetch(`/career/company/${company.id}/score-fit`, { method:'POST', signal: controller.signal })
      clearTimeout(timer)
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { setEvalErr(`Server error: ${text.slice(0, 200)}`); return }
      if (data.error) { setEvalErr(data.error); return }
      if (data.fit_score != null) setApp(prev => ({ ...prev, fit_score: data.fit_score }))
      if (data.evalId)            setEvalId(data.evalId)
      if (data.evaluation)        { setEval(data.evaluation); setRightPanel('eval') }
    } catch (err) {
      setEvalErr(err.name === 'AbortError' ? 'Analysis timed out. Gemini may be rate-limited — try again in a minute.' : err.message)
    } finally {
      setAnalyzing(false)
    }
  }, [app?.job_title, company.id])

  useEffect(() => {
    if (autoAnalyze && app?.job_title && (app?.resume_original_name || hasGlobalResume)) {
      onAnalyzeDone?.()
      runAnalysis()
    }
  }, [autoAnalyze, app, hasGlobalResume, runAnalysis, onAnalyzeDone])

  async function save() {
    if (!app) return
    setSaving(true)
    try {
      const updated = await api.career.updateCompany(company.id, app)
      setApp(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (_) {}
    setSaving(false)
  }

  // Auto-save: debounced PUT whenever any tracked field on `app` changes.
  // Skips the very first render (when we just loaded the row from the
  // server) so we don't immediately echo it back. Uses a ref to track
  // whether the user has actually modified the state.
  const dirtyRef = React.useRef(false)
  const autoSaveTimer = React.useRef(null)
  useEffect(() => {
    if (!app) return
    if (!dirtyRef.current) { dirtyRef.current = true; return }
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => { save() }, 800)
    return () => clearTimeout(autoSaveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.status, app?.applied_date, app?.follow_up_date, app?.salary, app?.location_type, app?.notes, app?.job_title, app?.job_url])
  // Reset dirty flag when company id changes (loaded a different row).
  useEffect(() => { dirtyRef.current = false }, [company.id])

  async function uploadResume(file) {
    if (!file) return
    setResumeUp(true)
    try {
      const fd = new FormData()
      fd.append('resume', file)
      const res = await rawApiFetch(`/companies/${company.id}/career-ops/resume`, { method:'POST', body: fd })
      const data = await res.json()
      if (data.resume && data.application) {
        setApp(data.application)
        if (data.application?.job_title) {
          setResumeUp(false)
          await runAnalysis()
          return
        }
      }
    } catch (_) {}
    setResumeUp(false)
  }

  async function deleteResume() {
    setResumeDel(true)
    try {
      await rawApiFetch(`/companies/${company.id}/career-ops/resume`, { method:'DELETE' })
      setApp(prev => ({ ...prev, resume_path:null, resume_original_name:null, resume_size:null }))
      setEval(null)
    } catch (_) {}
    setResumeDel(false)
  }

  async function generatePDF() {
    if (!evalId) return
    setPdfGenerating(true)
    setPdfError(null)
    try {
      const data = await api.career.tailoredResume(evalId)
      if (data.error) { setPdfError(data.error); return }
      const safe = (s) => String(s || '').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80)
      const filename = `${safe(company?.name) || 'company'}-tailored.pdf`
      await api.career.downloadEvaluationPdf(evalId, filename)
    } catch (err) {
      setPdfError(err.message)
    }
    setPdfGenerating(false)
  }

  function onResumeChange(e) {
    const file = e.target.files?.[0]
    if (file) uploadResume(file)
    e.target.value = ''
  }

  // Pick which scraped role to evaluate — persists the role on the application
  // so the next analysis scores fit for *that* role. Makes the Career Ops
  // evaluation explicitly role-based instead of one fixed tracked role.
  async function pickRole(roleTitle) {
    const r = (roles || []).find(x => x.title === roleTitle)
    if (!r) return
    const pretty = ({ greenhouse:'Greenhouse', lever:'Lever', linkedin:'LinkedIn', workatastartup:'WaaS', google:'Google' })[r.source] || r.source || 'Job Scraper'
    const patch = { job_title: r.title, job_url: r.apply_url || '', job_source: pretty }
    setEval(null)
    setApp(a => ({ ...a, ...patch }))
    try { const updated = await api.career.updateCompany(company.id, { ...app, ...patch }); if (updated) setApp(updated) } catch (_) {}
  }

  if (!app) return <div style={{ display:'flex', justifyContent:'center', paddingTop:60 }}><Spin size={28} /></div>

  const score   = app.fit_score ? Number(app.fit_score) : null
  const grade   = evaluation?.grade || null
  const hasRole = !!app.job_title
  // Distinguish between three states:
  //   - perCompany: user explicitly attached a resume to THIS company (upload or library pick)
  //   - global:     user has a default resume saved in Career Ops Auto-Apply Setup
  //   - neither:    needs to upload or pick from library
  const perCompanyResume = !!app.resume_original_name
  const isLibraryResume  = perCompanyResume && (app.resume_path || '').startsWith('storage://')
  const hasResume        = perCompanyResume || hasGlobalResume
  const suggestedArchetype = suggestArchetype(app.job_title)
  const suggestedFile      = libraryItems.find(i => i.archetype === suggestedArchetype) || libraryItems[0]

  // ── Eval block tabs (santifer/career-ops A–G) ──
  const BLOCKS = [
    { id:'a', label:'A · Role',        data: evaluation?.blockA_roleSummary },
    { id:'b', label:'B · CV Match',    data: evaluation?.blockB_cvMatch },
    { id:'c', label:'C · Level',       data: evaluation?.blockC_levelAndStrategy },
    { id:'d', label:'D · Comp',        data: evaluation?.blockD_compAndDemand },
    { id:'e', label:'E · Personalize', data: evaluation?.blockE_personalization },
    { id:'f', label:'F · Interview',   data: evaluation?.blockF_interviewPrep },
    { id:'g', label:'G · Legitimacy',  data: evaluation?.blockG_legitimacy },
  ]

  return (
    <div style={{
      display:'grid',
      // Desktop: 280px sidebar + main panel side by side. Tablet/phone:
      // single column, sidebar stacks above the eval panel.
      gridTemplateColumns: isCareerOpsNarrow ? '1fr' : '280px 1fr',
      gap:0, minHeight:600, background:'#f8fafc',
    }}>

      {/* ── LEFT SIDEBAR ───────────────────────────────────────────────── */}
      <div style={{
        borderRight: isCareerOpsNarrow ? 'none' : '1px solid #e2e8f0',
        borderBottom: isCareerOpsNarrow ? '1px solid #e2e8f0' : 'none',
        background:'#fff',
        padding: isCareerOpsNarrow ? '14px 14px' : '20px 16px',
        display:'flex', flexDirection:'column', gap:14, overflowY:'auto',
      }}>

        {/* ── Score ring ── */}
        <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', background: score ? (score>=4.2?'#f0fdf4':score>=3.8?'#fefce8':'#fef2f2') : '#f8fafc', borderRadius:12, border:`1.5px solid ${score ? SCORE_COLOR(score)+'40' : '#e2e8f0'}` }}>
          <div style={{ width:56, height:56, borderRadius:'50%', background: score ? SCORE_COLOR(score) : '#e2e8f0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            {analyzing
              ? <Spin size={22} color="#fff" />
              : <><span style={{ fontSize:20, fontWeight:900, color:'#fff', lineHeight:1 }}>{grade||'—'}</span><span style={{ fontSize:9, color:'rgba(255,255,255,0.8)' }}>{score?`${score.toFixed(1)}/5`:''}</span></>
            }
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>{analyzing ? 'Analyzing…' : score ? 'Fit Score' : 'Not evaluated'}</div>
            {evaluation?.recommendation && <div style={{ fontSize:11, color:'#64748b', marginTop:2, lineHeight:1.4 }}>{evaluation.recommendation}</div>}
            {!evaluation && !analyzing && <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>Run analysis to get your score</div>}
          </div>
        </div>

        {/* ── Role to evaluate — pick which scraped role to score fit against ── */}
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Role to Evaluate</div>
          {roles.length > 0 && (
            <div style={{ marginBottom: hasRole ? 8 : 0 }}>
              <Dropdown
                ariaLabel="Pick a role to evaluate"
                value={hasRole ? app.job_title : ''}
                onChange={pickRole}
                options={[
                  { value:'', label: hasRole ? 'Switch to another role…' : 'Pick a scraped role to evaluate…' },
                  ...roles.map((r, i) => ({ value: r.title, label: r.title, key: r.id ?? i })),
                  ...(hasRole && !roles.some(r => r.title === app.job_title) ? [{ value: app.job_title, label: app.job_title }] : []),
                ]}
              />
            </div>
          )}
          {hasRole ? (
            <div style={{ background:'#f8fafc', borderRadius:10, padding:'12px', border:'1px solid #e2e8f0' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', marginBottom:1 }}>{app.job_title}</div>
              <div style={{ fontSize:11, color:'#94a3b8', marginBottom:10 }}>{app.job_source || 'Job Scraper'}</div>
              <div style={{ display:'flex', gap:6 }}>
                {app.job_url && <a href={app.job_url} target="_blank" rel="noreferrer"
                  style={{ flex:1, padding:'6px 0', textAlign:'center', background:'#6366f1', color:'#fff', borderRadius:7, fontSize:11, fontWeight:700, textDecoration:'none' }}>Apply →</a>}
                <button onClick={() => { setApp(a => ({ ...a, job_title:'', job_url:'', job_source:'' })); setEval(null); }}
                  style={{ flex:1, padding:'6px 0', background:'#fff', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding:'12px', background:'#fafafa', borderRadius:10, border:'1.5px dashed #e2e8f0', textAlign:'center' }}>
              <div style={{ fontSize:12, color:'#94a3b8' }}>{roles.length > 0 ? 'Pick a role above to evaluate it' : 'No roles scraped yet'}</div>
              <div style={{ fontSize:11, color:'#cbd5e1', marginTop:3 }}>{roles.length > 0 ? 'Your fit is scored for the role you choose' : 'Go to Job Scraper → Scrape, then pick a role here'}</div>
            </div>
          )}
        </div>

        {/* ── Resume — clean picker: upload OR pick from library ── */}
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Resume</div>
          <input id={`co-resume-${company.id}`} type="file" onChange={onResumeChange} accept=".pdf,.docx" style={{ display:'none' }} />

          {perCompanyResume ? (
            // Resume is explicitly attached to this company (upload OR library pick).
            <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'12px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <span style={{ fontSize:16 }}>{isLibraryResume ? '📚' : '✅'}</span>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'#15803d', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{app.resume_original_name}</div>
                  <div style={{ fontSize:10, color:'#86efac' }}>{isLibraryResume ? 'From library' : `${((app.resume_size||0)/1024).toFixed(0)} KB`}</div>
                </div>
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <label htmlFor={`co-resume-${company.id}`}
                  style={{ flex:1, padding:'5px 0', textAlign:'center', background:'#fff', color:'#475569', border:'1px solid #d1fae5', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                  Replace
                </label>
                <button onClick={() => setShowLibraryPicker(true)}
                  style={{ flex:1, padding:'5px 0', background:'#fff', color:'#4f46e5', border:'1px solid #c7d2fe', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                  Library
                </button>
                <button onClick={deleteResume} disabled={resumeDeleting}
                  style={{ flex:1, padding:'5px 0', background:'#fff', color:'#dc2626', border:'1px solid #fecaca', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                  {resumeDeleting ? '…' : 'Remove'}
                </button>
              </div>
            </div>
          ) : (
            // No per-company resume yet — show two clear paths: upload OR library.
            // (The global default resume from Auto-Apply Setup is no longer
            // implicitly used here; user must explicitly pick a source.)
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <label htmlFor={`co-resume-${company.id}`}
                style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, border:'1px solid #c7d2fe', borderRadius:8, padding:'10px 12px', cursor:'pointer', background:'#eef2ff', color:'#4f46e5', fontSize:12, fontWeight:700, transition:'all 0.15s' }}>
                {resumeUploading
                  ? <><Spin color="#4f46e5" size={14}/> Uploading…</>
                  : <>📎 Upload PDF</>
                }
              </label>
              <button onClick={() => setShowLibraryPicker(true)}
                disabled={libraryItems.length === 0}
                title={libraryItems.length === 0 ? 'No library yet — add archetype PDFs in Career Ops → Auto-Apply Setup' : 'Pick from your saved archetype PDFs'}
                style={{ padding:'10px 12px', border:'1px solid #ddd6fe', borderRadius:8, background:'#f5f3ff', color: libraryItems.length === 0 ? '#cbd5e1' : '#7c3aed', fontSize:12, fontWeight:700, cursor: libraryItems.length === 0 ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                📚 From Library {libraryItems.length > 0 ? `(${libraryItems.length} saved)` : '(empty)'}
              </button>
              {hasGlobalResume && (
                <div style={{ padding:'6px 10px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, fontSize:10, color:'#94a3b8' }}>
                  💡 You also have a default resume saved in Auto-Apply Setup — pick one above to use it for this company specifically.
                </div>
              )}
            </div>
          )}

          {/* Library picker modal — shown when user clicks "From Library" or "Library" */}
          {showLibraryPicker && (
            <div style={{ marginTop:10, padding:12, background:'#f5f3ff', border:'1px solid #ddd6fe', borderRadius:10 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#7c3aed' }}>Pick from library</div>
                <button onClick={() => setShowLibraryPicker(false)} style={{ padding:'2px 6px', fontSize:10, background:'none', border:'none', color:'#94a3b8', cursor:'pointer' }}>✕</button>
              </div>
              {libraryItems.length === 0 ? (
                <div style={{ fontSize:11, color:'#7c3aed' }}>No PDFs in your library. Go to Career Ops → Auto-Apply Setup to upload archetype resumes first.</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:5, maxHeight:240, overflowY:'auto' }}>
                  {libraryItems.map((item, i) => {
                    const isSuggested = suggestedFile && item.archetype === suggestedFile.archetype && item.filename === suggestedFile.filename
                    const key = `${item.archetype}/${item.filename}`
                    return (
                      <button key={i} onClick={() => pickFromLibrary(item.archetype, item.filename)} disabled={pickingLibrary !== ''}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', border: isSuggested ? '1.5px solid #7c3aed' : '1px solid #e2e8f0', borderRadius:7, background: isSuggested ? '#fff' : '#fafafa', cursor: pickingLibrary ? 'default' : 'pointer', textAlign:'left' }}>
                        <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, background:'#eef2ff', color:'#4f46e5', textTransform:'uppercase', flexShrink:0 }}>{item.archetype}</span>
                        <span style={{ fontSize:11, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, fontFamily:'monospace' }}>{item.filename}</span>
                        {isSuggested && <span style={{ fontSize:9, fontWeight:700, color:'#7c3aed', flexShrink:0 }}>✨ best for {app.job_title ? 'this role' : 'most roles'}</span>}
                        {pickingLibrary === key && <Spin color="#7c3aed" size={11} />}
                      </button>
                    )
                  })}
                </div>
              )}
              {hasRole && libraryItems.length > 0 && !suggestedFile && (
                <div style={{ marginTop:6, fontSize:10, color:'#94a3b8' }}>No exact archetype match for "{app.job_title}" — pick whichever fits best.</div>
              )}
            </div>
          )}
        </div>

        {/* ── Analyze button ── */}
        <div>
          {hasRole && hasResume ? (
            <button onClick={runAnalysis} disabled={analyzing}
              style={{ width:'100%', padding:'11px 0', background: analyzing ? '#e0e7ff' : 'linear-gradient(135deg,#6366f1,#7c3aed)', color: analyzing ? '#6366f1' : '#fff', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor: analyzing?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'opacity 0.15s' }}>
              {analyzing ? <><Spin color="#6366f1" size={14}/> Analyzing…</> : '⚡ Analyze Role Fit'}
            </button>
          ) : (
            <div style={{ padding:'10px 12px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0', textAlign:'center' }}>
              <div style={{ fontSize:12, color:'#94a3b8' }}>
                {!hasRole ? '① Pick a role above' : '② Upload your resume above'}
              </div>
              <div style={{ fontSize:11, color:'#cbd5e1', marginTop:2 }}>
                {!hasRole ? 'then upload resume to analyze' : 'to enable fit analysis'}
              </div>
            </div>
          )}
          {evalError && (
            <div style={{ marginTop:8, padding:'8px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, fontSize:11, color:'#dc2626', lineHeight:1.5 }}>
              {evalError}
            </div>
          )}
        </div>

        {/* ── Pipeline status — single dropdown, was 8 stacked buttons ── */}
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Pipeline Status</div>
          <Dropdown
            ariaLabel="Pipeline status"
            value={app.status || 'evaluated'}
            onChange={(v) => setApp(a => ({ ...a, status: v }))}
            options={PIPELINE_STATUSES.map(s => ({ value:s.value, label:s.label }))}
          />
        </div>

        {/* ── Details ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:2 }}>Details</div>
          {[
            { label:'Applied Date', key:'applied_date', type:'date' },
            { label:'Follow-up By', key:'follow_up_date', type:'date' },
            { label:'Salary / Pay', key:'salary', type:'text', placeholder:'e.g. $45/hr' },
          ].map(f => (
            <div key={f.key}>
              <div style={{ fontSize:10, color:'#94a3b8', marginBottom:3 }}>{f.label}</div>
              <input type={f.type} value={app[f.key]||''} onChange={e=>setApp(a=>({...a,[f.key]:e.target.value}))}
                placeholder={f.placeholder||''}
                style={{ width:'100%', padding:'7px 10px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:12, outline:'none', boxSizing:'border-box', background:'#fff' }} />
            </div>
          ))}
          <div>
            <div style={{ fontSize:10, color:'#94a3b8', marginBottom:3 }}>Location</div>
            {/* Themed Dropdown so mobile doesn't trigger the iOS native
                picker overlay — keeps the look consistent with the other
                fields on this card on both web and mobile. */}
            <Dropdown
              ariaLabel="Work location type"
              value={app.location_type || 'onsite'}
              onChange={(v) => setApp(a => ({ ...a, location_type: v }))}
              options={[
                { value:'onsite', label:'On-site' },
                { value:'remote', label:'Remote' },
                { value:'hybrid', label:'Hybrid' },
              ]}
            />
          </div>
        </div>

        {/* ── Notes ── */}
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Notes</div>
          <textarea value={app.notes||''} onChange={e=>setApp(a=>({...a,notes:e.target.value}))}
            rows={3} placeholder="Recruiter name, next steps, interview notes…"
            style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, color:'#0f172a', lineHeight:1.5, outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }} />
        </div>

        {/* ── Auto-save indicator (replaces the manual Save button).
             Shows 'Saving…' while a debounced PUT is in flight, '✓ Saved'
             briefly after, otherwise blank. Quiet — no big black button. */}
        <div style={{ minHeight:18, fontSize:11, color: saving ? '#64748b' : (saved ? '#15803d' : '#94a3b8'), display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6, fontWeight:600 }}>
          {saving ? <><Spin color="#94a3b8" size={11}/> Saving…</> : saved ? '✓ Saved' : '· auto-saves as you type'}
        </div>
      </div>

      {/* ── RIGHT: evaluation report / tracker / reports ─────────────── */}
      <div style={{ overflowY:'auto' }}>

        {/* Panel switcher — segmented pill row inside a tinted track,
            matching the rest of the app's tab UI instead of underline tabs. */}
        <div style={{ padding:'12px 14px 10px', background:'#fff', position:'sticky', top:0, zIndex:10, borderBottom:'1px solid #f1f5f9' }}>
          <div style={{ display:'flex', gap:4, padding:4, background:'#f1f5f9', borderRadius:10 }}>
            {[['eval','📋 Evaluation'],['tracker','📊 Tracker'],['reports','📁 Reports']].map(([id, label]) => (
              <button key={id} onClick={async () => {
                setRightPanel(id)
                if (id === 'tracker' && !trackerRows) {
                  setTrackerLoad(true)
                  try { const r = await api.career.tracker(); setTrackerRows(r.rows) } catch (_) {}
                  setTrackerLoad(false)
                }
                if (id === 'reports' && !reportFiles) {
                  try { const rows = await api.career.evaluations(); setReportFiles(rows) } catch (_) {}
                }
              }}
                style={{
                  flex:1, padding:'8px 10px', borderRadius:7, border:'none',
                  fontSize:12, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap',
                  background: rightPanel===id ? '#fff' : 'transparent',
                  color:      rightPanel===id ? '#4f46e5' : '#64748b',
                  boxShadow:  rightPanel===id ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
                  transition:'all 0.15s',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tracker panel ── */}
        {rightPanel === 'tracker' && (
          <div style={{ padding:'24px 28px' }}>
            <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:16 }}>applications.md — Pipeline Tracker</div>
            {trackerLoading && <div style={{ color:'#94a3b8', fontSize:13 }}>Loading…</div>}
            {!trackerLoading && trackerRows !== null && (() => {
              const companyRows = trackerRows.filter(r => r.company?.toLowerCase() === company.name?.toLowerCase())
              if (companyRows.length === 0) return (
                <div style={{ color:'#94a3b8', fontSize:13 }}>No evaluations for {company.name} yet. Run an analysis first.</div>
              )
              return (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#f8fafc' }}>
                      {['#','Date','Role','Score','Status','Report'].map(h => (
                        <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontWeight:700, color:'#475569', borderBottom:'2px solid #e2e8f0', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {companyRows.map((r, i) => (
                      <tr key={i} style={{ borderBottom:'1px solid #f1f5f9' }}>
                        <td style={{ padding:'8px 10px', color:'#94a3b8' }}>{r.num}</td>
                        <td style={{ padding:'8px 10px', color:'#64748b', whiteSpace:'nowrap' }}>{r.date}</td>
                        <td style={{ padding:'8px 10px', color:'#475569' }}>{r.role}</td>
                        <td style={{ padding:'8px 10px' }}>
                          <span style={{ fontWeight:800, color: Number(r.score)>=4?'#16a34a':Number(r.score)>=3?'#ca8a04':'#dc2626' }}>{r.score}</span>
                        </td>
                        <td style={{ padding:'8px 10px' }}>
                          <span style={{ padding:'2px 8px', borderRadius:6, fontSize:10, fontWeight:700, background:'#e0e7ff', color:'#4338ca' }}>{r.status}</span>
                        </td>
                        <td style={{ padding:'8px 10px', color:'#6366f1', fontSize:11 }}>{r.report}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )
            })()}
            <button onClick={async () => {
              setTrackerLoad(true)
              try { const r = await api.career.tracker(); setTrackerRows(r.rows) } catch (_) {}
              setTrackerLoad(false)
            }} style={{ marginTop:16, padding:'7px 16px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', color:'#475569' }}>
              ↺ Refresh
            </button>
          </div>
        )}

        {/* ── Reports panel ── */}
        {rightPanel === 'reports' && (
          <div style={{ padding:'24px 28px' }}>
            <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:16 }}>Saved Reports</div>
            {!reportFiles && <div style={{ color:'#94a3b8', fontSize:13 }}>Loading…</div>}
            {reportFiles && reportFiles.length === 0 && (
              <div style={{ color:'#94a3b8', fontSize:13 }}>No reports saved yet.</div>
            )}
            {reportFiles && (() => {
              const filtered = reportFiles.filter(r => (r.company_name || '').toLowerCase() === (company.name || '').toLowerCase())
              if (filtered.length === 0) return <div style={{ color:'#94a3b8', fontSize:13 }}>No reports for {company.name} yet.</div>
              const gradeColor = g => ({ A:'#16a34a', B:'#0d9488', C:'#d97706', D:'#ea580c', F:'#dc2626' }[g] || '#64748b')
              return (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {filtered.map((r, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0' }}>
                    <div style={{ width:34, height:34, borderRadius:'50%', border:`2px solid ${gradeColor(r.grade)}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <span style={{ fontSize:13, fontWeight:900, color: gradeColor(r.grade) }}>{r.grade || '—'}</span>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.job_title || 'Evaluation'}</div>
                      <div style={{ fontSize:11, color:'#94a3b8' }}>
                        {r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : ''}
                        {r.score != null && ` · ${Number(r.score).toFixed(1)}/5`}
                      </div>
                    </div>
                    <button onClick={async () => {
                        try { await api.career.openReportTab(r.id) }
                        catch (err) { alert('Could not open report: ' + err.message) }
                      }}
                      style={{ padding:'6px 14px', background:'#6366f1', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer', flexShrink:0 }}>
                      View report →
                    </button>
                  </div>
                ))}
              </div>
              )
            })()}
            <button onClick={async () => {
              try { const rows = await api.career.evaluations(); setReportFiles(rows) } catch (_) {}
            }} style={{ marginTop:16, padding:'7px 16px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', color:'#475569' }}>
              ↺ Refresh
            </button>
          </div>
        )}

        {/* ── Evaluation panel ── */}
        {rightPanel === 'eval' && !evaluation && !analyzing && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', minHeight:400, gap:12, padding:40, textAlign:'center' }}>
            <div style={{ width:64, height:64, borderRadius:'50%', background:'#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28 }}>📋</div>
            <div style={{ fontSize:16, fontWeight:700, color:'#0f172a' }}>No report yet</div>
            <div style={{ fontSize:13, color:'#64748b', maxWidth:300, lineHeight:1.7 }}>
              {!hasRole ? <>Go to <strong>Job Scraper</strong> and click <strong>+ Track</strong> on a role</> : !hasResume ? <>Upload your resume on the left, then hit <strong>⚡ Analyze Role Fit</strong></> : <>Click <strong>⚡ Analyze Role Fit</strong> to get your full evaluation</>}
            </div>
            {hasRole && hasResume && (
              <button onClick={runAnalysis} style={{ marginTop:8, padding:'10px 24px', background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer' }}>
                ⚡ Run Analysis
              </button>
            )}
          </div>
        )}

        {/* Analyzing */}
        {rightPanel === 'eval' && analyzing && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', minHeight:400, gap:16, padding:40, textAlign:'center' }}>
            <div style={{ position:'relative' }}>
              <div style={{ width:72, height:72, borderRadius:'50%', background:'linear-gradient(135deg,#6366f1,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Spin size={32} color="#fff" />
              </div>
            </div>
            <div style={{ fontSize:16, fontWeight:700, color:'#6366f1' }}>Running analysis…</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6, fontSize:12, color:'#94a3b8' }}>
              <div>📄 Fetching job description</div>
              <div>🔍 Matching against your resume</div>
              <div>📊 Generating 6-block report</div>
            </div>
            <div style={{ fontSize:11, color:'#cbd5e1', marginTop:4 }}>Usually takes 15–30 seconds</div>
          </div>
        )}

        {/* Report */}
        {rightPanel === 'eval' && evaluation && !analyzing && (
          <div style={{ padding:'24px 28px' }}>

            {/* Header */}
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, marginBottom:20, paddingBottom:16, borderBottom:'1px solid #f1f5f9' }}>
              <div>
                <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>Evaluation Report</div>
                <div style={{ fontSize:18, fontWeight:800, color:'#0f172a' }}>{evaluation.jobTitle || app.job_title}</div>
                <div style={{ fontSize:13, color:'#64748b', marginTop:2 }}>{evaluation.companyName || company.name}</div>
                {evaluation.recommendation && (
                  <div style={{ marginTop:8, display:'inline-flex', alignItems:'center', gap:6, padding:'5px 12px', background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:20, fontSize:12, color:'#0369a1', fontWeight:600 }}>
                    {evaluation.recommendation}
                  </div>
                )}
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, flexShrink:0 }}>
                <div style={{ width:52, height:52, borderRadius:'50%', background: SCORE_COLOR(score), display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                  <span style={{ fontSize:18, fontWeight:900, color:'#fff', lineHeight:1 }}>{grade}</span>
                </div>
                <div style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>{score?.toFixed(1)}/5.0</div>
                <button onClick={runAnalysis} style={{ padding:'4px 12px', background:'#f8fafc', color:'#475569', border:'1px solid #e2e8f0', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer', marginTop:2 }}>
                  ↺ Re-run
                </button>
              </div>
            </div>

            {/* Verdict — Claude.ai-style decisive headline + buried-match
                + calibrated interview odds. Surfaces the most useful parts
                of the new evaluation prompt before the user has to dig
                into individual blocks. Renders only when the evaluation
                JSON has a verdict (older evals from before the prompt
                upgrade fall through gracefully). */}
            {evaluation.verdict && (
              <div style={{ background:'linear-gradient(135deg,#fafafa,#f8fafc)', border:'2px solid #1e293b', borderRadius:14, padding:'16px 18px', marginBottom:16 }}>
                <div style={{ fontSize:10, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Verdict</div>
                <div style={{ fontSize:17, fontWeight:800, color:'#0f172a', marginBottom:6, lineHeight:1.35 }}>{evaluation.verdict.headline}</div>
                {evaluation.verdict.oneLineWhy && (
                  <div style={{ fontSize:12, color:'#374151', lineHeight:1.6, marginBottom: evaluation.verdict.buriedMatch ? 10 : 0 }}>{evaluation.verdict.oneLineWhy}</div>
                )}
                {evaluation.verdict.buriedMatch && (
                  <div style={{ marginTop:8, padding:'10px 12px', background:'#fef3c7', borderRadius:8, border:'1px solid #fcd34d' }}>
                    <div style={{ fontSize:10, fontWeight:800, color:'#92400e', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>⚠ Buried match</div>
                    <div style={{ fontSize:11, color:'#374151', lineHeight:1.6 }}>{evaluation.verdict.buriedMatch}</div>
                  </div>
                )}
                {evaluation.verdict.interviewOdds && (
                  <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    <div style={{ padding:'10px 12px', background:'#fee2e2', borderRadius:8, border:'1px solid #fca5a5' }}>
                      <div style={{ fontSize:9, fontWeight:800, color:'#991b1b', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:2 }}>As-is</div>
                      <div style={{ fontSize:16, fontWeight:900, color:'#0f172a' }}>{evaluation.verdict.interviewOdds.asIs}</div>
                    </div>
                    <div style={{ padding:'10px 12px', background:'#dcfce7', borderRadius:8, border:'1px solid #86efac' }}>
                      <div style={{ fontSize:9, fontWeight:800, color:'#15803d', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:2 }}>Tailored</div>
                      <div style={{ fontSize:16, fontWeight:900, color:'#0f172a' }}>{evaluation.verdict.interviewOdds.properlyTailored}</div>
                    </div>
                    {evaluation.verdict.interviewOdds.reasoning && (
                      <div style={{ gridColumn:'1 / -1', fontSize:11, color:'#64748b', lineHeight:1.55, fontStyle:'italic' }}>
                        {evaluation.verdict.interviewOdds.reasoning}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Top 3 Gaps — most actionable insights from the new schema */}
            {(evaluation.topGaps || []).length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Top 3 gaps to fix</div>
                {evaluation.topGaps.slice(0, 3).map((g, i) => {
                  const sevColor = g.severity === 'blocker' ? '#dc2626' : g.severity === 'high' ? '#d97706' : '#6366f1'
                  const sevBg    = g.severity === 'blocker' ? '#fee2e2' : g.severity === 'high' ? '#fef3c7' : '#eef2ff'
                  return (
                    <div key={i} style={{ padding:'12px 14px', marginBottom:6, background:'#fff', borderRadius:10, border:'1px solid #e2e8f0', borderLeft:`4px solid ${sevColor}` }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                        <span style={{ fontSize:15, fontWeight:900, color:sevColor, width:20 }}>{i + 1}.</span>
                        <span style={{ fontSize:9, fontWeight:800, padding:'2px 7px', borderRadius:5, background: sevBg, color: sevColor, textTransform:'uppercase', letterSpacing:'0.08em' }}>{g.severity}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:'#0f172a', flex:'1 1 200px' }}>{g.gap}</span>
                      </div>
                      <div style={{ fontSize:11, color:'#374151', lineHeight:1.6, paddingLeft:28 }}>
                        <strong style={{ color:'#16a34a' }}>Fix:</strong> {g.fix}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Tab nav */}
            <div style={{ display:'flex', gap:2, marginBottom:20, background:'#f8fafc', borderRadius:10, padding:4, overflowX:'auto' }}>
              {BLOCKS.map(b => (
                <button key={b.id} onClick={() => setActiveBlock(b.id)}
                  style={{ flex:'1 0 auto', padding:'7px 8px', borderRadius:7, border:'none', fontSize:11, fontWeight:700, cursor:'pointer', transition:'all 0.15s', textAlign:'center', whiteSpace:'nowrap',
                    background: activeBlock===b.id ? '#fff' : 'transparent',
                    color: activeBlock===b.id ? '#6366f1' : '#94a3b8',
                    boxShadow: activeBlock===b.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
                  {b.label}
                </button>
              ))}
            </div>

            {/* Archetype banner (Paso 0) */}
            {evaluation.archetype?.primary && (
              <div style={{ padding:'14px 16px', marginBottom:12, background:'linear-gradient(135deg,#eef2ff,#e0e7ff)', border:'1px solid #c7d2fe', borderRadius:12 }}>
                <div style={{ fontSize:10, fontWeight:700, color:'#4338ca', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Detected Archetype</div>
                <div style={{ fontSize:15, fontWeight:800, color:'#1e1b4b' }}>
                  {evaluation.archetype.primary}
                  {evaluation.archetype.secondary && <span style={{ color:'#6366f1', fontWeight:600 }}> + {evaluation.archetype.secondary}</span>}
                </div>
                {evaluation.archetype.reasoning && <div style={{ fontSize:12, color:'#4c1d95', marginTop:6, lineHeight:1.5 }}>{evaluation.archetype.reasoning}</div>}
              </div>
            )}

            {/* Block A — Role Summary */}
            {activeBlock==='a' && evaluation.blockA_roleSummary && (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {evaluation.blockA_roleSummary.tldr && (
                  <div style={{ padding:'16px', background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:12 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'#0369a1', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>TL;DR</div>
                    <div style={{ fontSize:13, color:'#0f172a', lineHeight:1.7 }}>{evaluation.blockA_roleSummary.tldr}</div>
                  </div>
                )}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {[
                    ['Domain',      evaluation.blockA_roleSummary.domain],
                    ['Function',    evaluation.blockA_roleSummary.function],
                    ['Seniority',   evaluation.blockA_roleSummary.seniority],
                    ['Remote',      evaluation.blockA_roleSummary.remote],
                    ['Team Size',   evaluation.blockA_roleSummary.teamSize],
                    ['Archetype',   evaluation.blockA_roleSummary.archetypeDetected],
                  ].filter(([,v])=>v).map(([k,v])=>(
                    <div key={k} style={{ padding:'12px 14px', background:'#fff', borderRadius:10, border:'1px solid #e2e8f0' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>{k}</div>
                      <div style={{ fontSize:13, color:'#0f172a', fontWeight:600 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Block B — CV Match (JD requirements → CV evidence + gaps) */}
            {activeBlock==='b' && evaluation.blockB_cvMatch && (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {(evaluation.blockB_cvMatch.requirements||[]).length>0 && (
                  <div style={{ padding:'16px', background:'#fff', borderRadius:12, border:'1px solid #e2e8f0' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>JD Requirements → CV Evidence</div>
                    {evaluation.blockB_cvMatch.requirements.map((r,i)=>{
                      const col = r.status==='match' ? '#16a34a' : r.status==='partial' ? '#ca8a04' : '#dc2626'
                      const icon = r.status==='match' ? '✓' : r.status==='partial' ? '~' : '✗'
                      return (
                        <div key={i} style={{ padding:'10px 0', borderBottom:'1px solid #f1f5f9' }}>
                          <div style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:4 }}>
                            <span style={{ color:col, fontWeight:800, flexShrink:0 }}>{icon}</span>
                            <span style={{ fontSize:13, color:'#0f172a', fontWeight:600 }}>{r.requirement}</span>
                          </div>
                          {r.cvEvidence && <div style={{ fontSize:12, color:'#64748b', marginLeft:20, lineHeight:1.5 }}>{r.cvEvidence}</div>}
                        </div>
                      )
                    })}
                  </div>
                )}
                {(evaluation.blockB_cvMatch.gaps||[]).length>0 && (
                  <div style={{ padding:'16px', background:'#fef2f2', borderRadius:12, border:'1px solid #fecaca' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#dc2626', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>Gaps & Mitigation</div>
                    {evaluation.blockB_cvMatch.gaps.map((g,i)=>(
                      <div key={i} style={{ padding:'10px 0', borderBottom:'1px solid #fee2e2' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                          <span style={{ fontSize:13, color:'#991b1b', fontWeight:700 }}>{g.gap}</span>
                          <span style={{ fontSize:10, padding:'2px 8px', borderRadius:6, background:g.severity==='hard blocker'?'#dc2626':'#f59e0b', color:'#fff', fontWeight:700 }}>{g.severity}</span>
                        </div>
                        {g.adjacentExperience && <div style={{ fontSize:12, color:'#64748b', marginBottom:4 }}><strong>Adjacent:</strong> {g.adjacentExperience}</div>}
                        {g.mitigation && <div style={{ fontSize:12, color:'#0f172a', lineHeight:1.5 }}><strong>Plan:</strong> {g.mitigation}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Block C — Level & Strategy */}
            {activeBlock==='c' && evaluation.blockC_levelAndStrategy && (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div style={{ padding:'14px', background:'#fff', borderRadius:10, border:'1px solid #e2e8f0' }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>JD Level</div>
                    <div style={{ fontSize:14, fontWeight:700, color:'#0f172a' }}>{evaluation.blockC_levelAndStrategy.jdLevel || '—'}</div>
                  </div>
                  <div style={{ padding:'14px', background:'#fff', borderRadius:10, border:'1px solid #e2e8f0' }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Your Natural Level</div>
                    <div style={{ fontSize:14, fontWeight:700, color:'#0f172a' }}>{evaluation.blockC_levelAndStrategy.candidateNaturalLevel || '—'}</div>
                  </div>
                </div>
                {(evaluation.blockC_levelAndStrategy.sellSeniorPlan||[]).length>0 && (
                  <div style={{ padding:'16px', background:'#f0fdf4', borderRadius:12, border:'1px solid #86efac' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#15803d', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>Sell Senior (Without Lying)</div>
                    {evaluation.blockC_levelAndStrategy.sellSeniorPlan.map((p,i)=>(
                      <div key={i} style={{ fontSize:13, color:'#166534', padding:'6px 0', lineHeight:1.5 }}>→ {p}</div>
                    ))}
                  </div>
                )}
                {(evaluation.blockC_levelAndStrategy.ifDownleveledPlan||[]).length>0 && (
                  <div style={{ padding:'16px', background:'#fffbeb', borderRadius:12, border:'1px solid #fde68a' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#b45309', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>If Downleveled</div>
                    {evaluation.blockC_levelAndStrategy.ifDownleveledPlan.map((p,i)=>(
                      <div key={i} style={{ fontSize:13, color:'#78350f', padding:'6px 0', lineHeight:1.5 }}>→ {p}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Block D — Comp & Demand */}
            {activeBlock==='d' && evaluation.blockD_compAndDemand && (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {evaluation.blockD_compAndDemand.salaryRange && (
                  <div style={{ padding:'20px', background:'linear-gradient(135deg,#f0fdf4,#dcfce7)', border:'1.5px solid #86efac', borderRadius:14 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#15803d', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Salary Range</div>
                    <div style={{ fontSize:22, fontWeight:800, color:'#166534' }}>{evaluation.blockD_compAndDemand.salaryRange}</div>
                  </div>
                )}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {evaluation.blockD_compAndDemand.companyCompReputation && (
                    <div style={{ padding:'14px', background:'#fff', borderRadius:10, border:'1px solid #e2e8f0' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Company Rep</div>
                      <div style={{ fontSize:13, color:'#0f172a', lineHeight:1.5 }}>{evaluation.blockD_compAndDemand.companyCompReputation}</div>
                    </div>
                  )}
                  {evaluation.blockD_compAndDemand.roleDemandTrend && (
                    <div style={{ padding:'14px', background:'#fff', borderRadius:10, border:'1px solid #e2e8f0' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Demand Trend</div>
                      <div style={{ fontSize:13, color:'#0f172a', fontWeight:600, textTransform:'capitalize' }}>{evaluation.blockD_compAndDemand.roleDemandTrend}</div>
                    </div>
                  )}
                </div>
                {(evaluation.blockD_compAndDemand.sources||[]).length>0 && (
                  <div style={{ padding:'12px 14px', background:'#f8fafc', borderRadius:10 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Sources</div>
                    <div style={{ fontSize:12, color:'#475569' }}>{evaluation.blockD_compAndDemand.sources.join(' · ')}</div>
                  </div>
                )}
              </div>
            )}

            {/* Block E — Personalization */}
            {activeBlock==='e' && evaluation.blockE_personalization && (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {(evaluation.blockE_personalization.cvChanges||[]).length>0 && (
                  <div style={{ padding:'16px', background:'#fff', borderRadius:12, border:'1px solid #e2e8f0' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>CV Changes</div>
                    {evaluation.blockE_personalization.cvChanges.map((c,i)=>(
                      <div key={i} style={{ padding:'10px 0', borderBottom:'1px solid #f1f5f9' }}>
                        <div style={{ fontSize:12, fontWeight:700, color:'#6366f1', marginBottom:4 }}>{c.section}</div>
                        {c.currentState && <div style={{ fontSize:12, color:'#94a3b8', marginBottom:4 }}><s>{c.currentState}</s></div>}
                        {c.proposedChange && <div style={{ fontSize:13, color:'#0f172a', marginBottom:4, lineHeight:1.5 }}>→ {c.proposedChange}</div>}
                        {c.why && <div style={{ fontSize:11, color:'#64748b', fontStyle:'italic' }}>Why: {c.why}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {(evaluation.blockE_personalization.linkedinChanges||[]).length>0 && (
                  <div style={{ padding:'16px', background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:12 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#0369a1', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>LinkedIn Changes</div>
                    {evaluation.blockE_personalization.linkedinChanges.map((s,i)=>(
                      <div key={i} style={{ fontSize:13, color:'#0c4a6e', padding:'6px 0', lineHeight:1.5 }}>→ {s}</div>
                    ))}
                  </div>
                )}

                {/* Generate Tailored Resume PDF */}
                <div style={{ padding:'20px', background:'linear-gradient(135deg,#f8f7ff,#eef2ff)', border:'1px solid #c7d2fe', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#3730a3', marginBottom:4 }}>Tailored Resume PDF</div>
                    <div style={{ fontSize:11, color:'#6366f1' }}>ATS-optimised with JD keywords injected — never invents experience</div>
                    {pdfError && <div style={{ fontSize:11, color:'#dc2626', marginTop:4 }}>{pdfError}</div>}
                  </div>
                  <button
                    onClick={generatePDF}
                    disabled={!evalId || pdfGenerating}
                    style={{ padding:'10px 20px', background: evalId ? '#6366f1' : '#e2e8f0', color: evalId ? '#fff' : '#94a3b8', border:'none', borderRadius:9, fontSize:13, fontWeight:700, cursor: evalId ? 'pointer' : 'not-allowed', whiteSpace:'nowrap', flexShrink:0 }}>
                    {pdfGenerating ? '⏳ Generating…' : '📄 Generate Resume'}
                  </button>
                </div>
              </div>
            )}

            {/* Block F — Interview Prep (STAR+R) */}
            {activeBlock==='f' && evaluation.blockF_interviewPrep && (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {(evaluation.blockF_interviewPrep.starStories||[]).length>0 && (
                  <div style={{ padding:'16px', background:'#fdf4ff', border:'1px solid #e9d5ff', borderRadius:12 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#7c3aed', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>STAR+R Stories</div>
                    {evaluation.blockF_interviewPrep.starStories.map((s,i)=>(
                      <div key={i} style={{ marginBottom:14, padding:'14px', background:'#fff', borderRadius:10, border:'1px solid #e9d5ff' }}>
                        {s.jdRequirement && <div style={{ fontSize:11, fontWeight:700, color:'#6366f1', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.05em' }}>Req: {s.jdRequirement}</div>}
                        {['situation','task','action','result','reflection'].map(k=>s[k]&&(
                          <div key={k} style={{ fontSize:12, color:'#0f172a', marginBottom:6, lineHeight:1.5 }}>
                            <strong style={{ color:'#7c3aed', textTransform:'uppercase', fontSize:10, marginRight:4 }}>{k}:</strong>{s[k]}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {evaluation.blockF_interviewPrep.caseStudyRecommendation && (
                  <div style={{ padding:'16px', background:'#fff', borderRadius:12, border:'1px solid #e2e8f0' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Case Study Recommendation</div>
                    <div style={{ fontSize:13, color:'#0f172a', lineHeight:1.7 }}>{evaluation.blockF_interviewPrep.caseStudyRecommendation}</div>
                  </div>
                )}
                {(evaluation.blockF_interviewPrep.redFlagQuestions||[]).length>0 && (
                  <div style={{ padding:'16px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:12 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#b45309', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>Red-Flag Questions</div>
                    {evaluation.blockF_interviewPrep.redFlagQuestions.map((q,i)=>(
                      <div key={i} style={{ padding:'10px 0', borderBottom:'1px solid #fef3c7' }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'#78350f', marginBottom:4 }}>Q: {q.question}</div>
                        <div style={{ fontSize:12, color:'#0f172a', lineHeight:1.5 }}>A: {q.answer}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Block G — Posting Legitimacy */}
            {activeBlock==='g' && evaluation.blockG_legitimacy && (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {evaluation.blockG_legitimacy.assessment && (() => {
                  const a = evaluation.blockG_legitimacy.assessment
                  const col = a==='High Confidence' ? '#16a34a' : a==='Suspicious' ? '#dc2626' : '#ca8a04'
                  const bg  = a==='High Confidence' ? '#f0fdf4' : a==='Suspicious' ? '#fef2f2' : '#fefce8'
                  return (
                    <div style={{ padding:'16px', background:bg, border:`1.5px solid ${col}40`, borderRadius:12 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:col, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Assessment</div>
                      <div style={{ fontSize:18, fontWeight:800, color:col }}>{a}</div>
                    </div>
                  )
                })()}
                {(evaluation.blockG_legitimacy.signals||[]).length>0 && (
                  <div style={{ padding:'16px', background:'#fff', borderRadius:12, border:'1px solid #e2e8f0' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>Signals</div>
                    {evaluation.blockG_legitimacy.signals.map((s,i)=>{
                      const col = s.weight==='Positive' ? '#16a34a' : s.weight==='Concerning' ? '#dc2626' : '#64748b'
                      return (
                        <div key={i} style={{ padding:'10px 0', borderBottom:'1px solid #f1f5f9' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                            <span style={{ fontSize:12, fontWeight:700, color:'#0f172a' }}>{s.signal}</span>
                            <span style={{ fontSize:10, padding:'2px 8px', borderRadius:6, background:col, color:'#fff', fontWeight:700 }}>{s.weight}</span>
                          </div>
                          <div style={{ fontSize:12, color:'#475569', lineHeight:1.5 }}>{s.finding}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {evaluation.blockG_legitimacy.contextNotes && (
                  <div style={{ padding:'14px', background:'#f8fafc', borderRadius:10 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Context</div>
                    <div style={{ fontSize:12, color:'#475569', lineHeight:1.6 }}>{evaluation.blockG_legitimacy.contextNotes}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Company Detail (main export) ──────────────────────────────────────────────
export default function CompanyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]           = useState('job-scraper')
  const [status, setStatus]     = useState('new')
  const [autoAnalyze, setAutoAnalyze] = useState(false)
  const isPhone = useMediaQuery('(max-width: 480px)')

  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = CD_CSS
    document.head.appendChild(el)
    return () => el.remove()
  }, [])

  useEffect(() => {
    setLoading(true)
    api.jobs.detail(id).then(d => {
      setData(d)
      setStatus(d.company?.status || 'new')
    }).catch(() => {}).finally(() => setLoading(false))
  }, [id])

  async function onStatusChange(newStatus) {
    setStatus(newStatus)
    try { await api.jobs.updateStatus(id, newStatus) } catch (_) {}
  }

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <Spin size={32} />
    </div>
  )

  if (!data) return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#64748b' }}>
      <div style={{ fontSize:40, marginBottom:12 }}>🏢</div>
      <div style={{ fontSize:16, fontWeight:700, color:'#475569', marginBottom:8 }}>Company not found</div>
      <button onClick={() => navigate('/')} style={{ padding:'9px 18px', background:'#6366f1', color:'#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:700, cursor:'pointer' }}>
        ← Back to Companies
      </button>
    </div>
  )

  const { company, contacts, roles } = data
  const isYC = !!(company.yc_batch || company.source?.includes('yc'))
  const tags = (() => { try { return JSON.parse(company.tags || '[]') } catch { return [] } })()
  const aColor = avatarColor(company.name)
  const stColor = STATUS_COLORS[status] || STATUS_COLORS.new

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Header section */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', flexShrink:0 }}>
        {/* Breadcrumb */}
        <div style={{ padding:'14px 32px 0', fontSize:12, color:'#94a3b8' }}>
          <Link to="/companies" style={{ color:'#6366f1', textDecoration:'none', fontWeight:600 }}>← Companies</Link>
          {company.category && (
            <>
              {' / '}
              <Link to={`/category/${encodeURIComponent(company.category)}`} style={{ color:'#6366f1', textDecoration:'none', fontWeight:600 }}>
                {company.category}
              </Link>
            </>
          )}
          {' / '}
          <span style={{ color:'#0f172a', fontWeight:700 }}>{company.name}</span>
        </div>

        {/* Company header */}
        <div style={{ padding:'16px 32px 0', display:'flex', alignItems:'flex-start', gap:16 }}>
          <div style={{ width:52, height:52, borderRadius:12, background:aColor, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:22, fontWeight:800, flexShrink:0 }}>
            {company.name[0].toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:4, flexWrap:'wrap' }}>
              <h1 style={{ fontSize:22, fontWeight:800, color:'#0f172a', margin:0 }}>{company.name}</h1>
              {(() => {
                const web = company.website || ''
                // Don't surface ATS hostnames (workday/greenhouse/etc) as the
                // "website" — they're scrape artifacts, not the real company.
                const isAts = /workday|myworkdayjobs|greenhouse|lever\.co|ashbyhq|ashby|icims|smartrecruiters|recruitee|workable|jobvite/i.test(web)
                if (!web || isAts) return null
                const href = web.startsWith('http') ? web : `https://${web}`
                const label = href.replace(/^https?:\/\//, '').replace(/\/$/, '')
                return (
                  <a href={href} target="_blank" rel="noreferrer"
                    style={{ fontSize:12, color:'#6366f1', textDecoration:'none', fontWeight:600 }}>
                    {label} →
                  </a>
                )
              })()}
              {isYC && (company.tag || company.url) && (
                <a href={company.url || `https://www.workatastartup.com/companies/${company.tag}`} target="_blank" rel="noreferrer"
                  style={{ fontSize:12, color:'#c2410c', textDecoration:'none', fontWeight:600, background:'#fff7ed', padding:'3px 10px', borderRadius:6, border:'1px solid #fed7aa' }}>
                  View on WaaS →
                </a>
              )}
              {isYC && company.yc_batch && (
                <span style={{ fontSize:10, padding:'3px 8px', borderRadius:6, background:'rgba(242,102,37,0.1)', color:'#F26625', fontWeight:700, border:'1px solid rgba(242,102,37,0.2)' }}>
                  {company.yc_batch}
                </span>
              )}
            </div>
            {getDescription(company) && (
              <p style={{ fontSize:13, color:'#475569', margin:'0 0 8px', lineHeight:1.4 }}>
                {getDescription(company).slice(0, 220)}
              </p>
            )}
            <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:8 }}>
              {company.location && <span style={{ fontSize:12, color:'#64748b' }}>📍 {company.location}</span>}
              {company.team_size && <span style={{ fontSize:12, color:'#64748b' }}>👥 {company.team_size} people</span>}
              {company.category && <span style={{ fontSize:11, color:'#64748b', padding:'2px 7px', background:'#f1f5f9', borderRadius:4 }}>{company.subcategory || company.category}</span>}
              {tags.slice(0,4).map(t => (
                <span key={t} style={{ fontSize:10, padding:'2px 8px', background:'#eff6ff', color:'#4f46e5', borderRadius:20, border:'1px solid #c7d2fe', fontWeight:600 }}>{t}</span>
              ))}
            </div>
          </div>
          {/* Status dropdown — themed Dropdown so the iOS picker doesn't
              cover the page when tapped on mobile. */}
          <div style={{ flexShrink:0, minWidth:150 }}>
            <Dropdown
              ariaLabel="Company status"
              value={status}
              onChange={onStatusChange}
              options={[
                { value:'new',         label:'New' },
                { value:'researching', label:'Researching' },
                { value:'contacted',   label:'Contacted' },
                { value:'responded',   label:'Responded' },
                { value:'skip',        label:'Skip' },
              ]}
            />
          </div>
        </div>

        {/* Tabs — TabPicker dropdown on phone, horizontal strip on desktop. */}
        {isPhone ? (
          <div style={{ borderTop:'1px solid #f1f5f9', marginTop:12, padding:'12px 16px 14px' }}>
            <TabPicker
              tabs={[
                { id:'job-scraper',    icon:'🔍', full:'Job Scraper' },
                { id:'career-ops',     icon:'🧠', full:'Career Ops' },
                { id:'outreach',       icon:'✉',  full:'Outreach' },
                { id:'job-automation', icon:'🤖', full:'Job Automation' },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>
        ) : (
          <div style={{ display:'flex', borderTop:'1px solid #f1f5f9', marginTop:12, paddingLeft:16 }}>
            {[['job-scraper','Job Scraper'],['career-ops','Career Ops'],['outreach','Outreach'],['job-automation','Job Automation']].map(([t, l]) => (
              <button key={t} className={`cd-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab content */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {tab === 'outreach'       && <OutreachTab company={company} contacts={contacts} />}
        {tab === 'career-ops'     && <CareerOpsTab company={company} roles={roles} autoAnalyze={autoAnalyze} onAnalyzeDone={() => setAutoAnalyze(false)} />}
        {tab === 'job-scraper'    && <JobScraperTab company={company} onTabSwitch={(t, opts) => { if (opts?.analyze) setAutoAnalyze(true); setTab(t); }} />}
        {tab === 'job-automation' && <JobAutomationTab company={company} roles={roles} />}
      </div>
    </div>
  )
}

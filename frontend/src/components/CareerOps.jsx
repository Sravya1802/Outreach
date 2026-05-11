import React, { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import { useMediaQuery } from '../hooks'
import TabPicker from './TabPicker'

// ── Inject styles ─────────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('co-styles')) return
  const s = document.createElement('style')
  s.id = 'co-styles'
  s.textContent = `
    @keyframes cospin { to { transform: rotate(360deg); } }
    @keyframes cofade { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
    .co-fade { animation: cofade 0.22s ease; }
    .co-card:hover { box-shadow: 0 4px 18px rgba(99,102,241,0.12) !important; border-color: #c7d2fe !important; }
    .co-block summary { cursor: pointer; user-select: none; list-style: none; }
    .dropzone-active { border-color: #6366f1 !important; background: #eef2ff !important; }
  `
  document.head.appendChild(s)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function gradeColor(g) { return { A:'#16a34a', B:'#0d9488', C:'#d97706', D:'#ea580c', F:'#dc2626' }[g] || '#94a3b8' }

// Best-effort client-side extraction of role title + company from a job URL.
// Used by the Evaluate loading panel so the user sees *what's* being
// evaluated during the AI call, instead of a generic spinner.
//
// Handles the four ATS we deeply support — Workday, Ashby, Greenhouse, Lever
// — by parsing the URL slug. Falls back to null when the slug is opaque
// (LinkedIn job IDs, generic boards). The backend still does the canonical
// extraction; this is just a fast preview.
function extractJobMetaFromUrl(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const parts = u.pathname.split('/').filter(Boolean)

    // Slug → human title: split on dashes/underscores, strip trailing
    // jobReqId tokens (R-1089, J123, etc.), title-case the rest.
    const slugToTitle = (slug) => {
      if (!slug) return null
      // Drop trailing _R-1089 / _J123 / _0123 jobReqId-style suffixes
      const trimmed = slug.replace(/[_-](?:R[-_]?\d+|J\d+|\d{4,})$/i, '')
      const words = trimmed.split(/[-_]+/).filter(Boolean)
      if (!words.length) return null
      return words.map(w => w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    }

    // Workday — myworkdayjobs.com tenant. Path: [/locale]/<site>/job/<location>/<slug>
    if (/myworkdayjobs\.com$/.test(host)) {
      const tenant = host.split('.')[0]
      const startIdx = /^[a-z]{2}-[a-z]{2}$/i.test(parts[0]) ? 1 : 0
      const tail = parts.slice(startIdx)
      const slug = tail[tail.length - 1]
      const title = slugToTitle(slug)
      if (title) return { title, company: tenant.charAt(0).toUpperCase() + tenant.slice(1) }
    }
    // Greenhouse boards — boards.greenhouse.io/<board>/jobs/<id>
    if (/^(boards|job-boards)\.greenhouse\.io$/.test(host)) {
      const board = parts[0]
      if (board) return { title: null, company: board.charAt(0).toUpperCase() + board.slice(1) }
    }
    // Lever — jobs.lever.co/<org>/<id>. id is a UUID, no title in URL.
    if (host === 'jobs.lever.co') {
      const org = parts[0]
      if (org) return { title: null, company: org.charAt(0).toUpperCase() + org.slice(1) }
    }
    // Ashby — jobs.ashbyhq.com/<org>/<jobId>. jobId is UUID, no title.
    if (host === 'jobs.ashbyhq.com') {
      const org = parts[0]
      if (org) return { title: null, company: org }
    }
    return null
  } catch { return null }
}
function gradeBg(g)    { return { A:'#dcfce7', B:'#ccfbf1', C:'#fef3c7', D:'#ffedd5', F:'#fee2e2' }[g] || '#f8fafc' }

function Spin({ size=16, color='#6366f1' }) {
  return <span style={{ display:'inline-block', width:size, height:size, border:`2px solid ${color}25`, borderTopColor:color, borderRadius:'50%', animation:'cospin 0.7s linear infinite', flexShrink:0 }} />
}

function ScoreBar({ label, value, max=10 }) {
  const pct = (value / max) * 100
  const color = pct >= 70 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626'
  const display = label.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#374151', marginBottom:4 }}>
        <span>{display}</span>
        <span style={{ fontWeight:700, color }}>{value}/10</span>
      </div>
      <div style={{ height:6, background:'#f1f5f9', borderRadius:4, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:4, transition:'width 0.6s ease' }} />
      </div>
    </div>
  )
}

function Block({ title, icon, defaultOpen=false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border:'1px solid #e2e8f0', borderRadius:12, marginBottom:10, overflow:'hidden' }}>
      <div onClick={() => setOpen(v=>!v)}
        style={{ display:'flex', alignItems:'center', gap:10, padding:'13px 16px', background: open ? '#fafafa' : '#fff', cursor:'pointer', borderBottom: open ? '1px solid #f1f5f9':'none', transition:'background 0.12s' }}>
        <span style={{ fontSize:17 }}>{icon}</span>
        <span style={{ fontSize:14, fontWeight:700, color:'#0f172a', flex:1 }}>{title}</span>
        <span style={{ fontSize:12, color:'#94a3b8', transition:'transform 0.2s', display:'inline-block', transform: open ? 'rotate(90deg)':'rotate(0deg)' }}>▶</span>
      </div>
      {open && <div style={{ padding:'16px' }}>{children}</div>}
    </div>
  )
}

// Inline "Why?" expander — drops a chevron button next to a verdict and
// reveals reasoning prose underneath when clicked. Used on per-row verdicts
// (CV match status, demand trend, etc.) so users can drill into "why this
// got flagged" without leaving the block.
function JustifyToggle({ reasoning, color = '#6366f1', label = 'Why?' }) {
  const [open, setOpen] = useState(false)
  if (!reasoning) return null
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
        style={{ marginLeft:6, padding:'1px 7px', fontSize:9, fontWeight:700, background:'transparent', color, border:`1px solid ${color}50`, borderRadius:5, cursor:'pointer', letterSpacing:'0.04em' }}>
        {open ? '▲ Hide' : `▼ ${label}`}
      </button>
      {open && (
        <div style={{ marginTop:6, padding:'8px 10px', background:'#f8fafc', borderLeft:`2px solid ${color}40`, borderRadius:'0 6px 6px 0', fontSize:11, color:'#475569', lineHeight:1.6, fontStyle:'italic' }}>
          {reasoning}
        </div>
      )}
    </>
  )
}

// ── Resume upload ─────────────────────────────────────────────────────────────
function ResumeUpload({ resumeInfo, onUploaded }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef()

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') { setError('PDF files only, please.'); return }
    setUploading(true); setError(null)
    try {
      const r = await api.career.uploadResume(file)
      if (!r.success) throw new Error(r.error || 'Upload failed')
      onUploaded(r)
    } catch (err) { setError(err.message) }
    finally { setUploading(false) }
  }

  if (resumeInfo?.hasResume) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 18px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:12 }}>
        <div style={{ width:40, height:40, borderRadius:10, background:'#dcfce7', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>📄</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#166534' }}>{resumeInfo.name}</div>
          <div style={{ fontSize:11, color:'#15803d', marginTop:2 }}>
            Uploaded {resumeInfo.date ? new Date(resumeInfo.date).toLocaleDateString() : ''}
          </div>
        </div>
        <button onClick={() => fileRef.current.click()} style={{ padding:'7px 16px', fontSize:12, fontWeight:700, background:'#fff', color:'#374151', border:'1px solid #e2e8f0', borderRadius:8, cursor:'pointer' }}>
          Replace
        </button>
        <input ref={fileRef} type="file" accept=".pdf" style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
      </div>
    )
  }

  return (
    <div>
      <div className={dragging ? 'dropzone-active' : ''}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
        onClick={() => fileRef.current.click()}
        style={{ border:'2px dashed #c7d2fe', borderRadius:12, padding:'36px', textAlign:'center', cursor:'pointer', background:'#fafbff', transition:'all 0.15s' }}>
        {uploading ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, color:'#6366f1', fontSize:13, fontWeight:600 }}>
            <Spin /> Parsing PDF…
          </div>
        ) : (
          <>
            <div style={{ fontSize:36, marginBottom:10 }}>📤</div>
            <div style={{ fontSize:14, fontWeight:700, color:'#374151', marginBottom:4 }}>Drop your resume PDF here</div>
            <div style={{ fontSize:12, color:'#94a3b8' }}>or click to browse · PDF only · max 10MB</div>
          </>
        )}
        <input ref={fileRef} type="file" accept=".pdf" style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
      </div>
      {error && <div style={{ marginTop:8, fontSize:12, color:'#dc2626', fontWeight:600 }}>⚠ {error}</div>}
    </div>
  )
}

// ── Evaluation report — renders santifer's A-G schema ────────────────────────
function EvaluationReport({ evaluation: e, onGeneratePDF, pdfLoading, pdfReady, onDownloadPdf, applyMode, applyStatus, onApplyModeChange, onApply, applying, onQueue, queuing }) {
  const gc = gradeColor(e.grade)
  const gb = gradeBg(e.grade)
  const [showJustify, setShowJustify] = useState(false)

  // Legitimacy assessment → color + plain-English meaning.
  // Santifer's G block uses: "High Confidence" / "Proceed with Caution" / "Suspicious".
  const legitAssess = e.blockG_legitimacy?.assessment || 'Proceed with Caution'
  const legitMeta = legitAssess === 'High Confidence'
    ? { color:'#16a34a', bg:'#dcfce7', hint:'Multiple signals suggest this is a real, active opening — safe to invest effort.' }
    : legitAssess === 'Suspicious'
    ? { color:'#dc2626', bg:'#fee2e2', hint:'Multiple ghost-job indicators. Investigate (layoffs, posting age, reposts) before applying.' }
    : { color:'#d97706', bg:'#fef3c7', hint:'Mixed signals — consider applying but don\'t over-invest until you confirm the role is live.' }
  const hasSignals = (e.blockG_legitimacy?.signals || []).length > 0

  return (
    <div className="co-fade">
      {/* Grade header card */}
      <div style={{ display:'flex', alignItems:'center', gap:20, padding:'22px 24px', background:gb, border:`1px solid ${gc}30`, borderRadius:16, marginBottom:20, flexWrap:'wrap' }}>
        <div style={{ width:76, height:76, borderRadius:'50%', background:`${gc}20`, border:`3px solid ${gc}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <span style={{ fontSize:34, fontWeight:900, color:gc }}>{e.grade}</span>
        </div>
        <div style={{ flex:1, minWidth:220 }}>
          <div style={{ fontSize:19, fontWeight:800, color:'#0f172a', marginBottom:4 }}>
            {e.jobTitle} <span style={{ fontWeight:400, color:'#64748b', fontSize:16 }}>at</span> {e.companyName}
          </div>
          <div style={{ fontSize:13, fontWeight:700, color:gc, marginBottom:4 }}>{e.recommendation}</div>
          <div style={{ fontSize:12, color:'#64748b' }}>
            Score: <strong>{e.globalScore ? e.globalScore.toFixed(1) : (e.overallScore / 20).toFixed(1)}/5.0</strong>
            {e.archetype?.primary && <> · Archetype: <strong>{e.archetype.primary}</strong>{e.archetype.secondary ? ` / ${e.archetype.secondary}` : ''}</>}
          </div>
        </div>

        {/* Apply mode toggle + Apply button */}
        <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'stretch', minWidth:200 }}>
          <div style={{ display:'inline-flex', background:'#fff', borderRadius:9, padding:3, border:'1px solid #e2e8f0' }}>
            {[['manual','👤 Manual'],['auto','⚡ Auto']].map(([k, l]) => (
              <button key={k} onClick={() => onApplyModeChange?.(k)}
                style={{ padding:'6px 14px', fontSize:11, fontWeight:700, border:'none', borderRadius:7, cursor:'pointer', flex:1,
                  background: applyMode === k ? (k === 'auto' ? '#7c3aed' : '#4f46e5') : 'transparent',
                  color: applyMode === k ? '#fff' : '#64748b',
                  transition:'all 0.12s' }}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={onApply} disabled={applying}
            style={{ padding:'9px 18px', fontSize:12, fontWeight:700, background: applying ? '#f1f5f9' : (applyMode === 'auto' ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : 'linear-gradient(135deg,#6366f1,#4f46e5)'), color: applying ? '#64748b' : '#fff', border:'none', borderRadius:9, cursor: applying ? 'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
            {applying
              ? <><Spin size={13} color="#64748b" /> Working…</>
              : applyStatus === 'submitted' ? '✓ Submitted'
              : applyStatus === 'opened' ? (applyMode === 'auto' ? '⚡ Run auto apply' : '↗ Open again')
              : applyStatus === 'queued' ? '⋯ Queued for auto apply'
              : (applyMode === 'auto' ? '⚡ Auto apply' : '↗ Open & apply')}
          </button>
          <div style={{ fontSize:10, color:'#94a3b8', textAlign:'center', lineHeight:1.4 }}>
            {applyMode === 'auto'
              ? 'Playwright worker submits for you'
              : 'Opens the job page — you submit'}
          </div>
          {/* Queue-only path: sets mode=auto + status=queued without running.
              Resume selection at run time, in order: per-eval upload (if the
              user attached one via the 📎 Upload button) → archetype library
              match → closest library resume by keyword score. */}
          {applyStatus !== 'submitted' && applyStatus !== 'queued' && (
            <button onClick={onQueue} disabled={queuing}
              style={{ padding:'7px 14px', fontSize:11, fontWeight:700, background:'#fff', color:'#7c3aed', border:'1px solid #ddd6fe', borderRadius:8, cursor: queuing ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
              {queuing ? <><Spin size={11} color="#7c3aed" /> Queuing…</> : '＋ Add to Auto-Apply Queue'}
            </button>
          )}
          {applyStatus === 'queued' && (
            <div style={{ padding:'7px 14px', fontSize:11, fontWeight:700, background:'#f5f3ff', color:'#7c3aed', border:'1px solid #ddd6fe', borderRadius:8, textAlign:'center' }}>
              ✓ In auto-apply queue
            </div>
          )}
          {pdfReady ? (
            <button onClick={onDownloadPdf} style={{ padding:'8px 14px', fontSize:11, fontWeight:700, background:'#16a34a', color:'#fff', border:'none', borderRadius:8, textAlign:'center', cursor:'pointer' }}>
              ⬇ Download Tailored CV
            </button>
          ) : (
            <button onClick={onGeneratePDF} disabled={pdfLoading}
              style={{ padding:'8px 14px', fontSize:11, fontWeight:700, background:'#fff', color:'#4f46e5', border:'1px solid #c7d2fe', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
              {pdfLoading ? <><Spin size={11} color="#4f46e5" /> Generating…</> : '✨ Tailored CV PDF'}
            </button>
          )}
        </div>
      </div>

      {/* Verdict — Claude.ai-style one-liner + buried match + interview odds */}
      {e.verdict && (
        <div style={{ background:'linear-gradient(135deg,#fafafa,#f8fafc)', border:'2px solid #1e293b', borderRadius:14, padding:'18px 22px', marginBottom:18 }}>
          <div style={{ fontSize:10, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:8 }}>Verdict</div>
          <div style={{ fontSize:18, fontWeight:800, color:'#0f172a', marginBottom:8, lineHeight:1.35 }}>{e.verdict.headline}</div>
          {e.verdict.oneLineWhy && (
            <div style={{ fontSize:13, color:'#374151', lineHeight:1.6, marginBottom:e.verdict.buriedMatch ? 12 : 0 }}>{e.verdict.oneLineWhy}</div>
          )}
          {e.verdict.buriedMatch && (
            <div style={{ marginTop:10, padding:'12px 14px', background:'#fef3c7', borderRadius:9, border:'1px solid #fcd34d' }}>
              <div style={{ fontSize:10, fontWeight:800, color:'#92400e', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>⚠ Buried match</div>
              <div style={{ fontSize:12, color:'#374151', lineHeight:1.6 }}>{e.verdict.buriedMatch}</div>
            </div>
          )}
          {e.verdict.interviewOdds && (
            <div style={{ marginTop:14, display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div style={{ padding:'12px 14px', background:'#fee2e2', borderRadius:9, border:'1px solid #fca5a5' }}>
                <div style={{ fontSize:10, fontWeight:800, color:'#991b1b', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>As-is</div>
                <div style={{ fontSize:18, fontWeight:900, color:'#0f172a' }}>{e.verdict.interviewOdds.asIs}</div>
              </div>
              <div style={{ padding:'12px 14px', background:'#dcfce7', borderRadius:9, border:'1px solid #86efac' }}>
                <div style={{ fontSize:10, fontWeight:800, color:'#15803d', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>Tailored</div>
                <div style={{ fontSize:18, fontWeight:900, color:'#0f172a' }}>{e.verdict.interviewOdds.properlyTailored}</div>
              </div>
              {e.verdict.interviewOdds.reasoning && (
                <div style={{ gridColumn:'1 / -1', fontSize:11, color:'#64748b', lineHeight:1.6, fontStyle:'italic' }}>
                  {e.verdict.interviewOdds.reasoning}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Top 3 Gaps — most actionable insights */}
      {(e.topGaps || []).length > 0 && (
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Top 3 gaps to fix</div>
          {e.topGaps.slice(0, 3).map((g, i) => {
            const sevColor = g.severity === 'blocker' ? '#dc2626' : g.severity === 'high' ? '#d97706' : '#6366f1'
            const sevBg    = g.severity === 'blocker' ? '#fee2e2' : g.severity === 'high' ? '#fef3c7' : '#eef2ff'
            return (
              <div key={i} style={{ padding:'14px 16px', marginBottom:8, background:'#fff', borderRadius:11, border:'1px solid #e2e8f0', borderLeft:`4px solid ${sevColor}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                  <span style={{ fontSize:18, fontWeight:900, color:sevColor, width:24 }}>{i + 1}.</span>
                  <span style={{ fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:6, background: sevBg, color: sevColor, textTransform:'uppercase', letterSpacing:'0.08em' }}>{g.severity}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:'#0f172a', flex:1 }}>{g.gap}</span>
                </div>
                <div style={{ fontSize:12, color:'#374151', lineHeight:1.65, paddingLeft:34 }}>
                  <strong style={{ color:'#16a34a' }}>Fix:</strong> {g.fix}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Block A — Role Summary */}
      <Block title="A · Role Summary" icon="📋" defaultOpen={true}>
        <p style={{ fontSize:13, color:'#374151', lineHeight:1.75, marginBottom:14 }}>{e.blockA_roleSummary?.tldr}</p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
          {[
            ['Archetype', e.blockA_roleSummary?.archetypeDetected],
            ['Domain', e.blockA_roleSummary?.domain],
            ['Function', e.blockA_roleSummary?.function],
            ['Seniority', e.blockA_roleSummary?.seniority],
            ['Remote', e.blockA_roleSummary?.remote],
            ['Team', e.blockA_roleSummary?.teamSize],
          ].map(([lbl, val]) => val && (
            <div key={lbl} style={{ padding:'10px 12px', background:'#f8fafc', borderRadius:8, border:'1px solid #f1f5f9' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:3 }}>{lbl}</div>
              <div style={{ fontSize:12, fontWeight:600, color:'#0f172a' }}>{val}</div>
            </div>
          ))}
        </div>
        {e.archetype?.reasoning && (
          <div style={{ marginTop:12 }}>
            <span style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em' }}>Archetype rationale</span>
            <JustifyToggle reasoning={e.archetype.reasoning} label="Why this archetype?" />
          </div>
        )}
      </Block>

      {/* Block B — CV Match */}
      <Block title="B · CV Match" icon="📊" defaultOpen={true}>
        <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>Requirements vs Your CV</div>
        {(e.blockB_cvMatch?.requirements || []).map((r, i) => {
          const statusColor = r.status === 'match' ? '#16a34a' : r.status === 'partial' ? '#d97706' : '#dc2626'
          return (
            <div key={i} style={{ padding:'10px 12px', marginBottom:6, background: r.status === 'match' ? '#f0fdf4' : r.status === 'partial' ? '#fffbeb' : '#fef2f2', borderRadius:8, borderLeft:`3px solid ${statusColor}` }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                <span style={{ fontSize:10, fontWeight:700, padding:'1px 7px', borderRadius:10, background: r.status === 'match' ? '#dcfce7' : r.status === 'partial' ? '#fef3c7' : '#fee2e2', color: r.status === 'match' ? '#15803d' : r.status === 'partial' ? '#92400e' : '#991b1b' }}>
                  {r.status}
                </span>
                <span style={{ fontSize:12, fontWeight:700, color:'#0f172a', flex:1 }}>{r.requirement}</span>
                <JustifyToggle reasoning={r.reasoning} color={statusColor} label="Why?" />
              </div>
              <div style={{ fontSize:11, color:'#64748b', lineHeight:1.55 }}>{r.cvEvidence}</div>
            </div>
          )
        })}
        {(e.blockB_cvMatch?.gaps || []).length > 0 && (
          <>
            <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginTop:14, marginBottom:10 }}>Gap Mitigation</div>
            {e.blockB_cvMatch.gaps.map((g, i) => (
              <div key={i} style={{ padding:'10px 12px', marginBottom:6, background:'#fef2f2', borderRadius:8, border:'1px solid #fecaca' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                  <span style={{ fontSize:10, fontWeight:700, padding:'1px 7px', borderRadius:10, background: g.severity === 'hard blocker' ? '#fee2e2' : '#fef3c7', color: g.severity === 'hard blocker' ? '#991b1b' : '#92400e' }}>
                    {g.severity}
                  </span>
                  <span style={{ fontSize:12, fontWeight:700, color:'#0f172a' }}>{g.gap}</span>
                </div>
                {g.adjacentExperience && <div style={{ fontSize:11, color:'#475569', marginBottom:3 }}>Adjacent: {g.adjacentExperience}</div>}
                <div style={{ fontSize:11, color:'#374151', fontStyle:'italic' }}>→ {g.mitigation}</div>
              </div>
            ))}
          </>
        )}
      </Block>

      {/* Block C — Level & Strategy */}
      <Block title="C · Level & Strategy" icon="🎯">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
          <div style={{ padding:'10px 12px', background:'#eef2ff', borderRadius:8 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#4f46e5', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:3 }}>JD Level</div>
            <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>{e.blockC_levelAndStrategy?.jdLevel || 'Unknown'}</div>
          </div>
          <div style={{ padding:'10px 12px', background:'#f0fdf4', borderRadius:8 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#16a34a', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:3 }}>Your Natural Level</div>
            <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>{e.blockC_levelAndStrategy?.candidateNaturalLevel || 'Unknown'}</div>
          </div>
        </div>
        {(e.blockC_levelAndStrategy?.sellSeniorPlan || []).length > 0 && (
          <>
            <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>"Sell senior without lying" tactics</div>
            {e.blockC_levelAndStrategy.sellSeniorPlan.map((p, i) => (
              <div key={i} style={{ fontSize:12, color:'#374151', marginBottom:6, display:'flex', gap:8, lineHeight:1.6 }}>
                <span style={{ color:'#6366f1', flexShrink:0 }}>→</span>{p}
              </div>
            ))}
          </>
        )}
        {(e.blockC_levelAndStrategy?.ifDownleveledPlan || []).length > 0 && (
          <div style={{ marginTop:12, padding:'10px 12px', background:'#fffbeb', borderRadius:8, border:'1px solid #fde68a' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:5 }}>If they downlevel you</div>
            {e.blockC_levelAndStrategy.ifDownleveledPlan.map((p, i) => (
              <div key={i} style={{ fontSize:11, color:'#374151', marginBottom:3 }}>· {p}</div>
            ))}
          </div>
        )}
      </Block>

      {/* Block D — Comp & Demand */}
      <Block title="D · Comp & Demand" icon="💰">
        <div style={{ padding:'14px 16px', background:'#f0fdf4', borderRadius:10, marginBottom:14, border:'1px solid #bbf7d0' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#16a34a', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.07em' }}>Estimated Range</div>
          <div style={{ fontSize:18, fontWeight:800, color:'#0f172a' }}>{e.blockD_compAndDemand?.salaryRange || 'Not available'}</div>
          {e.blockD_compAndDemand?.companyCompReputation && (
            <div style={{ fontSize:11, color:'#475569', marginTop:5, lineHeight:1.5 }}>{e.blockD_compAndDemand.companyCompReputation}</div>
          )}
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:8, alignItems:'center' }}>
          <span style={{ fontSize:11, padding:'4px 10px', borderRadius:20, background:'#eef2ff', color:'#4f46e5', fontWeight:600 }}>
            Demand: {e.blockD_compAndDemand?.roleDemandTrend || 'unknown'}
          </span>
          {(e.blockD_compAndDemand?.sources || []).map((s, i) => (
            <span key={i} style={{ fontSize:11, padding:'4px 10px', borderRadius:20, background:'#f1f5f9', color:'#475569', fontWeight:500 }}>{s}</span>
          ))}
          <JustifyToggle reasoning={e.blockD_compAndDemand?.reasoning} color="#4f46e5" label="Why this trend?" />
        </div>
      </Block>

      {/* Block E — Personalization */}
      <Block title="E · CV & LinkedIn Edits" icon="✏">
        {(e.blockE_personalization?.cvChanges || []).length > 0 && (
          <>
            <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>CV Changes</div>
            {e.blockE_personalization.cvChanges.map((c, i) => (
              <div key={i} style={{ padding:'10px 12px', marginBottom:6, background:'#f8fafc', borderRadius:8, borderLeft:'3px solid #6366f1' }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#0f172a', marginBottom:3 }}>{c.section}</div>
                <div style={{ fontSize:11, color:'#64748b', marginBottom:3 }}><strong>Before:</strong> {c.currentState}</div>
                <div style={{ fontSize:11, color:'#16a34a', marginBottom:3 }}><strong>After:</strong> {c.proposedChange}</div>
                <div style={{ fontSize:10, color:'#94a3b8', fontStyle:'italic' }}>Why: {c.why}</div>
              </div>
            ))}
          </>
        )}
        {(e.blockE_personalization?.linkedinChanges || []).length > 0 && (
          <>
            <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginTop:14, marginBottom:10 }}>LinkedIn Changes</div>
            {e.blockE_personalization.linkedinChanges.map((c, i) => (
              <div key={i} style={{ fontSize:12, color:'#374151', marginBottom:5, display:'flex', gap:7 }}>
                <span style={{ color:'#0077b5', flexShrink:0 }}>·</span>{c}
              </div>
            ))}
          </>
        )}
      </Block>

      {/* Block F — Interview Prep */}
      <Block title="F · Interview Prep" icon="🎤">
        {(e.blockF_interviewPrep?.starStories || []).length > 0 && (
          <>
            <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>STAR+R stories mapped to the JD</div>
            {e.blockF_interviewPrep.starStories.map((s, i) => (
              <div key={i} style={{ padding:'11px 14px', marginBottom:8, background:'#fafafa', borderRadius:9, borderLeft:'3px solid #7c3aed' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#7c3aed', marginBottom:4 }}>Maps to: {s.jdRequirement}</div>
                <div style={{ fontSize:12, color:'#0f172a', lineHeight:1.55 }}>
                  <strong>S</strong>: {s.situation}<br/>
                  <strong>T</strong>: {s.task}<br/>
                  <strong>A</strong>: {s.action}<br/>
                  <strong>R</strong>: {s.result}
                </div>
                {s.reflection && <div style={{ fontSize:11, color:'#475569', marginTop:4, fontStyle:'italic' }}>Reflection: {s.reflection}</div>}
              </div>
            ))}
          </>
        )}
        {e.blockF_interviewPrep?.caseStudyRecommendation && (
          <div style={{ padding:'12px 14px', background:'#fef3c7', borderRadius:9, marginTop:10, border:'1px solid #fde68a' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#d97706', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.07em' }}>Case Study Recommendation</div>
            <p style={{ fontSize:12, color:'#374151', lineHeight:1.65, margin:0 }}>{e.blockF_interviewPrep.caseStudyRecommendation}</p>
          </div>
        )}
        {(e.blockF_interviewPrep?.redFlagQuestions || []).length > 0 && (
          <>
            <div style={{ fontSize:11, fontWeight:700, color:'#dc2626', textTransform:'uppercase', letterSpacing:'0.07em', marginTop:14, marginBottom:10 }}>⚠ Red-flag questions</div>
            {e.blockF_interviewPrep.redFlagQuestions.map((q, i) => (
              <div key={i} style={{ padding:'10px 12px', marginBottom:6, background:'#fef2f2', borderRadius:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#991b1b', marginBottom:4 }}>Q: {q.question}</div>
                <div style={{ fontSize:11, color:'#374151', lineHeight:1.55 }}>A: {q.answer}</div>
              </div>
            ))}
          </>
        )}
      </Block>

      {/* Block G — Legitimacy */}
      <Block title="G · Posting Legitimacy" icon="🔎" defaultOpen={true}>
        <div style={{ padding:'12px 14px', background: legitMeta.bg, borderRadius:9, marginBottom: showJustify ? 0 : 12, border:`1px solid ${legitMeta.color}30` }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
            <div style={{ fontSize:13, fontWeight:800, color: legitMeta.color }}>{legitAssess}</div>
            {hasSignals && (
              <button
                onClick={() => setShowJustify(v => !v)}
                style={{ padding:'4px 10px', fontSize:10, fontWeight:700, background:'transparent', color: legitMeta.color, border:`1px solid ${legitMeta.color}60`, borderRadius:6, cursor:'pointer', letterSpacing:'0.03em' }}>
                {showJustify ? '▲ Hide signals' : '▼ Why?'}
              </button>
            )}
          </div>
          <div style={{ fontSize:11, color:'#374151', lineHeight:1.55, marginTop:4 }}>{legitMeta.hint}</div>
        </div>

        {showJustify && hasSignals && (
          <div style={{ border:`1px solid ${legitMeta.color}30`, borderTop:'none', borderRadius:'0 0 9px 9px', marginBottom:12, overflow:'hidden' }}>
            <table style={{ width:'100%', fontSize:11, borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ borderBottom:'1px solid #e2e8f0', background:'#fafafa' }}>
                  <th style={{ textAlign:'left', padding:'6px 8px', color:'#94a3b8', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', fontSize:10 }}>Signal</th>
                  <th style={{ textAlign:'left', padding:'6px 8px', color:'#94a3b8', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', fontSize:10 }}>Finding</th>
                  <th style={{ textAlign:'center', padding:'6px 8px', color:'#94a3b8', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', fontSize:10, width:110 }}>Weight</th>
                </tr>
              </thead>
              <tbody>
                {e.blockG_legitimacy.signals.map((s, i) => {
                  const wColor = s.weight === 'Positive' ? '#16a34a' : s.weight === 'Concerning' ? '#dc2626' : '#64748b'
                  const wBg    = s.weight === 'Positive' ? '#dcfce7' : s.weight === 'Concerning' ? '#fee2e2' : '#f1f5f9'
                  return (
                    <tr key={i} style={{ borderBottom:'1px solid #f1f5f9' }}>
                      <td style={{ padding:'8px', color:'#0f172a', fontWeight:600, verticalAlign:'top' }}>{s.signal}</td>
                      <td style={{ padding:'8px', color:'#475569', lineHeight:1.55 }}>{s.finding}</td>
                      <td style={{ padding:'8px', textAlign:'center' }}>
                        <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background: wBg, color: wColor }}>
                          {s.weight}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {e.blockG_legitimacy?.contextNotes && (
              <div style={{ padding:'10px 12px', background:'#f8fafc', borderTop:'1px solid #f1f5f9', fontSize:11, color:'#475569', fontStyle:'italic', lineHeight:1.6 }}>
                {e.blockG_legitimacy.contextNotes}
              </div>
            )}
          </div>
        )}

        {!showJustify && e.blockG_legitimacy?.contextNotes && (
          <div style={{ marginTop:4, padding:'10px 12px', background:'#f8fafc', borderRadius:8, fontSize:11, color:'#475569', fontStyle:'italic', lineHeight:1.6 }}>
            {e.blockG_legitimacy.contextNotes}
          </div>
        )}
      </Block>

      {/* ATS Keywords */}
      {(e.atsKeywords || []).length > 0 && (
        <Block title="ATS Keywords" icon="🏷">
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {e.atsKeywords.map((k, i) => (
              <span key={i} style={{ padding:'4px 10px', background:'#eef2ff', color:'#4f46e5', borderRadius:20, fontSize:11, fontWeight:600 }}>{k}</span>
            ))}
          </div>
        </Block>
      )}
    </div>
  )
}

// ── Archetype upload card ─────────────────────────────────────────────────────
// One per role family (AI/ML, SWE, DS, DevOps, …). Supports click-to-upload
// AND drag-and-drop. Shows the current file with a friendly size + delete; if
// empty, the whole card becomes the dropzone so the affordance is obvious.
function ArchetypeUploadCard({ archetype, label, hint, files, filled, isUploading, storageConfigured, onUpload, onDelete }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)
  const disabled = !storageConfigured || isUploading
  function handleFiles(fileList) {
    const file = fileList?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      alert('Only PDF files are accepted')
      return
    }
    onUpload(file)
  }
  return (
    <div
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!disabled) handleFiles(e.dataTransfer.files) }}
      style={{
        padding:'12px 14px',
        border:`1px ${dragOver ? 'dashed' : 'solid'} ${dragOver ? '#6366f1' : filled ? '#bbf7d0' : '#e2e8f0'}`,
        borderRadius:10,
        background: dragOver ? '#eef2ff' : filled ? '#f0fdf4' : '#fafbff',
        transition:'all 0.12s',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onClick={(e) => {
        // Only trigger upload when the empty card is clicked. If there's an
        // existing file, ignore clicks on the card chrome — the user has to
        // delete first, or use the "Replace" pill explicitly.
        if (disabled || filled) return
        if (e.target.closest('button, label, input')) return
        inputRef.current?.click()
      }}
    >
      <input ref={inputRef} type="file" accept="application/pdf" disabled={disabled}
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
        style={{ display:'none' }} />
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
        <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background: filled ? '#dcfce7' : '#eef2ff', color: filled ? '#15803d' : '#4f46e5', textTransform:'uppercase' }}>{archetype}</span>
        <span style={{ fontSize:12, fontWeight:700, color:'#0f172a' }}>{label}</span>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); if (!disabled) inputRef.current?.click() }}
          disabled={disabled}
          style={{
            marginLeft:'auto', cursor: disabled ? 'not-allowed' : 'pointer',
            padding:'4px 10px', fontSize:11, fontWeight:700,
            background: disabled ? '#f1f5f9' : '#eef2ff',
            color:      disabled ? '#94a3b8' : '#4f46e5',
            border:`1px solid ${disabled ? '#e2e8f0' : '#c7d2fe'}`,
            borderRadius:6, opacity: isUploading ? 0.6 : 1, whiteSpace:'nowrap',
          }}>
          {isUploading ? '⏳ Uploading…' : filled ? '↻ Replace' : '＋ Upload PDF'}
        </button>
      </div>
      <div style={{ fontSize:10, color:'#94a3b8', marginBottom:6, lineHeight:1.4 }}>{hint}</div>
      {files.length === 0 ? (
        <div style={{ fontSize:11, color:'#94a3b8', fontStyle:'italic' }}>
          {dragOver ? 'Drop PDF to upload' : 'Drag a PDF here or click ＋ Upload'}
        </div>
      ) : files.map((f, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, marginTop:4 }}>
          <span aria-hidden="true">📄</span>
          <span style={{ fontSize:11, color:'#0f172a', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{f.filename}</span>
          <span style={{ fontSize:10, color:'#94a3b8' }}>{Math.max(1, Math.round((f.sizeBytes || 0) / 1024))} KB</span>
          <button onClick={(e) => { e.stopPropagation(); onDelete(f) }}
            style={{ padding:'2px 7px', fontSize:10, background:'none', border:'1px solid #fecaca', color:'#dc2626', borderRadius:5, cursor:'pointer' }}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Auto-Apply Setup (profile + resume library + queue runner) ───────────────
// Exported so CompanyDetail's Job Automation tab can reuse the exact same form.
export function AutoApplySetup() {
  const [profile, setProfile]     = useState(null)
  const [storageItems, setStorageItems] = useState([])      // per-user storage-backed library
  const [storageConfigured, setStorageConfigured] = useState(false)
  const [storageUploading, setStorageUploading] = useState('')
  const [storageStatus, setStorageStatus] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [savedMsg, setSavedMsg]   = useState(null)
  const [running, setRunning]     = useState(false)
  const [runResult, setRunResult] = useState(null)
  const [queue, setQueue]         = useState({ items: [], counts: {} })
  const [queueFilter, setQueueFilter] = useState('all')
  const [nightly, setNightly]     = useState(null)
  const [nightlySaving, setNightlySaving] = useState(false)
  const [nightlyRunning, setNightlyRunning] = useState(false)
  const [nightlyResult, setNightlyResult] = useState(null)
  const [lastRun, setLastRun]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, storage, q, ns, lr] = await Promise.all([
        api.career.profile(),
        api.career.storageLibrary().catch(() => ({ items: [], configured: false })),
        api.career.autoApplyQueue().catch(() => ({ items: [], counts: {} })),
        api.career.nightlySettings().catch(() => ({ settings: null })),
        api.career.nightlyLastRun().catch(() => ({ lastRun: null })),
      ])
      setProfile(p || {})
      setStorageItems(storage.items || [])
      setStorageConfigured(!!storage.configured)
      setQueue(q || { items: [], counts: {} })
      setNightly(ns?.settings || { enabled:false, roleType:'intern', minScore:85, maxApps:50, useLibraryResume:true })
      setLastRun(lr?.lastRun || null)
    } catch (e) { console.warn('Profile load error:', e) }
    setLoading(false)
  }, [])

  async function uploadToLibrary(archetype, file) {
    if (!file) return
    setStorageUploading(archetype); setStorageStatus(null)
    try {
      await api.career.uploadLibrary(archetype, file)
      const refreshed = await api.career.storageLibrary().catch(() => ({ items: [] }))
      setStorageItems(refreshed.items || [])
      setStorageStatus({ ok: true, text: `Uploaded ${file.name} to ${archetype}` })
    } catch (err) {
      setStorageStatus({ ok: false, text: err.message || 'Upload failed' })
    } finally { setStorageUploading('') }
  }

  async function deleteFromLibrary(archetype, filename) {
    if (!window.confirm(`Delete ${filename} from ${archetype}?`)) return
    try {
      await api.career.deleteLibrary(archetype, filename)
      const refreshed = await api.career.storageLibrary().catch(() => ({ items: [] }))
      setStorageItems(refreshed.items || [])
    } catch (err) { alert('Delete failed: ' + err.message) }
  }
  useEffect(() => { load() }, [load])

  async function saveNightly() {
    setNightlySaving(true)
    try {
      const r = await api.career.saveNightlySettings(nightly)
      setNightly(r.settings)
    } catch (err) { alert('Save failed: ' + err.message) }
    setNightlySaving(false)
  }

  async function runNightly() {
    setNightlyRunning(true); setNightlyResult(null)
    try {
      const r = await api.career.runNightlyPipeline()
      setNightlyResult(r); setLastRun(r)
      // refresh the queue list
      const q = await api.career.autoApplyQueue().catch(() => ({ items: [], counts: {} }))
      setQueue(q)
    } catch (err) { setNightlyResult({ error: err.message }) }
    setNightlyRunning(false)
  }

  async function saveProfile() {
    setSaving(true); setSavedMsg(null)
    try {
      const updated = await api.career.updateProfile(profile)
      setProfile(updated)
      setSavedMsg({ ok: true, text: 'Profile saved' })
    } catch (err) { setSavedMsg({ ok: false, text: err.message }) }
    setSaving(false)
    setTimeout(() => setSavedMsg(null), 4000)
  }

  async function runQueue(dryRun = false) {
    setRunning(true); setRunResult(null)
    try {
      const r = await api.career.autoApplyRun({ dryRun, headless: true, limit: 10 })
      setRunResult(r)
    } catch (err) { setRunResult({ error: err.message }) }
    setRunning(false)
  }

  if (loading) return <div style={{ padding:40, textAlign:'center' }}><Spin size={24} /></div>
  const p = profile || {}
  const set = (k, v) => setProfile({ ...p, [k]: v })

  const field = (label, key, opts = {}) => (
    <div style={{ marginBottom:12 }}>
      <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:4 }}>{label}</label>
      <input type={opts.type || 'text'} value={p[key] || ''} onChange={e => set(key, e.target.value)} placeholder={opts.placeholder}
        style={{ width:'100%', padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', background:'#fff' }} />
    </div>
  )
  const select = (label, key, options) => (
    <div style={{ marginBottom:12 }}>
      <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:4 }}>{label}</label>
      <select value={p[key] || options[0]?.[0] || ''} onChange={e => set(key, e.target.value)}
        style={{ width:'100%', padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', background:'#fff' }}>
        {options.map(([value, labelText]) => <option key={value} value={value}>{labelText}</option>)}
      </select>
    </div>
  )

  return (
    <div>
      {/* Profile card */}
      <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:20, marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, gap:12, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 200px', minWidth:0 }}>
            <h2 style={{ fontSize:16, fontWeight:800, color:'#0f172a', margin:0 }}>Profile</h2>
            <p style={{ fontSize:12, color:'#64748b', margin:'2px 0 0' }}>Used by the auto-apply worker to fill application forms</p>
          </div>
          <button onClick={saveProfile} disabled={saving}
            style={{ padding:'9px 18px', fontSize:12, fontWeight:700, background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:9, cursor: saving ? 'default':'pointer', display:'flex', alignItems:'center', gap:7, whiteSpace:'nowrap', flexShrink:0 }}>
            {saving ? <><Spin size={13} color="#fff" /> Saving…</> : 'Save Profile'}
          </button>
        </div>
        {savedMsg && (
          <div style={{ padding:'8px 12px', borderRadius:8, fontSize:12, fontWeight:600, marginBottom:12,
            background: savedMsg.ok ? '#f0fdf4' : '#fef2f2', color: savedMsg.ok ? '#15803d' : '#dc2626',
            border: `1px solid ${savedMsg.ok ? '#bbf7d0' : '#fecaca'}` }}>
            {savedMsg.ok ? '✓' : '✗'} {savedMsg.text}
          </div>
        )}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          {field('First Name', 'first_name')}
          {field('Last Name',  'last_name')}
          {field('Email',      'email',      { type:'email' })}
          {field('Phone',      'phone',      { type:'tel' })}
          {field('LinkedIn URL', 'linkedin_url', { placeholder:'https://linkedin.com/in/yourname' })}
          {field('GitHub URL',   'github_url',   { placeholder:'https://github.com/yourname' })}
          {field('Portfolio URL','portfolio_url')}
          {field('Location (City, ST)', 'location')}
          {field('Address', 'address')}
          {field('City', 'city')}
          {field('State / Province', 'state_province')}
          {field('Country', 'country', { placeholder:'US' })}
          {field('ZIP / Postal Code', 'postal_code')}
          {field('Preferred Locations', 'preferred_locations', { placeholder:'Remote; New York; San Francisco' })}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginTop:4 }}>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:4 }}>Work Authorization</label>
            <select value={p.work_authorization || 'US Citizen'} onChange={e => set('work_authorization', e.target.value)}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', background:'#fff' }}>
              {['US Citizen','Permanent Resident','F-1 (OPT/STEM)','H-1B','TN Visa','Other'].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          {select('Work Location Preference', 'work_location_preference', [
            ['any', 'Any'],
            ['remote', 'Remote'],
            ['hybrid', 'Hybrid'],
            ['onsite', 'On-site'],
          ])}
          {select('Target Job Type', 'target_job_type', [
            ['intern', 'Internship'],
            ['new_grad', 'New grad / entry-level'],
            ['full_time', 'Full-time'],
            ['any', 'Any'],
          ])}
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:4 }}>Needs Sponsorship?</label>
            <select value={p.needs_sponsorship ? '1' : '0'} onChange={e => set('needs_sponsorship', e.target.value === '1' ? 1 : 0)}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', background:'#fff' }}>
              <option value="0">No</option>
              <option value="1">Yes</option>
            </select>
          </div>
          {select('Willing To Relocate?', 'willing_to_relocate', [['0','No'], ['1','Yes']])}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginTop:4 }}>
          {field('School / University', 'education_school')}
          {field('Degree', 'education_degree')}
          {field('Major', 'education_major')}
          {field('Graduation Date', 'graduation_date')}
          {field('GPA', 'gpa')}
          {field('Certifications', 'certifications')}
          {field('Current Company', 'current_company')}
          {field('Current Title', 'current_title')}
          {field('Years Experience', 'years_experience')}
          {field('Skills', 'skills')}
          {field('Projects', 'projects')}
          {select('Gender (optional)', 'gender', [
            ['', 'Prefer not to answer'],
            ['female', 'Female'],
            ['male', 'Male'],
            ['non_binary', 'Non-binary'],
            ['self_describe', 'I prefer to self-describe'],
          ])}
          {select('Race / Ethnicity (optional)', 'race', [
            ['', 'Prefer not to answer'],
            ['asian', 'Asian'],
            ['black', 'Black or African American'],
            ['hispanic_latino', 'Hispanic or Latino'],
            ['white', 'White'],
            ['two_or_more', 'Two or more races'],
            ['self_describe', 'I prefer to self-describe'],
          ])}
          {select('Veteran Status (optional)', 'veteran_status', [
            ['', 'Prefer not to answer'],
            ['not_veteran', 'I am not a protected veteran'],
            ['protected_veteran', 'I identify as a protected veteran'],
          ])}
          {select('Disability Status (optional)', 'disability_status', [
            ['', 'Prefer not to answer'],
            ['no', 'No, I do not have a disability'],
            ['yes', 'Yes, I have a disability'],
          ])}
        </div>
        <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:8 }}>
          <label style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:12, color:'#475569', lineHeight:1.5 }}>
            <input type="checkbox" checked={!!p.auto_apply_consent} onChange={e => set('auto_apply_consent', e.target.checked ? 1 : 0)}
              style={{ width:14, height:14, marginTop:2 }} />
            I understand Auto Apply may submit real job applications using this profile and my selected resumes. Only queue roles that match my saved preferences.
          </label>
          <label style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:12, color: p.auto_apply_paused ? '#b45309' : '#475569', lineHeight:1.5, padding:p.auto_apply_paused ? '8px 10px' : 0, background: p.auto_apply_paused ? '#fef3c7' : 'transparent', borderRadius:8, border: p.auto_apply_paused ? '1px solid #fde68a' : 'none' }}>
            <input type="checkbox" checked={!!p.auto_apply_paused} onChange={e => set('auto_apply_paused', e.target.checked ? 1 : 0)}
              style={{ width:14, height:14, marginTop:2 }} />
            <span>
              <strong>Pause Auto Apply</strong> — keep my consent and profile, but the worker and the nightly pipeline will not submit any applications until I unpause.
            </span>
          </label>
          <label style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:12, color:'#475569', lineHeight:1.5 }}>
            <input type="checkbox" checked={!!p.demographic_consent} onChange={e => set('demographic_consent', e.target.checked ? 1 : 0)}
              style={{ width:14, height:14, marginTop:2 }} />
            I consent to saving optional demographic/self-identification answers if I choose to provide them. Prefer-not-to-answer is acceptable.
          </label>
        </div>
      </div>

      {/* Per-user storage-backed resume library — multi-user safe */}
      <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:20, marginBottom:16 }}>
        <h2 style={{ fontSize:16, fontWeight:800, color:'#0f172a', margin:'0 0 4px' }}>Resume Library <span style={{ fontSize:11, fontWeight:600, color:'#7c3aed', letterSpacing:0 }}>— per-user (cloud storage)</span></h2>
        <p style={{ fontSize:12, color:'#64748b', margin:'0 0 12px' }}>
          Upload one PDF per role archetype. The auto-apply worker picks the closest match for each role.
          Files are scoped to your account — other users never see them.
        </p>
        {!storageConfigured && (
          <div style={{ padding:'10px 12px', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, fontSize:12, color:'#92400e', marginBottom:10 }}>
            ⚠ Cloud storage not configured on the backend (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). The legacy folder library below is still active.
          </div>
        )}
        {storageStatus && (
          <div style={{ padding:'8px 12px', borderRadius:8, fontSize:12, fontWeight:700, marginBottom:10,
            background: storageStatus.ok ? '#f0fdf4' : '#fef2f2',
            color: storageStatus.ok ? '#166534' : '#991b1b',
            border: `1px solid ${storageStatus.ok ? '#bbf7d0' : '#fecaca'}` }}>
            {storageStatus.ok ? '✓' : '✗'} {storageStatus.text}
          </div>
        )}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12 }}>
          {[
            { key:'aiml',      label:'AI / ML',     hint:'AI engineer, ML, NLP, computer vision' },
            { key:'ds',        label:'Data Science',hint:'Data scientist, analyst, BI, data eng' },
            { key:'swe',       label:'Software Eng',hint:'Backend, systems, SDE, software dev' },
            { key:'devops',    label:'DevOps / SRE',hint:'SRE, platform, infra, cloud, k8s' },
            { key:'fullstack', label:'Full-Stack',  hint:'Web app, frontend + backend' },
            { key:'startup',   label:'Startup',     hint:'Founding engineer, seed, YC, early-stage' },
            { key:'misc',      label:'Misc',        hint:'Anything else — used as the closest-resume fallback' },
          ].map(({ key: arch, label, hint }) => {
            const files = storageItems.filter(i => i.archetype === arch || i.folder === arch)
            const filled = files.length > 0
            const isUploading = storageUploading === arch
            return (
              <ArchetypeUploadCard key={arch}
                archetype={arch}
                label={label}
                hint={hint}
                files={files}
                filled={filled}
                isUploading={isUploading}
                storageConfigured={storageConfigured}
                onUpload={(file) => uploadToLibrary(arch, file)}
                onDelete={(f) => deleteFromLibrary(f.archetype, f.filename)}
              />
            )
          })}
        </div>
      </div>

      {/* Visible queue — shows what's in flight, what needs review, what's done */}
      <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:20, marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:10 }}>
          <div>
            <h2 style={{ fontSize:16, fontWeight:800, color:'#0f172a', margin:0 }}>Queue & Status</h2>
            <p style={{ fontSize:12, color:'#64748b', margin:'2px 0 0' }}>Every role flagged for auto-apply, by status</p>
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            <button onClick={() => setQueueFilter('all')}
              style={{ fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:20, background: queueFilter === 'all' ? '#0f172a' : '#f1f5f9', color: queueFilter === 'all' ? '#fff' : '#475569', border:'1px solid #e2e8f0', cursor:'pointer' }}>
              All {queue.items.length}
            </button>
            {/* Filter pills are ALWAYS rendered (even with count 0) so the
                user can always see and click every filter. Previously these
                only rendered when count > 0, which made the Queue and
                Unsupported buttons "disappear" depending on data state. */}
            {[
              ['needs_review',         queue.counts?.needs_review || 0, '#dc2626', '#fee2e2', 'Needs review'],
              ['queued',               queue.counts?.queued       || 0, '#7c3aed', '#f5f3ff', 'Queued'],
              ['submitted',            queue.counts?.submitted    || 0, '#16a34a', '#f0fdf4', 'Submitted'],
              ['failed',               queue.counts?.failed       || 0, '#d97706', '#fffbeb', 'Failed'],
              ['platform_unsupported', queue.counts?.unsupported  || 0, '#64748b', '#f1f5f9', 'Unsupported'],
            ].map(([k, n, color, bg, label]) => (
              <button key={k} onClick={() => setQueueFilter(f => f === k ? 'all' : k)}
                disabled={n === 0 && queueFilter !== k}
                title={n === 0 ? `No ${label.toLowerCase()} items in queue` : `Show only ${label.toLowerCase()} (${n})`}
                style={{ fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:20,
                  cursor: n === 0 && queueFilter !== k ? 'not-allowed' : 'pointer',
                  opacity: n === 0 && queueFilter !== k ? 0.45 : 1,
                  background: queueFilter === k ? color : bg,
                  color: queueFilter === k ? '#fff' : color,
                  border: `1px solid ${color}50` }}>
                {label}: {n}
              </button>
            ))}
          </div>
        </div>
        {queue.items.length === 0 ? (
          <div style={{ fontSize:13, color:'#94a3b8', padding:'18px 0', textAlign:'center' }}>
            No roles in the queue yet. Add some via "＋ Add to Auto-Apply Queue" on an Evaluate result, or run the nightly pipeline below.
          </div>
        ) : (
          <div style={{ maxHeight:340, overflowY:'auto', border:'1px solid #f1f5f9', borderRadius:10 }}>
            {queue.items.filter(item => queueFilter === 'all' || item.apply_status === queueFilter).map(item => {
              const statusMeta = {
                needs_review:         { color:'#dc2626', bg:'#fee2e2', label:'Needs review' },
                queued:               { color:'#7c3aed', bg:'#f5f3ff', label:'Queued' },
                submitted:            { color:'#16a34a', bg:'#f0fdf4', label:'Submitted' },
                submit_failed:        { color:'#d97706', bg:'#fffbeb', label:'Failed' },
                failed:               { color:'#d97706', bg:'#fffbeb', label:'Failed' },
                platform_unsupported: { color:'#64748b', bg:'#f1f5f9', label:'Unsupported' },
              }[item.apply_status] || { color:'#64748b', bg:'#f1f5f9', label: item.apply_status }
              const sourceLabel = {
                career_ops:           'Manual eval',
                career_ops_batch:     'Bulk eval',
                nightly_pipeline:     '🌙 Nightly',
                'career_ops_batch (portal scanner)': 'Portal Scanner',
              }[item.source] || item.source || 'manual'
              return (
                <div key={item.id} style={{ padding:'12px 14px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', gap:12, fontSize:12 }}>
                  <span style={{ fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:5, background: statusMeta.bg, color: statusMeta.color, flexShrink:0, minWidth:90, textAlign:'center' }}>
                    {statusMeta.label}
                  </span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {item.job_title || 'Unknown role'} <span style={{ fontWeight:400, color:'#94a3b8' }}>at</span> {item.company_name || 'Unknown'}
                    </div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:2, display:'flex', gap:8, flexWrap:'wrap' }}>
                      {item.grade && <span>Grade {item.grade}</span>}
                      {item.score && <span>· {Number(item.score).toFixed(0)}/100</span>}
                      <span>· from {sourceLabel}</span>
                      {item.apply_platform && <span>· {item.apply_platform}</span>}
                      {item.created_at && <span>· {new Date(item.created_at).toLocaleDateString()}</span>}
                    </div>
                    {item.apply_status === 'needs_review' && item.apply_error && (
                      <div style={{ fontSize:11, color:'#dc2626', marginTop:3, fontStyle:'italic' }}>⚠ {item.apply_error}</div>
                    )}
                  </div>
                  {item.job_url && (
                    <a href={item.job_url} target="_blank" rel="noreferrer"
                      style={{ fontSize:11, fontWeight:600, color:'#6366f1', textDecoration:'none', flexShrink:0 }}>
                      View ↗
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Nightly pipeline — full chain (scan → evaluate → fit-filter → queue → submit) */}
      {nightly && (
        <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:20, marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:10 }}>
            <div>
              <h2 style={{ fontSize:16, fontWeight:800, color:'#0f172a', margin:0 }}>🌙 Nightly Pipeline</h2>
              <p style={{ fontSize:12, color:'#64748b', margin:'2px 0 0' }}>Auto-runs at 07:00 UTC: scan → evaluate → score ≥ {nightly.minScore} → submit (up to {nightly.maxApps}). Uses your <strong>library</strong> resume — no per-role tailoring.</p>
            </div>
            <button onClick={runNightly} disabled={nightlyRunning}
              style={{ padding:'9px 18px', fontSize:12, fontWeight:700, background: nightlyRunning ? '#f1f5f9' : 'linear-gradient(135deg,#1e293b,#334155)', color: nightlyRunning ? '#64748b':'#fff', border:'none', borderRadius:9, cursor: nightlyRunning ? 'default':'pointer', display:'flex', alignItems:'center', gap:7 }}>
              {nightlyRunning ? <><Spin size={13} color="#64748b" /> Running pipeline…</> : '🌙 Run Pipeline Now'}
            </button>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:14 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:4 }}>Enabled</label>
              <select value={nightly.enabled ? '1' : '0'} onChange={e => setNightly({ ...nightly, enabled: e.target.value === '1' })}
                style={{ width:'100%', padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13 }}>
                <option value="0">Off</option>
                <option value="1">On (cron + manual)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:4 }}>Role Type</label>
              <select value={nightly.roleType} onChange={e => setNightly({ ...nightly, roleType: e.target.value })}
                style={{ width:'100%', padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13 }}>
                <option value="intern">Intern</option>
                <option value="fulltime">Full-time</option>
                <option value="all">Both</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:4 }}>Min Score</label>
              <input type="number" min="0" max="100" value={nightly.minScore} onChange={e => setNightly({ ...nightly, minScore: Number(e.target.value) })}
                style={{ width:'100%', padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13 }} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:4 }}>Max Apps / Run</label>
              <input type="number" min="1" max="200" value={nightly.maxApps} onChange={e => setNightly({ ...nightly, maxApps: Number(e.target.value) })}
                style={{ width:'100%', padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13 }} />
            </div>
          </div>

          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <button onClick={saveNightly} disabled={nightlySaving}
              style={{ padding:'7px 14px', fontSize:12, fontWeight:700, background:'#fff', color:'#475569', border:'1px solid #e2e8f0', borderRadius:8, cursor: nightlySaving ? 'default':'pointer' }}>
              {nightlySaving ? 'Saving…' : 'Save Settings'}
            </button>
            {lastRun?.startedAt && (
              <span style={{ fontSize:11, color:'#94a3b8' }}>
                Last run {new Date(lastRun.startedAt).toLocaleString()} — scanned {lastRun.scanned}, evaluated {lastRun.evaluated}, fits {lastRun.fits}, applied {lastRun.applied}
                {lastRun.needsReview > 0 && <>, <span style={{ color:'#dc2626' }}>{lastRun.needsReview} needs review</span></>}
              </span>
            )}
          </div>

          {nightlyResult && (
            <div style={{ marginTop:12, padding:'12px 14px', background: nightlyResult.error ? '#fef2f2' : '#f0fdf4', border:`1px solid ${nightlyResult.error ? '#fecaca' : '#bbf7d0'}`, borderRadius:9, fontSize:12 }}>
              {nightlyResult.error
                ? <span style={{ color:'#dc2626' }}>✗ {nightlyResult.error}</span>
                : <span style={{ color:'#15803d', fontWeight:600 }}>
                    ✓ Pipeline complete — scanned {nightlyResult.scanned}, evaluated {nightlyResult.evaluated}, {nightlyResult.fits} fits found, {nightlyResult.applied} applications submitted
                    {nightlyResult.needsReview > 0 && <> · <span style={{ color:'#dc2626' }}>{nightlyResult.needsReview} need review</span></>}
                  </span>}
            </div>
          )}
        </div>
      )}

      {/* Queue runner */}
      <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:20 }}>
        <h2 style={{ fontSize:16, fontWeight:800, color:'#0f172a', margin:'0 0 4px' }}>Auto-Apply Queue</h2>
        <p style={{ fontSize:12, color:'#64748b', margin:'0 0 14px' }}>Runs the Playwright worker against every evaluation marked <strong>Auto</strong> and <strong>queued</strong>. Supported platforms: Greenhouse, Lever, Ashby. Others are marked "platform_unsupported" for manual apply.</p>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={() => runQueue(false)} disabled={running}
            style={{ padding:'10px 22px', fontSize:13, fontWeight:700, background: running ? '#f1f5f9' : 'linear-gradient(135deg,#7c3aed,#a855f7)', color: running ? '#64748b':'#fff', border:'none', borderRadius:10, cursor: running ? 'default':'pointer', display:'flex', alignItems:'center', gap:8 }}>
            {running ? <><Spin size={14} color="#64748b" /> Running…</> : '⚡ Run auto-apply queue'}
          </button>
          <button onClick={() => runQueue(true)} disabled={running}
            style={{ padding:'10px 22px', fontSize:13, fontWeight:700, background:'#fff', color:'#475569', border:'1px solid #e2e8f0', borderRadius:10, cursor: running ? 'default':'pointer' }}>
            Dry-run (no submit)
          </button>
        </div>

        {runResult && (
          <div style={{ marginTop:16, padding:'14px 16px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0' }}>
            {runResult.error ? (
              <div style={{ color:'#dc2626', fontSize:13 }}>✗ {runResult.error}</div>
            ) : (
              <>
                <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', marginBottom:8 }}>
                  Processed {runResult.processed} · Submitted {runResult.submitted} · Failed {runResult.failed} · Skipped {runResult.skipped}
                </div>
                {(runResult.results || []).map(r => (
                  <div key={r.evalId} style={{ fontSize:11, padding:'5px 0', borderTop:'1px solid #e2e8f0', display:'flex', gap:10 }}>
                    <span style={{ fontFamily:'monospace', color:'#94a3b8' }}>#{r.evalId}</span>
                    <span style={{ color: r.ok ? '#16a34a' : '#dc2626', fontWeight:600, minWidth:70 }}>{r.ok ? '✓ ok' : '✗ fail'}</span>
                    <span style={{ color:'#475569', minWidth:90 }}>{r.platform || '—'}</span>
                    <span style={{ color:'#64748b' }}>{r.error || r.resume || '—'}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── History card ──────────────────────────────────────────────────────────────
function EvalCard({ ev, onClick, onDelete, onQueue, selected, onToggleSelect }) {
  const gc = gradeColor(ev.grade)
  const initialQueued = ev.apply_mode === 'auto' && ['queued','submitted','needs_review','running'].includes(ev.apply_status || '')
  const [queued, setQueued] = useState(initialQueued)
  const [queuing, setQueuing] = useState(false)
  // Per-eval resume override — when set, autoApplier uses this PDF instead
  // of looking up an archetype match in the user's Resume Library.
  const [hasOverride, setHasOverride] = useState(!!ev.pdf_path)
  const [uploadingResume, setUploadingResume] = useState(false)
  const resumeInputRef = useRef(null)
  async function handleQueueClick(e) {
    e.stopPropagation()
    if (queued || queuing) return
    setQueuing(true)
    try { await onQueue(ev.id); setQueued(true) }
    catch (err) { alert('Queue failed: ' + err.message) }
    finally { setQueuing(false) }
  }
  async function handleResumeUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingResume(true)
    try {
      await api.career.uploadEvalResume(ev.id, file)
      setHasOverride(true)
    } catch (err) { alert('Upload failed: ' + err.message) }
    finally { setUploadingResume(false) }
  }
  return (
    <div className="co-card" onClick={onClick}
      style={{ background: selected ? '#eef2ff' : '#fff', border:`1px solid ${selected ? '#a5b4fc' : '#e2e8f0'}`, borderRadius:12, padding:'14px 18px', cursor:'pointer', display:'flex', alignItems:'center', gap:12, transition:'all 0.15s', marginBottom:10, flexWrap:'wrap', rowGap:10 }}>
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={!!selected}
          onClick={e => e.stopPropagation()}
          onChange={() => onToggleSelect(ev.id)}
          style={{ width:18, height:18, cursor:'pointer', accentColor:'#7c3aed', flexShrink:0 }}
        />
      )}
      <div style={{ width:48, height:48, borderRadius:'50%', background:gradeBg(ev.grade), border:`2px solid ${gc}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <span style={{ fontSize:20, fontWeight:900, color:gc }}>{ev.grade}</span>
      </div>
      <div style={{ flex:'1 1 180px', minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:700, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ev.job_title || 'Unknown Role'}</div>
        <div style={{ fontSize:12, color:'#64748b', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ev.company_name} · Score: {ev.score}/100</div>
        <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>{new Date(ev.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}</div>
      </div>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
        <button onClick={handleQueueClick} disabled={queued || queuing} title={queued ? 'Already queued for auto-apply' : 'Add to auto-apply queue'}
          style={{ padding:'6px 12px', fontSize:11, fontWeight:700, background: queued ? '#dcfce7' : '#fef3c7', color: queued ? '#15803d' : '#b45309', border:`1px solid ${queued ? '#86efac' : '#fcd34d'}`, borderRadius:7, cursor: queued || queuing ? 'default' : 'pointer', flexShrink:0, display:'flex', alignItems:'center', gap:4, whiteSpace:'nowrap' }}>
          {queuing ? <Spin size={11} /> : queued ? '✓ Queued' : '+ Auto-Apply'}
        </button>
        <button onClick={async e => {
            e.stopPropagation()
            try { await api.career.openReportTab(ev.id) }
            catch (err) { alert('Could not open report: ' + err.message) }
          }}
          style={{ padding:'6px 12px', fontSize:11, fontWeight:700, background:'#eef2ff', color:'#4f46e5', border:'1px solid #c7d2fe', borderRadius:7, cursor:'pointer', flexShrink:0, whiteSpace:'nowrap' }}>
          HTML ↗
        </button>
        {/* Per-eval resume override. Clicking opens a file picker; backend
            writes evaluations.pdf_path so the auto-apply worker uploads
            this exact PDF instead of an archetype-matched library file. */}
        <input ref={resumeInputRef} type="file" accept="application/pdf"
          style={{ display:'none' }} onClick={e => e.stopPropagation()} onChange={handleResumeUpload} />
        <button onClick={e => { e.stopPropagation(); resumeInputRef.current?.click() }}
          disabled={uploadingResume}
          title={hasOverride ? 'Custom resume uploaded — click to replace' : 'Upload a custom resume to use for this role (overrides archetype library)'}
          style={{ padding:'6px 12px', fontSize:11, fontWeight:700, background: hasOverride ? '#dcfce7' : '#fff', color: hasOverride ? '#15803d' : '#475569', border:`1px solid ${hasOverride ? '#86efac' : '#cbd5e1'}`, borderRadius:7, cursor: uploadingResume ? 'default' : 'pointer', flexShrink:0, whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:4 }}>
          {uploadingResume ? <Spin size={11} /> : hasOverride ? '📎 Resume' : '📎 Upload'}
        </button>
        <button onClick={e => { e.stopPropagation(); onDelete(ev.id) }}
          style={{ padding:'5px 10px', fontSize:11, background:'none', border:'1px solid #fecaca', color:'#dc2626', borderRadius:7, cursor:'pointer', flexShrink:0 }}>
          ✕
        </button>
      </div>
    </div>
  )
}

// ── Portal scanner ────────────────────────────────────────────────────────────
// Scan results persist across tab switches via sessionStorage, so the user
// doesn't have to re-scan every time they navigate away. roleType drives the
// backend query (intern | fulltime | all) and is included in the cache key
// so changing role type triggers a fresh scan.
const PORTAL_CACHE_KEY = 'careerOps:portalScan:v2'
function readPortalCache() {
  try {
    const raw = sessionStorage.getItem(PORTAL_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.at || Date.now() - parsed.at > 60 * 60 * 1000) return null // 1h TTL
    return parsed
  } catch { return null }
}
function writePortalCache(payload) {
  try { sessionStorage.setItem(PORTAL_CACHE_KEY, JSON.stringify({ at: Date.now(), ...payload })) } catch {}
}
function formatAgo(date) {
  const ms = Date.now() - date.getTime()
  if (ms < 60000) return 'just now'
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`
  return `${Math.floor(ms / 86400000)}d ago`
}

function PortalScanner({ hasResume, onSendToEvaluate }) {
  const cached = readPortalCache()
  const [scanning, setScanning] = useState(false)
  const [jobs, setJobs]         = useState(cached?.jobs || [])
  const [bySource, setBySource] = useState(cached?.bySource || {})
  const [filter, setFilter]     = useState('all')
  const [roleType, setRoleType] = useState(cached?.roleType || 'intern')
  const [error, setError]       = useState(null)
  const [sending, setSending]   = useState(null)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)
  const scannedAt = cached?.at ? new Date(cached.at) : null

  async function handleScan(typeOverride = roleType) {
    setScanning(true); setError(null); setJobs([])
    try {
      const r = await api.career.scanPortals(typeOverride)
      const nextJobs = r.jobs || []
      const nextBySource = r.bySource || {}
      setJobs(nextJobs); setBySource(nextBySource)
      writePortalCache({ jobs: nextJobs, bySource: nextBySource, roleType: typeOverride })
    } catch (err) { setError(err.message) }
    finally { setScanning(false) }
  }

  function changeRoleType(t) {
    setRoleType(t)
    handleScan(t)
  }

  // Evaluate all currently-filtered scanned roles via batch-evaluate.
  // Caps at 10 (backend's max). Hides the list afterward and routes to History.
  async function evaluateAll() {
    const urls = filtered.map(j => j.applyUrl).filter(Boolean).slice(0, 10)
    if (!urls.length) return
    setBulkRunning(true); setBulkProgress(`Evaluating ${urls.length} role${urls.length !== 1 ? 's' : ''}…`)
    try {
      const r = await api.career.batchEvaluate(urls)
      const ok = (r.results || []).filter(x => x.status === 'done').length
      setBulkProgress(`✓ Evaluated ${ok}/${urls.length} — see History tab`)
      setTimeout(() => setBulkProgress(null), 6000)
    } catch (err) {
      setBulkProgress(`✗ Batch failed: ${err.message}`)
      setTimeout(() => setBulkProgress(null), 6000)
    } finally { setBulkRunning(false) }
  }

  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.source === filter)
  const srcColors = { greenhouse:'#16a34a', lever:'#2563eb', ashby:'#7c3aed' }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:'#0f172a', marginBottom:3 }}>Live Portal Scanner</div>
          <div style={{ fontSize:12, color:'#94a3b8' }}>
            Scans Greenhouse, Lever & Ashby for {roleType === 'all' ? 'all roles' : roleType === 'fulltime' ? 'full-time roles' : 'internship roles'} posted this week
            {scannedAt && jobs.length > 0 && <> · last scanned {formatAgo(scannedAt)}</>}
          </div>
        </div>
        <button onClick={() => handleScan()} disabled={scanning}
          style={{ padding:'10px 22px', fontSize:13, fontWeight:700, background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:10, cursor: scanning ? 'default':'pointer', display:'flex', alignItems:'center', gap:8 }}>
          {scanning ? <><Spin size={14} color="#fff" /> Scanning…</> : (jobs.length > 0 ? '↻ Re-scan' : '🔍 Scan Now')}
        </button>
      </div>

      {/* Role-type filter — drives the backend query. Changing it auto-rescans. */}
      <div style={{ display:'inline-flex', background:'#f1f5f9', borderRadius:9, padding:3, marginBottom:14, gap:3 }}>
        {[['intern','🎓 Internship'], ['fulltime','💼 Full-Time'], ['all','📋 All Roles']].map(([k, l]) => (
          <button key={k} onClick={() => changeRoleType(k)} disabled={scanning}
            style={{ padding:'7px 16px', fontSize:12, fontWeight:700, cursor: scanning ? 'default' : 'pointer', border:'none', borderRadius:7,
              background: roleType === k ? '#fff' : 'transparent',
              color: roleType === k ? '#6366f1' : '#64748b',
              boxShadow: roleType === k ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.12s' }}>
            {l}
          </button>
        ))}
      </div>

      {jobs.length > 0 && (
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
          {[{ k:'all', l:`All ${jobs.length}` }, ...Object.entries(bySource).filter(([,n])=>n>0).map(([src,n]) => ({ k:src, l:`${src.charAt(0).toUpperCase()+src.slice(1)} ${n}` }))].map(({ k, l }) => (
            <button key={k} onClick={() => setFilter(k)}
              style={{ padding:'5px 16px', fontSize:12, fontWeight:700, border:'none', borderRadius:20, cursor:'pointer', transition:'all 0.12s',
                background: filter===k ? (k==='all' ? '#6366f1' : srcColors[k]||'#6366f1') : '#f1f5f9',
                color: filter===k ? '#fff' : '#64748b' }}>
              {l}
            </button>
          ))}
          {hasResume && filtered.length > 0 && (
            <button onClick={evaluateAll} disabled={bulkRunning}
              style={{ marginLeft:'auto', padding:'6px 14px', fontSize:12, fontWeight:700, background:'#eef2ff', color:'#6366f1', border:'1px solid #c7d2fe', borderRadius:8, cursor: bulkRunning ? 'default' : 'pointer', display:'flex', alignItems:'center', gap:6 }}>
              {bulkRunning ? <><Spin size={11} /> Evaluating…</> : `⚡ Evaluate ${Math.min(10, filtered.length)} role${Math.min(10, filtered.length) !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}

      {bulkProgress && (
        <div style={{ padding:'10px 14px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:9, fontSize:13, color:'#1e40af', marginBottom:14, fontWeight:600 }}>
          {bulkProgress}
        </div>
      )}

      {error && <div style={{ padding:'12px 16px', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:10, fontSize:13, color:'#dc2626', marginBottom:16 }}>⚠ {error}</div>}

      {!scanning && jobs.length === 0 && !error && (
        <div style={{ textAlign:'center', padding:'72px 0', color:'#94a3b8' }}>
          <div style={{ fontSize:44, marginBottom:14 }}>🔍</div>
          <div style={{ fontSize:14, fontWeight:600, color:'#64748b', marginBottom:6 }}>Ready to scan 50+ company portals</div>
          <div style={{ fontSize:12 }}>
            {roleType === 'all'   && 'All roles posted in the last 7 days'}
            {roleType === 'intern' && 'Internship roles posted in the last 7 days'}
            {roleType === 'fulltime' && 'Full-time + new-grad roles posted in the last 7 days'}
          </div>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {filtered.map((job, i) => (
          <div key={i} style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'14px 18px', display:'flex', alignItems:'flex-start', gap:14 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#0f172a', marginBottom:3 }}>{job.title}</div>
              <div style={{ fontSize:12, color:'#64748b' }}>
                {job.company.charAt(0).toUpperCase() + job.company.slice(1)}
                {job.location ? ` · ${job.location}` : ''}
                {job.postedAt ? ` · ${new Date(job.postedAt).toLocaleDateString()}` : ''}
              </div>
              <span style={{ fontSize:10, fontWeight:700, marginTop:6, display:'inline-block', padding:'2px 8px', borderRadius:20, background:`${srcColors[job.source]||'#6366f1'}15`, color:srcColors[job.source]||'#6366f1', textTransform:'capitalize' }}>
                {job.source}
              </span>
            </div>
            <div style={{ display:'flex', gap:8, flexShrink:0 }}>
              <a href={job.applyUrl} target="_blank" rel="noreferrer"
                style={{ padding:'8px 14px', fontSize:12, fontWeight:700, background:'#f8fafc', color:'#374151', border:'1px solid #e2e8f0', borderRadius:8, textDecoration:'none' }}>
                View ↗
              </a>
              {hasResume && (
                <button disabled={sending === i}
                  onClick={async () => { setSending(i); await onSendToEvaluate(job.applyUrl || job.title); setSending(null) }}
                  style={{ padding:'8px 14px', fontSize:12, fontWeight:700, background:'#eef2ff', color:'#6366f1', border:'1px solid #c7d2fe', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                  {sending === i ? <Spin size={11} /> : '⚡ Evaluate'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Batch evaluation ──────────────────────────────────────────────────────────
function BatchEval({ hasResume }) {
  const [urlsText, setUrlsText] = useState('')
  const [running, setRunning]   = useState(false)
  const [results, setResults]   = useState([])
  const [progress, setProgress] = useState(null)
  const [error, setError]       = useState(null)
  // Multi-select state for "Queue Selected for Auto-Apply" — keys by evalId.
  const [selected, setSelected] = useState(new Set())
  const [queueing, setQueueing] = useState(false)
  const [queueMsg, setQueueMsg] = useState(null)

  async function handleBatch() {
    const urls = urlsText.split('\n').map(u=>u.trim()).filter(u=>u.startsWith('http'))
    if (!urls.length) return
    if (urls.length > 10) { setError('Max 10 URLs at a time'); return }
    setRunning(true); setError(null); setResults([]); setSelected(new Set()); setQueueMsg(null); setProgress(`Evaluating ${urls.length} jobs…`)
    try {
      const r = await api.career.batchEvaluate(urls)
      setResults(r.results || []); setProgress(null)
    } catch (err) { setError(err.message); setProgress(null) }
    finally { setRunning(false) }
  }

  function toggleSelect(id) {
    setSelected(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function selectAll() {
    const ids = results.filter(r => r.status === 'done' && r.evalId).map(r => r.evalId)
    setSelected(new Set(ids))
  }
  function clearSelection() { setSelected(new Set()) }

  async function queueSelected() {
    if (!selected.size) return
    setQueueing(true); setQueueMsg(null)
    try {
      const ids = [...selected]
      const res = await api.career.queueByIds(ids)
      setQueueMsg(`✓ Queued ${res.queued} role${res.queued === 1 ? '' : 's'} for auto-apply`)
      setSelected(new Set())
    } catch (err) {
      setQueueMsg(`⚠ ${err.message}`)
    } finally {
      setQueueing(false)
    }
  }

  const urlCount = urlsText.split('\n').filter(u=>u.trim().startsWith('http')).length
  const doneCount = results.filter(r => r.status === 'done').length

  return (
    <div>
      <div style={{ fontSize:15, fontWeight:700, color:'#0f172a', marginBottom:3 }}>Batch Job Evaluation</div>
      <div style={{ fontSize:12, color:'#94a3b8', marginBottom:18 }}>Paste up to 10 job URLs — AI evaluates all in parallel and ranks by fit score</div>

      <textarea value={urlsText} onChange={e => setUrlsText(e.target.value)}
        placeholder={'https://jobs.lever.co/stripe/abc123\nhttps://boards.greenhouse.io/openai/jobs/456\nhttps://jobs.ashbyhq.com/linear/789'}
        rows={7}
        style={{ fontFamily:'monospace', fontSize:12, lineHeight:1.75, marginBottom:12, background:'#fff', borderRadius:10 }} />

      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
        <button onClick={handleBatch} disabled={running || !hasResume || !urlCount}
          style={{ padding:'11px 26px', fontSize:13, fontWeight:700, background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:10, cursor: running ? 'default':'pointer', display:'flex', alignItems:'center', gap:8 }}>
          {running ? <><Spin size={14} color="#fff" /> Evaluating…</> : `⚡ Evaluate All (${urlCount})`}
        </button>
        <span style={{ fontSize:12, color:'#94a3b8' }}>{urlCount} URL{urlCount !== 1 ? 's' : ''} detected</span>
      </div>

      {!hasResume && <div style={{ padding:'10px 16px', background:'#fef3c7', borderRadius:9, fontSize:12, color:'#d97706', fontWeight:600, marginBottom:14 }}>⚠ Upload your resume first</div>}
      {error && <div style={{ padding:'12px 16px', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:10, fontSize:13, color:'#dc2626', marginBottom:14 }}>⚠ {error}</div>}

      {progress && (
        <div style={{ display:'flex', alignItems:'center', gap:14, padding:'22px 20px', background:'#eef2ff', borderRadius:12, marginBottom:18, border:'1px solid #c7d2fe' }}>
          <Spin size={22} />
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:'#6366f1' }}>{progress}</div>
            <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>Takes 1–3 minutes. Keep this tab open.</div>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em' }}>Results — ranked by fit score</div>
            {doneCount > 0 && (
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <button onClick={selectAll}
                  style={{ padding:'5px 11px', fontSize:11, fontWeight:600, background:'#fff', color:'#4f46e5', border:'1px solid #c7d2fe', borderRadius:7, cursor:'pointer' }}>
                  Select all ({doneCount})
                </button>
                {selected.size > 0 && (
                  <button onClick={clearSelection}
                    style={{ padding:'5px 11px', fontSize:11, fontWeight:600, background:'#fff', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:7, cursor:'pointer' }}>
                    Clear
                  </button>
                )}
                <button onClick={queueSelected} disabled={!selected.size || queueing}
                  style={{ padding:'7px 14px', fontSize:12, fontWeight:700, background: selected.size ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#f1f5f9', color: selected.size ? '#fff' : '#94a3b8', border:'none', borderRadius:8, cursor: selected.size ? 'pointer' : 'default', display:'flex', alignItems:'center', gap:6 }}>
                  {queueing ? <><Spin size={11} color="#fff" /> Queuing…</> : `⚡ Queue ${selected.size || ''} for Auto-Apply`}
                </button>
              </div>
            )}
          </div>
          {queueMsg && (
            <div style={{ padding:'10px 14px', background: queueMsg.startsWith('✓') ? '#dcfce7' : '#fee2e2', color: queueMsg.startsWith('✓') ? '#15803d' : '#991b1b', borderRadius:8, fontSize:12, fontWeight:600, marginBottom:12 }}>
              {queueMsg}
            </div>
          )}
          {results.map((r, i) => r.status === 'done' ? (
            <div key={i} style={{ background: selected.has(r.evalId) ? '#eef2ff' : '#fff', border:`1px solid ${selected.has(r.evalId) ? '#a5b4fc' : '#e2e8f0'}`, borderRadius:12, padding:'14px 18px', marginBottom:10, display:'flex', alignItems:'center', gap:14, transition:'background 0.12s' }}>
              <input
                type="checkbox"
                checked={selected.has(r.evalId)}
                onChange={() => toggleSelect(r.evalId)}
                disabled={!r.evalId}
                style={{ width:18, height:18, cursor: r.evalId ? 'pointer' : 'default', accentColor:'#7c3aed', flexShrink:0 }}
              />
              <span style={{ fontSize:12, fontWeight:700, color:'#94a3b8', width:24, flexShrink:0, textAlign:'center' }}>#{i+1}</span>
              <div style={{ width:46, height:46, borderRadius:'50%', background:gradeBg(r.evaluation?.grade), border:`2px solid ${gradeColor(r.evaluation?.grade)}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <span style={{ fontSize:18, fontWeight:900, color:gradeColor(r.evaluation?.grade) }}>{r.evaluation?.grade}</span>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'#0f172a' }}>{r.evaluation?.jobTitle} <span style={{ fontWeight:400, color:'#94a3b8' }}>at</span> {r.evaluation?.companyName}</div>
                <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>Score: {r.evaluation?.overallScore}/100 · {r.evaluation?.recommendation}</div>
              </div>
              <a href={r.url} target="_blank" rel="noreferrer" style={{ padding:'7px 14px', fontSize:12, fontWeight:700, background:'#f8fafc', color:'#374151', border:'1px solid #e2e8f0', borderRadius:8, textDecoration:'none', flexShrink:0 }}>View ↗</a>
            </div>
          ) : (
            <div key={i} style={{ background:'#fafafa', border:'1px solid #fecaca', borderRadius:12, padding:'12px 18px', marginBottom:10, display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:16 }}>⚠</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, color:'#dc2626', fontWeight:600 }}>Failed: {r.error}</div>
                <div style={{ fontSize:11, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.url}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CareerOps() {
  const [tab, setTab]               = useState('scanner')
  const [resumeInfo, setResumeInfo] = useState(null)
  const [jobInput, setJobInput]     = useState('')
  const [inputMode, setInputMode]   = useState('url')
  // Resume picker for the Evaluate tab. Per user ask #2 option A: no
  // preselection — the user must pick "Use saved" / "Upload" / "Paste"
  // every time so they confirm which resume each evaluation runs against.
  const [resumeMode, setResumeMode] = useState(null)        // 'saved' | 'upload' | 'paste' | null
  const [resumePasted, setResumePasted] = useState('')
  const [resumeUploadedText, setResumeUploadedText] = useState('')
  const [resumeUploadedName, setResumeUploadedName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  // Metadata for the evaluating-loading panel — populated synchronously from
  // the URL slug at click time so the user sees *what* is being evaluated
  // during the 10-30s AI call instead of a generic spinner. null when we
  // can't extract anything useful (e.g. LinkedIn job IDs).
  const [evaluatingMeta, setEvaluatingMeta] = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [evalId, setEvalId]         = useState(null)
  const [evalError, setEvalError]   = useState(null)
  const [history, setHistory]       = useState([])
  const [histLoading, setHistLoading] = useState(false)
  // History tab multi-select for batch auto-apply queueing.
  const [historySelected, setHistorySelected] = useState(new Set())
  const [historyQueueing, setHistoryQueueing] = useState(false)
  const [historyQueueMsg, setHistoryQueueMsg] = useState(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfReady, setPdfReady]     = useState(false)
  const [applyMode, setApplyMode]   = useState('manual') // per-evaluation: 'manual' | 'auto'
  const [applyStatus, setApplyStatus] = useState('not_started')
  const [applying, setApplying]     = useState(false)
  const [queuing, setQueuing]       = useState(false)
  const [roleTypeFilter, setRoleTypeFilter] = useState('all') // 'all' | 'intern' | 'fulltime'

  // Classify job type from title
  const classifyRoleType = (title) => {
    if (!title) return 'intern'
    const internKw = /\binterns?\b|\binternships?\b|\bco-op\b|\bcoop\b|\bsummer 2026\b/i
    const fulltimeKw = /\bfull.?time\b|\bfull time\b|\bnew grad\b|\bnew-grad\b|\bnew.?graduate\b|\bentry.?level\b|\bjunior\b|\bjr\b|\bsenior\b|\blead\b|\bstaff\b/i
    if (internKw.test(title)) return 'intern'
    if (fulltimeKw.test(title)) return 'fulltime'
    return 'intern'
  }

  useEffect(() => { injectStyles() }, [])
  useEffect(() => { api.career.resume().then(setResumeInfo).catch(() => {}) }, [])
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab])

  async function loadHistory() {
    setHistLoading(true)
    try {
      const all = await api.career.evaluations()
      // Filter out tracked-but-unevaluated rows (no grade — created via Track
      // or Queue actions on scraped roles that never went through full AI
      // evaluation). They polluted the History tab with "Score: /100" entries.
      const evaluated = (all || []).filter(ev => ev.grade && ev.grade !== '-')
      // Dedupe: for the same job_url keep only the most-recent evaluation.
      // (Multiple track actions on the same scraped role create duplicate rows.)
      const seen = new Map()
      for (const ev of evaluated) {
        const key = ev.job_url || ev.id
        if (!seen.has(key) || new Date(ev.created_at) > new Date(seen.get(key).created_at)) {
          seen.set(key, ev)
        }
      }
      setHistory([...seen.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
    } finally { setHistLoading(false) }
  }

  // Resolve the resume text for an evaluation based on the picker mode.
  // Returns null if mode unset/invalid (caller surfaces an error).
  function pickResumeTextForEval() {
    if (resumeMode === 'paste') return resumePasted.trim() || null
    if (resumeMode === 'upload') return resumeUploadedText.trim() || null
    if (resumeMode === 'saved') return null                  // backend falls back to saved
    return null                                              // mode unset
  }

  async function handleEvaluate(prefillUrl = null) {
    const input = prefillUrl || jobInput
    if (!input?.trim()) return
    if (prefillUrl) { setTab('evaluate'); setJobInput(prefillUrl); setInputMode('url') }
    if (!resumeMode) { setEvalError('Pick a resume above (Use saved / Upload / Paste) before evaluating'); return }
    if (resumeMode === 'paste' && resumePasted.trim().length < 50) { setEvalError('Pasted resume looks too short — paste the full text'); return }
    if (resumeMode === 'upload' && !resumeUploadedText) { setEvalError('Upload a PDF first'); return }
    if (resumeMode === 'saved' && !resumeInfo?.hasResume) { setEvalError('No saved resume — pick Upload or Paste, or upload a default in Auto-Apply Setup'); return }
    setEvaluating(true); setEvalError(null); setEvaluation(null); setPdfReady(false)
    setApplyMode('manual'); setApplyStatus('not_started')
    // Best-effort client-side extraction of role title + company from the URL
    // so the loading panel shows the user *what* is being evaluated. Falls
    // back to the URL itself when the slug is opaque (LinkedIn, etc.).
    const isUrl = input.trim().startsWith('http')
    setEvaluatingMeta(isUrl ? extractJobMetaFromUrl(input.trim()) : null)
    try {
      const baseBody = isUrl ? { jobUrl: input.trim() } : { jobDescription: input.trim() }
      const overrideText = pickResumeTextForEval()
      const body = overrideText ? { ...baseBody, resumeText: overrideText } : baseBody
      const r = await api.career.evaluate(body)
      setEvaluation(r.evaluation); setEvalId(r.evalId)
    } catch (err) { setEvalError(err.message) }
    finally { setEvaluating(false); setEvaluatingMeta(null) }
  }

  async function handleResumeUpload(file) {
    if (!file) return
    setParsing(true); setEvalError(null)
    try {
      const r = await api.career.parseResume(file)
      setResumeUploadedText(r.text || '')
      setResumeUploadedName(r.name || file.name)
    } catch (err) {
      setEvalError(err.message || 'Resume parse failed')
      setResumeUploadedText(''); setResumeUploadedName('')
    } finally { setParsing(false) }
  }

  // Persist apply-mode choice to DB so history/auto-apply worker can honor it.
  async function handleApplyModeChange(mode) {
    setApplyMode(mode)
    if (!evalId) return
    try { await api.career.setApplyMode(evalId, mode) } catch (e) { console.warn('Apply mode change error:', e) }
  }

  // Manual mode: opens the job URL in a new tab — user submits the form and then
  // clicks "Mark applied" to confirm.  Auto mode: enqueues the evaluation for the
  // Playwright worker (worker itself lands in issue #9).
  async function handleApply() {
    if (!evalId) return
    setApplying(true)
    try {
      const r = await api.career.apply(evalId)
      setApplyStatus(r.status || 'opened')
      if (r.mode === 'manual' && r.url) {
        window.open(r.url, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      alert('Apply failed: ' + err.message)
    } finally { setApplying(false) }
  }

  // Queue without running — flips mode → 'auto' and status → 'queued'
  // so the Auto-Apply Setup tab's "Run Auto-Apply Queue" button picks it
  // up later. Resume archetype matching happens at run time inside the
  // worker via pickResumeForRole.
  async function handleQueue() {
    if (!evalId) return
    setQueuing(true)
    try {
      await api.career.setApplyMode(evalId, 'auto')
      await api.career.setApplyStatus(evalId, 'queued')
      setApplyMode('auto')
      setApplyStatus('queued')
    } catch (err) {
      alert('Queue failed: ' + err.message)
    } finally { setQueuing(false) }
  }

  async function handleGeneratePDF() {
    if (!evalId) return
    setPdfLoading(true)
    try { const r = await api.career.tailoredResume(evalId); if (r.ok) setPdfReady(true) }
    catch (err) { alert('PDF generation failed: ' + err.message) }
    finally { setPdfLoading(false) }
  }

  async function handleDownloadPdf() {
    if (!evalId) return
    const safe = (s) => String(s || '').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80)
    const filename = `${safe(evaluation?.companyName) || 'company'}-${safe(evaluation?.jobTitle) || 'role'}.pdf`
    try { await api.career.downloadEvaluationPdf(evalId, filename) }
    catch (err) { alert('Download failed: ' + err.message) }
  }

  async function handleDeleteEval(id) {
    await api.career.deleteEvaluation(id)
    setHistory(h => h.filter(e => e.id !== id))
  }

  async function loadEvalFromHistory(ev) {
    const r = await api.career.evaluation(ev.id)
    setEvaluation(r.evaluation); setEvalId(r.id)
    setPdfReady(!!r.pdf_path)
    setApplyMode(r.apply_mode || 'manual')
    setApplyStatus(r.apply_status || 'not_started')
    setTab('evaluate')
  }

  // Tab definitions broken into icon + short + full label so we can render
  // the same source data three ways (icon-only on tablet, dropdown on phone,
  // full label on desktop) without duplicating state.
  const TABS = [
    { k:'scanner',  icon:'🔍', short:'Scanner',   full:'Portal Scanner' },
    { k:'evaluate', icon:'⚡', short:'Evaluate',  full:'Evaluate' },
    { k:'batch',    icon:'📦', short:'Batch',     full:'Batch Evaluate' },
    { k:'history',  icon:'📋', short:`History${history.length > 0 ? ` (${history.length})` : ''}`, full:`History${history.length > 0 ? ` (${history.length})` : ''}` },
    { k:'profile',  icon:'⚙',  short:'Auto-Apply', full:'Auto-Apply Setup' },
  ]
  const isPhone   = useMediaQuery('(max-width: 480px)')
  const isTablet  = useMediaQuery('(min-width: 481px) and (max-width: 900px)')

  // Add to auto-apply queue from a History row.
  async function handleQueueFromHistory(id) {
    await api.career.setApplyMode(id, 'auto')
    await api.career.setApplyStatus(id, 'queued')
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'#f8fafc' }}>

      {/* Page header */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', flexShrink:0 }}>
        <div style={{ padding:'18px 28px 0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <h1 style={{ margin:0, fontSize:20, fontWeight:800, color:'#0f172a', display:'flex', alignItems:'center', gap:10 }}>
              🧠 Career Ops
            </h1>
            <p style={{ margin:'4px 0 0', fontSize:12, color:'#94a3b8' }}>Evaluate roles · Tailor your resume · Discover opportunities</p>
          </div>
        </div>

        {/* Tabs — three renderings:
            • Phone (≤480px): native <select> dropdown — fits everything on
              the narrowest screens, accessible, no horizontal scroll.
            • Tablet (481-900px): icon-only tab strip — all 5 tabs fit
              without clipping. Hover/active states show the full label.
            • Desktop (>900px): full label strip (existing). */}
        {isPhone ? (
          <div style={{ padding:'10px 16px 14px', borderTop:'1px solid #f1f5f9' }}>
            <TabPicker tabs={TABS} value={tab} onChange={setTab} />
          </div>
        ) : (
          <div style={{ display:'flex', padding:'0 28px', overflowX:'auto' }}>
            {TABS.map(t => (
              <button key={t.k} onClick={() => setTab(t.k)}
                title={t.full}
                style={{ padding: isTablet ? '12px 12px' : '12px 18px', fontSize: isTablet ? 18 : 13, fontWeight: tab===t.k ? 700:500, cursor:'pointer', background:'none', border:'none', whiteSpace:'nowrap', borderBottom: tab===t.k ? '2px solid #6366f1':'2px solid transparent', color: tab===t.k ? '#6366f1':'#94a3b8', transition:'all 0.12s', marginBottom:'-1px', display:'flex', alignItems:'center', gap:6 }}>
                <span aria-hidden="true">{t.icon}</span>
                {!isTablet && <span>{t.full}</span>}
                {isTablet && tab === t.k && <span style={{ fontSize:12 }}>{t.short}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px' }}>

        {/* Resume section — only render when needed:
            - on profile/setup tab (manage resume there), or
            - on any tab when the user has no resume yet (so the prompt to upload is visible).
            Returning users on evaluate/scanner/batch/history skip the redundant green
            "uploaded" box and see the actual workflow first. */}
        {(tab === 'profile' || resumeInfo?.hasResume === false) && (
          <div style={{ marginBottom:22 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>Your Resume</div>
            <ResumeUpload resumeInfo={resumeInfo} onUploaded={info => setResumeInfo({ hasResume:true, ...info })} />
          </div>
        )}

        {/* ── Evaluate tab ── */}
        {tab === 'evaluate' && (
          <div>
            {/* Resume picker — pick which resume each evaluation runs against.
                No preselection (per user ask #2 option A) so the user
                consciously confirms the resume every time. */}
            <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:16, marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Resume for this evaluation</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {[
                  { k:'saved',  l: resumeInfo?.hasResume ? `💾 Use saved (${resumeInfo?.name || 'default'})` : '💾 Use saved (none)', disabled: !resumeInfo?.hasResume },
                  { k:'upload', l:'📎 Upload PDF' },
                  { k:'paste',  l:'📝 Paste text' },
                ].map(({ k, l, disabled }) => (
                  <button key={k} onClick={() => { if (!disabled) { setResumeMode(k); setEvalError(null) } }} disabled={disabled}
                    style={{ padding:'8px 14px', fontSize:12, fontWeight:700, border:'1px solid', borderRadius:8, cursor: disabled ? 'not-allowed' : 'pointer',
                      borderColor: resumeMode === k ? '#6366f1' : '#e2e8f0',
                      background:  resumeMode === k ? '#eef2ff' : (disabled ? '#f8fafc' : '#fff'),
                      color:       resumeMode === k ? '#4338ca' : (disabled ? '#cbd5e1' : '#475569'),
                      transition:'all 0.12s' }}>
                    {l}
                  </button>
                ))}
              </div>

              {resumeMode === 'upload' && (
                <div style={{ marginTop:12 }}>
                  <input type="file" accept="application/pdf"
                    onChange={e => handleResumeUpload(e.target.files?.[0])}
                    style={{ fontSize:12 }} />
                  {parsing && <div style={{ marginTop:8, fontSize:12, color:'#6366f1', display:'flex', alignItems:'center', gap:8 }}><Spin size={12} /> Parsing PDF…</div>}
                  {!parsing && resumeUploadedText && (
                    <div style={{ marginTop:8, padding:'8px 12px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, fontSize:12, color:'#15803d', fontWeight:600 }}>
                      ✓ {resumeUploadedName} parsed ({resumeUploadedText.length.toLocaleString()} chars). This evaluation will use this PDF — your saved default is untouched.
                    </div>
                  )}
                </div>
              )}

              {resumeMode === 'paste' && (
                <div style={{ marginTop:12 }}>
                  <textarea value={resumePasted} onChange={e => setResumePasted(e.target.value)}
                    placeholder="Paste the full resume text…" rows={8}
                    style={{ width:'100%', background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, fontSize:12, padding:10, lineHeight:1.55, fontFamily:'monospace', boxSizing:'border-box' }} />
                  <div style={{ marginTop:6, fontSize:11, color: resumePasted.length < 50 ? '#dc2626' : '#94a3b8', fontWeight:600 }}>
                    {resumePasted.length.toLocaleString()} chars — minimum 50
                  </div>
                </div>
              )}

              {resumeMode === 'saved' && resumeInfo?.hasResume && (
                <div style={{ marginTop:10, padding:'8px 12px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, fontSize:12, color:'#15803d', fontWeight:600 }}>
                  ✓ Using saved default: {resumeInfo.name}
                </div>
              )}

              {!resumeMode && (
                <div style={{ marginTop:10, fontSize:12, color:'#94a3b8' }}>Pick one of the options above to enable Evaluate.</div>
              )}
            </div>

            {/* Mode toggle */}
            <div style={{ display:'inline-flex', background:'#f1f5f9', borderRadius:9, padding:3, marginBottom:16, gap:3 }}>
              {[['url','🔗 Job URL'],['paste','📝 Paste JD']].map(([k,l]) => (
                <button key={k} onClick={() => setInputMode(k)}
                  style={{ padding:'7px 18px', fontSize:12, fontWeight:700, cursor:'pointer', border:'none', borderRadius:7,
                    background: inputMode===k ? '#fff':'transparent',
                    color: inputMode===k ? '#6366f1':'#64748b',
                    boxShadow: inputMode===k ? '0 1px 4px rgba(0,0,0,0.08)':'none',
                    transition:'all 0.15s' }}>
                  {l}
                </button>
              ))}
            </div>

            {inputMode === 'url' ? (
              <div style={{ display:'flex', gap:10, marginBottom:16 }}>
                <input value={jobInput} onChange={e => setJobInput(e.target.value)} onKeyDown={e => e.key==='Enter' && handleEvaluate()}
                  placeholder="https://jobs.lever.co/company/… or any job posting URL"
                  style={{ flex:1, background:'#fff', borderRadius:10, fontSize:13 }} />
                <button onClick={() => handleEvaluate()} disabled={evaluating || !resumeMode}
                  style={{ padding:'10px 24px', fontSize:13, fontWeight:700, background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:10, cursor: evaluating || !resumeMode ? 'not-allowed':'pointer', opacity: !resumeMode ? 0.55 : 1, display:'flex', alignItems:'center', gap:8, whiteSpace:'nowrap', flexShrink:0 }}>
                  {evaluating ? <><Spin size={14} color="#fff" /> Evaluating…</> : '⚡ Evaluate'}
                </button>
              </div>
            ) : (
              <div style={{ marginBottom:16 }}>
                <textarea value={jobInput} onChange={e => setJobInput(e.target.value)}
                  placeholder="Paste the full job description here…" rows={8}
                  style={{ background:'#fff', borderRadius:10, fontSize:13, lineHeight:1.65 }} />
                <div style={{ display:'flex', justifyContent:'flex-end', marginTop:10 }}>
                  <button onClick={() => handleEvaluate()} disabled={evaluating || !resumeMode}
                    style={{ padding:'10px 26px', fontSize:13, fontWeight:700, background:'linear-gradient(135deg,#6366f1,#7c3aed)', color:'#fff', border:'none', borderRadius:10, cursor: evaluating || !resumeMode ? 'not-allowed':'pointer', opacity: !resumeMode ? 0.55 : 1, display:'flex', alignItems:'center', gap:8 }}>
                    {evaluating ? <><Spin size={14} color="#fff" /> Evaluating…</> : '⚡ Evaluate Job'}
                  </button>
                </div>
              </div>
            )}

            {evaluating && (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'56px 16px', gap:14 }}>
                <Spin size={36} />
                {evaluatingMeta?.title || evaluatingMeta?.company ? (
                  <div style={{ textAlign:'center', maxWidth:480 }}>
                    <div style={{ fontSize:15, color:'#0f172a', fontWeight:800, marginBottom:4 }}>
                      {evaluatingMeta.title || 'Role'}
                      {evaluatingMeta.company && (
                        <span style={{ fontWeight:500, color:'#64748b' }}> · {evaluatingMeta.company}</span>
                      )}
                    </div>
                    <div style={{ fontSize:13, color:'#6366f1', fontWeight:600 }}>Analyzing against your resume…</div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>Generating verdict + Top 3 gaps + A–G blocks · typically 10–30 seconds</div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize:15, color:'#6366f1', fontWeight:700 }}>Analyzing role against your resume…</div>
                    <div style={{ fontSize:12, color:'#94a3b8' }}>Generating verdict + Top 3 gaps + A–G blocks — typically 10–30 seconds</div>
                  </>
                )}
              </div>
            )}

            {evalError && (
              <div style={{ padding:'14px 18px', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:12, fontSize:13, color:'#dc2626', fontWeight:600 }}>
                ⚠ {evalError}
              </div>
            )}

            {evaluation && !evaluating && (
              <EvaluationReport
                evaluation={evaluation}
                onGeneratePDF={handleGeneratePDF}
                pdfLoading={pdfLoading}
                pdfReady={pdfReady}
                onDownloadPdf={handleDownloadPdf}
                applyMode={applyMode}
                applyStatus={applyStatus}
                onApplyModeChange={handleApplyModeChange}
                onApply={handleApply}
                applying={applying}
                onQueue={handleQueue}
                queuing={queuing}
              />
            )}
          </div>
        )}

        {tab === 'scanner' && <PortalScanner hasResume={!!resumeInfo?.hasResume} onSendToEvaluate={url => handleEvaluate(url)} />}
        {tab === 'batch'   && <BatchEval hasResume={!!resumeInfo?.hasResume} />}
        {tab === 'profile' && <AutoApplySetup />}

        {tab === 'history' && (
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:16 }}>Past Evaluations</div>
            {histLoading ? (
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'40px 0', justifyContent:'center' }}>
                <Spin /> <span style={{ fontSize:13, color:'#64748b' }}>Loading evaluations…</span>
              </div>
            ) : history.length === 0 ? (
              <div style={{ textAlign:'center', padding:'64px 0', color:'#94a3b8' }}>
                <div style={{ fontSize:44, marginBottom:12 }}>📋</div>
                <div style={{ fontSize:14, fontWeight:600, color:'#64748b' }}>No evaluations yet</div>
                <div style={{ fontSize:12, marginTop:4 }}>Evaluate a job to see it here</div>
              </div>
            ) : (
              <>
                {/* Role Type Filter */}
                {history.length > 0 && (
                  <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
                    {[
                      { k:'all', l:`All ${history.length}` },
                      { k:'intern', l:`🎓 Intern (${history.filter(ev => classifyRoleType(ev.jobTitle) === 'intern').length})` },
                      { k:'fulltime', l:`💼 Full-Time/New Grad (${history.filter(ev => classifyRoleType(ev.jobTitle) === 'fulltime').length})` }
                    ].map(({ k, l }) => (
                      <button key={k} onClick={() => setRoleTypeFilter(k)}
                        style={{ padding:'6px 16px', fontSize:12, fontWeight:700, border:'none', borderRadius:20, cursor:'pointer', transition:'all 0.12s',
                          background: roleTypeFilter === k ? '#6366f1' : '#f1f5f9',
                          color: roleTypeFilter === k ? '#fff' : '#64748b' }}>
                        {l}
                      </button>
                    ))}
                  </div>
                )}
                {/* Multi-select header */}
                {(() => {
                  const visible = history.filter(ev => roleTypeFilter === 'all' || classifyRoleType(ev.jobTitle) === roleTypeFilter)
                  const eligibleIds = visible.filter(ev => ev.grade).map(ev => ev.id)
                  const selectedCount = historySelected.size
                  return (
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:12, padding:'10px 12px', background: selectedCount ? '#eef2ff' : '#f8fafc', borderRadius:9 }}>
                      <div style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>
                        {selectedCount > 0 ? `${selectedCount} selected` : 'Select multiple to queue them all at once'}
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                        <button onClick={() => setHistorySelected(new Set(eligibleIds))}
                          style={{ padding:'5px 11px', fontSize:11, fontWeight:600, background:'#fff', color:'#4f46e5', border:'1px solid #c7d2fe', borderRadius:7, cursor:'pointer' }}>
                          Select all evaluated ({eligibleIds.length})
                        </button>
                        {selectedCount > 0 && (
                          <button onClick={() => setHistorySelected(new Set())}
                            style={{ padding:'5px 11px', fontSize:11, fontWeight:600, background:'#fff', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:7, cursor:'pointer' }}>
                            Clear
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (!historySelected.size) return
                            setHistoryQueueing(true); setHistoryQueueMsg(null)
                            try {
                              const res = await api.career.queueByIds([...historySelected])
                              setHistoryQueueMsg(`✓ Queued ${res.queued} role${res.queued === 1 ? '' : 's'} for auto-apply`)
                              setHistorySelected(new Set())
                              loadHistory()
                            } catch (err) {
                              setHistoryQueueMsg(`⚠ ${err.message}`)
                            } finally {
                              setHistoryQueueing(false)
                            }
                          }}
                          disabled={!selectedCount || historyQueueing}
                          style={{ padding:'7px 14px', fontSize:12, fontWeight:700, background: selectedCount ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#f1f5f9', color: selectedCount ? '#fff' : '#94a3b8', border:'none', borderRadius:8, cursor: selectedCount ? 'pointer' : 'default', display:'flex', alignItems:'center', gap:6 }}>
                          {historyQueueing ? <><Spin size={11} color="#fff" /> Queuing…</> : `⚡ Queue ${selectedCount || ''} for Auto-Apply`}
                        </button>
                      </div>
                    </div>
                  )
                })()}
                {historyQueueMsg && (
                  <div style={{ padding:'10px 14px', background: historyQueueMsg.startsWith('✓') ? '#dcfce7' : '#fee2e2', color: historyQueueMsg.startsWith('✓') ? '#15803d' : '#991b1b', borderRadius:8, fontSize:12, fontWeight:600, marginBottom:12 }}>
                    {historyQueueMsg}
                  </div>
                )}
                {/* Filtered Evaluations */}
                {history.filter(ev => roleTypeFilter === 'all' || classifyRoleType(ev.jobTitle) === roleTypeFilter).map(ev => (
                  <EvalCard
                    key={ev.id}
                    ev={ev}
                    onClick={() => loadEvalFromHistory(ev)}
                    onDelete={handleDeleteEval}
                    onQueue={handleQueueFromHistory}
                    selected={historySelected.has(ev.id)}
                    onToggleSelect={ev.grade ? (id) => {
                      setHistorySelected(s => {
                        const next = new Set(s)
                        next.has(id) ? next.delete(id) : next.add(id)
                        return next
                      })
                    } : null}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

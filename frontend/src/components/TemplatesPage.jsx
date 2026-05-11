import { useEffect, useState } from 'react'
import { api } from '../api'
import { useMediaQuery } from '../hooks'
import Spin from './Spin'

const fieldStyle = {
  width: '100%',
  minHeight: 220,
  resize: 'vertical',
  border: '1px solid #dbe3ef',
  borderRadius: 10,
  padding: 14,
  fontSize: 13,
  lineHeight: 1.55,
  color: '#0f172a',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
}

const variantNameStyle = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #dbe3ef',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  color: '#0f172a',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
}

function makeId() {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export default function TemplatesPage() {
  // Phone stacks the email/linkedin pair; tablet keeps the side-by-side
  // layout but with tighter outer padding.
  const isPhone   = useMediaQuery('(max-width: 480px)')
  const isNarrow  = useMediaQuery('(max-width: 900px)')
  const [templates, setTemplates] = useState({ email: '', linkedin: '', variants: [] })
  const [defaults, setDefaults] = useState({ email: '', linkedin: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let alive = true
    api.generate.templates()
      .then(d => {
        if (!alive) return
        const t = d.templates || {}
        setTemplates({
          email: t.email || '',
          linkedin: t.linkedin || '',
          variants: Array.isArray(t.variants) ? t.variants : [],
        })
        setDefaults(d.defaults || d.templates || {})
      })
      .catch(err => alive && setStatus({ ok: false, text: err.message || 'Could not load templates' }))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  async function save() {
    setSaving(true)
    setStatus(null)
    try {
      const d = await api.generate.saveTemplates(templates)
      const t = d.templates || templates
      setTemplates({
        email: t.email || '',
        linkedin: t.linkedin || '',
        variants: Array.isArray(t.variants) ? t.variants : [],
      })
      setStatus({ ok: true, text: 'Templates saved' })
    } catch (err) {
      setStatus({ ok: false, text: err.message || 'Save failed' })
    }
    setSaving(false)
  }

  function resetToDefaults() {
    setTemplates({ ...defaults, variants: [] })
    setStatus({ ok: true, text: 'Defaults loaded. Save to apply them.' })
  }

  function addVariant(kind) {
    const next = [...(templates.variants || []), { id: makeId(), kind, name: '', body: '' }]
    setTemplates(t => ({ ...t, variants: next }))
  }

  function updateVariant(id, patch) {
    setTemplates(t => ({
      ...t,
      variants: (t.variants || []).map(v => v.id === id ? { ...v, ...patch } : v),
    }))
  }

  function removeVariant(id) {
    setTemplates(t => ({ ...t, variants: (t.variants || []).filter(v => v.id !== id) }))
  }

  const emailVariants = (templates.variants || []).filter(v => v.kind === 'email')
  const linkedinVariants = (templates.variants || []).filter(v => v.kind === 'linkedin')

  return (
    <div style={{ flex:1, overflowY:'auto', background:'#f8fafc', padding: isPhone ? '14px' : isNarrow ? '24px' : '40px' }}>
      <div style={{ maxWidth:980, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:14, marginBottom: isPhone ? 16 : 24, flexWrap:'wrap' }}>
          <div style={{ minWidth:0, flex:'1 1 auto' }}>
            <h1 style={{ fontSize: isPhone ? 18 : 24, fontWeight:800, color:'#0f172a', margin:'0 0 4px' }}>Templates</h1>
            <p style={{ fontSize: isPhone ? 12 : 13, color:'#64748b', margin:0 }}>
              Email and LinkedIn style anchors used when the AI generates outreach. Save additional named variants to give the AI more tones to draw from.
            </p>
          </div>
          <div style={{ display:'flex', gap:8, flexShrink:0 }}>
            <button type="button" onClick={resetToDefaults} disabled={loading || saving}
              style={{ padding:'9px 14px', borderRadius:9, border:'1px solid #dbe3ef', background:'#fff', color:'#475569', fontSize:12, fontWeight:700, cursor: loading || saving ? 'default' : 'pointer' }}>
              Reset defaults
            </button>
            <button type="button" onClick={save} disabled={loading || saving}
              style={{ padding:'9px 16px', borderRadius:9, border:'none', background: saving ? '#cbd5e1' : '#4f46e5', color:'#fff', fontSize:12, fontWeight:800, cursor: loading || saving ? 'default' : 'pointer' }}>
              {saving ? 'Saving...' : 'Save templates'}
            </button>
          </div>
        </div>

        {status && (
          <div style={{ marginBottom:16, padding:'10px 12px', borderRadius:9, border:`1px solid ${status.ok ? '#bbf7d0' : '#fecaca'}`, background: status.ok ? '#f0fdf4' : '#fef2f2', color: status.ok ? '#166534' : '#991b1b', fontSize:12, fontWeight:700 }}>
            {status.text}
          </div>
        )}

        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', paddingTop:80 }}><Spin /></div>
        ) : (
          <>
            <div style={{ display:'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr', gap: isPhone ? 14 : 18 }}>
              <section style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:18 }}>
                <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:6 }}>Cold Email — Primary</div>
                <div style={{ fontSize:12, color:'#64748b', marginBottom:12 }}>
                  Use placeholders like {'{{first_name}}'} and {'{{company}}'} if helpful.
                </div>
                <textarea value={templates.email || ''} onChange={e => setTemplates(t => ({ ...t, email: e.target.value }))} style={fieldStyle} />
              </section>

              <section style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:18 }}>
                <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:6 }}>LinkedIn DM — Primary</div>
                <div style={{ fontSize:12, color:'#64748b', marginBottom:12 }}>
                  Keep this short; LinkedIn connection notes should stay under 280 characters.
                </div>
                <textarea value={templates.linkedin || ''} onChange={e => setTemplates(t => ({ ...t, linkedin: e.target.value }))} style={{ ...fieldStyle, minHeight: 140 }} />
                <div style={{ marginTop:8, fontSize:11, color: (templates.linkedin || '').length > 280 ? '#dc2626' : '#94a3b8', fontWeight:700 }}>
                  {(templates.linkedin || '').length}/280
                </div>
              </section>
            </div>

            {/* Email variants */}
            <section style={{ marginTop:22, background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:18 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10, gap:10, flexWrap:'wrap' }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:800, color:'#0f172a' }}>Cold Email — Additional variants</div>
                  <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                    Save more email styles (e.g. recruiter outreach, hiring-manager intro). The AI uses them as additional style examples.
                  </div>
                </div>
                <button type="button" onClick={() => addVariant('email')}
                  style={{ padding:'8px 14px', borderRadius:8, border:'1px dashed #6366f1', background:'#eef2ff', color:'#4f46e5', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  + Add email variant
                </button>
              </div>
              {emailVariants.length === 0 ? (
                <div style={{ padding:'18px 0', fontSize:12, color:'#94a3b8' }}>No additional variants yet. Click "Add email variant" to create one.</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  {emailVariants.map(v => (
                    <div key={v.id} style={{ border:'1px solid #e2e8f0', borderRadius:10, padding:14, background:'#fafbff' }}>
                      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10 }}>
                        <input value={v.name || ''} onChange={e => updateVariant(v.id, { name: e.target.value })}
                          placeholder="Variant name (e.g. 'Recruiter cold email')"
                          style={variantNameStyle} />
                        <button type="button" onClick={() => removeVariant(v.id)}
                          style={{ padding:'7px 12px', fontSize:11, fontWeight:700, background:'none', border:'1px solid #fecaca', color:'#dc2626', borderRadius:7, cursor:'pointer', flexShrink:0 }}>
                          Delete
                        </button>
                      </div>
                      <textarea value={v.body || ''} onChange={e => updateVariant(v.id, { body: e.target.value })}
                        placeholder="Body of this email variant…"
                        style={{ ...fieldStyle, minHeight: 160 }} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* LinkedIn variants */}
            <section style={{ marginTop:18, background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:18 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10, gap:10, flexWrap:'wrap' }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:800, color:'#0f172a' }}>LinkedIn DM — Additional variants</div>
                  <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                    Short DM styles for different recipients. Each is used as an additional style anchor.
                  </div>
                </div>
                <button type="button" onClick={() => addVariant('linkedin')}
                  style={{ padding:'8px 14px', borderRadius:8, border:'1px dashed #6366f1', background:'#eef2ff', color:'#4f46e5', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  + Add LinkedIn variant
                </button>
              </div>
              {linkedinVariants.length === 0 ? (
                <div style={{ padding:'18px 0', fontSize:12, color:'#94a3b8' }}>No additional variants yet. Click "Add LinkedIn variant" to create one.</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  {linkedinVariants.map(v => (
                    <div key={v.id} style={{ border:'1px solid #e2e8f0', borderRadius:10, padding:14, background:'#fafbff' }}>
                      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10 }}>
                        <input value={v.name || ''} onChange={e => updateVariant(v.id, { name: e.target.value })}
                          placeholder="Variant name (e.g. 'Short connect note')"
                          style={variantNameStyle} />
                        <button type="button" onClick={() => removeVariant(v.id)}
                          style={{ padding:'7px 12px', fontSize:11, fontWeight:700, background:'none', border:'1px solid #fecaca', color:'#dc2626', borderRadius:7, cursor:'pointer', flexShrink:0 }}>
                          Delete
                        </button>
                      </div>
                      <textarea value={v.body || ''} onChange={e => updateVariant(v.id, { body: e.target.value })}
                        placeholder="Body of this LinkedIn DM…"
                        style={{ ...fieldStyle, minHeight: 120 }} />
                      <div style={{ marginTop:6, fontSize:11, color: (v.body || '').length > 280 ? '#dc2626' : '#94a3b8', fontWeight:700 }}>
                        {(v.body || '').length}/280
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

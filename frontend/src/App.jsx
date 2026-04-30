import { useState, useRef, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { runAgents, uploadFile, saveFeedback, clearMemory } from './lib/api.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────
const SESSION_KEY = 'rana_session_id'
const getSessionId = () => {
  let id = localStorage.getItem(SESSION_KEY)
  if (!id) { id = uuidv4(); localStorage.setItem(SESSION_KEY, id) }
  return id
}

function tryParseJson(str) {
  if (typeof str !== 'string') return null
  try { return JSON.parse(str) } catch {
    const match = str.match(/(\{[\s\S]*\})/)
    if (match) {
      try { return JSON.parse(match[1]) } catch { }
    }
    return null
  }
}

function humanizeKey(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function SummaryView({ data }) {
  if (typeof data === 'string') {
    return <p style={{ margin: 0, color: 'var(--text)', fontSize: 13 }}>{data}</p>
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return <p style={{ margin: 0, color: 'var(--text)', fontSize: 13 }}>{String(data)}</p>
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 13 }}>Tidak ada data.</p>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.slice(0, 4).map((item, index) => (
          <div key={index} style={{ padding: 12, background: 'var(--bg4)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Item {index + 1}</div>
            <SummaryView data={item} />
          </div>
        ))}
        {data.length > 4 && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>+ {data.length - 4} item lainnya</div>
        )}
      </div>
    )
  }
  if (typeof data === 'object' && data !== null) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {Object.entries(data).map(([key, value]) => (
          <div key={key}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
              {humanizeKey(key)}
            </div>
            {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
              ? <p style={{ margin: 0, color: 'var(--text)', fontSize: 13 }}>{String(value)}</p>
              : <SummaryView data={value} />
            }
          </div>
        ))}
      </div>
    )
  }
  return null
}

// ─── Agent config ─────────────────────────────────────────────────────────────
const AGENTS = {
  rana: { name: 'Rana', role: 'Supervisor', color: '#c4a882', icon: '◆' },
  hara: { name: 'Hara', role: 'Research', color: '#82c4a0', icon: '◎' },
  bombom: { name: 'Bombom', role: 'Image Ads', color: '#c48282', icon: '▣' },
  luna: { name: 'Luna', role: 'Video Concept', color: '#8299c4', icon: '◐' },
  hagen: { name: 'Hagen', role: 'Eksekusi', color: '#c4b082', icon: '▷' },
}

const STEPS = [
  { id: 'rana_init', agent: 'rana', label: 'Rana inisialisasi konteks' },
  { id: 'hara', agent: 'hara', label: 'Hara riset market' },
  { id: 'validate_hara', agent: 'rana', label: 'Rana validasi riset' },
  { id: 'creative', agent: 'bombom', label: 'Bombom & Luna buat konten' },
  { id: 'decision', agent: 'rana', label: 'Rana keputusan final' },
]

// ─── Components ───────────────────────────────────────────────────────────────

function AgentBadge({ agentKey, size = 'sm' }) {
  const a = AGENTS[agentKey]
  if (!a) return null
  const sz = size === 'lg' ? { fontSize: 13, px: 12, py: 5, gap: 6 } : { fontSize: 11, px: 8, py: 3, gap: 4 }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: sz.gap,
      background: `${a.color}18`, border: `1px solid ${a.color}40`,
      color: a.color, borderRadius: 6,
      padding: `${sz.py}px ${sz.px}px`, fontSize: sz.fontSize,
      fontFamily: 'var(--font-mono)', fontWeight: 500, whiteSpace: 'nowrap'
    }}>
      <span>{a.icon}</span>
      <span>{a.name}</span>
    </span>
  )
}

function StepTracker({ currentStep, completed }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 0' }}>
      {STEPS.map((step, i) => {
        const isDone = completed.includes(step.id)
        const isActive = currentStep === step.id
        const a = AGENTS[step.agent]
        return (
          <div key={step.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            opacity: isDone ? 1 : isActive ? 1 : 0.35,
            animation: isActive ? 'stepReveal 0.3s ease' : undefined,
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: isDone ? `${a.color}30` : isActive ? `${a.color}20` : 'var(--bg4)',
              border: `1.5px solid ${isDone || isActive ? a.color : 'transparent'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: a.color,
            }}>
              {isDone ? '✓' : isActive ? <span style={{ animation: 'pulse 1s infinite' }}>●</span> : i + 1}
            </div>
            <span style={{ fontSize: 12, color: isDone ? 'var(--text)' : isActive ? 'var(--text)' : 'var(--text-3)' }}>
              {step.label}
            </span>
            {isActive && (
              <div style={{
                width: 14, height: 14, border: `1.5px solid ${a.color}`,
                borderTopColor: 'transparent', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite', flexShrink: 0
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function OutputCard({ agentKey, content, title }) {
  const [expanded, setExpanded] = useState(false)
  const a = AGENTS[agentKey]
  const parsed = tryParseJson(content)

  return (
    <div style={{
      background: 'var(--bg3)', border: `1px solid var(--border)`,
      borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      borderLeft: `3px solid ${a.color}`,
      animation: 'fadeIn 0.4s ease',
    }}>
      <button onClick={() => setExpanded(e => !e)} style={{
        width: '100%', padding: '14px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AgentBadge agentKey={agentKey} />
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{title}</span>
        </div>
        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '0 18px 18px' }}>
          {parsed ? (
            <>
              <div style={{ marginBottom: 18 }}>
                <SummaryView data={parsed} />
              </div>
              <details style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-3)', fontSize: 12, marginBottom: 10 }}>
                  Lihat detail JSON
                </summary>
                <div style={{ marginTop: 12 }}>
                  <JsonViewer data={parsed} agentColor={a.color} />
                </div>
              </details>
            </>
          ) : (
            <pre style={{
              fontFamily: 'var(--font-mono)', fontSize: 12,
              color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.7,
              background: 'var(--bg4)', padding: 14, borderRadius: 8
            }}>{content}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function JsonViewer({ data, agentColor, depth = 0 }) {
  if (typeof data === 'string') {
    return <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, marginBottom: 6 }}>{data}</p>
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return <span style={{ color: agentColor, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{String(data)}</span>
  }
  if (Array.isArray(data)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map((item, i) => (
          <div key={i} style={{
            background: 'var(--bg4)', borderRadius: 8, padding: '12px 14px',
            borderLeft: `2px solid ${agentColor}40`
          }}>
            <JsonViewer data={item} agentColor={agentColor} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }
  if (typeof data === 'object' && data !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Object.entries(data).map(([key, val]) => (
          <div key={key}>
            <div style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
              color: agentColor, marginBottom: 4,
              textTransform: 'uppercase', letterSpacing: '0.08em'
            }}>
              {key.replace(/_/g, ' ')}
            </div>
            <div style={{ paddingLeft: 8, borderLeft: `1px solid ${agentColor}25` }}>
              <JsonViewer data={val} agentColor={agentColor} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return null
}

function RanaDecisionCard({ content }) {
  const parsed = tryParseJson(content)
  if (!parsed) return <OutputCard agentKey="rana" content={content} title="Keputusan final" />

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a1710 0%, #111113 100%)',
      border: '1px solid rgba(196,168,130,0.25)',
      borderRadius: 'var(--radius-lg)', padding: 24,
      animation: 'fadeIn 0.5s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <AgentBadge agentKey="rana" size="lg" />
        <span style={{ color: 'var(--text-2)', fontSize: 13 }}>Keputusan Final</span>
      </div>

      {parsed.summary_untuk_user && (
        <p style={{
          fontSize: 14, color: 'var(--text)', lineHeight: 1.7,
          padding: '14px 16px', background: 'rgba(196,168,130,0.08)',
          borderRadius: 8, borderLeft: '3px solid var(--rana)', marginBottom: 20
        }}>
          {parsed.summary_untuk_user}
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {parsed.top_image_ads && (
          <div style={{ background: 'var(--bg4)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10, color: 'var(--bombom)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
              TOP IMAGE ADS
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {parsed.top_image_ads.map(n => (
                <span key={n} style={{
                  background: 'rgba(196,130,130,0.15)', color: 'var(--bombom)',
                  borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 500
                }}>#{n}</span>
              ))}
            </div>
          </div>
        )}
        {parsed.top_video_concepts && (
          <div style={{ background: 'var(--bg4)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10, color: 'var(--luna)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
              TOP VIDEO CONCEPTS
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {parsed.top_video_concepts.map(n => (
                <span key={n} style={{
                  background: 'rgba(130,153,196,0.15)', color: 'var(--luna)',
                  borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 500
                }}>#{n}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {parsed.butuh_human_review?.length > 0 && (
        <div style={{ background: 'rgba(255,200,100,0.06)', border: '1px solid rgba(255,200,100,0.15)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: '#ffc864', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>⚠ BUTUH HUMAN REVIEW</div>
          {parsed.butuh_human_review.map((item, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>• {item}</div>
          ))}
        </div>
      )}

      {parsed.next_steps?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>NEXT STEPS</div>
          {parsed.next_steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--rana)', fontSize: 12, marginTop: 2 }}>{i + 1}.</span>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{step}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FeedbackBar({ sessionId, onDone }) {
  const [feedback, setFeedback] = useState('')
  const [sent, setSent] = useState(false)

  const send = async () => {
    if (!feedback.trim()) return
    await saveFeedback(sessionId, feedback)
    setSent(true)
    onDone?.()
  }

  if (sent) return (
    <div style={{ textAlign: 'center', padding: 16, color: 'var(--hara)', fontSize: 13 }}>
      ✓ Feedback tersimpan — Rana akan belajar dari ini
    </div>
  )

  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>
        FEEDBACK UNTUK RANA
      </div>
      <textarea
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="Apa yang kurang? Mana yang bagus? Rana akan belajar untuk sesi berikutnya..."
        rows={3}
        style={{
          width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 12px', color: 'var(--text)',
          fontFamily: 'var(--font-body)', fontSize: 13, resize: 'vertical',
          outline: 'none', lineHeight: 1.6
        }}
      />
      <button onClick={send} style={{
        marginTop: 10, padding: '8px 20px',
        background: 'rgba(196,168,130,0.15)', border: '1px solid rgba(196,168,130,0.3)',
        color: 'var(--rana)', borderRadius: 8, fontSize: 13, cursor: 'pointer',
        fontFamily: 'var(--font-body)',
      }}>
        Kirim feedback
      </button>
    </div>
  )
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const sessionId = useRef(getSessionId()).current
  const [productContext, setProductContext] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [runHagen, setRunHagen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState(null)
  const [completedSteps, setCompletedSteps] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const fileRef = useRef()

  const handleFileUpload = useCallback(async (files) => {
    for (const file of Array.from(files)) {
      try {
        const res = await uploadFile(sessionId, file)
        setUploadedFiles(prev => [...prev, { name: file.name, preview: res.preview }])
      } catch {
        setError(`Gagal upload: ${file.name}`)
      }
    }
  }, [sessionId])

  const simulateSteps = useCallback(async () => {
    const stepIds = ['rana_init', 'hara', 'validate_hara', 'creative', 'decision']
    const durations = [1200, 4000, 1500, 5000, 1500]
    for (let i = 0; i < stepIds.length; i++) {
      setCurrentStep(stepIds[i])
      await new Promise(r => setTimeout(r, durations[i]))
      setCompletedSteps(prev => [...prev, stepIds[i]])
    }
    setCurrentStep(null)
  }, [])

  const handleRun = async () => {
    if (!productContext.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)
    setCompletedSteps([])
    setShowFeedback(false)

    try {
      const [data] = await Promise.all([
        runAgents({ sessionId, productContext, runHagen }),
        simulateSteps()
      ])
      setResult(data)
      setShowFeedback(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    await clearMemory(sessionId)
    setResult(null)
    setCompletedSteps([])
    setCurrentStep(null)
    setProductContext('')
    setUploadedFiles([])
    setShowFeedback(false)
    setError(null)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '18px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, background: 'rgba(10,10,11,0.9)',
        backdropFilter: 'blur(12px)', zIndex: 100,
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em' }}>
            Rana <span style={{ color: 'var(--text-3)', fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 400 }}>marketing system</span>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {Object.entries(AGENTS).map(([key, a]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: a.color }} />
            </div>
          ))}
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginLeft: 4 }}>
            5 agents
          </span>
          {result && (
            <button onClick={handleClear} style={{
              marginLeft: 8, padding: '5px 12px', background: 'none',
              border: '1px solid var(--border)', color: 'var(--text-3)',
              borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-body)'
            }}>
              Reset sesi
            </button>
          )}
        </div>
      </header>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '340px 1fr', maxWidth: 1280, margin: '0 auto', width: '100%', padding: '32px 24px', gap: 32, alignItems: 'start' }}>
        {/* LEFT PANEL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, position: 'sticky', top: 90 }}>

          {/* Input produk */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Konteks Produk
            </label>
            <textarea
              value={productContext}
              onChange={e => setProductContext(e.target.value)}
              disabled={loading}
              placeholder={`Ceritakan produkmu:\n— Nama & kategori produk\n— Target audience\n— Unique selling point\n— Kompetitor utama\n— Budget iklan & platform`}
              rows={10}
              style={{
                width: '100%', background: 'var(--bg3)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                padding: '14px 16px', color: 'var(--text)',
                fontFamily: 'var(--font-body)', fontSize: 13, resize: 'vertical',
                outline: 'none', lineHeight: 1.7,
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(196,168,130,0.3)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          {/* File upload */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Upload Brief / Dokumen
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFileUpload(e.dataTransfer.files) }}
              style={{
                border: '1px dashed var(--border-bright)', borderRadius: 'var(--radius)',
                padding: '20px 16px', textAlign: 'center', cursor: 'pointer',
                background: 'var(--bg3)', transition: 'border-color 0.2s',
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 8 }}>↑</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                Drag & drop atau klik<br />
                <span style={{ color: 'var(--text-3)', fontSize: 11 }}>PDF, TXT, DOCX</span>
              </div>
              <input ref={fileRef} type="file" multiple accept=".pdf,.txt,.doc,.docx"
                onChange={e => handleFileUpload(e.target.files)} style={{ display: 'none' }} />
            </div>
            {uploadedFiles.map((f, i) => (
              <div key={i} style={{
                marginTop: 6, padding: '8px 12px', background: 'var(--bg4)',
                borderRadius: 6, fontSize: 12, color: 'var(--hara)',
                display: 'flex', gap: 8, alignItems: 'center'
              }}>
                <span>✓</span>
                <span style={{ color: 'var(--text-2)' }}>{f.name}</span>
              </div>
            ))}
          </div>

          {/* Hagen toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', background: 'var(--bg3)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)'
          }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>
                Jalankan Hagen
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Script eksekusi video (opsional)</div>
            </div>
            <div
              onClick={() => setRunHagen(h => !h)}
              style={{
                width: 40, height: 22, borderRadius: 11,
                background: runHagen ? 'rgba(196,176,130,0.4)' : 'var(--bg4)',
                border: `1px solid ${runHagen ? 'var(--hagen)' : 'var(--border)'}`,
                cursor: 'pointer', position: 'relative', transition: 'all 0.2s',
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: '50%',
                background: runHagen ? 'var(--hagen)' : 'var(--text-3)',
                position: 'absolute', top: 2,
                left: runHagen ? 20 : 2, transition: 'left 0.2s',
              }} />
            </div>
          </div>

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={loading || !productContext.trim()}
            style={{
              padding: '14px 24px', width: '100%',
              background: loading || !productContext.trim()
                ? 'var(--bg4)'
                : 'linear-gradient(135deg, rgba(196,168,130,0.2) 0%, rgba(196,168,130,0.1) 100%)',
              border: `1px solid ${loading || !productContext.trim() ? 'var(--border)' : 'rgba(196,168,130,0.4)'}`,
              color: loading || !productContext.trim() ? 'var(--text-3)' : 'var(--accent)',
              borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 500,
              cursor: loading || !productContext.trim() ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-body)', transition: 'all 0.2s',
              letterSpacing: '0.01em',
            }}
          >
            {loading ? 'Menjalankan agents...' : '◆ Jalankan Sistem'}
          </button>

          {error && (
            <div style={{
              padding: '12px 14px', background: 'rgba(196,80,80,0.1)',
              border: '1px solid rgba(196,80,80,0.3)', borderRadius: 8,
              fontSize: 12, color: '#e07070', lineHeight: 1.6
            }}>
              <strong>Error:</strong> {error}<br />
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
                Cek apakah backend sudah running & ANTHROPIC_API_KEY sudah di-set.
              </span>
            </div>
          )}

          {/* Agent legend */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Agents Aktif
            </div>
            {Object.entries(AGENTS).map(([key, a]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ color: a.color, fontSize: 14 }}>{a.icon}</span>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{a.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 8 }}>{a.role}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: 400 }}>

          {/* Empty state */}
          {!loading && !result && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '80px 40px', textAlign: 'center',
              border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)',
            }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 48, color: 'var(--text-3)',
                marginBottom: 16, lineHeight: 1,
              }}>◆</div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, marginBottom: 12, color: 'var(--text-2)' }}>
                Siap membantu marketing-mu
              </h2>
              <p style={{ color: 'var(--text-3)', fontSize: 13, maxWidth: 340, lineHeight: 1.7 }}>
                Masukkan konteks produk di panel kiri, lalu jalankan sistem.
                Rana akan mengkoordinasikan Hara, Bombom, dan Luna untuk menghasilkan output marketing yang actionable.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
                {['Riset market', 'Pain point', 'Image ads', 'Video concept'].map(t => (
                  <span key={t} style={{
                    padding: '5px 12px', background: 'var(--bg3)',
                    border: '1px solid var(--border)', borderRadius: 20,
                    fontSize: 11, color: 'var(--text-3)'
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* Step tracker while loading */}
          {loading && (
            <div style={{
              background: 'var(--bg3)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '24px 28px',
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                SISTEM BERJALAN
              </div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 400, marginBottom: 20 }}>
                Agents sedang bekerja...
              </h3>
              <StepTracker currentStep={currentStep} completed={completedSteps} />
            </div>
          )}

          {/* Results */}
          {result && (
            <>
              <div style={{
                padding: '16px 20px', background: 'rgba(130,196,160,0.06)',
                border: '1px solid rgba(130,196,160,0.2)', borderRadius: 'var(--radius)',
                display: 'flex', alignItems: 'center', gap: 10,
                animation: 'fadeIn 0.3s ease',
              }}>
                <span style={{ color: 'var(--hara)', fontSize: 16 }}>✓</span>
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  Semua agents selesai — {new Date().toLocaleTimeString('id-ID')}
                </span>
              </div>

              {/* Rana decision — always first */}
              {result.rana_decision && (
                <RanaDecisionCard content={result.rana_decision} />
              )}

              {/* Hara output */}
              {result.hara_output && (
                <OutputCard agentKey="hara" content={result.hara_output} title="Market research & insight" />
              )}

              {/* Bombom output */}
              {result.bombom_output && (
                <OutputCard agentKey="bombom" content={result.bombom_output} title="10 konsep image ads" />
              )}

              {/* Luna output */}
              {result.luna_output && (
                <OutputCard agentKey="luna" content={result.luna_output} title="Konsep video ads" />
              )}

              {/* Hagen output (if exists) */}
              {result.hagen_output && (
                <OutputCard agentKey="hagen" content={result.hagen_output} title="Script eksekusi video" />
              )}

              {/* Feedback */}
              {showFeedback && (
                <FeedbackBar sessionId={sessionId} onDone={() => setShowFeedback(false)} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

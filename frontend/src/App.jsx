import { useState, useRef, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  runAgents,
  continueSession,
  uploadFile,
  saveFeedback,
  fetchBackendHistory,
  saveBackendHistory,
  clearMemory,
  getModelAvailability,
} from './lib/api.js'
import {
  createAccountWithEmail,
  deleteSessionFromCloud,
  fetchUserHistory,
  fetchSessionState,
  isFirebaseConfigured,
  saveSessionToCloud,
  saveUserHistory,
  signInWithEmail,
  signInWithGoogleAccount,
  signOutFirebase,
  subscribeToAuth,
  subscribeToUserHistory,
  subscribeToUserSessions,
} from './lib/firebase.js'

// Helpers.
const SESSION_KEY = 'rana_session_id'
const USER_KEY = 'rana_guest_user_id'
const SESSION_LIST_PREFIX = 'rana_session_list:'
const SESSION_STATE_PREFIX = 'rana_session_state:'
const POST_REGISTER_LOGOUT_KEY = 'rana_post_register_logout'
const POST_REGISTER_NOTICE_KEY = 'rana_post_register_notice'
const MAX_SESSIONS = 3
const MAX_SESSION_CHARS = 18000
const SESSION_WARNING_CHARS = 13000
const defaultWizardForm = {
  namaProduk: '',
  kategori: '',
  keunggulan: '',
  targetAudience: '',
  painPoint: '',
  harga: '',
  platform: [],
  kompetitor: '',
  catatan: ''
}

const getUserId = () => {
  let id = localStorage.getItem(USER_KEY)
  if (!id) {
    id = `guest_${uuidv4()}`
    localStorage.setItem(USER_KEY, id)
  }
  return id
}

const getSessionListKey = (userId) => `${SESSION_LIST_PREFIX}${userId || 'guest'}`
const getActiveSessionKey = (userId) => `${SESSION_KEY}:${userId || 'guest'}`

function readActiveSessionId(userId) {
  return localStorage.getItem(getActiveSessionKey(userId)) || localStorage.getItem(SESSION_KEY)
}

function writeActiveSessionId(userId, sessionId) {
  localStorage.setItem(getActiveSessionKey(userId), sessionId)
  localStorage.setItem(SESSION_KEY, sessionId)
}

function readSessionList(userId) {
  try {
    const raw = localStorage.getItem(getSessionListKey(userId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeSessionList(userId, sessions) {
  try {
    localStorage.setItem(getSessionListKey(userId), JSON.stringify(sessions.slice(0, MAX_SESSIONS)))
  } catch { }
}

const getSessionId = (userId) => {
  const existing = readActiveSessionId(userId)
  const sessions = readSessionList(userId)
  if (existing && sessions.some(session => session.id === existing)) return existing

  const id = sessions[0]?.id || uuidv4()
  writeActiveSessionId(userId, id)
  if (!sessions.length) {
    writeSessionList(userId, [{
      id,
      title: 'New conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      hasResult: false,
    }])
  }
  return id
}

const getSessionStateKey = (sessionId) => `${SESSION_STATE_PREFIX}${sessionId}`

function readSessionState(sessionId) {
  try {
    const raw = localStorage.getItem(getSessionStateKey(sessionId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeSessionState(sessionId, state) {
  try {
    localStorage.setItem(getSessionStateKey(sessionId), JSON.stringify(state))
  } catch {
    // Ignore storage quota/private mode errors; the app can still run normally.
  }
}

function clearSessionState(sessionId) {
  try {
    localStorage.removeItem(getSessionStateKey(sessionId))
  } catch { }
}

function getEmptySessionState() {
  return {
    productContext: '',
    wizardStep: 1,
    wizardForm: defaultWizardForm,
    uploadedFiles: [],
    runHagen: false,
    provider: DEFAULT_PROVIDER,
    model: getDefaultModel(DEFAULT_PROVIDER),
    result: null,
    additionalInput: '',
  }
}

function getSessionTitle(state) {
  const productName = state?.wizardForm?.namaProduk?.trim()
  if (productName) return productName.slice(0, 48)
  const firstContextLine = String(state?.productContext || '').split('\n').find(Boolean)
  if (firstContextLine) return firstContextLine.replace(/^Product name:\s*/i, '').slice(0, 48)
  return 'New conversation'
}

function mergeSessions(localSessions, cloudSessions) {
  const byId = new Map()
  ;[...localSessions, ...cloudSessions].forEach(session => {
    if (!session?.id) return
    const current = byId.get(session.id)
    if (!current || (session.updatedAt || 0) >= (current.updatedAt || 0)) {
      byId.set(session.id, session)
    }
  })
  return Array.from(byId.values())
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_SESSIONS)
}

function getStatesForSessions(sessions) {
  return sessions.reduce((states, session) => {
    const state = readSessionState(session.id)
    if (state) states[session.id] = state
    return states
  }, {})
}

function getSessionUsage(state) {
  const payload = [
    state?.productContext,
    state?.additionalInput,
    state?.result?.hara_output,
    state?.result?.bombom_output,
    state?.result?.luna_output,
    state?.result?.hagen_output,
    state?.result?.rana_decision,
  ].filter(Boolean).join('\n')
  return payload.length
}

function isSessionUnusedState(state) {
  if (!state) return true
  if (state.result) return false
  if ((state.uploadedFiles || []).length > 0) return false
  if (getMeaningfulLength(state.additionalInput) > 0) return false
  const form = state.wizardForm || {}
  const formText = [
    form.namaProduk,
    form.kategori,
    form.keunggulan,
    form.targetAudience,
    form.painPoint,
    form.harga,
    form.kompetitor,
    form.catatan,
    ...(form.platform || []),
  ].join(' ')
  return getMeaningfulLength(formText) === 0
}

function tryParseJson(str) {
  if (typeof str !== 'string') return null
  try {
    const parsed = JSON.parse(str)
    if (parsed && typeof parsed === 'object') return parsed
    return null
  } catch {
    const match = str.match(/(\{[\s\S]*\})/)
    if (match) {
      try {
        const parsed = JSON.parse(match[1])
        if (parsed && typeof parsed === 'object') return parsed
      } catch { }
    }
    return null
  }
}

function humanizeKey(key) {
  const labels = {
    demographics: 'Demographics',
    psychographics: 'Psychographics',
    penjelasan: 'Explanation',
    question: 'Question',
    answer: 'Answer',
    what_needs_improvement: 'What Needs Improvement',
    user_summary: 'User Summary',
    ad_insight: 'Ad Insight',
  }
  if (labels[key]) return labels[key]
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function getMeaningfulLength(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').length
}

function isMeaningfulText(value, minLength = 2) {
  const cleaned = String(value || '').trim().toLowerCase()
  const compact = cleaned.replace(/[^a-z0-9]/gi, '')
  if (compact.length < minLength) return false
  if (compact.length <= 3 && new Set(compact).size === 1) return false
  return !['test', 'testing', 'dummy', 'placeholder', 'na', 'n/a', 'none'].includes(cleaned)
}

function getFriendlyErrorMessage(error) {
  const normalized = String(error || '').toLowerCase()
  if (/context|input|field|lengkap|pendek|short|meaningful|invalid/.test(normalized)) {
    return String(error)
  }
  if (/rate|quota|limit|429|credit|usage/.test(normalized)) {
    return String(error)
  }
  if (/authentication|permission|api_key|api key|401|403/.test(normalized)) {
    return String(error)
  }
  if (/network|fetch|failed to fetch/.test(normalized)) {
    return 'Unable to connect to the system. Make sure your internet connection is stable, then try again.'
  }
  if (/502|ai service|bad gateway|openrouter|anthropic|openai|gemini|grok|groq/.test(normalized)) {
    return 'The AI service request failed. Check the backend terminal for error details, API key configuration, quota, or rate limit.'
  }
  if (/api/.test(normalized)) {
    return 'There is a configuration issue. Contact the technical team.'
  }
  return 'An error occurred. Try running again — if it still fails, reset the session and start over.'
}

function InlineMarkdown({ text, style }) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g)
  return (
    <span style={style}>
      {parts.map((part, index) => {
        const boldMatch = part.match(/^\*\*([^*]+)\*\*$/)
        if (boldMatch) {
          return <strong key={index} style={{ color: 'var(--text)' }}>{boldMatch[1]}</strong>
        }
        return <span key={index}>{part}</span>
      })}
    </span>
  )
}

function SummaryView({ data }) {
  if (typeof data === 'string') {
    return <p style={{ margin: 0, color: 'var(--text)', fontSize: 13 }}>{data}</p>
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return <p style={{ margin: 0, color: 'var(--text)', fontSize: 13 }}>{String(data)}</p>
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 13 }}>No data.</p>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.slice(0, 4).map((item, index) => (
          <div key={index} style={{ padding: 12, background: 'var(--bg4)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Item {index + 1}</div>
            <SummaryView data={item} />
          </div>
        ))}
        {data.length > 4 && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>+ {data.length - 4} more items</div>
        )}
      </div>
    )
  }
  if (typeof data === 'object' && data !== null) {
    return (
      <div className="two-col-grid">
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

// Agent config.
const AGENTS = {
  rana: { name: 'Rana', role: 'Supervisor', color: '#c4a882', icon: '◆' },
  hara: { name: 'Hara', role: 'Research', color: '#82c4a0', icon: '◎' },
  bombom: { name: 'Bombom', role: 'Image Ads', color: '#c48282', icon: '▣' },
  luna: { name: 'Luna', role: 'Video Concept', color: '#8299c4', icon: '◐' },
  hagen: { name: 'Hagen', role: 'Execution', color: '#c4b082', icon: '▷' },
}

const PROVIDER_LABELS = {
  anthropic: 'Anthropic',
  grok: 'Grok',
  openai: 'OpenAI',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  groq: 'Groq',
}

const PROVIDER_MODELS = {
  anthropic: [
    'claude-3-5-haiku-20241022',
    'claude-3-5-sonnet-20241022',
    'claude-opus-4-1-20250805',
  ],
  grok: [
    'grok-beta',
    'grok-2-latest',
  ],
  openai: [
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4o',
  ],
  gemini: [
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ],
  openrouter: [
    'openai/gpt-oss-120b:free',
    'deepseek/deepseek-chat-v3-0324',
    'qwen/qwen3-32b',
    'mistralai/mistral-small-3.1-24b-instruct',
    'openai/gpt-4o-mini',
  ],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
  ],
}

const DEFAULT_PROVIDER = 'anthropic'
const getDefaultModel = (provider) => PROVIDER_MODELS[provider]?.[0] || ''

const STEPS = [
  { id: 'rana_init', agent: 'rana', label: 'Rana is understanding your product and business context...' },
  { id: 'hara', agent: 'hara', label: 'Hara is researching your audience and what they feel...' },
  { id: 'validate_hara', agent: 'rana', label: 'Rana is checking research quality before moving forward...' },
  { id: 'creative', agent: 'bombom', label: 'Bombom & Luna are crafting the best ad concepts...' },
  { id: 'decision', agent: 'rana', label: 'Rana is selecting the strongest concept and preparing recommendations...' },
]

// Components.

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

function StepTracker({ steps, currentStep, completed }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 0' }}>
      {steps.map((step, i) => {
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
  const [showAllConcepts, setShowAllConcepts] = useState(false)
  const a = AGENTS[agentKey]
  const parsed = tryParseJson(content)

  const renderParsedBody = () => {
    if (!parsed) return null

    if (agentKey === 'hara') {
      const tm = parsed.target_market || {}
      const cp = parsed.core_problem || {}
      const dt = parsed.decision_trigger || {}
      const faq = parsed.faq || []
      const objections = parsed.objection || []
      const hasHaraData = (
        tm.demographics ||
        tm.psychographics ||
        tm.fb_interest_targeting?.length ||
        cp.main_pain_point ||
        dt.trigger ||
        faq.length ||
        objections.length ||
        parsed.ad_insight
      )

      if (!hasHaraData) return <SummaryView data={parsed} />

      return (
        <div className="hara-output" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Target Market */}
          {(tm.demographics || tm.psychographics || tm.fb_interest_targeting?.length) && (
            <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Target Market</div>
              {tm.demographics && (
                <div style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: 13, color: 'var(--text)' }}>Demographics:</strong>
                  {typeof tm.demographics === 'string' ? (
                    <p style={{ margin: '4px 0', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{tm.demographics}</p>
                  ) : (
                    <div style={{ marginTop: 4 }}><SummaryView data={tm.demographics} /></div>
                  )}
                </div>
              )}
              {tm.psychographics && (
                <div style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: 13, color: 'var(--text)' }}>Psychographics:</strong>
                  {typeof tm.psychographics === 'string' ? (
                    <p style={{ margin: '4px 0', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{tm.psychographics}</p>
                  ) : (
                    <div style={{ marginTop: 4 }}><SummaryView data={tm.psychographics} /></div>
                  )}
                </div>
              )}
              {tm.fb_interest_targeting?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {tm.fb_interest_targeting.map((t, i) => (
                    <span key={i} style={{ padding: '3px 10px', borderRadius: 20, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-3)' }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pain Point */}
          {cp.main_pain_point && (
            <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Main Pain Point</div>
              <div style={{ marginBottom: 8 }}>
                {typeof cp.main_pain_point === 'string' ? (
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.6 }}>{cp.main_pain_point}</p>
                ) : (
                  <SummaryView data={cp.main_pain_point} />
                )}
              </div>
              {cp.problem_logic && (
                <div>
                  {typeof cp.problem_logic === 'string' ? (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{cp.problem_logic}</p>
                  ) : (
                    <SummaryView data={cp.problem_logic} />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Decision Trigger */}
          {dt.trigger && (
            <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Purchase Decision Trigger</div>
              <div style={{ marginBottom: 8 }}>
                {typeof dt.trigger === 'string' ? (
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.6 }}>{dt.trigger}</p>
                ) : (
                  <SummaryView data={dt.trigger} />
                )}
              </div>
              {dt.penjelasan && (
                <div>
                  {typeof dt.penjelasan === 'string' ? (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{dt.penjelasan}</p>
                  ) : (
                    <SummaryView data={dt.penjelasan} />
                  )}
                </div>
              )}
            </div>
          )}

          {/* FAQ */}
          {faq.length > 0 && (
            <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>FAQ</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {faq.map((f, i) => (
                  <div key={i}>
                    <div style={{ marginBottom: 4 }}>
                      <strong style={{ fontSize: 13, color: 'var(--text)' }}>Q:</strong>
                      {typeof f.question === 'string' ? (
                        <span style={{ marginLeft: 4, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{f.question}</span>
                      ) : (
                        <div style={{ marginLeft: 4 }}><SummaryView data={f.question} /></div>
                      )}
                    </div>
                    <div>
                      <strong style={{ fontSize: 13, color: 'var(--text)' }}>A:</strong>
                      {typeof f.answer === 'string' ? (
                        <span style={{ marginLeft: 4, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{f.answer}</span>
                      ) : (
                        <div style={{ marginLeft: 4 }}><SummaryView data={f.answer} /></div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Objection Handling */}
          {objections.length > 0 && (
            <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Objection Handling</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {objections.map((o, i) => (
                  <div key={i}>
                    <div style={{ marginBottom: 4 }}>
                      <strong style={{ fontSize: 13, color: 'var(--text)' }}>⚡</strong>
                      {typeof o.objection === 'string' ? (
                        <span style={{ marginLeft: 4, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{o.objection}</span>
                      ) : (
                        <div style={{ marginLeft: 4 }}><SummaryView data={o.objection} /></div>
                      )}
                    </div>
                    <div>
                      {typeof o.handling === 'string' ? (
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{o.handling}</p>
                      ) : (
                        <SummaryView data={o.handling} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Insight */}
          {parsed.ad_insight && (
            <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Insight for Ads</div>
              {typeof parsed.ad_insight === 'string' ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{parsed.ad_insight}</p>
              ) : (
                <SummaryView data={parsed.ad_insight} />
              )}
            </div>
          )}
        </div>
      )
    }

    if (agentKey === 'bombom') {
      const concepts = Array.isArray(parsed.ad_concepts) ? parsed.ad_concepts : []
      const visibleConcepts = showAllConcepts ? concepts : concepts.slice(0, 3)
      if (concepts.length === 0) return <SummaryView data={parsed} />

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {visibleConcepts.map((item, index) => (
            <div key={index} style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Concept {index + 1}</div>
              {item.hook && (
                <div style={{ marginBottom: 8 }}>
                  {typeof item.hook === 'string' ? (
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--bombom)' }}>{item.hook}</div>
                  ) : (
                    <SummaryView data={item.hook} />
                  )}
                </div>
              )}
              {item.visual_idea && (
                <div style={{ marginBottom: 10 }}>
                  {typeof item.visual_idea === 'string' ? (
                    <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{item.visual_idea}</div>
                  ) : (
                    <SummaryView data={item.visual_idea} />
                  )}
                </div>
              )}
              {item.primary_text && (
                <div style={{ marginBottom: 10 }}>
                  {typeof item.primary_text === 'string' ? (
                    <div style={{ fontSize: 13, color: 'var(--text)' }}>{item.primary_text}</div>
                  ) : (
                    <SummaryView data={item.primary_text} />
                  )}
                </div>
              )}
              {item.headline && (
                <div style={{ marginTop: 10 }}>
                  {typeof item.headline === 'string' ? (
                    <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 999, background: 'rgba(196,130,130,0.12)', color: 'var(--bombom)', fontSize: 12, fontWeight: 600 }}>
                      {item.headline}
                    </span>
                  ) : (
                    <SummaryView data={item.headline} />
                  )}
                </div>
              )}
            </div>
          ))}
          {concepts.length > 3 && (
            <button onClick={() => setShowAllConcepts(active => !active)} style={{
              alignSelf: 'flex-start', padding: '10px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 10,
              color: 'var(--text-2)', cursor: 'pointer', fontSize: 12
            }}>
              {showAllConcepts ? `Hide some concepts` : `View all ${concepts.length} concepts`}
            </button>
          )}
        </div>
      )
    }

    if (agentKey === 'luna') {
      const videos = Array.isArray(parsed.video_concepts) ? parsed.video_concepts : []
      if (videos.length === 0) return <SummaryView data={parsed} />

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {videos.map((item, index) => {
            const hook = item.hook_scene || {}
            const bodyScenes = Array.isArray(item.body_scenes) ? item.body_scenes : []
            const kp = item.production_requirements || {}
            return (
              <div key={index} style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Concept {item.nomor || index + 1}</div>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{item.real_shoot ? 'Real Shoot' : 'Illustration'}</span>
                </div>
                {item.angle_konten && (
                  <div style={{ marginBottom: 12 }}>
                    {typeof item.angle_konten === 'string' ? (
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--luna)', fontWeight: 600 }}>{item.angle_konten}</p>
                    ) : (
                      <SummaryView data={item.angle_konten} />
                    )}
                  </div>
                )}

                {/* Hook scene */}
                {hook.description && (
                  <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)', marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 4 }}>Hook ({hook.duration || '0-3 seconds'})</div>
                    {typeof hook.description === 'string' ? (
                      <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{hook.description}</p>
                    ) : (
                      <div style={{ marginBottom: 4 }}><SummaryView data={hook.description} /></div>
                    )}
                    {hook.dialogue_or_text && (
                      <div>
                        {typeof hook.dialogue_or_text === 'string' ? (
                          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>&quot;{hook.dialogue_or_text}&quot;</p>
                        ) : (
                          <SummaryView data={hook.dialogue_or_text} />
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Body scenes */}
                {bodyScenes.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                    {bodyScenes.map((scene, sceneIndex) => (
                      <div key={sceneIndex} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                        <strong style={{ color: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                          {typeof scene.scene === 'string' ? scene.scene : JSON.stringify(scene.scene)} ({typeof scene.duration === 'string' ? scene.duration : JSON.stringify(scene.duration)})
                        </strong>
                        <br />
                        {typeof scene.scene_text === 'string' ? scene.scene_text : <SummaryView data={scene.scene_text} />}
                      </div>
                    ))}
                  </div>
                )}

                {(kp.talent || kp.location || kp.estimated_total_duration) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {kp.talent && (
                      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
                        🎭 {typeof kp.talent === 'string' ? kp.talent : JSON.stringify(kp.talent)}
                      </span>
                    )}
                    {kp.location && (
                      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
                        📍 {typeof kp.location === 'string' ? kp.location : JSON.stringify(kp.location)}
                      </span>
                    )}
                    {kp.estimated_total_duration && (
                      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
                        ⏱ {typeof kp.estimated_total_duration === 'string' ? kp.estimated_total_duration : JSON.stringify(kp.estimated_total_duration)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )
    }

    if (agentKey === 'rana') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {parsed.user_summary && (
            <div style={{ padding: '14px 16px', background: 'rgba(196,168,130,0.08)', borderRadius: 8, borderLeft: '3px solid var(--rana)' }}>
              <div style={{ fontSize: 11, color: 'var(--rana)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Summary</div>
              {typeof parsed.user_summary === 'string' ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{parsed.user_summary}</p>
              ) : (
                <SummaryView data={parsed.user_summary} />
              )}
            </div>
          )}

          {(topImageAds.length > 0 || topVideoConcepts.length > 0) && (
            <div className="two-col-grid rana-top-grid">
              {topImageAds.length > 0 && (
                <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 10, color: 'var(--bombom)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Top Image Ads</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {topImageAds.map((n, idx) => (
                      <span key={idx} style={{ background: 'rgba(196,130,130,0.15)', color: 'var(--bombom)', borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 600 }}>#{n}</span>
                    ))}
                  </div>
                </div>
              )}
              {topVideoConcepts.length > 0 && (
                <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 10, color: 'var(--luna)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Top Video Concepts</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {topVideoConcepts.map((n, idx) => (
                      <span key={idx} style={{ background: 'rgba(130,153,196,0.15)', color: 'var(--luna)', borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 600 }}>#{n}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {parsed.choice_rationale && (
            <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Choice Rationale</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{parsed.choice_rationale}</p>
            </div>
          )}

          {humanReview.length > 0 && (
            <div style={{ background: 'rgba(255,200,100,0.06)', border: '1px solid rgba(255,200,100,0.2)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: '#ffc864', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>⚠ Needs Human Review</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {humanReview.map((item, i) => (
                  <div key={i} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>• {item}</div>
                ))}
              </div>
            </div>
          )}

          {nextSteps.length > 0 && (
            <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Next Steps</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {nextSteps.map((step, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--rana)', fontWeight: 700, fontSize: 13, marginTop: 1, flexShrink: 0 }}>{i + 1}.</span>
                    <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {parsed.status && (
            <div style={{ background: 'var(--bg4)', border: `1px solid ${parsed.status === 'approved' ? 'rgba(130,196,160,0.3)' : 'rgba(255,200,100,0.3)'}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Validation Status</div>
              <span style={{
                display: 'inline-flex', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: parsed.status === 'approved' ? 'rgba(130,196,160,0.15)' : 'rgba(255,200,100,0.12)',
                color: parsed.status === 'approved' ? 'var(--hara)' : '#ffc864',
                border: `1px solid ${parsed.status === 'approved' ? 'rgba(130,196,160,0.3)' : 'rgba(255,200,100,0.3)'}`,
              }}>
                {parsed.status === 'approved' ? '✓ Approved' : '⚠ Revision Needed'}
              </span>
            </div>
          )}
          {parsed.assessment && (
            <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Assessment</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{parsed.assessment}</p>
            </div>
          )}
          {parsed.key_insight_for_creative_team && (
            <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--rana)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Key Insight for Creative Team</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{parsed.key_insight_for_creative_team}</p>
            </div>
          )}

        </div>
      )
    }

    if (agentKey === 'hagen') {
      const scenes = Array.isArray(parsed.script_breakdown) ? parsed.script_breakdown : []
      const checklist = Array.isArray(parsed.production_checklist) ? parsed.production_checklist : []
      if (!scenes.length && !checklist.length) return <SummaryView data={parsed} />

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {scenes.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Script breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {scenes.map((scene, index) => (
                  <div key={index} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 24, height: 24, borderRadius: '50%', background: `${a.color}20`, color: a.color, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>
                      {scene.scene_number || index + 1}
                    </div>
                    <div style={{ flex: 1, background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
                      {scene.duration && (
                        <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                          {typeof scene.duration === 'string' ? scene.duration : JSON.stringify(scene.duration)}
                        </div>
                      )}
                      {scene.visual_direction && (
                        <div style={{ marginBottom: 8 }}>
                          {typeof scene.visual_direction === 'string' ? (
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{scene.visual_direction}</p>
                          ) : (
                            <SummaryView data={scene.visual_direction} />
                          )}
                        </div>
                      )}
                      {scene.dialog && (
                        <div style={{ marginBottom: 8 }}>
                          {typeof scene.dialog === 'string' ? (
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, fontStyle: 'italic' }}>&quot;{scene.dialog}&quot;</p>
                          ) : (
                            <SummaryView data={scene.dialog} />
                          )}
                        </div>
                      )}
                      {scene.on_screen_text && (
                        <div style={{ marginBottom: 6 }}>
                          {typeof scene.on_screen_text === 'string' ? (
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>Text: {scene.on_screen_text}</p>
                          ) : (
                            <SummaryView data={scene.on_screen_text} />
                          )}
                        </div>
                      )}
                      {scene.audio && (
                        <div style={{ marginBottom: 6 }}>
                          {typeof scene.audio === 'string' ? (
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>Audio: {scene.audio}</p>
                          ) : (
                            <SummaryView data={scene.audio} />
                          )}
                        </div>
                      )}
                      {scene.director_notes && (
                        <div>
                          {typeof scene.director_notes === 'string' ? (
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>🎬 {scene.director_notes}</p>
                          ) : (
                            <SummaryView data={scene.director_notes} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {checklist.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Production checklist</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {checklist.map((item, index) => (
                  <div key={index} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--bg)', border: `1px solid ${a.color}`, display: 'grid', placeItems: 'center', fontSize: 12, color: a.color }}>
                      ✓
                    </span>
                    <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                      {typeof item === 'string' ? item : <SummaryView data={item} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )
    }

    return <SummaryView data={parsed} />
  }

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

      {!expanded && !parsed && content && (
        <div style={{ padding: '0 18px 18px' }}>
          {(content || '').split('\n').slice(0, 6).map((line, i) => {
            const trimmed = line.trim()
            if (!trimmed) return <div key={i} style={{ height: 8 }} />
            return (
              <p key={i} style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
                {trimmed}
              </p>
            )
          })}
          {(content || '').split('\n').length > 6 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>…more raw output available if you expand</div>
          )}
        </div>
      )}

      {expanded && (
        <div style={{ padding: '0 18px 18px' }}>
          {parsed ? (
            <div style={{ marginBottom: 18 }}>
              {renderParsedBody()}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(content || '').split('\n').map((line, i) => {
                const trimmed = line.trim()
                if (!trimmed) return <div key={i} style={{ height: 8 }} />

                // Render markdown headings.
                if (/^#{1,3}\s/.test(trimmed) || /^\*\*[^*]+\*\*:?$/.test(trimmed)) {
                  const text = trimmed.replace(/^#{1,3}\s*/, '').replace(/\*\*/g, '').replace(/:$/, '')
                  return (
                    <div key={i} style={{
                      fontSize: 12, fontWeight: 700, color: a.color,
                      fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                      letterSpacing: '0.06em', marginTop: 14, marginBottom: 4
                    }}>{text}</div>
                  )
                }

                // Render markdown tables.
                if (/^\|/.test(trimmed) && trimmed.endsWith('|')) {
                  // Skip separator rows (|---|---|)
                  if (/^\|[-|\s:]+\|$/.test(trimmed)) return null
                  const cells = trimmed.split('|').filter(c => c.trim())
                  return (
                    <div key={i} style={{
                      display: 'flex', gap: 0,
                      background: i % 2 === 0 ? 'var(--bg4)' : 'transparent',
                      borderRadius: 4, padding: '5px 0'
                    }}>
                      {cells.map((cell, ci) => (
                        <div key={ci} style={{
                          flex: 1, fontSize: 12, color: 'var(--text-2)',
                          padding: '0 10px', lineHeight: 1.6,
                          borderRight: ci < cells.length - 1 ? '1px solid var(--border)' : 'none',
                          // Bold markdown **text**
                          fontWeight: /^\*\*.*\*\*$/.test(cell.trim()) ? 600 : 400,
                        }}>
                          {cell.trim().replace(/\*\*/g, '')}
                        </div>
                      ))}
                    </div>
                  )
                }

                // Render bullet rows.
                if (/^[-•]\s/.test(trimmed)) {
                  const text = trimmed.replace(/^[-•]\s*/, '')
                  return (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0' }}>
                      <span style={{ color: a.color, fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>•</span>
                      <InlineMarkdown text={text} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }} />
                    </div>
                  )
                }

                // Render numbered rows.
                if (/^\d+\.\s/.test(trimmed)) {
                  const [num, ...rest] = trimmed.split(/\.\s/)
                  const text = rest.join('. ')
                  return (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '3px 0' }}>
                      <span style={{ color: a.color, fontWeight: 700, fontSize: 12, flexShrink: 0, minWidth: 18 }}>{num}.</span>
                      <InlineMarkdown text={text} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }} />
                    </div>
                  )
                }

                // Render separators.
                if (/^-{3,}$/.test(trimmed)) {
                  return <div key={i} style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />
                }

                // Render plain paragraphs.
                return (
                  <p key={i} style={{ margin: 0 }}>
                    <InlineMarkdown text={trimmed} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }} />
                  </p>
                )
              })}
            </div>
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
              {humanizeKey(key)}
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
  if (!parsed || typeof parsed !== 'object') {
    return <OutputCard agentKey="rana" content={content} title="Final decision" />
  }

  const topImageAds = Array.isArray(parsed.top_image_ads) ? parsed.top_image_ads : []
  const topVideoConcepts = Array.isArray(parsed.top_video_concepts) ? parsed.top_video_concepts : []
  const humanReview = Array.isArray(parsed.needs_human_review) ? parsed.needs_human_review : []
  const nextSteps = Array.isArray(parsed.next_steps) ? parsed.next_steps : []
  const hasDecisionData = (
    parsed.user_summary ||
    parsed.choice_rationale ||
    topImageAds.length ||
    topVideoConcepts.length ||
    humanReview.length ||
    nextSteps.length
  )

  if (!hasDecisionData) {
    return <OutputCard agentKey="rana" content={content} title="Final decision" />
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a1710 0%, #111113 100%)',
      border: '1px solid rgba(196,168,130,0.25)',
      borderRadius: 'var(--radius-lg)', padding: 24,
      animation: 'fadeIn 0.5s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <AgentBadge agentKey="rana" size="lg" />
        <span style={{ color: 'var(--text-2)', fontSize: 13 }}>Final Decision</span>
      </div>

      {parsed.user_summary && (
        <div style={{
          padding: '14px 16px', background: 'rgba(196,168,130,0.08)',
          borderRadius: 8, borderLeft: '3px solid var(--rana)', marginBottom: 20
        }}>
          {typeof parsed.user_summary === 'string' ? (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.7 }}>
              {parsed.user_summary}
            </p>
          ) : (
            <SummaryView data={parsed.user_summary} />
          )}
        </div>
      )}

      {(topImageAds.length > 0 || topVideoConcepts.length > 0) && (
        <div className="two-col-grid rana-top-grid" style={{ marginBottom: 16 }}>
          {topImageAds.length > 0 && (
            <div style={{ background: 'var(--bg4)', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 10, color: 'var(--bombom)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                TOP IMAGE ADS
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {topImageAds.map((n, idx) => (
                  <span key={idx} style={{
                    background: 'rgba(196,130,130,0.15)', color: 'var(--bombom)',
                    borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 500
                  }}>#{n}</span>
                ))}
              </div>
            </div>
          )}
          {topVideoConcepts.length > 0 && (
            <div style={{ background: 'var(--bg4)', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 10, color: 'var(--luna)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                TOP VIDEO CONCEPTS
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {topVideoConcepts.map((n, idx) => (
                  <span key={idx} style={{
                    background: 'rgba(130,153,196,0.15)', color: 'var(--luna)',
                    borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 500
                  }}>#{n}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {humanReview.length > 0 && (
        <div style={{ background: 'rgba(255,200,100,0.06)', border: '1px solid rgba(255,200,100,0.15)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: '#ffc864', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>⚠ Needs Human Review</div>
          {humanReview.map((item, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>
              • {typeof item === 'string' ? item : <SummaryView data={item} />}
            </div>
          ))}
        </div>
      )}

      {parsed.choice_rationale && (
        <div style={{ background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>Choice Rationale</div>
          {typeof parsed.choice_rationale === 'string' ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{parsed.choice_rationale}</p>
          ) : (
            <SummaryView data={parsed.choice_rationale} />
          )}
        </div>
      )}

      {nextSteps.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>NEXT STEPS</div>
          {nextSteps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--rana)', fontSize: 12, marginTop: 2 }}>{i + 1}.</span>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                {typeof step === 'string' ? step : <SummaryView data={step} />}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FeedbackBar({ sessionId, userId, onDone }) {
  const [feedback, setFeedback] = useState('')
  const [sent, setSent] = useState(false)

  const send = async () => {
    if (!feedback.trim()) return
    await saveFeedback(sessionId, feedback, userId)
    setSent(true)
    onDone?.()
  }

  if (sent) return (
    <div style={{ textAlign: 'center', padding: 16, color: 'var(--hara)', fontSize: 13 }}>
      ✓ Feedback saved — Rana will learn from this
    </div>
  )

  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>
        FEEDBACK FOR RANA
      </div>
      <label htmlFor="feedback" style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>
        Your feedback
      </label>
      <textarea
        id="feedback"
        name="feedback"
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="What could be improved? What worked well? Rana will learn for the next session..."
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
        Submit feedback
      </button>
    </div>
  )
}

function LoginView() {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => {
    const savedNotice = sessionStorage.getItem(POST_REGISTER_NOTICE_KEY) || ''
    sessionStorage.removeItem(POST_REGISTER_NOTICE_KEY)
    return savedNotice
  })
  const isRegister = mode === 'register'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    try {
      if (isRegister) {
        sessionStorage.setItem(POST_REGISTER_LOGOUT_KEY, '1')
        sessionStorage.setItem(POST_REGISTER_NOTICE_KEY, 'Register selesai. Silakan login dengan akun yang baru dibuat.')
        await createAccountWithEmail({ name, email, password })
      } else {
        await signInWithEmail(email, password)
      }
    } catch (e) {
      sessionStorage.removeItem(POST_REGISTER_LOGOUT_KEY)
      sessionStorage.removeItem(POST_REGISTER_NOTICE_KEY)
      setError(e.message || 'Login failed. Check your account and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      await signInWithGoogleAccount()
    } catch (e) {
      setError(e.message || 'Google login failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-mark">R</div>
          <div>
            <h1>Rana</h1>
            <p>Marketing system</p>
          </div>
        </div>

        {!isFirebaseConfigured ? (
          <div className="login-error">
            Firebase belum dikonfigurasi. Isi file <code>.env</code> dari <code>.env.example</code>, lalu restart Vite.
          </div>
        ) : (
          <>
            <div className="login-tabs" role="tablist" aria-label="Authentication mode">
              <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>
                Login
              </button>
              <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); setNotice('') }}>
                Register
              </button>
            </div>

            <form onSubmit={handleSubmit} className="login-form">
              {isRegister && (
                <label>
                  Name
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Nama akun" autoComplete="name" />
                </label>
              )}
              <label>
                Email
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="email@example.com" autoComplete="email" required />
              </label>
              <label>
                Password
                <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Minimal 6 karakter" autoComplete={isRegister ? 'new-password' : 'current-password'} required />
              </label>
              {notice && <div className="login-notice">{notice}</div>}
              {error && <div className="login-error">{error}</div>}
              <button type="submit" className="login-primary" disabled={loading}>
                {loading ? 'Please wait...' : isRegister ? 'Create account' : 'Login'}
              </button>
            </form>

            <button type="button" className="login-google" onClick={handleGoogle} disabled={loading}>
              Continue with Google
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function AuthLoadingView() {
  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-mark">R</div>
          <div>
            <h1>Rana</h1>
            <p>Loading account...</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Main app.
function RanaApp({ authUser }) {
  const userId = authUser.uid
  const [sessionList, setSessionList] = useState(() => readSessionList(userId))
  const [sessionId, setSessionId] = useState(() => getSessionId(userId))
  const sessionIdRef = useRef(sessionId)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 980)
  const [showNewChatWarning, setShowNewChatWarning] = useState(false)
  const savedState = useRef(readSessionState(sessionId)).current
  const didHydrateSavedState = useRef(Boolean(savedState))
  const [productContext, setProductContext] = useState(savedState?.productContext || '')
  const [wizardStep, setWizardStep] = useState(savedState?.wizardStep || 1)
  const [wizardForm, setWizardForm] = useState(savedState?.wizardForm || defaultWizardForm)
  const [copyStatus, setCopyStatus] = useState('Copy all output')
  const [uploadedFiles, setUploadedFiles] = useState(savedState?.uploadedFiles || [])
  const [runHagen, setRunHagen] = useState(savedState?.runHagen || false)
  const [provider, setProvider] = useState(savedState?.provider || DEFAULT_PROVIDER)
  const [model, setModel] = useState(
    savedState?.model && PROVIDER_MODELS[savedState?.provider || DEFAULT_PROVIDER]?.includes(savedState.model)
      ? savedState.model
      : getDefaultModel(savedState?.provider || DEFAULT_PROVIDER)
  )
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState(null)
  const [completedSteps, setCompletedSteps] = useState([])
  const [result, setResult] = useState(savedState?.result || null)
  const [error, setError] = useState(null)
  const [showFeedback, setShowFeedback] = useState(Boolean(savedState?.result))
  const [additionalInput, setAdditionalInput] = useState(savedState?.additionalInput || '')
  const [modelAvailability, setModelAvailability] = useState(null)
  const [historyReady, setHistoryReady] = useState(false)
  const [cloudReady, setCloudReady] = useState(!isFirebaseConfigured)
  const [cloudError, setCloudError] = useState('')
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const fileRef = useRef()
  const didInitialCloudSync = useRef(false)
  const didUploadLocalSessions = useRef(false)
  const skipNextPersist = useRef(false)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    setSessionList(readSessionList(userId))
  }, [userId])

  const buildProductContext = () => `
Product name: ${wizardForm.namaProduk}
Category: ${wizardForm.kategori}
Key advantage: ${wizardForm.keunggulan}
Target audience: ${wizardForm.targetAudience}
Pain point: ${wizardForm.painPoint}
Price range: ${wizardForm.harga}
Ad platforms: ${wizardForm.platform.join(', ')}
Main competitor: ${wizardForm.kompetitor}
Additional notes: ${wizardForm.catatan}
`.trim()

  useEffect(() => {
    if (didHydrateSavedState.current) {
      didHydrateSavedState.current = false
      return
    }
    setProductContext(buildProductContext())
  }, [wizardForm])

  const persistSession = useCallback((state, options = {}) => {
    const now = Date.now()
    writeSessionState(sessionId, state)

    const existing = readSessionList(userId)
    const current = existing.some(session => session.id === sessionId)
      ? existing
      : [{ id: sessionId, createdAt: now, updatedAt: now }, ...existing]
    const updated = current
      .map(session => session.id === sessionId
        ? {
          ...session,
          title: session.hasResult ? (session.title || getSessionTitle(state)) : getSessionTitle(state),
          updatedAt: now,
          hasResult: Boolean(state.result),
          usage: getSessionUsage(state),
        }
        : session)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS)
    const currentSession = updated.find(session => session.id === sessionId)
    writeSessionList(userId, updated)
    setSessionList(updated)

    const states = getStatesForSessions(updated)
    states[sessionId] = state

    if (isFirebaseConfigured && currentSession) {
      saveSessionToCloud(userId, currentSession, state).catch(e => {
        console.warn('Failed to sync session to Firebase:', e)
      })
      saveUserHistory(userId, updated, states).catch(e => {
        console.warn('Failed to sync account history to Firebase:', e)
      })
    }

    return saveBackendHistory(userId, updated, states)
      .then(() => {
        if (options.clearCloudError !== false) setCloudError('')
      })
      .catch(e => {
        console.warn('Failed to sync session to backend history:', e)
        setCloudError('Sync ke backend gagal. History hanya aman di browser ini sampai backend tersambung.')
      })
  }, [sessionId, userId])

  useEffect(() => {
    if (loading || !historyReady) return
    if (skipNextPersist.current) {
      skipNextPersist.current = false
      return
    }
    const state = {
      productContext,
      wizardStep,
      wizardForm,
      uploadedFiles,
      runHagen,
      provider,
      model,
      result,
      additionalInput,
    }
    persistSession(state)
  }, [sessionId, productContext, wizardStep, wizardForm, uploadedFiles, runHagen, provider, model, result, additionalInput, loading, userId, historyReady, persistSession])

  useEffect(() => {
    if (!PROVIDER_MODELS[provider]?.includes(model)) {
      setModel(getDefaultModel(provider))
    }
  }, [provider, model])

  useEffect(() => {
    const fetchAvailability = async () => {
      try {
        const data = await getModelAvailability()
        setModelAvailability(data.availabilities)
      } catch (e) {
        console.warn('Failed to fetch model availability:', e)
      }
    }
    fetchAvailability()
  }, [])

  const handleFormChange = (field, value) => {
    setWizardForm(prev => ({ ...prev, [field]: value }))
  }

  const togglePlatform = (platform) => {
    setWizardForm(prev => ({
      ...prev,
      platform: prev.platform.includes(platform)
        ? prev.platform.filter(item => item !== platform)
        : [...prev.platform, platform]
    }))
  }

  const loadSessionState = (nextSessionId) => {
    const nextState = readSessionState(nextSessionId) || getEmptySessionState()
    didHydrateSavedState.current = true
    skipNextPersist.current = true
    setSessionId(nextSessionId)
    writeActiveSessionId(userId, nextSessionId)
    setProductContext(nextState.productContext || '')
    setWizardStep(nextState.wizardStep || 1)
    setWizardForm(nextState.wizardForm || defaultWizardForm)
    setUploadedFiles(nextState.uploadedFiles || [])
    setRunHagen(nextState.runHagen || false)
    const nextProvider = nextState.provider || DEFAULT_PROVIDER
    setProvider(nextProvider)
    setModel(
      nextState.model && PROVIDER_MODELS[nextProvider]?.includes(nextState.model)
        ? nextState.model
        : getDefaultModel(nextProvider)
    )
    setResult(nextState.result || null)
    setAdditionalInput(nextState.additionalInput || '')
    setShowFeedback(Boolean(nextState.result))
    setCompletedSteps([])
    setCurrentStep(null)
    setError(null)
    if (window.innerWidth <= 980) setSidebarOpen(false)
  }

  useEffect(() => {
    let cancelled = false
    let didInitialBackendSync = false
    setHistoryReady(false)

    const syncBackendHistory = async () => {
      try {
        const backendHistory = await fetchBackendHistory(userId)
        if (cancelled) return

        Object.entries(backendHistory.states || {}).forEach(([id, state]) => {
          if (state) writeSessionState(id, state)
        })

        const backendSessions = Array.isArray(backendHistory.sessions) ? backendHistory.sessions : []
        const localSessions = readSessionList(userId)
        const usefulLocalSessions = backendSessions.length
          ? localSessions.filter(session => !isSessionUnusedState(readSessionState(session.id)))
          : localSessions
        const mergedSessions = mergeSessions(usefulLocalSessions, backendSessions)

        if (mergedSessions.length) {
          const activeId = readActiveSessionId(userId)
          const nextSessionId = mergedSessions.some(session => session.id === activeId)
            ? activeId
            : mergedSessions[0].id
          writeSessionList(userId, mergedSessions)
          setSessionList(mergedSessions)
          if (!didInitialBackendSync || !mergedSessions.some(session => session.id === sessionIdRef.current)) {
            loadSessionState(nextSessionId)
          }
          if (!didInitialBackendSync) {
            await saveBackendHistory(userId, mergedSessions, getStatesForSessions(mergedSessions))
          }
        }
        didInitialBackendSync = true
        setCloudError('')
      } catch (e) {
        console.warn('Failed to load backend history:', e)
        setCloudError('Sync ke backend gagal. History hanya aman di browser ini sampai backend tersambung.')
      } finally {
        if (!cancelled) setHistoryReady(true)
      }
    }

    syncBackendHistory()
    const interval = window.setInterval(syncBackendHistory, 4000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [userId])

  useEffect(() => {
    if (!isFirebaseConfigured) return
    let cancelled = false
    let latestCloudSessions = []
    let latestHistorySessions = []

    setCloudReady(false)
    setCloudError('')

    const syncFromCloud = async () => {
      try {
        const localSessions = readSessionList(userId)
        const cloudSessions = mergeSessions(latestCloudSessions, latestHistorySessions)

        if (cloudSessions.length) {
          const states = await Promise.all(
            cloudSessions.map(async session => [session.id, await fetchSessionState(userId, session.id)])
          )
          if (cancelled) return

          states.forEach(([id, state]) => {
            if (state) writeSessionState(id, state)
          })
        }

        const usefulLocalSessions = cloudSessions.length
          ? localSessions.filter(session => !isSessionUnusedState(readSessionState(session.id)))
          : localSessions
        const mergedSessions = mergeSessions(usefulLocalSessions, cloudSessions)
        if (!didUploadLocalSessions.current) {
          const cloudSessionIds = new Set(cloudSessions.map(session => session.id))
          const localOnlySessions = mergedSessions.filter(session => !cloudSessionIds.has(session.id))
          await Promise.all(localOnlySessions.map(session => {
            const state = readSessionState(session.id) || getEmptySessionState()
            return saveSessionToCloud(userId, session, state)
          }))
          await saveUserHistory(userId, mergedSessions, getStatesForSessions(mergedSessions))
          didUploadLocalSessions.current = true
        }
        if (cancelled) return

        if (mergedSessions.length) {
          const activeId = readActiveSessionId(userId)
          const shouldLoadSession = !didInitialCloudSync.current || !mergedSessions.some(session => session.id === sessionIdRef.current)
          const nextSessionId = mergedSessions.some(session => session.id === activeId)
            ? activeId
            : mergedSessions[0].id
          writeSessionList(userId, mergedSessions)
          setSessionList(mergedSessions)
          if (shouldLoadSession) loadSessionState(nextSessionId)
        }
        didInitialCloudSync.current = true
      } catch (e) {
        console.warn('Failed to load Firebase sessions:', e)
        if (!cancelled) {
          setCloudError('Belum bisa mengambil progress dari Firebase. Progress lokal tetap bisa dipakai.')
        }
      } finally {
        if (!cancelled) setCloudReady(true)
      }
    }

    fetchUserHistory(userId)
      .then(history => {
        if (cancelled) return
        latestHistorySessions = history.sessions
        Object.entries(history.states || {}).forEach(([id, state]) => {
          if (state) writeSessionState(id, state)
        })
        syncFromCloud()
      })
      .catch(e => {
        console.warn('Failed to fetch Firebase history:', e)
      })

    const unsubscribe = subscribeToUserSessions(
      userId,
      MAX_SESSIONS,
      cloudSessions => {
        latestCloudSessions = cloudSessions
        syncFromCloud()
      },
      e => {
        console.warn('Failed to subscribe Firebase sessions:', e)
        if (!cancelled) {
          setCloudError('Belum bisa mengambil progress dari Firebase. Progress lokal tetap bisa dipakai.')
          setCloudReady(true)
        }
      }
    )
    const unsubscribeHistory = subscribeToUserHistory(
      userId,
      history => {
        latestHistorySessions = history.sessions
        Object.entries(history.states || {}).forEach(([id, state]) => {
          if (state) writeSessionState(id, state)
        })
        syncFromCloud()
      },
      e => {
        console.warn('Failed to subscribe Firebase history:', e)
      }
    )

    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeHistory()
    }
  }, [userId])

  const createNewSession = async () => {
    const existing = readSessionList(userId)
    const nextId = uuidv4()
    const now = Date.now()
    const evicted = [...existing, { id: nextId, updatedAt: now }]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(MAX_SESSIONS)

    evicted.forEach(session => {
      clearSessionState(session.id)
      clearMemory(session.id, userId).catch(() => { })
      deleteSessionFromCloud(userId, session.id).catch(() => { })
    })

    const nextList = [
      { id: nextId, title: 'New conversation', createdAt: now, updatedAt: now, hasResult: false, usage: 0 },
      ...existing.filter(session => !evicted.some(old => old.id === session.id)),
    ].slice(0, MAX_SESSIONS)
    writeSessionList(userId, nextList)
    setSessionList(nextList)
    writeSessionState(nextId, getEmptySessionState())
    saveBackendHistory(userId, nextList, getStatesForSessions(nextList)).catch(() => { })
    saveSessionToCloud(userId, nextList[0], getEmptySessionState()).catch(() => { })
    saveUserHistory(userId, nextList, getStatesForSessions(nextList)).catch(() => { })
    loadSessionState(nextId)
  }

  const handleNewSession = async () => {
    if (loading || newChatDisabled) return
    const existing = readSessionList(userId)
    if (existing.length >= MAX_SESSIONS) {
      setShowNewChatWarning(true)
      return
    }
    await createNewSession()
  }

  const handleConfirmNewSession = async () => {
    setShowNewChatWarning(false)
    await createNewSession()
  }

  const handleSelectSession = (nextSessionId) => {
    if (loading || nextSessionId === sessionId) return
    loadSessionState(nextSessionId)
  }

  const getExportText = () => {
    const parts = []
    if (result?.hara_output) parts.push('Hara - Market research & insight:\n' + result.hara_output)
    if (result?.bombom_output) parts.push('Bombom - Image ad concepts:\n' + result.bombom_output)
    if (result?.luna_output) parts.push('Luna - Video ad concepts:\n' + result.luna_output)
    if (result?.rana_decision) parts.push('Rana - Final decision:\n' + result.rana_decision)
    return parts.join('\n\n')
  }

  const handleCopyAll = async () => {
    const text = getExportText()
    if (!text) return

    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('✓ Copied!')
    } catch {
      setCopyStatus('Failed to copy')
      return
    }

    setTimeout(() => setCopyStatus('Copy all output'), 2000)
  }

  const handleDownloadTxt = () => {
    const text = getExportText()
    if (!text) return
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `rana-output-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const stepOneValid = (
    isMeaningfulText(wizardForm.namaProduk, 2) &&
    isMeaningfulText(wizardForm.kategori, 2) &&
    isMeaningfulText(wizardForm.keunggulan, 8)
  )
  const stepTwoValid = (
    isMeaningfulText(wizardForm.targetAudience, 8) &&
    isMeaningfulText(wizardForm.painPoint, 8) &&
    isMeaningfulText(wizardForm.harga, 2)
  )
  const stepThreeValid = wizardForm.platform.length > 0
  const canProceed = wizardStep === 1 ? stepOneValid : wizardStep === 2 ? stepTwoValid : true
  const canRun = stepOneValid && stepTwoValid && stepThreeValid
  const canContinue = isMeaningfulText(additionalInput, 8)
  const activeSessionState = { productContext, wizardForm, uploadedFiles, additionalInput, result }
  const sessionUsage = getSessionUsage(activeSessionState)
  const sessionUsagePercent = Math.min(100, Math.round((sessionUsage / MAX_SESSION_CHARS) * 100))
  const sessionLimitReached = sessionUsage >= MAX_SESSION_CHARS
  const newChatDisabled = loading || sessionList.some(session => {
    const state = session.id === sessionId ? activeSessionState : readSessionState(session.id)
    return isSessionUnusedState(state)
  })

  const handleFileUpload = useCallback(async (files) => {
    for (const file of Array.from(files)) {
      try {
        const res = await uploadFile(sessionId, file, userId)
        setUploadedFiles(prev => [...prev, { name: file.name, preview: res.preview }])
      } catch (error) {
        setError(`Upload failed: ${file.name}. ${error.message}`)
      }
    }
  }, [sessionId, userId])

  const stepList = runHagen
    ? [...STEPS, { id: 'hagen', agent: 'hagen', label: 'Hagen is generating the execution script...' }]
    : STEPS

  const simulateSteps = useCallback(async () => {
    const stepIds = stepList.map(step => step.id)
    const durations = [1200, 4000, 1500, 5000, 1500, 2500].slice(0, stepIds.length)
    for (let i = 0; i < stepIds.length; i++) {
      setCurrentStep(stepIds[i])
      await new Promise(r => setTimeout(r, durations[i]))
      setCompletedSteps(prev => [...prev, stepIds[i]])
    }
    setCurrentStep(null)
  }, [stepList])

  const handleRun = async () => {
    if (!canRun || getMeaningfulLength(productContext) < 30) {
      setError('Product input is still too short. Fill in product name, category, advantage, target buyer, pain point, price, and platform with clearer context.')
      return
    }
    setLoading(true)
    setResult(null)
    setError(null)
    setCompletedSteps([])
    setShowFeedback(false)

    try {
      const [data] = await Promise.all([
        runAgents({ sessionId, userId, productContext, runHagen, opts: { provider, model } }),
        simulateSteps()
      ])
      setResult(data)
      setShowFeedback(true)
      await persistSession({
        productContext,
        wizardStep,
        wizardForm,
        uploadedFiles,
        runHagen,
        provider,
        model,
        result: data,
        additionalInput,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleContinue = async () => {
    if (sessionLimitReached) {
      setError('This session is already too long. Start a new conversation from the sidebar so the agents have a cleaner context and quota lasts longer.')
      return
    }
    if (!canContinue || !productContext.trim()) {
      setError('Additional input is still too short. Add specific context, such as target buyer, budget, pain point, or the requested concept revision.')
      return
    }
    setLoading(true)
    setError(null)
    setCompletedSteps([])
    setShowFeedback(false)

    try {
      const note = additionalInput.trim()
      const [data] = await Promise.all([
        continueSession({ sessionId, userId, productContext, additionalInput: note, runHagen, opts: { provider, model } }),
        simulateSteps()
      ])
      setResult(data)
      setAdditionalInput('')
      const nextProductContext = `${productContext.trim()}\n\nAdditional input:\n${note}`
      setProductContext(nextProductContext)
      setShowFeedback(true)
      await persistSession({
        productContext: nextProductContext,
        wizardStep,
        wizardForm,
        uploadedFiles,
        runHagen,
        provider,
        model,
        result: data,
        additionalInput: '',
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    await clearMemory(sessionId, userId)
    clearSessionState(sessionId)
    setResult(null)
    setCompletedSteps([])
    setCurrentStep(null)
    setProductContext('')
    setWizardStep(1)
    setWizardForm({
      namaProduk: '',
      kategori: '',
      keunggulan: '',
      targetAudience: '',
      painPoint: '',
      harga: '',
      platform: [],
      kompetitor: '',
      catatan: ''
    })
    setUploadedFiles([])
    setRunHagen(false)
    setProvider(DEFAULT_PROVIDER)
    setModel(getDefaultModel(DEFAULT_PROVIDER))
    setShowFeedback(false)
    setAdditionalInput('')
    setError(null)
    setSessionList(prev => {
      const updated = prev.map(session => session.id === sessionId
        ? { ...session, title: 'New conversation', hasResult: false, usage: 0, updatedAt: Date.now() }
        : session)
      writeSessionList(userId, updated)
      saveBackendHistory(userId, updated, getStatesForSessions(updated)).catch(() => { })
      saveUserHistory(userId, updated, getStatesForSessions(updated)).catch(() => { })
      return updated
    })
  }

  const handleSignOut = async () => {
    if (loading) return
    setShowLogoutConfirm(false)
    await signOutFirebase()
  }

  return (
    <div className="app-shell" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <header className="app-header" style={{
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(10,10,11,0.9)',
        backdropFilter: 'blur(12px)',
        gap: 12,
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em' }}>
            Rana <span style={{ color: 'var(--text-3)', fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 400 }}>marketing system</span>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setSidebarOpen(open => !open)}
            className="icon-btn"
            aria-label={sidebarOpen ? 'Close chat history' : 'Open chat history'}
            title={sidebarOpen ? 'Close history' : 'Open history'}
          >
            {sidebarOpen ? 'Close' : 'Menu'}
          </button>
          <button
            type="button"
            onClick={handleNewSession}
            disabled={newChatDisabled}
            className="header-action-btn"
            title={newChatDisabled ? 'Use the empty chat first before creating another one.' : 'Start a new chat'}
          >
            New chat
          </button>
          {Object.entries(AGENTS).map(([key, a]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: a.color }} />
            </div>
          ))}
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginLeft: 4 }}>
            5 agents
          </span>
          <span style={{ fontSize: 11, color: cloudError ? '#e07070' : 'var(--text-3)', fontFamily: 'var(--font-mono)', marginLeft: 4 }} title={cloudError || authUser.email || authUser.uid}>
            {!historyReady ? 'syncing' : cloudError ? 'sync error' : 'server save'}
          </span>
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            disabled={loading}
            className="icon-btn"
            title={authUser.email || authUser.displayName || 'Signed in'}
          >
            Logout
          </button>
          {result && (
            <button onClick={handleClear} style={{
              marginLeft: 8, padding: '5px 12px', background: 'none',
              border: '1px solid var(--border)', color: 'var(--text-3)',
              borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-body)'
            }}>
              Reset session
            </button>
          )}
        </div>
      </header>

      {sidebarOpen && <div className="history-backdrop" onClick={() => setSidebarOpen(false)} />}

      {showNewChatWarning && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowNewChatWarning(false)}>
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-chat-warning-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="confirm-modal-kicker">History limit</div>
            <h2 id="new-chat-warning-title">Buat chat baru?</h2>
            <p>
              History chat sudah mencapai batas 3 sesi. Jika membuat chat ke-4, sesi paling lama akan terhapus otomatis.
            </p>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="confirm-modal-secondary"
                onClick={() => setShowNewChatWarning(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className="confirm-modal-primary"
                onClick={handleConfirmNewSession}
              >
                Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowLogoutConfirm(false)}>
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-confirm-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="confirm-modal-kicker">Logout</div>
            <h2 id="logout-confirm-title">Keluar dari akun?</h2>
            <p>
              Progress yang sudah tersimpan akan tetap ada di akun ini. Kamu perlu login lagi untuk melanjutkan sesi.
            </p>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="confirm-modal-secondary"
                onClick={() => setShowLogoutConfirm(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className="confirm-modal-primary"
                onClick={handleSignOut}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      <aside className={`history-sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Chat history">
        <div className="history-sidebar-head">
          <div>
            <div className="history-eyebrow">History</div>
            <div className="history-title">Conversations</div>
          </div>
          <button type="button" onClick={() => setSidebarOpen(false)} className="icon-btn" aria-label="Close history">Close</button>
        </div>

        <button
          type="button"
          onClick={handleNewSession}
          disabled={newChatDisabled}
          className="new-chat-btn"
          title={newChatDisabled ? 'Use the empty chat first before creating another one.' : 'Start a new chat'}
        >
          + New chat
        </button>

        <div className="history-list">
          {sessionList.map(session => (
            <button
              key={session.id}
              type="button"
              onClick={() => handleSelectSession(session.id)}
              className={`history-item ${session.id === sessionId ? 'active' : ''}`}
              disabled={loading}
            >
              <span className="history-item-title">{session.title || 'New conversation'}</span>
              <span className="history-item-meta">
                {session.hasResult ? 'Completed' : 'Draft'} - {Math.min(100, Math.round(((session.usage || 0) / MAX_SESSION_CHARS) * 100))}%
              </span>
            </button>
          ))}
        </div>

        <div className="history-note">
          Maksimal 3 sesi per akun. Saat membuat sesi ke-4, sesi paling lama dihapus otomatis.
        </div>
      </aside>

      <div className={`app-page ${sidebarOpen ? 'with-history' : ''}`}>
        {/* LEFT PANEL */}
        <div className="app-left-panel">
          <div className={`session-meter ${sessionUsage >= SESSION_WARNING_CHARS ? 'warning' : ''}`}>
            <div className="session-meter-row">
              <span>Session context</span>
              <span>{sessionUsagePercent}%</span>
            </div>
            <div className="session-meter-track">
              <div className="session-meter-fill" style={{ width: `${sessionUsagePercent}%` }} />
            </div>
            <p>
              {sessionLimitReached
                ? 'Session limit reached. Start a new chat for cleaner results.'
                : sessionUsage >= SESSION_WARNING_CHARS
                  ? 'This chat is getting long. A new chat will protect quality and quota.'
                  : 'Keep each session focused for better agent output.'}
            </p>
          </div>

          {/* Product input */}
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-end', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                  Product Context
                </div>
                <div style={{ fontSize: 16, color: 'var(--text)', fontWeight: 700 }}>Fill in product details step by step</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                Step {wizardStep} of 3
              </div>
            </div>

            {wizardStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label htmlFor="namaProduk" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Product name</label>
                  <input
                    id="namaProduk"
                    name="namaProduk"
                    value={wizardForm.namaProduk}
                    onChange={e => handleFormChange('namaProduk', e.target.value)}
                    disabled={loading}
                    style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label htmlFor="kategori" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Category / niche</label>
                  <input
                    id="kategori"
                    name="kategori"
                    value={wizardForm.kategori}
                    onChange={e => handleFormChange('kategori', e.target.value)}
                    disabled={loading}
                    placeholder="e.g. online course, skincare, SaaS"
                    style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label htmlFor="keunggulan" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Main product advantage</label>
                  <textarea
                    id="keunggulan"
                    name="keunggulan"
                    value={wizardForm.keunggulan}
                    onChange={e => handleFormChange('keunggulan', e.target.value)}
                    disabled={loading}
                    placeholder="What makes your product different?"
                    rows={4}
                    style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none', resize: 'vertical' }}
                  />
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label htmlFor="targetAudience" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Who is the target buyer?</label>
                  <input
                    id="targetAudience"
                    name="targetAudience"
                    value={wizardForm.targetAudience}
                    onChange={e => handleFormChange('targetAudience', e.target.value)}
                    disabled={loading}
                    style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label htmlFor="painPoint" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>What is their biggest problem?</label>
                  <textarea
                    id="painPoint"
                    name="painPoint"
                    value={wizardForm.painPoint}
                    onChange={e => handleFormChange('painPoint', e.target.value)}
                    disabled={loading}
                    placeholder="The pain point your product solves"
                    rows={4}
                    style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none', resize: 'vertical' }}
                  />
                </div>
                <div>
                  <label htmlFor="harga" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Product price range</label>
                  <input
                    id="harga"
                    name="harga"
                    value={wizardForm.harga}
                    onChange={e => handleFormChange('harga', e.target.value)}
                    disabled={loading}
                    placeholder="e.g. Rp 500k – Rp 2M"
                    style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
                  />
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Ad platforms
                  </div>
                  <div className="two-col-grid" style={{ gap: 10 }}>
                    {['FB/IG Ads', 'TikTok Ads', 'YouTube Ads', 'Google Ads'].map(platform => (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => togglePlatform(platform)}
                        style={{
                          padding: '12px 14px', borderRadius: '12px', border: `1px solid ${wizardForm.platform.includes(platform) ? 'var(--accent)' : 'var(--border)'}`,
                          background: wizardForm.platform.includes(platform) ? 'rgba(196,168,130,0.15)' : 'var(--bg4)', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: 13
                        }}
                      >
                        {platform}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="kompetitor" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Main competitor</label>
                  <input
                    id="kompetitor"
                    name="kompetitor"
                    value={wizardForm.kompetitor}
                    onChange={e => handleFormChange('kompetitor', e.target.value)}
                    disabled={loading}
                    placeholder="Optional"
                    style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label htmlFor="catatan" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Anything else Rana should know?</label>
                  <textarea
                    id="catatan"
                    name="catatan"
                    value={wizardForm.catatan}
                    onChange={e => handleFormChange('catatan', e.target.value)}
                    disabled={loading}
                    placeholder="Optional"
                    rows={4}
                    style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none', resize: 'vertical' }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
              <div>
                <label htmlFor="provider" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Provider</label>
                <select
                  id="provider"
                  value={provider}
                  onChange={e => {
                    const nextProvider = e.target.value
                    setProvider(nextProvider)
                    setModel(getDefaultModel(nextProvider))
                  }}
                  disabled={loading}
                  style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)' }}
                >
                  {Object.entries(PROVIDER_LABELS).map(([key, label]) => {
                    const models = PROVIDER_MODELS[key] || []
                    const hasAvailability = Boolean(modelAvailability?.[key])
                    const hasAvailableModel = models.some(modelName => modelAvailability?.[key]?.[modelName]?.available)
                    const availability = hasAvailability ? { available: hasAvailableModel, reason: 'no available model' } : null
                    const isAvailable = hasAvailableModel
                    return (
                      <option key={key} value={key} disabled={hasAvailability && !hasAvailableModel}>
                        {label} {availability ? (isAvailable ? '✓' : `✗ ${availability.reason}`) : ''}
                      </option>
                    )
                  })}
                </select>
              </div>
              <div>
                <label htmlFor="model" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Model</label>
                <select
                  id="model"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  disabled={loading}
                  style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)' }}
                >
                  {(PROVIDER_MODELS[provider] || []).map(value => {
                    const availability = modelAvailability?.[provider]?.[value]
                    const isAvailable = availability?.available
                    return (
                      <option key={value} value={value} disabled={Boolean(availability) && !isAvailable}>
                        {value} {availability ? (isAvailable ? '✓' : `✗ ${availability.reason}`) : ''}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setWizardStep(prev => prev - 1)}
                disabled={loading || wizardStep === 1}
                style={{
                  padding: '12px 16px', minWidth: 120,
                  background: wizardStep === 1 ? 'var(--bg4)' : 'var(--bg3)',
                  border: `1px solid ${wizardStep === 1 ? 'var(--border)' : 'var(--border)'}`,
                  color: wizardStep === 1 ? 'var(--text-3)' : 'var(--text)',
                  borderRadius: 'var(--radius)', cursor: wizardStep === 1 ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-body)', fontSize: 13
                }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => {
                  if (wizardStep < 3) return setWizardStep(prev => prev + 1)
                  handleRun()
                }}
                disabled={loading || (wizardStep < 3 ? !canProceed : !canRun)}
                style={{
                  flex: 1, padding: '12px 16px',
                  background: loading || (wizardStep < 3 ? !canProceed : !canRun)
                    ? 'var(--bg4)'
                    : 'linear-gradient(135deg, rgba(196,168,130,0.2) 0%, rgba(196,168,130,0.1) 100%)',
                  border: `1px solid ${loading || (wizardStep < 3 ? !canProceed : !canRun) ? 'var(--border)' : 'rgba(196,168,130,0.4)'}`,
                  color: loading || (wizardStep < 3 ? !canProceed : !canRun) ? 'var(--text-3)' : 'var(--accent)',
                  borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 500, cursor: loading || (wizardStep < 3 ? !canProceed : !canRun) ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-body)', letterSpacing: '0.01em'
                }}
              >
                {wizardStep < 3 ? 'Next →' : loading ? 'Running agents...' : '◆ Run System'}
              </button>
            </div>
          </div>

          {/* File upload */}
          <div>
            <label htmlFor="fileUpload" style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Upload Brief / Documents
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
                Drag & drop or click<br />
                <span style={{ color: 'var(--text-3)', fontSize: 11 }}>TXT, MD, CSV</span>
              </div>
              <input ref={fileRef} id="fileUpload" name="fileUpload" type="file" multiple accept=".txt,.md,.csv"
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
                Run Hagen
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Video execution script (optional)</div>
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

          {error && (
            <div style={{
              padding: '18px 16px', background: 'rgba(196,80,80,0.08)',
              border: '1px solid rgba(196,80,80,0.25)', borderRadius: 12,
              fontSize: 13, color: 'var(--text)', lineHeight: 1.7
            }}>
              <div style={{ marginBottom: 12, color: 'var(--text)', fontSize: 13 }}>
                {getFriendlyErrorMessage(error)}
              </div>
              <button onClick={handleRun} style={{
                padding: '10px 16px', background: 'rgba(196,168,130,0.15)', border: '1px solid rgba(196,168,130,0.3)',
                color: 'var(--rana)', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)'
              }}>
                Try again
              </button>
            </div>
          )}

          {/* Agent legend */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Active agents
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
        <div className="app-right-panel">

          {/* Error state when loading is complete but no result was generated */}
          {error && !loading && !result && (
            <div style={{
              background: 'rgba(196,80,80,0.08)', border: '1px solid rgba(196,80,80,0.25)',
              borderRadius: 'var(--radius-lg)', padding: '28px 24px',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', }}>Something went wrong</div>
              <div style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.7 }}>
                {getFriendlyErrorMessage(error)}
              </div>
              <button onClick={handleRun} style={{
                alignSelf: 'flex-start', padding: '10px 16px', background: 'rgba(196,168,130,0.15)',
                border: '1px solid rgba(196,168,130,0.3)', color: 'var(--rana)', borderRadius: 8,
                fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)'
              }}>
                Try again
              </button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !result && !error && (
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
                Ready to support your marketing
              </h2>
              <p style={{ color: 'var(--text-3)', fontSize: 13, maxWidth: 340, lineHeight: 1.7 }}>
                Enter product context in the left panel, then run the system.
                Rana will coordinate Hara, Bombom, and Luna to deliver actionable marketing output.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
                {['Market research', 'Pain point', 'Image ads', 'Video concept'].map(t => (
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
              borderRadius: 'var(--radius-lg)', padding: '28px 30px', minHeight: 420,
            }}>
              <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', marginBottom: 22 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  minWidth: 40,
                  minHeight: 40,
                  aspectRatio: '1 / 1',
                  flex: '0 0 40px',
                  borderRadius: '50%',
                  border: '4px solid rgba(196,168,130,0.2)',
                  borderTopColor: 'var(--accent)',
                  boxSizing: 'border-box',
                  animation: 'spin 1s linear infinite'
                }} />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    SYSTEM RUNNING
                  </div>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, margin: 0, color: 'var(--text)' }}>
                    Agents are working...
                  </h3>
                  <p style={{ color: 'var(--text-2)', fontSize: 13, maxWidth: 520, marginTop: 10, lineHeight: 1.7 }}>
                    Rana is coordinating the system. Keep this tab open while the agents generate your report.
                  </p>
                </div>
              </div>
              <StepTracker steps={stepList} currentStep={currentStep} completed={completedSteps} />
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
                  All agents completed - {new Date().toLocaleTimeString('id-ID')}
                </span>
              </div>

              {!(result.rana_decision || result.hara_output || result.bombom_output || result.luna_output || result.hagen_output) && (
                <div style={{
                  marginTop: 16, padding: '18px 20px', background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)'
                }}>
                  <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13, lineHeight: 1.7 }}>
                    The system completed, but no structured output was returned. Try editing the product context or resetting the session if this happens again.
                  </p>
                </div>
              )}

              {/* Rana decision — always first */}
              {result.rana_decision && (
                <>
                  <RanaDecisionCard content={result.rana_decision} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                    <button onClick={handleCopyAll} style={{
                      padding: '10px 16px', background: 'rgba(196,168,130,0.15)', border: '1px solid rgba(196,168,130,0.3)',
                      color: 'var(--rana)', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)'
                    }}>
                      {copyStatus}
                    </button>
                    <button onClick={handleDownloadTxt} style={{
                      padding: '10px 16px', background: 'transparent', border: '1px solid var(--border)',
                      color: 'var(--text)', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)'
                    }}>
                      Download as .txt
                    </button>
                  </div>
                </>
              )}

              {/* Hara output */}
              {result.hara_output && (
                <OutputCard agentKey="hara" content={result.hara_output} title="Market research & insight" />
              )}

              {/* Bombom output */}
              {result.bombom_output && (
                <OutputCard agentKey="bombom" content={result.bombom_output} title="10 image ad concepts" />
              )}

              {/* Luna output */}
              {result.luna_output && (
                <OutputCard agentKey="luna" content={result.luna_output} title="Video ad concepts" />
              )}

              {/* Hagen output (if exists) */}
              {result.hagen_output && (
                <OutputCard agentKey="hagen" content={result.hagen_output} title="Video execution script" />
              )}

              {/* Additional input */}
              <div style={{
                background: 'var(--bg3)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: 18,
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Continue this session
                  </div>
                  <div style={{ fontSize: 15, color: 'var(--text)', fontWeight: 700 }}>
                    Add missing input requested by any agent
                  </div>
                  <label htmlFor="additionalInput" style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginTop: 8, marginBottom: 6 }}>
                    Additional information
                  </label>
                </div>
                <textarea
                  id="additionalInput"
                  name="additionalInput"
                  value={additionalInput}
                  onChange={e => setAdditionalInput(e.target.value)}
                  disabled={loading}
                  rows={4}
                  placeholder="Example: Target buyer is HR manager at 50-200 employee companies. Budget is Rp 15M/month. Please revise the concepts using this context."
                  style={{
                    width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)',
                    fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none', resize: 'vertical',
                    lineHeight: 1.6,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    Rana will keep the same session memory and rerun the agents with this extra context.
                  </span>
                  <button
                    onClick={handleContinue}
                    disabled={loading || !canContinue || sessionLimitReached}
                    style={{
                      padding: '10px 16px',
                      background: loading || !canContinue || sessionLimitReached ? 'var(--bg4)' : 'rgba(196,168,130,0.15)',
                      border: `1px solid ${loading || !canContinue || sessionLimitReached ? 'var(--border)' : 'rgba(196,168,130,0.3)'}`,
                      color: loading || !canContinue || sessionLimitReached ? 'var(--text-3)' : 'var(--rana)',
                      borderRadius: 8, fontSize: 13,
                      cursor: loading || !canContinue || sessionLimitReached ? 'not-allowed' : 'pointer',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    Send additional input
                  </button>
                </div>
              </div>

              {/* Feedback */}
              {showFeedback && (
                <FeedbackBar sessionId={sessionId} userId={userId} onDone={() => setShowFeedback(false)} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [authUser, setAuthUser] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    const unsubscribe = subscribeToAuth(user => {
      if (user && sessionStorage.getItem(POST_REGISTER_LOGOUT_KEY) === '1') {
        setCheckingAuth(true)
        signOutFirebase()
          .catch(() => {})
          .finally(() => {
            sessionStorage.removeItem(POST_REGISTER_LOGOUT_KEY)
            setAuthUser(null)
            setCheckingAuth(false)
          })
        return
      }
      setAuthUser(user)
      setCheckingAuth(false)
    })
    return unsubscribe
  }, [])

  if (checkingAuth) return <AuthLoadingView />
  if (!authUser) return <LoginView />

  return <RanaApp key={authUser.uid} authUser={authUser} />
}

import { useState, useRef, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { runAgents, continueSession, uploadFile, saveFeedback, clearMemory, getModelAvailability } from './lib/api.js'

// Helpers.
const SESSION_KEY = 'rana_session_id'
const SESSION_STATE_PREFIX = 'rana_session_state:'
const ACTIVE_USER_KEY = 'rana_active_user'
const USER_CURRENT_SESSION_PREFIX = 'rana_current_session:'
const USER_HISTORY_PREFIX = 'rana_history:'
const MAX_HISTORY_SESSIONS = 3
const MAX_CONTINUES_PER_SESSION = 5
const SESSION_DATA_VERSION = 'output-renderer-v2'
const getSessionId = () => {
  let id = localStorage.getItem(SESSION_KEY)
  if (!id) { id = uuidv4(); localStorage.setItem(SESSION_KEY, id) }
  return id
}

const getSessionStateKey = (sessionId) => `${SESSION_STATE_PREFIX}${sessionId}`

function readSessionState(sessionId) {
  try {
    const raw = localStorage.getItem(getSessionStateKey(sessionId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.sessionDataVersion !== SESSION_DATA_VERSION) {
      return {
        ...parsed,
        sessionDataVersion: SESSION_DATA_VERSION,
        result: null,
        additionalInput: '',
        continueCount: 0,
      }
    }
    return parsed
  } catch {
    return null
  }
}

function writeSessionState(sessionId, state) {
  try {
    localStorage.setItem(getSessionStateKey(sessionId), JSON.stringify({
      ...state,
      sessionDataVersion: SESSION_DATA_VERSION,
    }))
  } catch {
    // Ignore storage quota/private mode errors; the app can still run normally.
  }
}

function clearSessionState(sessionId) {
  try {
    localStorage.removeItem(getSessionStateKey(sessionId))
  } catch { }
}

function normalizeUserName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40)
}

function getUserStorageId(userName) {
  return normalizeUserName(userName).toLowerCase()
}

function readActiveUser() {
  try {
    return normalizeUserName(localStorage.getItem(ACTIVE_USER_KEY))
  } catch {
    return ''
  }
}

function writeActiveUser(userName) {
  try {
    localStorage.setItem(ACTIVE_USER_KEY, normalizeUserName(userName))
  } catch { }
}

function clearActiveUser() {
  try {
    localStorage.removeItem(ACTIVE_USER_KEY)
  } catch { }
}

function getUserHistoryKey(userName) {
  return `${USER_HISTORY_PREFIX}${getUserStorageId(userName)}`
}

function getUserCurrentSessionKey(userName) {
  return `${USER_CURRENT_SESSION_PREFIX}${getUserStorageId(userName)}`
}

function readUserHistory(userName) {
  try {
    const raw = localStorage.getItem(getUserHistoryKey(userName))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeUserHistory(userName, history) {
  try {
    localStorage.setItem(getUserHistoryKey(userName), JSON.stringify(history.slice(0, MAX_HISTORY_SESSIONS)))
  } catch { }
}

function readUserCurrentSession(userName) {
  try {
    return localStorage.getItem(getUserCurrentSessionKey(userName)) || ''
  } catch {
    return ''
  }
}

function writeUserCurrentSession(userName, sessionId) {
  try {
    localStorage.setItem(getUserCurrentSessionKey(userName), sessionId)
  } catch { }
}

function getNewSessionId(userName) {
  return `${getUserStorageId(userName) || 'user'}-${uuidv4()}`
}

function getHistoryTitle(state) {
  const name = state?.wizardForm?.namaProduk?.trim()
  if (name) return name.slice(0, 48)
  const contextName = String(state?.productContext || '').match(/Product name:\s*(.+)/i)?.[1]?.trim()
  if (contextName) return contextName.slice(0, 48)
  return 'Untitled session'
}

function getHistorySummary(state) {
  const category = state?.wizardForm?.kategori?.trim()
  const platform = Array.isArray(state?.wizardForm?.platform) ? state.wizardForm.platform.join(', ') : ''
  return [category, platform].filter(Boolean).join(' | ') || 'Draft'
}

function upsertUserHistory(userName, sessionId, state) {
  if (!userName || !sessionId) return { history: [], removed: [] }
  const now = new Date().toISOString()
  const existing = readUserHistory(userName)
  const previous = existing.find(item => item.id === sessionId)
  const entry = {
    id: sessionId,
    title: getHistoryTitle(state),
    summary: getHistorySummary(state),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  }
  const next = [entry, ...existing.filter(item => item.id !== sessionId)].slice(0, MAX_HISTORY_SESSIONS)
  const removed = existing.filter(item => !next.some(nextItem => nextItem.id === item.id))
  removed.forEach(item => clearSessionState(item.id))
  writeUserHistory(userName, next)
  return { history: next, removed }
}

function removeUserHistorySession(userName, sessionId) {
  const next = readUserHistory(userName).filter(item => item.id !== sessionId)
  writeUserHistory(userName, next)
  clearSessionState(sessionId)
  return next
}

const TECHNICAL_KEYS = ['_status', '_warning', '_parse_error', 'raw_output']

function isTechnicalKey(key) {
  return TECHNICAL_KEYS.includes(key) || key.startsWith('_')
}

function cleanRawJsonText(raw) {
  if (typeof raw !== 'string') return raw
  let cleaned = raw.trim()
  const fencedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedMatch) cleaned = fencedMatch[1].trim()
  cleaned = cleaned
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .trim()
  return cleaned
}

function tryParseJson(str) {
  if (typeof str !== 'string') return null
  const clean = str.trim()
  if (!clean) return null

  const tryParse = (value) => {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  const parsed = tryParse(clean)
  if (parsed !== null) return parsed

  const fencedMatch = clean.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fencedMatch) {
    const fenced = tryParse(fencedMatch[1].trim())
    if (fenced !== null) return fenced
  }

  if (!/^[\[{]/.test(clean)) return null

  const escapedJson = clean.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  const escapedParsed = tryParse(escapedJson)
  if (escapedParsed !== null) return escapedParsed

  return null
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
  if (/502|ai service|bad gateway|openrouter|anthropic|openai|gemini|grok/.test(normalized)) {
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
    return <p style={{ margin: 0, color: 'var(--text)', fontSize: 13, lineHeight: 1.7 }}>{data}</p>
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return <p style={{ margin: 0, color: 'var(--text)', fontSize: 13, lineHeight: 1.7 }}>{String(data)}</p>
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 13 }}>No data.</p>
    const primitives = data.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
    if (primitives) {
      return (
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-2)', fontSize: 13, lineHeight: 1.7 }}>
          {data.map((item, index) => (
            <li key={index} style={{ marginBottom: 6 }}>{String(item)}</li>
          ))}
        </ul>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map((item, index) => (
          <div key={index} style={{ padding: 12, background: 'var(--bg4)', borderRadius: 10, border: '1px solid var(--border)' }}>
            {typeof item === 'object' && item !== null ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Item {index + 1}</div>
                <SummaryView data={item} />
              </div>
            ) : (
              <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13 }}>{String(item)}</p>
            )}
          </div>
        ))}
      </div>
    )
  }
  if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data).filter(([key]) => !isTechnicalKey(key))
    if (entries.length === 0) return null
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {entries.map(([key, value]) => (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {humanizeKey(key)}
            </div>
            <div style={{ paddingLeft: 6 }}>
              {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                ? <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13, lineHeight: 1.7 }}>{String(value)}</p>
                : <SummaryView data={value} />
              }
            </div>
          </div>
        ))}
      </div>
    )
  }
  return null
}

function cleanInvalidJsonForDisplay(raw) {
  return String(raw || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/"\s*,\s*"/g, '"\n"')
    .replace(/}\s*,\s*{/g, '}\n{')
    .replace(/[{}\[\]",]/g, '')
    .replace(/^\s*raw_output\s*:\s*/gim, '')
    .replace(/^\s*_[a-z_]+\s*:\s*.*$/gim, '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*"?(.*?)"?\s*:\s*/, (_, key) => `${humanizeKey(key)}: `).trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function isShortPrimitiveList(items) {
  return items.length > 0 && items.every(item => String(item ?? '').length <= 48 && !String(item ?? '').includes('\n'))
}

function isPrimitiveValue(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function isPrimitiveList(value) {
  return Array.isArray(value) && value.every(item => isPrimitiveValue(item))
}

function isFlatObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value).every(item => isPrimitiveValue(item) || isPrimitiveList(item))
}

function isWarningKey(key) {
  return /warning|review|risk|rejection|reject|concern|caution|objection|needs_human|human_review|note/i.test(String(key || ''))
}

function isActionKey(key) {
  return /next_steps|steps|recommendations|recommendation|action_items|checklist|todo|what_to_do/i.test(String(key || ''))
}

function getAgentItemLabel(agentKey, sectionKey) {
  const key = String(sectionKey || '').toLowerCase()
  if (agentKey === 'bombom') return 'Image Ad Concept'
  if (agentKey === 'luna') return 'Video Concept'
  if (agentKey === 'hagen') {
    if (/scene|script|breakdown/.test(key)) return 'Execution Scene'
    return 'Execution Item'
  }
  if (agentKey === 'hara') return 'Research Item'
  if (agentKey === 'rana') return 'Supervisor Item'
  return humanizeKey(sectionKey || 'Item')
}

function findHighlightEntry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const priority = [
    'user_summary', 'summary', 'market_analysis', 'ad_insight', 'key_insight',
    'key_insight_for_creative_team', 'choice_rationale', 'rationale',
    'main_pain_point', 'decision_trigger'
  ]
  const entries = Object.entries(data).filter(([key, value]) => !isTechnicalKey(key) && hasRenderableValue(value))
  return entries.find(([key, value]) => priority.includes(key) && (typeof value === 'string' || isFlatObject(value))) || null
}

function normalizePlainLabel(label) {
  return String(label || '')
    .replace(/^#{1,4}\s+/, '')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/:$/, '')
    .trim()
}

function toPlainObjectKey(label, used = {}) {
  const base = normalizePlainLabel(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'section'
  used[base] = (used[base] || 0) + 1
  return used[base] === 1 ? base : `${base}_${used[base]}`
}

function addPlainValue(target, label, value, used) {
  const key = toPlainObjectKey(label, used)
  target[key] = value
}

function appendPlainContent(target, value) {
  const text = String(value || '').trim()
  if (!text) return
  target.content = target.content ? `${target.content}\n${text}` : text
}

function appendPlainItem(target, value) {
  const text = String(value || '').trim()
  if (!text) return
  if (!Array.isArray(target.items)) target.items = []
  target.items.push(text)
}

function parsePlainTextReport(text) {
  const raw = String(text || '').replace(/```(?:json|text)?/gi, '').replace(/```/g, '').trim()
  if (!raw) return null

  const lines = raw.split(/\r?\n/)
  const keyValueLines = lines.filter(line => /^[-*•\s]*(?:\d+\.\s*)?[^:\n]{2,80}:\s*.*$/.test(line.trim()))
  const headingLines = lines.filter(line => /^#{1,4}\s+\S+|^\*\*[^*]+\*\*:?$/.test(line.trim()))
  if (keyValueLines.length < 2 && headingLines.length < 1) return null

  const result = {}
  const resultUsed = {}
  let current = null
  let currentUsed = {}
  let currentChild = null
  let currentChildUsed = {}

  const ensureSection = (label = 'Output') => {
    const section = {}
    addPlainValue(result, label, section, resultUsed)
    current = section
    currentUsed = {}
    currentChild = null
    currentChildUsed = {}
    return section
  }

  const shouldNestUnderCurrent = (label) => {
    if (!current) return false
    const normalized = normalizePlainLabel(label).toLowerCase()
    return /demographic|psychographic|interest|segment|persona|profile|platform|targeting|hook|scene|visual|script/.test(normalized) &&
      !/target market|market analysis|core problem|decision trigger|recommendation|next steps|image ad concept|video concept|execution/.test(normalized)
  }

  lines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return

    const markdownHeading = trimmed.match(/^#{1,4}\s+(.+)$/) || trimmed.match(/^\*\*([^*]+)\*\*:?$/)
    if (markdownHeading) {
      ensureSection(normalizePlainLabel(markdownHeading[1]))
      return
    }

    const numberedHeading = trimmed.match(/^(?:[-*•]\s*)?(image ad concept|video concept|concept|scene|execution item)\s*(\d+)\s*:?\s*$/i)
    if (numberedHeading) {
      ensureSection(`${numberedHeading[1]} ${numberedHeading[2]}`)
      return
    }

    const keyValue = trimmed.match(/^[-*•\s]*(?:\d+\.\s*)?([^:\n]{2,80}):\s*(.*)$/)
    if (keyValue && !/^https?:\/\//i.test(keyValue[1])) {
      const label = normalizePlainLabel(keyValue[1])
      const value = keyValue[2].trim()
      if (!value) {
        if (shouldNestUnderCurrent(label)) {
          const child = {}
          addPlainValue(current, label, child, currentUsed)
          currentChild = child
          currentChildUsed = {}
        } else {
          ensureSection(label)
        }
        return
      }

      if (!current) ensureSection('Output')
      const target = currentChild || current
      const used = currentChild ? currentChildUsed : currentUsed
      addPlainValue(target, label, value, used)
      return
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/)
    if (bullet) {
      if (!current) ensureSection('Output')
      appendPlainItem(currentChild || current, bullet[1])
      return
    }

    const numbered = trimmed.match(/^(\d+)\.\s+(.+)$/)
    if (numbered) {
      if (!current) ensureSection('Output')
      appendPlainItem(currentChild || current, `${numbered[1]}. ${numbered[2]}`)
      return
    }

    if (!current) ensureSection('Output')
    appendPlainContent(currentChild || current, trimmed)
  })

  return Object.keys(result).length ? result : null
}

function hasRenderableValue(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.some(item => hasRenderableValue(item))
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !isTechnicalKey(key))
      .some(([, item]) => hasRenderableValue(item))
  }
  return false
}

function RawOutputText({ content, text }) {
  const raw = String(text ?? content ?? '')
  if (!raw.trim()) {
    return <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 13 }}>No output.</p>
  }

  return (
    <pre style={{
      margin: 0,
      color: 'var(--text-2)',
      fontFamily: 'var(--font-body)',
      fontSize: 13,
      lineHeight: 1.7,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'visible',
    }}>
      {raw}
    </pre>
  )
}

function EmptyAgentOutput({ children = 'No output.' }) {
  return (
    <p style={{
      margin: 0,
      color: 'var(--text-3)',
      fontSize: 13,
      lineHeight: 1.7,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      {children}
    </p>
  )
}

function SectionPill({ children, agentKey = 'rana', warning = false }) {
  const agent = AGENTS[agentKey] || AGENTS.rana
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      alignSelf: 'flex-start',
      maxWidth: '100%',
      padding: '5px 12px',
      borderRadius: 999,
      background: warning ? 'rgba(255,200,100,0.10)' : `${agent.color}14`,
      border: warning ? '1px solid rgba(255,200,100,0.28)' : `1px solid ${agent.color}2f`,
      color: warning ? '#ffc864' : agent.color,
      fontSize: 11,
      lineHeight: 1.35,
      fontFamily: 'var(--font-mono)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      {children}
    </div>
  )
}

function AgentStyledOutput({ data, agentKey = 'rana' }) {
  const agent = AGENTS[agentKey] || AGENTS.rana
  const highlight = findHighlightEntry(data)
  if (!highlight) return <AgentConceptRenderer data={data} agentKey={agentKey} />

  const [highlightKey, highlightValue] = highlight
  const rest = Object.fromEntries(
    Object.entries(data).filter(([key]) => key !== highlightKey)
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={{
        padding: '16px 18px',
        background: `${agent.color}12`,
        border: `1px solid ${agent.color}35`,
        borderLeft: `3px solid ${agent.color}`,
        borderRadius: 12,
      }}>
        <div style={{ marginBottom: 14 }}>
          <SectionPill agentKey={agentKey}>{humanizeKey(highlightKey)}</SectionPill>
        </div>
        <AgentConceptRenderer data={highlightValue} level={1} sectionKey={highlightKey} agentKey={agentKey} />
      </section>
      <AgentConceptRenderer data={rest} agentKey={agentKey} />
    </div>
  )
}

function KeyValueList({ entries, level = 0, agentKey = 'rana' }) {
  const agent = AGENTS[agentKey] || AGENTS.rana
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map(([key, value]) => (
        <div key={key} style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          padding: '10px 12px',
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10,
        }}>
          <span style={{
            color: agent.color,
            fontSize: 13,
            lineHeight: 1.7,
            flexShrink: 0,
            marginTop: 1,
          }}>
            -
          </span>
          <div style={{ minWidth: 0 }}>
            <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700 }}>
              {humanizeKey(key)}:
            </span>
            {isPrimitiveList(value) ? (
              <div style={{ marginTop: 7 }}>
                <AgentConceptRenderer data={value} level={level + 1} sectionKey={key} agentKey={agentKey} />
              </div>
            ) : (
              <span style={{
                color: 'var(--text-2)',
                fontSize: 13,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {' '}{String(value)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function AgentConceptRenderer({ data, title, level = 0, sectionKey = '', agentKey = 'rana' }) {
  if (data === null || data === undefined) return null
  const agent = AGENTS[agentKey] || AGENTS.rana

  const textStyle = {
    margin: 0,
    color: level === 0 ? 'var(--text)' : 'var(--text-2)',
    fontSize: level === 0 ? 14 : 13,
    lineHeight: 1.75,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  }

  const renderString = (value) => {
    const lines = String(value || '').split(/\r?\n/)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lines.map((line, index) => {
          const trimmed = line.trim()
          if (!trimmed) return <div key={index} style={{ height: 8 }} />

          if (/^#{1,4}\s+/.test(trimmed) || /^\*\*[^*]+\*\*:?$/.test(trimmed)) {
            const text = trimmed.replace(/^#{1,4}\s+/, '').replace(/\*\*/g, '').replace(/:$/, '')
            return (
              <div key={index} style={{
                marginTop: index ? 8 : 0,
                color: 'var(--text)',
                fontSize: level === 0 ? 15 : 13,
                fontWeight: 700,
                lineHeight: 1.4,
              }}>
                {text}
              </div>
            )
          }

          if (/^[-*]\s+/.test(trimmed)) {
            const text = trimmed.replace(/^[-*]\s+/, '')
            return (
              <div key={index} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--text-3)', lineHeight: 1.7 }}>-</span>
                <InlineMarkdown text={text} style={textStyle} />
              </div>
            )
          }

          if (/^\d+\.\s+/.test(trimmed)) {
            const [, number, text] = trimmed.match(/^(\d+)\.\s+(.*)$/) || []
            return (
              <div key={index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--text-3)', fontWeight: 700, minWidth: 18, lineHeight: 1.7 }}>{number}.</span>
                <InlineMarkdown text={text} style={textStyle} />
              </div>
            )
          }

          return (
            <p key={index} style={textStyle}>
              <InlineMarkdown text={line} />
            </p>
          )
        })}
      </div>
    )
  }

  if (typeof data === 'string') {
    const looksLikeJsonDump = /^\s*[\{\[]/.test(data) || /raw_output|_parse_error|"\s*:\s*/.test(data)
    const cleaned = looksLikeJsonDump ? (cleanInvalidJsonForDisplay(data) || data) : data
    if (level > 0 && !title) {
      return (
        <div style={{
          padding: '11px 12px',
          background: 'rgba(0,0,0,0.16)',
          border: '1px solid rgba(255,255,255,0.055)',
          borderRadius: 8,
        }}>
          {renderString(cleaned)}
        </div>
      )
    }
    return (
      <section style={{
        background: level === 0 ? `${agent.color}10` : 'rgba(255,255,255,0.025)',
        border: level === 0 ? `1px solid ${agent.color}28` : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: 16,
      }}>
        {title && (
          <div style={{ marginBottom: 14 }}>
            <SectionPill agentKey={agentKey}>{title}</SectionPill>
          </div>
        )}
        {renderString(cleaned)}
      </section>
    )
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return <p style={textStyle}>{String(data)}</p>
  }

  if (Array.isArray(data)) {
    const renderableItems = data.filter(item => hasRenderableValue(item))
    if (!renderableItems.length) return null
    const primitives = renderableItems.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item))
    if (primitives) {
      if (isShortPrimitiveList(renderableItems)) {
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {renderableItems.map((item, index) => (
              <span key={index} style={{
                display: 'inline-flex',
                alignItems: 'center',
                maxWidth: '100%',
                padding: '5px 10px',
                borderRadius: 999,
                background: `${agent.color}14`,
                border: `1px solid ${agent.color}2f`,
                color: agent.color,
                fontSize: 12,
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>{String(item)}</span>
            ))}
          </div>
        )
      }
      if (isActionKey(sectionKey)) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {renderableItems.map((item, index) => (
              <div key={index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'rgba(196,168,130,0.12)',
                  border: `1px solid ${agent.color}36`,
                  color: agent.color,
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                  marginTop: 1,
                }}>{index + 1}</span>
                <span style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {String(item)}
                </span>
              </div>
            ))}
          </div>
        )
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {renderableItems.map((item, index) => (
            <div key={index} style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '10px 12px',
              background: 'rgba(0,0,0,0.14)',
              border: '1px solid rgba(255,255,255,0.055)',
              borderRadius: 8,
            }}>
              <span style={{ color: agent.color, lineHeight: 1.7, flexShrink: 0 }}>-</span>
              <span style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {String(item)}
              </span>
            </div>
          ))}
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {renderableItems.map((item, index) => (
          <section key={index} style={{
            background: level === 0 ? `${agent.color}0d` : 'rgba(255,255,255,0.025)',
            border: level === 0 ? `1px solid ${agent.color}28` : '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: 16,
          }}>
            <div style={{ marginBottom: 14 }}>
              <SectionPill agentKey={agentKey}>
                {getAgentItemLabel(agentKey, sectionKey)} {index + 1}
              </SectionPill>
            </div>
            <AgentConceptRenderer data={item} level={level + 1} sectionKey={sectionKey} agentKey={agentKey} />
          </section>
        ))}
      </div>
    )
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data).filter(([key, value]) => !isTechnicalKey(key) && hasRenderableValue(value))
    if (!entries.length) return null
    if (level > 0 && isFlatObject(data)) {
      return <KeyValueList entries={entries} level={level} agentKey={agentKey} />
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {entries.map(([key, value]) => {
          const isNested = typeof value === 'object' && value !== null
          const warning = isWarningKey(key)
          const action = isActionKey(key)
          return (
            <section key={key} style={{
              background: warning
                ? 'rgba(255,200,100,0.06)'
                : action
                  ? `${agent.color}0d`
                  : level === 0 ? 'var(--bg4)' : 'rgba(255,255,255,0.025)',
              border: warning
                ? '1px solid rgba(255,200,100,0.18)'
                : action
                  ? `1px solid ${agent.color}25`
                  : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              padding: 16,
            }}>
              <div style={{ marginBottom: 14 }}>
                <SectionPill agentKey={agentKey} warning={warning}>
                  {humanizeKey(key)}
                </SectionPill>
              </div>
              {isNested ? (
                <AgentConceptRenderer data={value} level={level + 1} sectionKey={key} agentKey={agentKey} />
              ) : (
                <AgentConceptRenderer data={value} level={level + 1} sectionKey={key} agentKey={agentKey} />
              )}
            </section>
          )
        })}
      </div>
    )
  }

  return null
}

// Agent config.
const AGENTS = {
  rana: { name: 'Rana', role: 'Supervisor', outputTitle: 'Supervisor / Final Decision', color: '#c4a882', icon: '◆' },
  hara: { name: 'Hara', role: 'Research', outputTitle: 'Research Output', color: '#82c4a0', icon: '◎' },
  bombom: { name: 'Bombom', role: 'Image Ads (10)', outputTitle: 'Image Ads Output (10 Concepts)', color: '#c48282', icon: '▣' },
  luna: { name: 'Luna', role: 'Video Concept', outputTitle: 'Video Concept Output', color: '#8299c4', icon: '◐' },
  hagen: { name: 'Hagen', role: 'Execution', outputTitle: 'Execution Output', color: '#c4b082', icon: '▷' },
}

const PROVIDER_LABELS = {
  anthropic: 'Anthropic',
  grok: 'Grok',
  openai: 'OpenAI',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
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
    'deepseek/deepseek-chat-v3-0324',
    'qwen/qwen3-32b',
    'mistralai/mistral-small-3.1-24b-instruct',
    'openai/gpt-4o-mini',
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
  const a = AGENTS[agentKey]
  const rawContent = String(content || '')
  const isJsonFirstAgent = agentKey === 'hara' || agentKey === 'rana'
  const cleanedContent = typeof content === 'string' && isJsonFirstAgent ? cleanRawJsonText(rawContent) : rawContent
  const parsed = typeof content === 'string'
    ? (tryParseJson(rawContent) || (isJsonFirstAgent ? tryParseJson(cleanedContent) : null))
    : content && typeof content === 'object'
      ? content
      : null

  const renderSafeBody = () => {
    const plainReport = parsePlainTextReport(rawContent)
    if (!parsed && plainReport && hasRenderableValue(plainReport)) {
      return <AgentStyledOutput data={plainReport} agentKey={agentKey} />
    }

    if (parsed && typeof parsed === 'object' && parsed._status === 'partial_or_invalid_json' && parsed.raw_output) {
      const rawOutput = String(parsed.raw_output || '')
      const restored = tryParseJson(rawOutput) || tryParseJson(cleanRawJsonText(rawOutput))
      if (restored && hasRenderableValue(restored)) {
        return <AgentStyledOutput data={restored} agentKey={agentKey} />
      }
      return <RawOutputText text={rawOutput || rawContent} />
    }

    if (parsed && hasRenderableValue(parsed)) {
      return <AgentStyledOutput data={parsed} agentKey={agentKey} />
    }

    if (isJsonFirstAgent && parsed) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <EmptyAgentOutput>No meaningful output available. Raw response was empty or incomplete.</EmptyAgentOutput>
        </div>
      )
    }

    return <RawOutputText text={rawContent} />
  }

  const body = expanded ? renderSafeBody() : null
  return (
    <div style={{
      background: 'var(--bg3)', border: `1px solid var(--border)`,
      borderRadius: 'var(--radius-lg)', overflow: 'visible',
      borderLeft: `3px solid ${a.color}`,
      animation: 'fadeIn 0.4s ease',
    }}>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          width: '100%',
          padding: '16px 18px',
          border: 'none',
          background: 'transparent',
          color: 'var(--text)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AgentBadge agentKey={agentKey} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{title || a.outputTitle}</span>
            <span style={{ fontSize: 11, color: a.color, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>
              {a.role}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {expanded ? 'Click to collapse' : 'Click to expand'}
            </span>
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '0 18px 18px' }}>
          {body}
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
        {Object.entries(data).filter(([key, val]) => !isTechnicalKey(key) && hasRenderableValue(val)).map(([key, val]) => (
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
  const rawContent = String(content || '')
  const parsed = tryParseJson(rawContent) || tryParseJson(cleanRawJsonText(rawContent))
  const plainReport = parsePlainTextReport(rawContent)
  const displayData = parsed && typeof parsed === 'object' ? parsed : plainReport

  if (displayData && displayData._status === 'partial_or_invalid_json') {
    return <OutputCard agentKey="rana" content={content} title="Supervisor / Final Decision" />
  }

  if (displayData && hasRenderableValue(displayData)) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #1a1710 0%, #111113 100%)',
        border: '1px solid rgba(196,168,130,0.25)',
        borderRadius: 'var(--radius-lg)',
        padding: 24,
        animation: 'fadeIn 0.5s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <AgentBadge agentKey="rana" size="lg" />
          <span style={{ color: 'var(--text-2)', fontSize: 13 }}>Supervisor / Final Decision</span>
        </div>
        <AgentStyledOutput data={displayData} agentKey="rana" />
      </div>
    )
  }

  if (!parsed || typeof parsed !== 'object') {
    return <OutputCard agentKey="rana" content={content} title="Supervisor / Final Decision" />
  }

  if (parsed._status === 'partial_or_invalid_json') {
    return <OutputCard agentKey="rana" content={content} title="Supervisor / Final Decision" />
  }

  if (!hasRenderableValue(parsed)) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #1a1710 0%, #111113 100%)',
        border: '1px solid rgba(196,168,130,0.25)',
        borderRadius: 'var(--radius-lg)',
        padding: 24,
        animation: 'fadeIn 0.5s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <AgentBadge agentKey="rana" size="lg" />
          <span style={{ color: 'var(--text-2)', fontSize: 13 }}>Supervisor / Final Decision</span>
        </div>
        <EmptyAgentOutput>No final decision content available.</EmptyAgentOutput>
      </div>
    )
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a1710 0%, #111113 100%)',
      border: '1px solid rgba(196,168,130,0.25)',
      borderRadius: 'var(--radius-lg)',
      padding: 24,
      animation: 'fadeIn 0.5s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <AgentBadge agentKey="rana" size="lg" />
        <span style={{ color: 'var(--text-2)', fontSize: 13 }}>Supervisor / Final Decision</span>
      </div>
      <AgentStyledOutput data={parsed} agentKey="rana" />
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

function LoginScreen({ onLogin }) {
  const [name, setName] = useState('')
  const canLogin = normalizeUserName(name).length >= 1

  const submit = (event) => {
    event.preventDefault()
    if (!canLogin) return
    onLogin(normalizeUserName(name))
  }
  return (
    <div className="app-shell" style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 420, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24 }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Local login
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, marginBottom: 10 }}>
          Rana
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.7, marginBottom: 18 }}>
          Enter a local username to keep your saved chat history separate on this device.
        </p>
        <label htmlFor="localUserName" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>
          Username
        </label>
        <input
          id="localUserName"
          value={name}
          onChange={event => setName(event.target.value)}
          autoFocus
          placeholder="e.g. Dzulhaq"
          style={{ width: '100%', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none', marginBottom: 14 }}
        />
        <button
          type="submit"
          disabled={!canLogin}
          style={{
            width: '100%', padding: '12px 16px',
            background: canLogin ? 'rgba(196,168,130,0.15)' : 'var(--bg4)',
            border: `1px solid ${canLogin ? 'rgba(196,168,130,0.3)' : 'var(--border)'}`,
            color: canLogin ? 'var(--rana)' : 'var(--text-3)',
            borderRadius: 'var(--radius)', fontSize: 14, cursor: canLogin ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-body)'
          }}
        >
          Continue
        </button>
      </form>
    </div>
  )
}

// Main app.
function Workspace({ activeUser, onLogout }) {
  const [sessionId, setSessionId] = useState(() => readUserCurrentSession(activeUser) || getNewSessionId(activeUser))
  const [history, setHistory] = useState(() => readUserHistory(activeUser))
  const savedState = useRef(readSessionState(sessionId)).current
  const didHydrateSavedState = useRef(Boolean(savedState))
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
  const [continueCount, setContinueCount] = useState(savedState?.continueCount || 0)
  const [modelAvailability, setModelAvailability] = useState(null)
  const [historyLimitDialog, setHistoryLimitDialog] = useState(null)
  const [historyNotice, setHistoryNotice] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const fileRef = useRef()

  const getCurrentSessionState = useCallback((overrides = {}) => ({
    sessionDataVersion: SESSION_DATA_VERSION,
    productContext,
    wizardStep,
    wizardForm,
    uploadedFiles,
    runHagen,
    provider,
    model,
    result,
    additionalInput,
    continueCount,
    ...overrides,
  }), [productContext, wizardStep, wizardForm, uploadedFiles, runHagen, provider, model, result, additionalInput, continueCount])

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

  useEffect(() => {
    if (loading) return
    const state = getCurrentSessionState()
    writeSessionState(sessionId, state)
    writeUserCurrentSession(activeUser, sessionId)
    if (getMeaningfulLength(productContext) > 0 || result) {
      const update = upsertUserHistory(activeUser, sessionId, state)
      setHistory(update.history)
      if (update.removed.length > 0) {
        setHistoryNotice(`History terlama "${update.removed[0].title}" dihapus karena batas maksimal ${MAX_HISTORY_SESSIONS} history.`)
      }
    } else {
      setHistory(readUserHistory(activeUser))
    }
  }, [activeUser, sessionId, productContext, result, loading, getCurrentSessionState])

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

  const getExportText = () => {
    const parts = []
    if (result?.hara_output) parts.push('Hara - Market research & insight:\n' + result.hara_output)
    if (result?.bombom_output) parts.push('Bombom - Image ad concepts:\n' + result.bombom_output)
    if (result?.luna_output) parts.push('Luna - Video ad concepts:\n' + result.luna_output)
    if (result?.hagen_output) parts.push('Hagen - Video execution script:\n' + result.hagen_output)
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
  const canContinue = isMeaningfulText(additionalInput, 8) && continueCount < MAX_CONTINUES_PER_SESSION

  const resetWorkspaceState = useCallback((nextState = {}) => {
    setProductContext(nextState.productContext || '')
    setWizardStep(nextState.wizardStep || 1)
    setWizardForm(nextState.wizardForm || defaultWizardForm)
    setUploadedFiles(nextState.uploadedFiles || [])
    setRunHagen(Boolean(nextState.runHagen))
    const nextProvider = nextState.provider || DEFAULT_PROVIDER
    setProvider(nextProvider)
    setModel(
      nextState.model && PROVIDER_MODELS[nextProvider]?.includes(nextState.model)
        ? nextState.model
        : getDefaultModel(nextProvider)
    )
    setResult(nextState.result || null)
    setCompletedSteps([])
    setCurrentStep(null)
    setShowFeedback(Boolean(nextState.result))
    setAdditionalInput(nextState.additionalInput || '')
    setContinueCount(nextState.continueCount || 0)
    setError(null)
  }, [])

  const createNewSession = useCallback((removedSession = null) => {
    if (loading) return
    if (removedSession) {
      removeUserHistorySession(activeUser, removedSession.id)
      setHistory(readUserHistory(activeUser))
      setHistoryNotice(`History terlama "${removedSession.title}" dihapus karena batas maksimal ${MAX_HISTORY_SESSIONS} history.`)
    }
    const nextId = getNewSessionId(activeUser)
    setSessionId(nextId)
    writeUserCurrentSession(activeUser, nextId)
    resetWorkspaceState()
  }, [activeUser, loading, resetWorkspaceState])

  const handleNewSession = useCallback(() => {
    if (loading) return
    if (history.length >= MAX_HISTORY_SESSIONS) {
      setHistoryLimitDialog(history[history.length - 1])
      return
    }
    createNewSession()
  }, [createNewSession, history, loading])

  const handleLoadSession = useCallback((targetSessionId) => {
    if (loading || targetSessionId === sessionId) return
    const nextState = readSessionState(targetSessionId) || {}
    setSessionId(targetSessionId)
    writeUserCurrentSession(activeUser, targetSessionId)
    resetWorkspaceState(nextState)
  }, [activeUser, loading, resetWorkspaceState, sessionId])

  const handleDeleteHistorySession = useCallback(async (targetSessionId) => {
    if (loading) return
    await clearMemory(targetSessionId)
    const nextHistory = removeUserHistorySession(activeUser, targetSessionId)
    setHistory(nextHistory)
    if (targetSessionId === sessionId) {
      createNewSession()
    }
  }, [activeUser, createNewSession, loading, sessionId])

  const handleFileUpload = useCallback(async (files) => {
    for (const file of Array.from(files)) {
      try {
        const res = await uploadFile(sessionId, file)
        setUploadedFiles(prev => [...prev, { name: file.name, preview: res.preview }])
      } catch (error) {
        setError(`Upload failed: ${file.name}. ${error.message}`)
      }
    }
  }, [sessionId])

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
        runAgents({ sessionId, userId: getUserStorageId(activeUser), productContext, runHagen, opts: { provider, model } }),
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

  const handleContinue = async () => {
    if (continueCount >= MAX_CONTINUES_PER_SESSION) {
      setError(`This session has reached the ${MAX_CONTINUES_PER_SESSION} revision limit. Start a new session to keep the chat history clear.`)
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
        continueSession({ sessionId, userId: getUserStorageId(activeUser), productContext, additionalInput: note, runHagen, opts: { provider, model } }),
        simulateSteps()
      ])
      setResult(data)
      setAdditionalInput('')
      setProductContext(prev => `${prev.trim()}\n\nAdditional input:\n${note}`)
      setContinueCount(prev => prev + 1)
      setShowFeedback(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    await clearMemory(sessionId)
    clearSessionState(sessionId)
    setHistory(removeUserHistorySession(activeUser, sessionId))
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
    setContinueCount(0)
    setError(null)
  }

  return (
    <div className="app-shell" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {historyLimitDialog && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 500,
          background: 'rgba(0,0,0,0.66)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            width: '100%', maxWidth: 420,
            background: 'var(--bg3)', border: '1px solid var(--border-bright)',
            borderRadius: 'var(--radius-lg)', padding: 20,
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              History limit
            </div>
            <div style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Maksimal {MAX_HISTORY_SESSIONS} history
            </div>
            <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.7, marginBottom: 16 }}>
              Kalau membuat chat baru, history paling lama akan dihapus: "{historyLimitDialog.title}".
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setHistoryLimitDialog(null)}
                style={{ padding: '10px 14px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const oldest = historyLimitDialog
                  setHistoryLimitDialog(null)
                  createNewSession(oldest)
                }}
                style={{ padding: '10px 14px', background: 'rgba(196,168,130,0.15)', border: '1px solid rgba(196,168,130,0.35)', color: 'var(--rana)', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
              >
                Create chat
              </button>
            </div>
          </div>
        </div>
      )}
      {historyNotice && (
        <div style={{
          position: 'fixed', right: 18, bottom: 18, zIndex: 450,
          maxWidth: 360, padding: '12px 14px',
          background: 'var(--bg3)', border: '1px solid var(--border-bright)',
          borderRadius: 10, color: 'var(--text-2)', fontSize: 13,
          boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
        }}>
          <div style={{ marginBottom: 8 }}>{historyNotice}</div>
          <button
            type="button"
            onClick={() => setHistoryNotice('')}
            style={{ background: 'transparent', border: 0, color: 'var(--rana)', cursor: 'pointer', fontFamily: 'var(--font-body)', padding: 0 }}
          >
            OK
          </button>
        </div>
      )}
      <button
        type="button"
        className={`sidebar-toggle ${sidebarOpen ? 'is-open' : 'is-closed'}`}
        onClick={() => setSidebarOpen(open => !open)}
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? '<' : '>'}
      </button>

      <div className={`app-page ${sidebarOpen ? '' : 'sidebar-collapsed'}`} style={{ width: '100%' }}>
        {/* LEFT PANEL */}
        <div className="app-left-panel" aria-hidden={!sidebarOpen}>

          {/* Sidebar */}
          <aside className="chat-sidebar">
            <div className="sidebar-main">
              <div className="sidebar-brand">
                <div className="sidebar-logo">R</div>
                <div>
                  <div className="sidebar-title">Rana</div>
                  <div className="sidebar-subtitle">Marketing System</div>
                </div>
                <button
                  type="button"
                  className="sidebar-close"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Close sidebar"
                >
                  x
                </button>
              </div>

              <button className="sidebar-new-chat" onClick={handleNewSession} disabled={loading}>
                <span className="sidebar-new-icon">+</span>
                <span>New chat</span>
              </button>

              <div className="sidebar-section-label">Recents</div>
              <div className="sidebar-history-list">
                {history.length === 0 && (
                  <div className="sidebar-empty">No saved chats yet.</div>
                )}
                {history.map(item => {
                  const active = item.id === sessionId
                  return (
                    <div key={item.id} className={`sidebar-history-item ${active ? 'active' : ''}`}>
                      <button
                        type="button"
                        onClick={() => handleLoadSession(item.id)}
                        disabled={loading}
                        className="sidebar-history-button"
                      >
                        <span className="sidebar-history-title">{item.title}</span>
                        <span className="sidebar-history-summary">{item.summary}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteHistorySession(item.id)}
                        disabled={loading}
                        title="Delete session"
                        className="sidebar-delete"
                      >
                        x
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="sidebar-account">
              <div className="sidebar-avatar">{activeUser.slice(0, 2).toUpperCase()}</div>
              <div className="sidebar-account-text">
                <div className="sidebar-account-name">{activeUser}</div>
                <div className="sidebar-account-meta">{history.length}/{MAX_HISTORY_SESSIONS} histories</div>
              </div>
              {result && (
                <button className="sidebar-account-action" onClick={handleClear} title="Reset session">
                  reset
                </button>
              )}
              <button className="sidebar-account-action" onClick={onLogout} disabled={loading}>
                out
              </button>
            </div>
          </aside>
        </div>

        <div className="app-work-panel">
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
                <div style={{ width: 40, height: 40, borderRadius: '50%', border: '4px solid rgba(196,168,130,0.2)', borderTopColor: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
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
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                animation: 'fadeIn 0.3s ease',
              }}>
                <span style={{ color: 'var(--hara)', fontSize: 16 }}>✓</span>
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  All agents completed - {new Date().toLocaleTimeString('id-ID')}
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
                  {[
                    ['rana', result.rana_decision],
                    ['hara', result.hara_output],
                    ['bombom', result.bombom_output],
                    ['luna', result.luna_output],
                    ['hagen', result.hagen_output],
                  ].filter(([, output]) => Boolean(output)).map(([agentKey]) => {
                    const agent = AGENTS[agentKey]
                    return (
                      <span key={agentKey} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '5px 9px', borderRadius: 8,
                        background: `${agent.color}16`,
                        border: `1px solid ${agent.color}38`,
                        color: agent.color,
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                        <span>{agent.icon}</span>
                        <span>{agent.name}</span>
                      </span>
                    )
                  })}
                </div>
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
                  <OutputCard agentKey="rana" content={result.rana_decision} title="Supervisor / Final Decision" />
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
                <OutputCard agentKey="hara" content={result.hara_output} title="Research Output" />
              )}

              {/* Bombom output */}
              {result.bombom_output && (
                <OutputCard agentKey="bombom" content={result.bombom_output} title="Image Ads Output (10 Concepts)" />
              )}

              {/* Luna output */}
              {result.luna_output && (
                <OutputCard agentKey="luna" content={result.luna_output} title="Video Concept Output" />
              )}

              {/* Hagen output (if exists) */}
              {result.hagen_output && (
                <OutputCard agentKey="hagen" content={result.hagen_output} title="Execution Output" />
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
                    Revision {continueCount}/{MAX_CONTINUES_PER_SESSION}. Rana will keep the same session memory and rerun the agents with this extra context.
                  </span>
                  <button
                    onClick={handleContinue}
                    disabled={loading || !canContinue}
                    style={{
                      padding: '10px 16px',
                      background: loading || !canContinue ? 'var(--bg4)' : 'rgba(196,168,130,0.15)',
                      border: `1px solid ${loading || !canContinue ? 'var(--border)' : 'rgba(196,168,130,0.3)'}`,
                      color: loading || !canContinue ? 'var(--text-3)' : 'var(--rana)',
                      borderRadius: 8, fontSize: 13,
                      cursor: loading || !canContinue ? 'not-allowed' : 'pointer',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    {continueCount >= MAX_CONTINUES_PER_SESSION ? 'Revision limit reached' : 'Send additional input'}
                  </button>
                </div>
              </div>

              {/* Feedback */}
              {showFeedback && (
                <FeedbackBar sessionId={sessionId} userId={getUserStorageId(activeUser)} onDone={() => setShowFeedback(false)} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [activeUser, setActiveUser] = useState(readActiveUser())
  const [appKey, setAppKey] = useState(0)

  const handleLogin = (userName) => {
    const normalized = normalizeUserName(userName)
    if (!normalized) return

    let nextSessionId = readUserCurrentSession(normalized)
    if (!nextSessionId) {
      nextSessionId = getNewSessionId(normalized)
      writeUserCurrentSession(normalized, nextSessionId)
      writeSessionState(nextSessionId, {
        sessionDataVersion: SESSION_DATA_VERSION,
        productContext: '',
        wizardStep: 1,
        wizardForm: null,
        uploadedFiles: [],
        runHagen: false,
        provider: DEFAULT_PROVIDER,
        model: getDefaultModel(DEFAULT_PROVIDER),
        result: null,
        additionalInput: '',
        continueCount: 0,
      })
    }

    writeActiveUser(normalized)
    setActiveUser(normalized)
    setAppKey(prev => prev + 1)
  }

  const handleLogout = () => {
    clearActiveUser()
    setActiveUser('')
    setAppKey(prev => prev + 1)
  }

  if (!activeUser) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return <Workspace key={`${activeUser}:${appKey}`} activeUser={activeUser} onLogout={handleLogout} />
}

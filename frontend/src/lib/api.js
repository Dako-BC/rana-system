import { getFirebaseIdToken } from './firebase.js'

// Use deployed backend URL when configured.
// Fall back to the Vite /api proxy locally.
const BASE_URL = import.meta.env.VITE_API_URL || ''
const apiUrl = (path) => BASE_URL ? `${BASE_URL}${path}` : path

async function authHeaders(extra = {}) {
  const token = await getFirebaseIdToken()
  return token
    ? { ...extra, Authorization: `Bearer ${token}` }
    : extra
}

async function parseApiError(res) {
  let detail = ''
  try {
    const body = await res.json()
    detail = body.detail || body.error || JSON.stringify(body)
  } catch {
    detail = await res.text()
  }

  const isFirebaseAdminError = /firebase admin|firebase application credentials|firebase id token/i.test(detail)
  const friendlyMessages = {
    400: 'The request is invalid. Check the input and try again.',
    401: 'Not authenticated. Try refreshing the page.',
    403: 'Access denied.',
    404: 'Endpoint not found. Make sure the backend is running.',
    422: 'The submitted data does not match the expected format.',
    429: 'AI service rate/quota limit reached. Wait a moment or check the Anthropic usage limit.',
    500: 'The server encountered an internal error. Please try again later.',
    502: 'The AI service returned an upstream error. Check the backend terminal for details.',
    503: isFirebaseAdminError
      ? 'Firebase authentication is not configured on the backend. Check backend Firebase Admin environment variables.'
      : 'The backend cannot connect to the AI service right now. Check network/server connectivity.',
  }

  const friendly = friendlyMessages[res.status] || `An error occurred (${res.status}).`
  const suffix = detail ? ` Detail: ${detail}` : ''
  return new Error(`${friendly}${suffix}`)
}

export async function runAgents({ sessionId, userId, productContext, runHagen = false, opts = {}, apiKeys = {} }) {
  const res = await fetch(apiUrl('/api/run'), {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      session_id: sessionId,
      user_id: userId,
      product_context: productContext,
      run_hagen: runHagen,
      opts,
      api_keys: apiKeys,
    }),
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function continueSession({ sessionId, userId, productContext, additionalInput, runHagen = false, opts = {}, apiKeys = {} }) {
  const res = await fetch(apiUrl('/api/continue'), {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      session_id: sessionId,
      user_id: userId,
      product_context: productContext,
      additional_input: additionalInput,
      run_hagen: runHagen,
      opts,
      api_keys: apiKeys,
    }),
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function uploadFile(sessionId, file, userId) {
  const form = new FormData()
  form.append('session_id', sessionId)
  if (userId) form.append('user_id', userId)
  form.append('file', file)
  const res = await fetch(apiUrl('/api/upload'), {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function saveFeedback(sessionId, feedback, userId) {
  const res = await fetch(apiUrl('/api/feedback'), {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ session_id: sessionId, user_id: userId, feedback }),
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function fetchBackendHistory(userId) {
  if (!userId) return { sessions: [], states: {} }
  const res = await fetch(apiUrl(`/api/history/${encodeURIComponent(userId)}`), {
    headers: await authHeaders(),
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function saveBackendHistory(userId, sessions, states) {
  if (!userId) return { status: 'skipped' }
  const res = await fetch(apiUrl(`/api/history/${encodeURIComponent(userId)}`), {
    method: 'PUT',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sessions, states }),
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function clearMemory(sessionId, userId) {
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : ''
  const res = await fetch(apiUrl(`/api/memory/${sessionId}${query}`), {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function getModelAvailability(apiKeys = {}) {
  const hasApiKeys = Object.values(apiKeys || {}).some(Boolean)
  const res = await fetch(apiUrl('/api/availability'), hasApiKeys
    ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_keys: apiKeys }),
    }
    : undefined)
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

// Use deployed backend URL when configured.
// Fall back to the Vite /api proxy locally.
const BASE_URL = import.meta.env.VITE_API_URL || ''
const apiUrl = (path) => BASE_URL ? `${BASE_URL}${path}` : path

async function parseApiError(res) {
  let detail = ''
  try {
    const body = await res.json()
    detail = body.detail || body.error || JSON.stringify(body)
  } catch {
    detail = await res.text()
  }

  const friendlyMessages = {
    400: 'The request is invalid. Check the input and try again.',
    401: 'Not authenticated. Try refreshing the page.',
    403: 'Access denied.',
    404: 'Endpoint not found. Make sure the backend is running.',
    422: 'The submitted data does not match the expected format.',
    429: 'AI service rate/quota limit reached. Wait a moment or check the Anthropic usage limit.',
    500: 'The server encountered an internal error. Please try again later.',
    502: 'The AI service returned an upstream error. Check the backend terminal for details.',
    503: 'The backend cannot connect to the AI service right now. Check network/server connectivity.',
  }

  const friendly = friendlyMessages[res.status] || `An error occurred (${res.status}).`
  const suffix = detail ? ` Detail: ${detail}` : ''
  return new Error(`${friendly}${suffix}`)
}

export async function runAgents({ sessionId, productContext, runHagen = false, opts = {} }) {
  const res = await fetch(apiUrl('/api/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      product_context: productContext,
      run_hagen: runHagen,
      opts,
    }),
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function continueSession({ sessionId, productContext, additionalInput, runHagen = false, opts = {} }) {
  const res = await fetch(apiUrl('/api/continue'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      product_context: productContext,
      additional_input: additionalInput,
      run_hagen: runHagen,
      opts,
    }),
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function uploadFile(sessionId, file) {
  const form = new FormData()
  form.append('session_id', sessionId)
  form.append('file', file)
  const res = await fetch(apiUrl('/api/upload'), {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function saveFeedback(sessionId, feedback) {
  const res = await fetch(apiUrl('/api/feedback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, feedback }),
  })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function clearMemory(sessionId) {
  const res = await fetch(apiUrl(`/api/memory/${sessionId}`), { method: 'DELETE' })
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

export async function getModelAvailability() {
  const res = await fetch(apiUrl('/api/availability'))
  if (!res.ok) throw await parseApiError(res)
  return res.json()
}

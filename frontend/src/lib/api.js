// Ganti dengan URL backend kamu setelah deploy ke Railway/Render
// Default ke proxy /api saat menjalankan Vite lokal.
const BASE_URL = import.meta.env.VITE_API_URL || ''
const apiUrl = (path) => BASE_URL ? `${BASE_URL}${path}` : path

export async function runAgents({ sessionId, productContext, runHagen = false }) {
  const res = await fetch(apiUrl('/api/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      product_context: productContext,
      run_hagen: runHagen,
    }),
  })
  if (!res.ok) {
    let message = ''
    try {
      const body = await res.json()
      message = body.detail || body.error || JSON.stringify(body)
    } catch {
      message = await res.text()
    }
    throw new Error(`API error: ${res.status} ${message}`)
  }
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
  if (!res.ok) throw new Error(`Upload error: ${res.status}`)
  return res.json()
}

export async function saveFeedback(sessionId, feedback) {
  await fetch(apiUrl('/api/feedback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, feedback }),
  })
}

export async function clearMemory(sessionId) {
  await fetch(apiUrl(`/api/memory/${sessionId}`), { method: 'DELETE' })
}

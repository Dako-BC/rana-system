// Ganti dengan URL backend kamu setelah deploy ke Railway/Render
// Default ke proxy /api saat menjalankan Vite lokal.
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
    400: 'Permintaan tidak valid. Cek kembali input yang dikirim.',
    401: 'Tidak terautentikasi. Coba refresh halaman.',
    403: 'Akses ditolak.',
    404: 'Endpoint tidak ditemukan. Pastikan backend sudah berjalan.',
    422: 'Data yang dikirim tidak sesuai format yang diharapkan.',
    429: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
    500: 'Server mengalami kesalahan internal. Coba beberapa saat lagi.',
    502: 'Backend tidak bisa terhubung ke layanan AI. Cek API key atau coba lagi.',
    503: 'Server sedang tidak tersedia. Coba beberapa saat lagi.',
  }

  const friendly = friendlyMessages[res.status] || `Terjadi kesalahan (${res.status}).`
  const suffix = detail ? ` Detail: ${detail}` : ''
  return new Error(`${friendly}${suffix}`)
}

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
  await fetch(apiUrl('/api/feedback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, feedback }),
  })
}

export async function clearMemory(sessionId) {
  await fetch(apiUrl(`/api/memory/${sessionId}`), { method: 'DELETE' })
}

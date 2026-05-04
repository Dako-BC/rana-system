import { useState } from 'react'

const STEPS = [
  { id: 'niche', label: 'Niche & Produk' },
  { id: 'target', label: 'Target Market' },
  { id: 'goals', label: 'Tujuan Iklan' },
  { id: 'confirm', label: 'Konfirmasi' },
]

const NICHE_OPTIONS = [
  { value: 'kecantikan', label: '💄 Kecantikan & Skincare' },
  { value: 'kursus', label: '🎤 Kursus & Pelatihan' },
  { value: 'kesehatan', label: '💪 Kesehatan & Wellness' },
  { value: 'fashion', label: '👗 Fashion & Lifestyle' },
  { value: 'bisnis', label: '📈 Bisnis & SaaS' },
  { value: 'lainnya', label: '✦ Lainnya' },
]

const GOAL_OPTIONS = [
  { value: 'awareness', label: 'Brand Awareness' },
  { value: 'leads', label: 'Lead Generation' },
  { value: 'konversi', label: 'Direct Konversi' },
  { value: 'retargeting', label: 'Retargeting' },
]

const PLATFORM_OPTIONS = [
  { value: 'facebook', label: 'Facebook Ads' },
  { value: 'instagram', label: 'Instagram Ads' },
  { value: 'tiktok', label: 'TikTok Ads' },
  { value: 'youtube', label: 'YouTube Ads' },
]

function ProgressBar({ current, total }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        {STEPS.map((step, i) => (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: i < current ? 'var(--accent)' : i === current ? 'var(--accent)' : 'var(--surface2)',
              border: i === current ? '2px solid var(--accent-bright)' : '2px solid transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.7rem', fontWeight: 700, color: i <= current ? 'var(--bg)' : 'var(--text-dim)',
              transition: 'all 0.3s ease',
              boxShadow: i === current ? '0 0 12px var(--accent-glow)' : 'none',
            }}>
              {i < current ? '✓' : i + 1}
            </div>
            <span style={{
              fontSize: '0.7rem', fontFamily: 'var(--font-mono)',
              color: i === current ? 'var(--accent-bright)' : i < current ? 'var(--accent)' : 'var(--text-dim)',
              display: window.innerWidth < 480 ? 'none' : 'block',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>{step.label}</span>
            {i < STEPS.length - 1 && (
              <div style={{
                width: 32, height: 1,
                background: i < current ? 'var(--accent)' : 'var(--surface2)',
                transition: 'background 0.3s ease',
              }} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function OptionGrid({ options, value, onChange, multi = false }) {
  const selected = multi ? (value || []) : value
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.6rem' }}>
      {options.map(opt => {
        const isSelected = multi ? selected.includes(opt.value) : selected === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              if (multi) {
                const next = isSelected ? selected.filter(v => v !== opt.value) : [...selected, opt.value]
                onChange(next)
              } else {
                onChange(opt.value)
              }
            }}
            style={{
              padding: '0.75rem 1rem', borderRadius: 8, cursor: 'pointer',
              border: isSelected ? '1px solid var(--accent)' : '1px solid var(--surface2)',
              background: isSelected ? 'var(--accent-faint)' : 'var(--surface)',
              color: isSelected ? 'var(--accent-bright)' : 'var(--text)',
              fontSize: '0.82rem', fontFamily: 'var(--font-body)',
              textAlign: 'left', transition: 'all 0.15s ease',
              boxShadow: isSelected ? '0 0 0 1px var(--accent-glow)' : 'none',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function TextField({ label, placeholder, value, onChange, multiline = false, hint }) {
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <label style={{
        display: 'block', marginBottom: '0.4rem',
        fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</label>
      <Tag
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={multiline ? 4 : undefined}
        style={{
          width: '100%', padding: '0.75rem 1rem',
          background: 'var(--surface)', border: '1px solid var(--surface2)',
          borderRadius: 8, color: 'var(--text)', fontSize: '0.9rem',
          fontFamily: 'var(--font-body)', resize: multiline ? 'vertical' : undefined,
          outline: 'none', transition: 'border-color 0.15s',
          boxSizing: 'border-box',
        }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--surface2)'}
      />
      {hint && <p style={{ marginTop: '0.3rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>{hint}</p>}
    </div>
  )
}

function ConfirmRow({ label, value }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null
  return (
    <div style={{ display: 'flex', gap: '1rem', padding: '0.6rem 0', borderBottom: '1px solid var(--surface2)' }}>
      <span style={{ minWidth: 140, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: '0.88rem', color: 'var(--text)' }}>
        {Array.isArray(value) ? value.join(', ') : value}
      </span>
    </div>
  )
}

export default function OnboardingWizard({ onSubmit, loading = false }) {
  const [step, setStep] = useState(0)
  const [data, setData] = useState({
    niche: '',
    productName: '',
    productDesc: '',
    usp: '',
    targetAge: '',
    targetGender: '',
    targetProblem: '',
    goals: [],
    platforms: [],
    budget: '',
    additionalNotes: '',
  })

  const set = (key) => (val) => setData(prev => ({ ...prev, [key]: val }))

  const canNext = () => {
    if (step === 0) return data.niche && data.productName && data.productDesc
    if (step === 1) return data.targetProblem
    if (step === 2) return data.goals.length > 0 && data.platforms.length > 0
    return true
  }

  const buildProductContext = () => {
    return [
      `NICHE: ${data.niche}`,
      `PRODUK: ${data.productName}`,
      `DESKRIPSI: ${data.productDesc}`,
      data.usp && `USP: ${data.usp}`,
      `TARGET DEMOGRAFI: ${[data.targetAge, data.targetGender].filter(Boolean).join(', ')}`,
      `MASALAH TARGET: ${data.targetProblem}`,
      `TUJUAN IKLAN: ${data.goals.join(', ')}`,
      `PLATFORM: ${data.platforms.join(', ')}`,
      data.budget && `BUDGET: ${data.budget}`,
      data.additionalNotes && `CATATAN TAMBAHAN: ${data.additionalNotes}`,
    ].filter(Boolean).join('\n')
  }

  const handleSubmit = () => {
    onSubmit({ productContext: buildProductContext() })
  }

  return (
    <div style={{
      '--bg': '#0d0d0f',
      '--surface': '#16161a',
      '--surface2': '#242428',
      '--accent': '#7c6af0',
      '--accent-bright': '#a89ef7',
      '--accent-faint': 'rgba(124,106,240,0.12)',
      '--accent-glow': 'rgba(124,106,240,0.35)',
      '--text': '#e8e6f0',
      '--text-dim': '#6b6880',
      '--font-body': "'DM Sans', sans-serif",
      '--font-mono': "'DM Mono', monospace",
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem 1rem',
      fontFamily: 'var(--font-body)',
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ width: '100%', maxWidth: 580 }}>
        {/* Header */}
        <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
          <div style={{
            display: 'inline-block', padding: '0.25rem 0.75rem',
            background: 'var(--accent-faint)', border: '1px solid var(--accent)',
            borderRadius: 20, fontSize: '0.7rem', fontFamily: 'var(--font-mono)',
            color: 'var(--accent-bright)', textTransform: 'uppercase', letterSpacing: '0.1em',
            marginBottom: '1rem',
          }}>
            Rana Multi-Agent System
          </div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.2 }}>
            Setup Kampanye
          </h1>
          <p style={{ color: 'var(--text-dim)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            Isi info produk kamu — agent kami akan mulai bekerja setelahnya.
          </p>
        </div>

        <ProgressBar current={step} total={STEPS.length} />

        {/* Card */}
        <div style={{
          background: 'var(--surface)', borderRadius: 16,
          border: '1px solid var(--surface2)', padding: '2rem',
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        }}>

          {/* Step 0 — Niche & Produk */}
          {step === 0 && (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', marginTop: 0, marginBottom: '0.3rem' }}>Niche & Produk</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Pilih kategori dan jelaskan produkmu.</p>

              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Kategori Produk</label>
              <div style={{ marginBottom: '1.5rem' }}>
                <OptionGrid options={NICHE_OPTIONS} value={data.niche} onChange={set('niche')} />
              </div>

              <TextField label="Nama Produk / Brand" placeholder="e.g. GlowUp Serum, SpeakPro Course" value={data.productName} onChange={set('productName')} />
              <TextField label="Deskripsi Produk" placeholder="Jelaskan produk, manfaat utama, dan cara kerjanya..." value={data.productDesc} onChange={set('productDesc')} multiline />
              <TextField label="USP (Opsional)" placeholder="Apa yang membuat produk ini beda dari kompetitor?" value={data.usp} onChange={set('usp')} hint="Unique Selling Proposition — satu kalimat yang paling membedakan." />
            </div>
          )}

          {/* Step 1 — Target Market */}
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', marginTop: 0, marginBottom: '0.3rem' }}>Target Market</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Siapa yang paling butuh produk kamu?</p>

              <TextField label="Rentang Usia Target" placeholder="e.g. 25–40 tahun, atau semua usia" value={data.targetAge} onChange={set('targetAge')} />
              <TextField label="Gender Target (Opsional)" placeholder="e.g. Wanita, Pria, atau semua" value={data.targetGender} onChange={set('targetGender')} />
              <TextField
                label="Masalah Utama Target Market *"
                placeholder="Apa masalah terbesar yang dihadapi target kamu? Semakin spesifik, semakin baik."
                value={data.targetProblem} onChange={set('targetProblem')} multiline
                hint="Contoh: Takut presentasi di depan atasan, tidak percaya diri bicara di publik, karir stagnan karena komunikasi yang buruk."
              />
            </div>
          )}

          {/* Step 2 — Tujuan */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', marginTop: 0, marginBottom: '0.3rem' }}>Tujuan & Platform</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Apa tujuan kampanye dan di mana iklan akan tayang?</p>

              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tujuan Iklan *</label>
              <div style={{ marginBottom: '1.5rem' }}>
                <OptionGrid options={GOAL_OPTIONS} value={data.goals} onChange={set('goals')} multi />
              </div>

              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Platform *</label>
              <div style={{ marginBottom: '1.5rem' }}>
                <OptionGrid options={PLATFORM_OPTIONS} value={data.platforms} onChange={set('platforms')} multi />
              </div>

              <TextField label="Budget Iklan (Opsional)" placeholder="e.g. Rp 5–10 juta/bulan" value={data.budget} onChange={set('budget')} />
              <TextField label="Catatan Tambahan (Opsional)" placeholder="Info lain yang perlu diketahui agent — tone brand, referensi iklan, dll." value={data.additionalNotes} onChange={set('additionalNotes')} multiline />
            </div>
          )}

          {/* Step 3 — Konfirmasi */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', marginTop: 0, marginBottom: '0.3rem' }}>Konfirmasi</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Cek kembali sebelum agent mulai bekerja.</p>

              <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem' }}>
                <ConfirmRow label="Niche" value={data.niche} />
                <ConfirmRow label="Produk" value={data.productName} />
                <ConfirmRow label="Deskripsi" value={data.productDesc} />
                <ConfirmRow label="USP" value={data.usp} />
                <ConfirmRow label="Usia Target" value={data.targetAge} />
                <ConfirmRow label="Gender" value={data.targetGender} />
                <ConfirmRow label="Masalah Target" value={data.targetProblem} />
                <ConfirmRow label="Tujuan" value={data.goals} />
                <ConfirmRow label="Platform" value={data.platforms} />
                <ConfirmRow label="Budget" value={data.budget} />
                <ConfirmRow label="Catatan" value={data.additionalNotes} />
              </div>

              <div style={{
                padding: '0.85rem 1rem', borderRadius: 8,
                background: 'var(--accent-faint)', border: '1px solid var(--accent)',
                fontSize: '0.82rem', color: 'var(--accent-bright)', lineHeight: 1.5,
              }}>
                ✦ Rana, Hara, Bombom, dan Luna akan mulai menganalisis produkmu secara paralel. Proses ini membutuhkan sekitar 30–60 detik.
              </div>
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setStep(s => s - 1)}
              disabled={step === 0}
              style={{
                padding: '0.65rem 1.5rem', borderRadius: 8, border: '1px solid var(--surface2)',
                background: 'transparent', color: step === 0 ? 'var(--text-dim)' : 'var(--text)',
                fontFamily: 'var(--font-body)', fontSize: '0.88rem', cursor: step === 0 ? 'default' : 'pointer',
                opacity: step === 0 ? 0.4 : 1,
              }}
            >
              ← Kembali
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(s => s + 1)}
                disabled={!canNext()}
                style={{
                  padding: '0.65rem 1.75rem', borderRadius: 8,
                  border: 'none', background: canNext() ? 'var(--accent)' : 'var(--surface2)',
                  color: canNext() ? '#fff' : 'var(--text-dim)',
                  fontFamily: 'var(--font-body)', fontSize: '0.88rem', fontWeight: 600,
                  cursor: canNext() ? 'pointer' : 'default', transition: 'all 0.15s',
                }}
              >
                Lanjut →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                style={{
                  padding: '0.65rem 1.75rem', borderRadius: 8,
                  border: 'none',
                  background: loading ? 'var(--surface2)' : 'var(--accent)',
                  color: loading ? 'var(--text-dim)' : '#fff',
                  fontFamily: 'var(--font-body)', fontSize: '0.88rem', fontWeight: 600,
                  cursor: loading ? 'default' : 'pointer',
                  boxShadow: loading ? 'none' : '0 0 20px var(--accent-glow)',
                }}
              >
                {loading ? '⏳ Memproses...' : '✦ Jalankan Agent'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

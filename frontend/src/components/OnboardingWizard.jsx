import { useState } from 'react'

const STEPS = [
  { id: 'niche', label: 'Niche & Product' },
  { id: 'target', label: 'Target Market' },
  { id: 'goals', label: 'Ad Goals' },
  { id: 'confirm', label: 'Confirm' },
]

const NICHE_OPTIONS = [
  { value: 'kecantikan', label: '💄 Beauty & Skincare' },
  { value: 'kursus', label: '🎤 Courses & Training' },
  { value: 'kesehatan', label: '💪 Health & Wellness' },
  { value: 'fashion', label: '👗 Fashion & Lifestyle' },
  { value: 'bisnis', label: '📈 Business & SaaS' },
  { value: 'lainnya', label: '✦ Other' },
]

const GOAL_OPTIONS = [
  { value: 'awareness', label: 'Brand Awareness' },
  { value: 'leads', label: 'Lead Generation' },
  { value: 'konversi', label: 'Direct Conversion' },
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
      `PRODUCT: ${data.productName}`,
      `DESCRIPTION: ${data.productDesc}`,
      data.usp && `USP: ${data.usp}`,
      `TARGET DEMOGRAPHICS: ${[data.targetAge, data.targetGender].filter(Boolean).join(', ')}`,
      `TARGET PROBLEM: ${data.targetProblem}`,
      `AD GOALS: ${data.goals.join(', ')}`,
      `PLATFORMS: ${data.platforms.join(', ')}`,
      data.budget && `BUDGET: ${data.budget}`,
      data.additionalNotes && `ADDITIONAL NOTES: ${data.additionalNotes}`,
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
            Campaign Setup
          </h1>
          <p style={{ color: 'var(--text-dim)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            Enter your product information — our agents will start working afterwards.
          </p>
        </div>

        <ProgressBar current={step} total={STEPS.length} />

        {/* Card */}
        <div style={{
          background: 'var(--surface)', borderRadius: 16,
          border: '1px solid var(--surface2)', padding: '2rem',
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        }}>

          {/* Step 0 - Niche and product */}
          {step === 0 && (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', marginTop: 0, marginBottom: '0.3rem' }}>Niche & Product</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Choose a category and describe your product.</p>

              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Product Category</label>
              <div style={{ marginBottom: '1.5rem' }}>
                <OptionGrid options={NICHE_OPTIONS} value={data.niche} onChange={set('niche')} />
              </div>

              <TextField label="Product Name / Brand" placeholder="e.g. GlowUp Serum, SpeakPro Course" value={data.productName} onChange={set('productName')} />
              <TextField label="Product Description" placeholder="Describe the product, main benefits, and how it works..." value={data.productDesc} onChange={set('productDesc')} multiline />
              <TextField label="USP (Optional)" placeholder="What makes this product different from competitors?" value={data.usp} onChange={set('usp')} hint="Unique Selling Proposition — one sentence that sets it apart." />
            </div>
          )}

          {/* Step 1 — Target Market */}
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', marginTop: 0, marginBottom: '0.3rem' }}>Target Market</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Who needs your product most?</p>

              <TextField label="Target Age Range" placeholder="e.g. 25–40, or all ages" value={data.targetAge} onChange={set('targetAge')} />
              <TextField label="Target Gender (Optional)" placeholder="e.g. Women, Men, or all" value={data.targetGender} onChange={set('targetGender')} />
              <TextField
                label="Main Target Market Problem *"
                placeholder="What is the biggest problem your audience faces? The more specific, the better."
                value={data.targetProblem} onChange={set('targetProblem')} multiline
                hint="Example: fear of presenting to managers, lack of confidence speaking publicly, stalled career due to poor communication."
              />
            </div>
          )}

          {/* Step 2 - Goals */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', marginTop: 0, marginBottom: '0.3rem' }}>Goals & Platforms</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>What is the campaign goal and where should ads run?</p>

              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ad Goals *</label>
              <div style={{ marginBottom: '1.5rem' }}>
                <OptionGrid options={GOAL_OPTIONS} value={data.goals} onChange={set('goals')} multi />
              </div>

              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Platform *</label>
              <div style={{ marginBottom: '1.5rem' }}>
                <OptionGrid options={PLATFORM_OPTIONS} value={data.platforms} onChange={set('platforms')} multi />
              </div>

              <TextField label="Ad Budget (Optional)" placeholder="e.g. Rp 5–10 million/month" value={data.budget} onChange={set('budget')} />
              <TextField label="Additional Notes (Optional)" placeholder="Other info the agent should know — brand tone, ad references, etc." value={data.additionalNotes} onChange={set('additionalNotes')} multiline />
            </div>
          )}

          {/* Step 3 - Confirmation */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', marginTop: 0, marginBottom: '0.3rem' }}>Confirm</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Review before agents start working.</p>

              <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem' }}>
                <ConfirmRow label="Niche" value={data.niche} />
                <ConfirmRow label="Product" value={data.productName} />
                <ConfirmRow label="Description" value={data.productDesc} />
                <ConfirmRow label="USP" value={data.usp} />
                <ConfirmRow label="Target Age" value={data.targetAge} />
                <ConfirmRow label="Gender" value={data.targetGender} />
                <ConfirmRow label="Target Problem" value={data.targetProblem} />
                <ConfirmRow label="Goals" value={data.goals} />
                <ConfirmRow label="Platform" value={data.platforms} />
                <ConfirmRow label="Budget" value={data.budget} />
                <ConfirmRow label="Notes" value={data.additionalNotes} />
              </div>

              <div style={{
                padding: '0.85rem 1rem', borderRadius: 8,
                background: 'var(--accent-faint)', border: '1px solid var(--accent)',
                fontSize: '0.82rem', color: 'var(--accent-bright)', lineHeight: 1.5,
              }}>
                ✦ Rana, Hara, Bombom, and Luna will start analyzing your product in parallel. This process takes about 30–60 seconds.
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
              ← Back
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
                Continue →
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
                {loading ? '⏳ Processing...' : '✦ Run Agents'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

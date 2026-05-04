import { useState } from 'react'

// ─── Shared tokens (extend dari parent theme jika ada) ───
const T = {
  surface: '#16161a',
  surface2: '#1e1e24',
  surface3: '#242428',
  border: '#2a2a32',
  text: '#e8e6f0',
  textDim: '#6b6880',
  fontMono: "'DM Mono', monospace",
  fontBody: "'DM Sans', sans-serif",
  agents: {
    hara: { color: '#4adeaf', glow: 'rgba(74,222,175,0.2)', label: 'HARA — Research Agent' },
    bombom: { color: '#f97316', glow: 'rgba(249,115,22,0.2)', label: 'BOMBOM — Image Ads' },
    luna: { color: '#c084fc', glow: 'rgba(192,132,252,0.2)', label: 'LUNA — Video Concept' },
    hagen: { color: '#38bdf8', glow: 'rgba(56,189,248,0.2)', label: 'HAGEN — Script Execution' },
    rana: { color: '#f59e0b', glow: 'rgba(245,158,11,0.2)', label: 'RANA — Supervisor' },
  },
}

function Badge({ children, color }) {
  return (
    <span style={{
      padding: '0.2rem 0.55rem', borderRadius: 20, fontSize: '0.68rem',
      fontFamily: T.fontMono, background: `${color}22`,
      color, border: `1px solid ${color}55`, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: '0.68rem', fontFamily: T.fontMono, color: T.textDim,
      textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem',
    }}>{children}</div>
  )
}

function InfoBlock({ label, value, color }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: '1rem' }}>
      <SectionLabel>{label}</SectionLabel>
      <p style={{ margin: 0, fontSize: '0.88rem', color: T.text, lineHeight: 1.6 }}>{value}</p>
    </div>
  )
}

function TagList({ items }) {
  if (!items?.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
      {items.map((item, i) => (
        <span key={i} style={{
          padding: '0.2rem 0.65rem', borderRadius: 20,
          background: T.surface3, border: `1px solid ${T.border}`,
          fontSize: '0.78rem', color: T.text, fontFamily: T.fontMono,
        }}>{item}</span>
      ))}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: T.border, margin: '1.25rem 0' }} />
}

// ─── HARA OUTPUT ───────────────────────────────────────────
function HaraCard({ data }) {
  const c = T.agents.hara.color
  const tm = data.target_market || {}
  const cp = data.core_problem || {}
  const dt = data.decision_trigger || {}

  return (
    <div>
      {/* Target Market */}
      <div style={{ marginBottom: '1.25rem' }}>
        <SectionLabel>Target Market</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div style={{ background: T.surface3, borderRadius: 8, padding: '0.85rem' }}>
            <div style={{ fontSize: '0.68rem', fontFamily: T.fontMono, color: T.textDim, marginBottom: '0.35rem' }}>DEMOGRAFI</div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: T.text, lineHeight: 1.5 }}>{tm.demografi || '—'}</p>
          </div>
          <div style={{ background: T.surface3, borderRadius: 8, padding: '0.85rem' }}>
            <div style={{ fontSize: '0.68rem', fontFamily: T.fontMono, color: T.textDim, marginBottom: '0.35rem' }}>PSIKOGRAFI</div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: T.text, lineHeight: 1.5 }}>{tm.psikografi || '—'}</p>
          </div>
        </div>
        {tm.fb_interest_targeting?.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ fontSize: '0.68rem', fontFamily: T.fontMono, color: T.textDim, marginBottom: '0.4rem' }}>FB INTEREST TARGETING</div>
            <TagList items={tm.fb_interest_targeting} />
          </div>
        )}
      </div>

      <Divider />

      {/* Pain Point + Decision Trigger side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div style={{ background: T.surface3, borderRadius: 8, padding: '0.85rem', borderLeft: `3px solid ${c}` }}>
          <div style={{ fontSize: '0.68rem', fontFamily: T.fontMono, color: c, marginBottom: '0.4rem' }}>PAIN POINT</div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: T.text, fontWeight: 600, marginBottom: '0.35rem' }}>{cp.pain_point_utama || '—'}</p>
          <p style={{ margin: 0, fontSize: '0.78rem', color: T.textDim, lineHeight: 1.5 }}>{cp.logika_kenapa_ini_masalah}</p>
        </div>
        <div style={{ background: T.surface3, borderRadius: 8, padding: '0.85rem', borderLeft: `3px solid ${c}` }}>
          <div style={{ fontSize: '0.68rem', fontFamily: T.fontMono, color: c, marginBottom: '0.4rem' }}>DECISION TRIGGER</div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: T.text, fontWeight: 600, marginBottom: '0.35rem' }}>{dt.trigger || '—'}</p>
          <p style={{ margin: 0, fontSize: '0.78rem', color: T.textDim, lineHeight: 1.5 }}>{dt.penjelasan}</p>
        </div>
      </div>

      <Divider />

      {/* FAQ */}
      {data.faq?.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <SectionLabel>FAQ</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {data.faq.map((f, i) => (
              <div key={i} style={{ background: T.surface3, borderRadius: 8, padding: '0.85rem' }}>
                <p style={{ margin: 0, fontSize: '0.83rem', color: T.text, fontWeight: 600 }}>Q: {f.pertanyaan}</p>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: T.textDim, lineHeight: 1.5 }}>A: {f.jawaban}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Objections */}
      {data.objection?.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <SectionLabel>Objection Handling</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {data.objection.map((o, i) => (
              <div key={i} style={{ background: T.surface3, borderRadius: 8, padding: '0.85rem', display: 'flex', gap: '0.75rem' }}>
                <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚡</span>
                <div>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: T.text, fontWeight: 600 }}>{o.objeksi}</p>
                  <p style={{ margin: '0.3rem 0 0', fontSize: '0.82rem', color: T.textDim, lineHeight: 1.5 }}>{o.handling}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insight */}
      {data.insight_untuk_iklan && (
        <div style={{
          padding: '1rem', borderRadius: 8,
          background: `${c}11`, border: `1px solid ${c}33`,
        }}>
          <SectionLabel>Insight Utama untuk Iklan</SectionLabel>
          <p style={{ margin: 0, fontSize: '0.88rem', color: T.text, lineHeight: 1.6 }}>{data.insight_untuk_iklan}</p>
        </div>
      )}
    </div>
  )
}

// ─── BOMBOM OUTPUT ──────────────────────────────────────────
function BombomCard({ data }) {
  const c = T.agents.bombom.color
  const [active, setActive] = useState(0)
  const ads = data.konsep_ads || []

  if (!ads.length) return <p style={{ color: T.textDim }}>Tidak ada output.</p>

  return (
    <div>
      {/* Tab selector */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '1.25rem' }}>
        {ads.map((ad, i) => (
          <button key={i} type="button" onClick={() => setActive(i)} style={{
            padding: '0.3rem 0.7rem', borderRadius: 20, border: 'none',
            background: active === i ? c : T.surface3,
            color: active === i ? '#000' : T.textDim,
            fontSize: '0.75rem', fontFamily: T.fontMono, cursor: 'pointer',
            fontWeight: active === i ? 700 : 400,
          }}>
            #{ad.nomor || i + 1}
          </button>
        ))}
      </div>

      {/* Active ad */}
      {ads[active] && (
        <div>
          {/* Hook — hero */}
          <div style={{
            padding: '1.5rem', borderRadius: 10, marginBottom: '1rem',
            background: `${c}11`, border: `1px solid ${c}44`, textAlign: 'center',
          }}>
            <div style={{ fontSize: '0.65rem', fontFamily: T.fontMono, color: c, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.5rem' }}>HOOK</div>
            <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: T.text, lineHeight: 1.3 }}>"{ads[active].hook}"</p>
          </div>

          {/* Visual idea */}
          <div style={{ background: T.surface3, borderRadius: 8, padding: '1rem', marginBottom: '0.75rem' }}>
            <SectionLabel>🎨 Visual Idea</SectionLabel>
            <p style={{ margin: 0, fontSize: '0.87rem', color: T.text, lineHeight: 1.6 }}>{ads[active].visual_idea}</p>
          </div>

          {/* Primary text */}
          <div style={{ background: T.surface3, borderRadius: 8, padding: '1rem', marginBottom: '0.75rem' }}>
            <SectionLabel>📝 Primary Text (Body Ads)</SectionLabel>
            <p style={{ margin: 0, fontSize: '0.87rem', color: T.text, lineHeight: 1.6 }}>{ads[active].primary_text}</p>
          </div>

          {/* Headline */}
          <div style={{ background: T.surface3, borderRadius: 8, padding: '1rem' }}>
            <SectionLabel>🏷 Headline (bawah visual)</SectionLabel>
            <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: T.text }}>{ads[active].headline}</p>
          </div>
        </div>
      )}

      {/* Catatan produksi */}
      {data.catatan_produksi && (
        <>
          <Divider />
          <div style={{ padding: '0.85rem', borderRadius: 8, background: `${c}11`, border: `1px solid ${c}33` }}>
            <SectionLabel>Catatan Produksi</SectionLabel>
            <p style={{ margin: 0, fontSize: '0.85rem', color: T.text, lineHeight: 1.6 }}>{data.catatan_produksi}</p>
          </div>
        </>
      )}
    </div>
  )
}

// ─── LUNA OUTPUT ────────────────────────────────────────────
function LunaCard({ data }) {
  const c = T.agents.luna.color
  const [active, setActive] = useState(0)
  const videos = data.konsep_video || []

  if (!videos.length) return <p style={{ color: T.textDim }}>Tidak ada output.</p>
  const vid = videos[active]

  return (
    <div>
      {/* Tab */}
      <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {videos.map((v, i) => (
          <button key={i} type="button" onClick={() => setActive(i)} style={{
            padding: '0.3rem 0.7rem', borderRadius: 20, border: 'none',
            background: active === i ? c : T.surface3,
            color: active === i ? '#fff' : T.textDim,
            fontSize: '0.75rem', fontFamily: T.fontMono, cursor: 'pointer',
            fontWeight: active === i ? 700 : 400,
          }}>
            Konsep {v.nomor || i + 1}
          </button>
        ))}
      </div>

      {vid && (
        <div>
          {/* Angle */}
          <div style={{ padding: '0.85rem 1rem', borderRadius: 8, background: `${c}11`, border: `1px solid ${c}44`, marginBottom: '1rem' }}>
            <SectionLabel>Angle Konten</SectionLabel>
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: T.text }}>{vid.angle_konten}</p>
          </div>

          {/* Timeline */}
          <SectionLabel>Storyboard</SectionLabel>
          <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
            {/* Hook scene */}
            {vid.hook_scene && (
              <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
                <div style={{ position: 'absolute', left: -24, top: 8, width: 10, height: 10, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}` }} />
                <div style={{ position: 'absolute', left: -20, top: 18, width: 2, height: 'calc(100% + 4px)', background: T.border }} />
                <div style={{ background: T.surface3, borderRadius: 8, padding: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', fontFamily: T.fontMono, color: c, fontWeight: 700 }}>HOOK SCENE</span>
                    <Badge color={c}>{vid.hook_scene.durasi}</Badge>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: T.text, lineHeight: 1.5 }}>{vid.hook_scene.deskripsi}</p>
                  {vid.hook_scene.dialog_atau_teks && (
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: T.textDim, fontStyle: 'italic' }}>"{vid.hook_scene.dialog_atau_teks}"</p>
                  )}
                  {vid.hook_scene.visual && <Badge color={T.textDim}>{vid.hook_scene.visual}</Badge>}
                </div>
              </div>
            )}

            {/* Body scenes */}
            {vid.body_scenes?.map((scene, i) => (
              <div key={i} style={{ position: 'relative', marginBottom: '0.75rem' }}>
                <div style={{ position: 'absolute', left: -24, top: 8, width: 10, height: 10, borderRadius: '50%', background: T.border, border: `2px solid ${c}` }} />
                {i < (vid.body_scenes.length - 1) && (
                  <div style={{ position: 'absolute', left: -20, top: 18, width: 2, height: 'calc(100% + 4px)', background: T.border }} />
                )}
                <div style={{ background: T.surface3, borderRadius: 8, padding: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', fontFamily: T.fontMono, color: T.textDim }}>{scene.scene}</span>
                    {scene.durasi && <Badge color={T.textDim}>{scene.durasi}</Badge>}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: T.text, lineHeight: 1.5 }}>{scene.isi}</p>
                  {scene.visual && <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: T.textDim }}>{scene.visual}</p>}
                </div>
              </div>
            ))}
          </div>

          {/* Kebutuhan produksi */}
          {vid.kebutuhan_produksi && (
            <>
              <Divider />
              <SectionLabel>Kebutuhan Produksi</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                {[
                  ['🎭 Talent', vid.kebutuhan_produksi.talent],
                  ['📍 Lokasi', vid.kebutuhan_produksi.lokasi],
                  ['🎬 Props', vid.kebutuhan_produksi.props],
                  ['⏱ Durasi', vid.kebutuhan_produksi.estimasi_durasi_total],
                ].map(([label, val]) => val ? (
                  <div key={label} style={{ background: T.surface3, borderRadius: 8, padding: '0.7rem 0.85rem' }}>
                    <div style={{ fontSize: '0.68rem', fontFamily: T.fontMono, color: T.textDim, marginBottom: '0.3rem' }}>{label}</div>
                    <p style={{ margin: 0, fontSize: '0.83rem', color: T.text }}>{val}</p>
                  </div>
                ) : null)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── HAGEN OUTPUT ───────────────────────────────────────────
function HagenCard({ data }) {
  const c = T.agents.hagen.color
  const scenes = data.script_breakdown || []

  return (
    <div>
      {scenes.map((scene, i) => (
        <div key={i} style={{ background: T.surface3, borderRadius: 10, padding: '1rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontFamily: T.fontMono, color: c, fontWeight: 700 }}>SCENE {scene.scene_number}</span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {scene.durasi && <Badge color={c}>{scene.durasi}</Badge>}
              {scene.reusable && <Badge color="#4adeaf">reusable</Badge>}
            </div>
          </div>
          <InfoBlock label="Visual Direction" value={scene.visual_direction} />
          {scene.dialog && (
            <div style={{ background: T.surface2, borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem', borderLeft: `3px solid ${c}` }}>
              <SectionLabel>Dialog / Script</SectionLabel>
              <p style={{ margin: 0, fontSize: '0.87rem', color: T.text, lineHeight: 1.6, fontStyle: 'italic' }}>"{scene.dialog}"</p>
            </div>
          )}
          <InfoBlock label="Teks Onscreen" value={scene.teks_onscreen} />
          <InfoBlock label="Audio" value={scene.audio} />
          {scene.catatan_sutradara && (
            <div style={{ padding: '0.6rem 0.85rem', borderRadius: 6, background: `${c}11`, fontSize: '0.8rem', color: T.textDim }}>
              🎬 {scene.catatan_sutradara}
            </div>
          )}
        </div>
      ))}

      {data.heygen_notes && (
        <>
          <Divider />
          <div style={{ padding: '0.85rem', borderRadius: 8, background: `${c}11`, border: `1px solid ${c}33` }}>
            <SectionLabel>HeyGen Notes</SectionLabel>
            <p style={{ margin: 0, fontSize: '0.85rem', color: T.text, lineHeight: 1.6 }}>{data.heygen_notes}</p>
          </div>
        </>
      )}

      {data.production_checklist?.length > 0 && (
        <>
          <Divider />
          <SectionLabel>Production Checklist</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {data.production_checklist.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', color: T.text }}>
                <span style={{ color: c }}>□</span> {item}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── RANA OUTPUT ────────────────────────────────────────────
function RanaCard({ data, agentKey }) {
  const c = T.agents.rana.color

  // Rana validate hara
  if (agentKey === 'rana_validate') {
    return (
      <div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.4rem 1rem', borderRadius: 20, marginBottom: '1rem',
          background: data.status === 'approved' ? 'rgba(74,222,175,0.15)' : 'rgba(249,115,22,0.15)',
          border: `1px solid ${data.status === 'approved' ? '#4adeaf' : '#f97316'}`,
          fontSize: '0.78rem', fontFamily: T.fontMono, fontWeight: 700,
          color: data.status === 'approved' ? '#4adeaf' : '#f97316',
        }}>
          {data.status === 'approved' ? '✓ APPROVED' : '⚠ REVISION NEEDED'}
        </div>
        <InfoBlock label="Penilaian" value={data.penilaian} />
        {data.yang_perlu_diperbaiki && data.yang_perlu_diperbaiki !== 'tidak ada' && (
          <InfoBlock label="Yang Perlu Diperbaiki" value={data.yang_perlu_diperbaiki} />
        )}
        {data.insight_kunci_untuk_bombom_dan_luna && (
          <div style={{ padding: '1rem', borderRadius: 8, background: `${c}11`, border: `1px solid ${c}33` }}>
            <SectionLabel>Insight Kunci → Bombom & Luna</SectionLabel>
            <p style={{ margin: 0, fontSize: '0.87rem', color: T.text, lineHeight: 1.6 }}>{data.insight_kunci_untuk_bombom_dan_luna}</p>
          </div>
        )}
      </div>
    )
  }

  // Rana final decision
  return (
    <div>
      {/* Summary */}
      {data.summary_untuk_user && (
        <div style={{
          padding: '1.25rem', borderRadius: 10, marginBottom: '1.25rem',
          background: `${c}11`, border: `1px solid ${c}44`,
        }}>
          <SectionLabel>Ringkasan untuk Kamu</SectionLabel>
          <p style={{ margin: 0, fontSize: '0.92rem', color: T.text, lineHeight: 1.7 }}>{data.summary_untuk_user}</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ background: T.surface3, borderRadius: 8, padding: '0.85rem' }}>
          <SectionLabel>Top Image Ads</SectionLabel>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {data.top_image_ads?.map(n => <Badge key={n} color={T.agents.bombom.color}>#{n}</Badge>)}
          </div>
        </div>
        <div style={{ background: T.surface3, borderRadius: 8, padding: '0.85rem' }}>
          <SectionLabel>Top Video Concepts</SectionLabel>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {data.top_video_concepts?.map(n => <Badge key={n} color={T.agents.luna.color}>Konsep {n}</Badge>)}
          </div>
        </div>
      </div>

      <InfoBlock label="Alasan Pilihan" value={data.alasan_pilihan} />

      {data.butuh_human_review?.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <SectionLabel>Perlu Human Review</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {data.butuh_human_review.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.6rem', fontSize: '0.84rem', color: T.text }}>
                <span style={{ color: '#f97316' }}>⚠</span> {item}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.next_steps?.length > 0 && (
        <>
          <Divider />
          <SectionLabel>Next Steps</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {data.next_steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', fontSize: '0.85rem', color: T.text }}>
                <span style={{ color: c, fontFamily: T.fontMono, fontSize: '0.75rem', paddingTop: 2, flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
                {step}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── MAIN EXPORT ────────────────────────────────────────────

/**
 * AgentOutputCard
 *
 * Props:
 *   agent     — 'hara' | 'bombom' | 'luna' | 'hagen' | 'rana_validate' | 'rana_final'
 *   rawOutput — string (JSON dari backend) atau parsed object
 *   loading   — boolean (tampilkan skeleton)
 */
export function formatAsPlainText(agent, data) {
  if (!data) return ''
  // Normalize: 'rana_validate', 'rana_final', 'hara_output', dll → key pendek
  const key = (agent || '').toLowerCase().split(/[_-]/)[0]

  if (key === 'hara') {
    const tm = data.target_market || {}
    const cp = data.core_problem || {}
    const dt = data.decision_trigger || {}
    const faq = (data.faq || []).map(f => `  T: ${f.pertanyaan}\n  J: ${f.jawaban}`).join('\n\n')
    const obj = (data.objection || []).map(o => `  ⚡ ${o.objeksi}\n     ${o.handling}`).join('\n\n')
    return [
      '== TARGET MARKET ==',
      `Demografi: ${tm.demografi || ''}`,
      `Psikografi: ${tm.psikografi || ''}`,
      `FB Targeting: ${(tm.fb_interest_targeting || []).join(', ')}`,
      '',
      '== PAIN POINT ==',
      cp.pain_point_utama || '',
      cp.logika_kenapa_ini_masalah || '',
      '',
      '== DECISION TRIGGER ==',
      dt.trigger || '',
      dt.penjelasan || '',
      '',
      '== FAQ ==',
      faq,
      '',
      '== OBJECTION HANDLING ==',
      obj,
      '',
      '== INSIGHT UNTUK IKLAN ==',
      data.insight_untuk_iklan || '',
    ].filter(v => v !== undefined && v !== '').join('\n')
  }

  if (key === 'bombom') {
    return (data.konsep_ads || []).map(ad =>
      `--- Konsep #${ad.nomor} ---\nHook: ${ad.hook || ''}\nVisual: ${ad.visual_idea || ''}\nPrimary Text: ${ad.primary_text || ''}\nHeadline: ${ad.headline || ''}`
    ).join('\n\n') + (data.catatan_produksi ? `\n\nCatatan Produksi:\n${data.catatan_produksi}` : '')
  }

  if (key === 'luna') {
    return (data.konsep_video || []).map(v => {
      const body = (v.body_scenes || []).map(s => `  ${s.scene} (${s.durasi}): ${s.isi}`).join('\n')
      const kp = v.kebutuhan_produksi || {}
      return [
        `--- Konsep Video ${v.nomor} ---`,
        `Angle: ${v.angle_konten || ''}`,
        `Hook (${v.hook_scene?.durasi || ''}): ${v.hook_scene?.deskripsi || ''}`,
        `Dialog: ${v.hook_scene?.dialog_atau_teks || ''}`,
        'Body Scenes:',
        body,
        `Produksi — Talent: ${kp.talent || ''} | Lokasi: ${kp.lokasi || ''} | Durasi: ${kp.estimasi_durasi_total || ''}`,
      ].join('\n')
    }).join('\n\n')
  }

  if (key === 'rana') {
    const alasan = typeof data.alasan_pilihan === 'string'
      ? data.alasan_pilihan
      : JSON.stringify(data.alasan_pilihan, null, 2)
    return [
      data.summary_untuk_user && `Ringkasan:\n${data.summary_untuk_user}`,
      data.top_image_ads && `Image Ads Terpilih: ${data.top_image_ads.map(n => `#${n}`).join(', ')}`,
      data.top_video_concepts && `Video Terpilih: Konsep ${data.top_video_concepts.join(', ')}`,
      alasan && `\nAlasan:\n${alasan}`,
      data.next_steps?.length && `\nNext Steps:\n${data.next_steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    ].filter(Boolean).join('\n')
  }

  if (key === 'hagen') {
    const scenes = data.script_breakdown || []
    const sceneText = scenes.map(s =>
      [
        `--- Scene ${s.scene_number || ''} (${s.durasi || ''}) ---`,
        s.visual_direction ? `Visual: ${s.visual_direction}` : null,
        s.dialog ? `Dialog: "${s.dialog}"` : null,
        s.teks_onscreen ? `Teks Onscreen: ${s.teks_onscreen}` : null,
        s.audio ? `Audio: ${s.audio}` : null,
        s.catatan_sutradara ? `Catatan: ${s.catatan_sutradara}` : null,
        s.reusable !== undefined ? `Reusable: ${s.reusable ? 'Ya' : 'Tidak'}` : null,
      ].filter(Boolean).join('\n')
    ).join('\n\n')
    return [
      sceneText,
      data.heygen_notes ? `\n== HEYGEN NOTES ==\n${data.heygen_notes}` : null,
      data.production_checklist?.length
        ? `\n== PRODUCTION CHECKLIST ==\n${data.production_checklist.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
        : null,
    ].filter(Boolean).join('\n')
  }

  // Fallback: flatten ke teks readable, bukan JSON mentah
  return Object.entries(data)
    .map(([k, v]) => `${k}:\n${typeof v === 'object' ? JSON.stringify(v, null, 2) : v}`)
    .join('\n\n')
}

export default function AgentOutputCard({ agent, rawOutput, loading = false }) {
  const [expanded, setExpanded] = useState(true)

  const agentKey = agent === 'rana_validate' || agent === 'rana_final' ? 'rana' : agent
  const meta = T.agents[agentKey] || T.agents.rana
  const c = meta.color

  // Parse JSON
  let parsed = null
  let parseError = false
  if (rawOutput) {
    if (typeof rawOutput === 'object') {
      parsed = rawOutput
    } else {
      try {
        // Strip markdown code fences if present
        const clean = rawOutput.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
        parsed = JSON.parse(clean)
      } catch {
        parseError = true
      }
    }
  }

  return (
    <div style={{
      fontFamily: T.fontBody,
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: '1rem',
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 1.25rem', cursor: 'pointer',
          borderBottom: expanded ? `1px solid ${T.border}` : 'none',
          background: T.surface2,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}` }} />
          <span style={{ fontSize: '0.78rem', fontFamily: T.fontMono, color: c, fontWeight: 700, letterSpacing: '0.08em' }}>
            {meta.label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ color: T.textDim, fontSize: '0.9rem' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: '1.25rem' }}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {[80, 60, 90, 50].map((w, i) => (
                <div key={i} style={{
                  height: 12, borderRadius: 6, width: `${w}%`,
                  background: `linear-gradient(90deg, ${T.surface3} 25%, ${T.border} 50%, ${T.surface3} 75%)`,
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s infinite',
                }} />
              ))}
              <style>{`@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
            </div>
          )}

          {!loading && parseError && (
            <div style={{ color: '#f97316', fontSize: '0.85rem', lineHeight: 1.6 }}>
              ⚠ Output agent tidak bisa ditampilkan. Coba jalankan ulang.
            </div>
          )}

          {!loading && parsed && (
            <>
              {agentKey === 'hara' && <HaraCard data={parsed} />}
              {agentKey === 'bombom' && <BombomCard data={parsed} />}
              {agentKey === 'luna' && <LunaCard data={parsed} />}
              {agentKey === 'hagen' && <HagenCard data={parsed} />}
              {agentKey === 'rana' && <RanaCard data={parsed} agentKey={agent} />}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', paddingTop: '1rem', borderTop: `1px solid ${T.border}` }}>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(formatAsPlainText(agent, parsed))}
                  style={{
                    padding: '0.4rem 0.9rem', borderRadius: 6,
                    border: `1px solid ${T.border}`, background: T.surface3,
                    color: T.textDim, fontSize: '0.75rem', fontFamily: T.fontMono, cursor: 'pointer',
                  }}
                >
                  Copy teks
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([formatAsPlainText(agent, parsed)], { type: 'text/plain' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url; a.download = `${agent}-output.txt`; a.click()
                    URL.revokeObjectURL(url)
                  }}
                  style={{
                    padding: '0.4rem 0.9rem', borderRadius: 6,
                    border: `1px solid ${T.border}`, background: T.surface3,
                    color: T.textDim, fontSize: '0.75rem', fontFamily: T.fontMono, cursor: 'pointer',
                  }}
                >
                  Download .txt
                </button>
              </div>
            </>
          )}

          {!loading && !rawOutput && (
            <p style={{ margin: 0, color: T.textDim, fontSize: '0.85rem' }}>Menunggu output dari agent...</p>
          )}
        </div>
      )}
    </div>
  )
}

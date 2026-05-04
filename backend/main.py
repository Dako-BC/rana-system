"""
RANA Multi-Agent Marketing System — Backend
Stack: FastAPI + LangGraph + Claude claude-haiku-4-5-20251001 (gratis via Anthropic free tier)
Deploy: Railway / Render (free tier)
"""

import os
import re
import json
import uuid
import asyncio
import logging
from pathlib import Path
from typing import Any, Optional, Annotated
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# LangGraph
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

# Anthropic
import anthropic
from anthropic import APIError
from anthropic.types.text_block import TextBlock

load_dotenv(Path(__file__).resolve().parent / ".env")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Rana Multi-Agent System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ganti dengan domain frontend saat production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
if not anthropic_api_key:
    raise RuntimeError(
        "ANTHROPIC_API_KEY tidak ditemukan. Pastikan backend/.env ada dan file tersebut dimuat, atau set env var ini sebelum menjalankan backend."
    )

api_key = os.environ.get("ANTHROPIC_API_KEY")
if not api_key:
    raise RuntimeError(
        "ANTHROPIC_API_KEY tidak ditemukan. "
        "Pastikan variable sudah diset di Railway Variables."
    )
client = anthropic.Anthropic(api_key=api_key)

# ─────────────────────────────────────────────
# MEMORY STORE (in-memory, ganti Redis untuk prod)
# ─────────────────────────────────────────────
session_memory: dict[str, list] = {}
rana_learning: list[dict] = []  # feedback log lintas sesi


def get_memory(session_id: str) -> list:
    return session_memory.get(session_id, [])


def save_memory(session_id: str, messages: list):
    session_memory[session_id] = messages[-20:]  # keep last 20


# Agent State
class AgentState(TypedDict):
    session_id: str
    product_context: str
    uploaded_files: list[str]
    hara_output: Optional[str]
    bombom_output: Optional[str]
    luna_output: Optional[str]
    hagen_output: Optional[str]
    rana_decision: Optional[str]
    current_step: str
    messages: Annotated[list, add_messages]
    run_hagen: bool


StateUpdate = dict[str, Any]


# ─────────────────────────────────────────────
# SYSTEM PROMPTS
# ─────────────────────────────────────────────
RANA_SYSTEM = """Kamu adalah Rana, supervisor utama sistem marketing AI.

TUGASMU:
- Memberikan konteks yang jelas ke setiap agent
- Memvalidasi semua output (Hara, Bombom, Luna)
- Menilai kualitas output: bagus / perlu revisi / tolak
- Memutuskan output mana yang dipakai
- Menentukan apakah butuh human review

LEARNING CONTEXT dari sesi sebelumnya:
{learning_context}

PRINSIP:
- Semua keputusan berbasis pain point & decision trigger
- Output harus actionable, bukan teori
- Jika ragu, minta clarifikasi ke user
OUTPUT `summary_untuk_user` — WAJIB DIISI:
- Field `summary_untuk_user` di setiap JSON output Rana TIDAK boleh kosong, null, atau berisi placeholder.
- Tulis dalam Bahasa Indonesia yang santai dan mudah dipahami oleh non-marketer.
- Struktur ringkasan: (1) apa yang sudah dikerjakan agent, (2) insight atau keputusan paling penting, (3) apa yang perlu dilakukan user selanjutnya.
- Maksimal 5 kalimat. Hindari jargon teknis marketing.
- Contoh yang BAIK: "Hara sudah menemukan bahwa target utamamu adalah profesional muda yang takut tampil di depan umum. Bombom dan Luna sudah membuat 10 konsep image ads dan 4 konsep video. Rana memilih 3 image ads terbaik yang fokus pada transformasi percaya diri. Kamu perlu review pilihan ini dan kasih tahu tim produksi mana yang mau diprioritaskan."
- Contoh yang BURUK: "Ringkasan hasil tersedia." atau summary yang hanya mengulang nama agent tanpa insight.

Respond dalam Bahasa Indonesia. Format output kamu selalu dalam JSON.

VALIDASI BRAND SAFETY — wajib dicek setiap review output Bombom & Luna:
- Tolak atau flag konsep yang positioning-nya "vs dermatologi" atau "skip dokter" — GlowUp adalah COMPLEMENT, bukan pengganti treatment medis
- Tolak klaim superlatif yang tidak ada datanya ("terbaik", "satu-satunya", dll)
- Flag konsep yang bisa backfire secara reputasi brand (terlalu agresif ke kompetitor atau industri lain)
- Dalam keputusan final, jelaskan ALASAN spesifik kenapa konsep di-reject bukan hanya "tidak sesuai\""""

HARA_SYSTEM = """Kamu adalah Hara, research agent marketing yang expert.

TUGASMU: Analisis mendalam target market untuk produk yang diberikan.

OUTPUT WAJIB dalam JSON dengan struktur ini:
{
  "target_market": {
    "demografi": "...",
    "psikografi": "...",
    "fb_interest_targeting": ["interest1", "interest2", "interest3"]
  },
  "core_problem": {
    "pain_point_utama": "...",
    "logika_kenapa_ini_masalah": "..."
  },
  "decision_trigger": {
    "trigger": "...",
    "penjelasan": "..."
  },
  "faq": [
    {"pertanyaan": "...", "jawaban": "..."}
  ],
  "objection": [
    {"objeksi": "...", "handling": "..."}
  ],
  "insight_untuk_iklan": "..."
}

Berikan data yang spesifik, konkret, dan bisa langsung dipakai untuk iklan.
Sertakan LOGIKA di balik setiap insight.

NICHE AWARENESS:
- Baca `product_context` yang diberikan user dengan seksama sebelum menganalisis.
- Sistem ini tidak terbatas pada produk kecantikan. Produk bisa berupa kursus, layanan, SaaS, coaching, atau kategori lainnya.
- Jika produk adalah kursus atau program pelatihan (misal: public speaking course, business coaching, online class), sesuaikan:
  - Pain point: fokus pada hambatan karir, rasa tidak percaya diri, atau skill gap — bukan masalah kulit
  - Decision trigger: transformasi profesional, pengakuan sosial, peluang kerja/bisnis
  - Larangan angka spesifik tetap berlaku; klaim manfaat harus sesuai konteks produk yang diberikan
- Jangan asumsikan niche produk. Inferensikan dari product_context.
"""

BOMBOM_SYSTEM = """Kamu adalah Bombom, spesialis static ads / image hook.

INPUT: Insight dari Hara yang sudah divalidasi Rana.

TUGASMU: Buat 10 konsep single image ads yang powerful.

OUTPUT dalam JSON:
{
  "konsep_ads": [
    {
      "nomor": 1,
      "visual_idea": "Deskripsi visual detail yang bisa langsung diproduksi",
      "hook": "Headline utama di visual (max 10 kata, stopping power)",
      "primary_text": "Teks body FB ads (2-3 kalimat, fokus pain point)",
      "headline": "Headline di bawah visual FB ads"
    }
  ],
  "catatan_produksi": "Tips umum untuk eksekusi visual"
}

FOKUS: Stopping power + relevansi pain point. Buat orang BERHENTI scroll.

LARANGAN KERAS:
- Jangan pernah mengarang angka spesifik seperti "7,543 women" atau "89% users"
- Gunakan placeholder seperti "ribuan wanita", "growing community", atau "[masukkan data real]"
- Statistik hanya boleh dipakai kalau ada di konteks produk yang diberikan user
- Jangan gunakan frasa "skip dokter", "jangan pilih prosedur invasif", atau framing apapun yang memposisikan produk VERSUS treatment medis — produk ini COMPLEMENT, bukan pengganti
- Jangan gunakan klaim usia spesifik seperti "5 tahun lebih muda" atau "10 tahun lebih muda" — ganti dengan benefit konkret seperti "kulit lebih firm", "fine lines berkurang", "tampil lebih segar & glowing"
- Jangan gunakan framing atau visual yang spesifik untuk produk kecantikan jika produk yang diberikan bukan produk kecantikan

NICHE AWARENESS:
- Baca `product_context` yang diberikan user dengan seksama sebelum menganalisis.
- Sistem ini tidak terbatas pada produk kecantikan. Produk bisa berupa kursus, layanan, SaaS, coaching, atau kategori lainnya.
- Jika produk adalah kursus atau program pelatihan (misal: public speaking course, business coaching, online class), sesuaikan:
  - Pain point: fokus pada hambatan karir, rasa tidak percaya diri, atau skill gap — bukan masalah kulit
  - Decision trigger: transformasi profesional, pengakuan sosial, peluang kerja/bisnis
  - Larangan angka spesifik tetap berlaku; klaim manfaat harus sesuai konteks produk yang diberikan
- Jangan asumsikan niche produk. Inferensikan dari product_context.
"""

LUNA_SYSTEM = """Kamu adalah Luna, spesialis video concept ads.

INPUT: Insight dari Hara yang sudah divalidasi Rana.

TUGASMU: Buat konsep video ads yang kuat.

OUTPUT dalam JSON:
{
  "konsep_video": [
    {
      "nomor": 1,
      "angle_konten": "...",
      "hook_scene": {
        "durasi": "0-3 detik",
        "deskripsi": "Apa yang terjadi di scene pembuka (wajah/orang)",
        "dialog_atau_teks": "...",
        "visual": "real shoot / ilustrasi / animasi"
      },
      "body_scenes": [
        {
          "scene": "Scene 2",
          "durasi": "3-10 detik",
          "isi": "social proof / narasi / ilustrasi produk",
          "visual": "..."
        }
      ],
      "kebutuhan_produksi": {
        "talent": "ya/tidak — deskripsi",
        "lokasi": "...",
        "props": "...",
        "estimasi_durasi_total": "..."
      }
    }
  ]
}

CATATAN PRODUKSI:
- Jangan gunakan framing atau visual yang spesifik untuk produk kecantikan jika produk yang diberikan bukan produk kecantikan.

NICHE AWARENESS:
- Baca `product_context` yang diberikan user dengan seksama sebelum menganalisis.
- Sistem ini tidak terbatas pada produk kecantikan. Produk bisa berupa kursus, layanan, SaaS, coaching, atau kategori lainnya.
- Jika produk adalah kursus atau program pelatihan (misal: public speaking course, business coaching, online class), sesuaikan:
  - Pain point: fokus pada hambatan karir, rasa tidak percaya diri, atau skill gap — bukan masalah kulit
  - Decision trigger: transformasi profesional, pengakuan sosial, peluang kerja/bisnis
  - Larangan angka spesifik tetap berlaku; klaim manfaat harus sesuai konteks produk yang diberikan
- Jangan asumsikan niche produk. Inferensikan dari product_context.
"""

HAGEN_SYSTEM = """Kamu adalah Hagen, execution agent untuk video production.

INPUT: Konsep video dari Luna yang sudah disetujui Rana.

TUGASMU: Breakdown script detail per scene untuk eksekusi.

OUTPUT dalam JSON:
{
  "script_breakdown": [
    {
      "scene_number": 1,
      "durasi": "...",
      "visual_direction": "Detail kamera, angle, komposisi",
      "dialog": "Script persis yang diucapkan",
      "teks_onscreen": "Text overlay jika ada",
      "audio": "musik / sfx / voiceover",
      "catatan_sutradara": "...",
      "reusable": true/false
    }
  ],
  "heygen_notes": "Jika pakai HeyGen: avatar yang cocok, voice setting, dll",
  "production_checklist": ["item1", "item2"]
}"""


# ─────────────────────────────────────────────
# HELPER: Call Claude
# ─────────────────────────────────────────────
def extract_text_from_message(message) -> str:
    text_blocks = []
    for block in getattr(message, "content", []):
        if getattr(block, "type", None) == "text" and hasattr(block, "text"):
            text_blocks.append(block.text)
        elif isinstance(block, TextBlock):
            text_blocks.append(block.text)
    if text_blocks:
        return "".join(text_blocks)
    return str(message)


def extract_message_content(message) -> str:
    if isinstance(message, dict):
        return message.get("content", "")
    if hasattr(message, "content"):
        return getattr(message, "content")
    if hasattr(message, "get"):
        try:
            return message.get("content", "")
        except Exception:
            pass
    return str(message)


def call_claude(system: str, user_message: str, max_tokens: int = 2000) -> str:
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",  # gratis tier friendly
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_message}]
    )
    return extract_text_from_message(response)


def call_claude_stream(system: str, user_message: str, max_tokens: int = 2000):
    """Generator untuk streaming response"""
    with client.messages.stream(
        model="claude-haiku-4-5-20251001",
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_message}]
    ) as stream:
        for text in stream.text_stream:
            yield text


def strip_json_fence(text: str) -> str:
    """Hapus markdown code fence ```json ... ``` dari output LLM."""
    if not isinstance(text, str):
        return text
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    return text.strip()


# ─────────────────────────────────────────────
# NODES — setiap agent adalah satu node
# ─────────────────────────────────────────────
def rana_init(state: AgentState) -> StateUpdate:
    """Rana menerima konteks dan siapkan instruksi untuk Hara"""
    learning = "\n".join([
        f"- {item['insight']}" for item in rana_learning[-5:]
    ]) or "Belum ada learning dari sesi sebelumnya."

    system = RANA_SYSTEM.format(learning_context=learning)

    file_context = ""
    if state.get("uploaded_files"):
        file_context = f"\n\nKONTEN FILE YANG DIUPLOAD:\n{chr(10).join(state['uploaded_files'])}"

    prompt = f"""Konteks produk dari user:
{state['product_context']}{file_context}

Tugas: Buat ringkasan konteks yang akan dikirim ke Hara untuk riset.
Tentukan juga: apakah ada info yang kurang? (jawab dalam JSON)

Format:
{{
  "konteks_untuk_hara": "...",
  "info_tambahan_dibutuhkan": "tidak ada / [sebutkan]",
  "catatan_rana": "..."
}}"""

    result = call_claude(system, prompt)
    return {"current_step": "hara", "messages": [{"role": "assistant", "content": f"[RANA] {result}"}]}


def hara_research(state: AgentState) -> StateUpdate:
    """Hara melakukan riset market"""
    rana_msg = ""
    for msg in reversed(state.get("messages", [])):
        content = extract_message_content(msg)
        if "[RANA]" in str(content):
            rana_msg = content
            break

    prompt = f"""Konteks dari Rana:
{rana_msg}

Produk: {state['product_context']}

Lakukan riset mendalam dan hasilkan analisis market yang komprehensif."""

    result = call_claude(HARA_SYSTEM, prompt, max_tokens=4000)
    cleaned_result = strip_json_fence(result)
    return {"hara_output": cleaned_result, "current_step": "rana_validates_hara",
            "messages": [{"role": "assistant", "content": f"[HARA] {cleaned_result}"}]}


def rana_validate_hara(state: AgentState) -> StateUpdate:
    """Rana memvalidasi output Hara"""
    learning = "\n".join(
        [f"- {item['insight']}" for item in rana_learning[-5:]]) or "Belum ada."
    system = RANA_SYSTEM.format(learning_context=learning)

    prompt = f"""Output dari Hara(Research Agent):
{state['hara_output']}

Validasi output ini. Apakah insight cukup kuat untuk dijadikan dasar iklan?

Format JSON:
{{
  "status": "approved" / "revision_needed",
  "penilaian": "...",
  "yang_perlu_diperbaiki": "tidak ada / [sebutkan]",
  "insight_kunci_untuk_bombom_dan_luna": "Ringkasan insight terpenting dalam 200 kata"
}}"""

    result = call_claude(system, prompt)
    return {"current_step": "creative_agents",
            "messages": [{"role": "assistant", "content": f"[RANA VALIDATES HARA] {result}"}]}


def bombom_create_ads(state: AgentState) -> StateUpdate:
    """Bombom membuat konsep image ads"""
    prompt = f"""Insight dari Hara(sudah divalidasi Rana):
{state['hara_output']}

Produk: {state['product_context']}

Buat 10 konsep image ads yang powerful dengan stopping power tinggi."""

    result = call_claude(BOMBOM_SYSTEM, prompt, max_tokens=4000)
    cleaned_result = strip_json_fence(result)
    return {"bombom_output": cleaned_result,
            "messages": [{"role": "assistant", "content": f"[BOMBOM] {cleaned_result}"}]}


def luna_create_video(state: AgentState) -> StateUpdate:
    """Luna membuat konsep video"""
    prompt = f"""Insight dari Hara(sudah divalidasi Rana):
{state['hara_output']}

Produk: {state['product_context']}

Buat 3-5 konsep video ads dengan angle yang beragam."""

    result = call_claude(LUNA_SYSTEM, prompt, max_tokens=4000)
    cleaned_result = strip_json_fence(result)
    return {"luna_output": cleaned_result,
            "messages": [{"role": "assistant", "content": f"[LUNA] {cleaned_result}"}]}


def rana_final_decision(state: AgentState) -> StateUpdate:
    """Rana membuat keputusan final"""
    learning = "\n".join(
        [f"- {item['insight']}" for item in rana_learning[-5:]]) or "Belum ada."
    system = RANA_SYSTEM.format(learning_context=learning)

    prompt = f"""Output dari Bombom(Image Ads):
{state.get('bombom_output', 'Tidak ada')}

Output dari Luna(Video Concept):
{state.get('luna_output', 'Tidak ada')}

Berikan keputusan final:
1. Konsep image ads mana yang terbaik(pilih top 3)
2. Konsep video mana yang terbaik(pilih top 2)
3. Apa yang butuh human review
4. Rekomendasi next step

Format JSON:
{{
  "top_image_ads": [1, 2, 3],
  "top_video_concepts": [1, 2],
  "alasan_pilihan": "...",
  "butuh_human_review": ["item1", "item2"],
  "next_steps": ["step1", "step2"],
  "run_hagen": true/false,
  "summary_untuk_user": "Ringkasan hasil untuk ditampilkan ke user"
}}"""

    result = call_claude(system, prompt, max_tokens=2000)
    cleaned_result = strip_json_fence(result)

    # Parse untuk cek apakah run_hagen
    run_hagen = False
    try:
        parsed = json.loads(cleaned_result)
        run_hagen = parsed.get("run_hagen", False)
    except:
        pass

    return {"rana_decision": cleaned_result, "run_hagen": run_hagen,
            "current_step": "hagen" if run_hagen else "done",
            "messages": [{"role": "assistant", "content": f"[RANA FINAL] {cleaned_result}"}]}


def hagen_execute(state: AgentState) -> StateUpdate:
    """Hagen membuat script eksekusi(opsional)"""
    prompt = f"""Konsep video terbaik dari Luna:
{state.get('luna_output', '')}

Keputusan Rana:
{state.get('rana_decision', '')}

Buat breakdown script detail untuk produksi."""

    result = call_claude(HAGEN_SYSTEM, prompt, max_tokens=4000)
    cleaned_result = strip_json_fence(result)
    return {"hagen_output": cleaned_result, "current_step": "done",
            "messages": [{"role": "assistant", "content": f"[HAGEN] {cleaned_result}"}]}


def route_after_rana_decision(state: AgentState) -> str:
    if state.get("run_hagen"):
        return "hagen"
    return END


# ─────────────────────────────────────────────
# BUILD GRAPH
# ─────────────────────────────────────────────
def build_graph():
    graph = StateGraph(AgentState)

    graph.add_node("rana_init", rana_init)
    graph.add_node("hara_research", hara_research)
    graph.add_node("rana_validate_hara", rana_validate_hara)
    graph.add_node("bombom_create_ads", bombom_create_ads)
    graph.add_node("luna_create_video", luna_create_video)
    graph.add_node("rana_final_decision", rana_final_decision)
    graph.add_node("hagen_execute", hagen_execute)

    graph.set_entry_point("rana_init")
    graph.add_edge("rana_init", "hara_research")
    graph.add_edge("hara_research", "rana_validate_hara")
    # Bombom dan Luna paralel setelah validasi Hara
    graph.add_edge("rana_validate_hara", "bombom_create_ads")
    graph.add_edge("rana_validate_hara", "luna_create_video")
    graph.add_edge("bombom_create_ads", "rana_final_decision")
    graph.add_edge("luna_create_video", "rana_final_decision")
    graph.add_conditional_edges(
        "rana_final_decision", route_after_rana_decision)
    graph.add_edge("hagen_execute", END)

    return graph.compile()


compiled_graph = build_graph()


# ─────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────
class RunRequest(BaseModel):
    session_id: str
    product_context: str
    run_hagen: bool = False


@app.post("/api/run")
async def run_agents(request: RunRequest):
    """Jalankan full multi-agent pipeline"""
    history = get_memory(request.session_id)

    initial_state: AgentState = {
        "session_id": request.session_id,
        "product_context": request.product_context,
        "uploaded_files": [],
        "hara_output": None,
        "bombom_output": None,
        "luna_output": None,
        "hagen_output": None,
        "rana_decision": None,
        "current_step": "start",
        "messages": history,
        "run_hagen": request.run_hagen,
    }

    try:
        result = await asyncio.to_thread(compiled_graph.invoke, initial_state)
    except APIError as api_err:
        logger.exception("Anthropic API error during run_agents")
        raise HTTPException(
            status_code=502,
            detail=f"Anthropic API error: {api_err.message}. Body: {api_err.body}"
        )
    except Exception as err:
        logger.exception("Unhandled error during run_agents")
        raise HTTPException(
            status_code=500,
            detail=str(err)
        )

    save_memory(request.session_id, result["messages"])

    return {
        "session_id": request.session_id,
        "hara_output": result.get("hara_output"),
        "bombom_output": result.get("bombom_output"),
        "luna_output": result.get("luna_output"),
        "hagen_output": result.get("hagen_output"),
        "rana_decision": result.get("rana_decision"),
        "steps_completed": result.get("current_step"),
    }


@app.post("/api/upload")
async def upload_file(
    session_id: str = Form(...),
    file: UploadFile = File(...)
):
    """Upload brief / dokumen produk"""
    content = await file.read()
    text_content = content.decode("utf-8", errors="ignore")

    if session_id not in session_memory:
        session_memory[session_id] = []

    # Simpan file content ke memory session
    file_entry = f"[FILE: {file.filename}]\n{text_content[:3000]}"

    return {"status": "ok", "file_name": file.filename, "preview": text_content[:200]}


@app.post("/api/feedback")
async def save_feedback(data: dict):
    """Simpan feedback dari user untuk Rana learning"""
    rana_learning.append({
        "session_id": data.get("session_id"),
        "insight": data.get("feedback"),
        "timestamp": str(asyncio.get_event_loop().time())
    })
    return {"status": "saved"}


@app.get("/api/memory/{session_id}")
async def get_session_memory(session_id: str):
    return {"messages": get_memory(session_id)}


@app.delete("/api/memory/{session_id}")
async def clear_session_memory(session_id: str):
    session_memory.pop(session_id, None)
    return {"status": "cleared"}


@app.get("/health")
async def health():
    return {"status": "ok", "agents": ["Rana", "Hara", "Bombom", "Luna", "Hagen"]}

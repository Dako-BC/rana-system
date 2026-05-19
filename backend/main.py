"""
RANA Multi-Agent Marketing System - Backend.
Stack: FastAPI, LangGraph, and Claude.
Deploy: Railway or Render.
"""

import os
import re
import json
import time
import asyncio
import logging
from pathlib import Path
from typing import Any, Optional, Annotated
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

# LangGraph integration.
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

# Anthropic client.
import anthropic
from anthropic import APIError
from anthropic.types import MessageParam

load_dotenv(Path(__file__).resolve().parent / ".env")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Rana Multi-Agent System")

cors_origins = [
    origin.strip()
    for origin in os.environ.get(
        "BACKEND_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Anthropic client is optional; backend can run with other providers (e.g., NVIDIA)
anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
client = anthropic.Anthropic(api_key=anthropic_api_key) if anthropic_api_key else None

# Model configuration.
# NVIDIA NIM API defaults (can be overridden via environment variables)
NVIDIA_DEFAULT_MODEL = os.environ.get("NVIDIA_MODEL", "meta/llama-3.1-8b-instruct")
NVIDIA_BASE_URL = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")

PROVIDER_MODELS = {
    "anthropic": [
        "claude-3-5-haiku-20241022",
        "claude-3-5-sonnet-20241022",
        "claude-opus-4-1-20250805",
    ],
    "grok": [
        "grok-beta",
        "grok-2-latest",
    ],
    "openai": [
        "gpt-4o-mini",
        "gpt-4-turbo",
        "gpt-4o",
    ],
    "gemini": [
        "gemini-2.0-flash",
        "gemini-2.5-flash",
    ],
    "nvidia": [
        NVIDIA_DEFAULT_MODEL
    ],
    "openrouter": [
    "deepseek/deepseek-chat-v3-0324",
    "qwen/qwen3-32b",
    "mistralai/mistral-small-3.1-24b-instruct",
    "openai/gpt-4o-mini",
],
}

DEFAULT_MODEL_BY_PROVIDER = {
    provider: models[0] for provider, models in PROVIDER_MODELS.items()
}

API_KEYS = {
    "anthropic": os.environ.get("ANTHROPIC_API_KEY"),
    "grok": os.environ.get("XAI_API_KEY"),
    "openai": os.environ.get("OPENAI_API_KEY"),
    "gemini": os.environ.get("GOOGLE_GEMINI_API_KEY"),
    "nvidia": os.environ.get("NVIDIA_API_KEY"),
    "openrouter": os.environ.get("OPENROUTER_API_KEY"),
}


def get_model(model: str, provider: str) -> str:
    provider_models = PROVIDER_MODELS.get(provider)
    if not provider_models:
        raise ValueError(f"Unknown provider: {provider}")
    if model not in provider_models:
        raise ValueError(f"Unknown model for {provider}: {model}")
    return model


async def check_anthropic_availability(model: str):
    if not API_KEYS["anthropic"]:
        return {"available": False, "reason": "API key not set"}
    return {"available": True, "quota": "API key set"}


async def check_openai_availability(model: str):
    if not API_KEYS["openai"]:
        return {"available": False, "reason": "API key not set"}
    return {"available": True, "quota": "API key set"}


async def check_grok_availability(model: str):
    if not API_KEYS["grok"]:
        return {"available": False, "reason": "API key not set"}
    return {"available": True, "quota": "API key set"}


async def check_gemini_availability(model: str):
    if not API_KEYS["gemini"]:
        return {"available": False, "reason": "API key not set"}
    return {"available": True, "quota": "API key set"}


async def check_nvidia_availability(model: str):
    if not API_KEYS["nvidia"]:
        return {"available": False, "reason": "API key not set"}
    return {"available": True, "quota": "API key set"}


async def check_openrouter_availability(model: str):
    if not API_KEYS["openrouter"]:
        return {"available": False, "reason": "API key not set"}
    return {"available": True, "quota": "API key set"}


AVAILABILITY_CHECKERS = {
    "anthropic": check_anthropic_availability,
    "grok": check_grok_availability,
    "openai": check_openai_availability,
    "gemini": check_gemini_availability,
    "nvidia": check_nvidia_availability,
    "openrouter": check_openrouter_availability,
}


async def check_provider_model_availability(provider: str, model_name: str):
    model = get_model(model_name, provider)
    checker = AVAILABILITY_CHECKERS.get(provider)
    if not checker:
        return {"available": False, "reason": "Provider not supported"}
    return await checker(model)


async def get_all_availabilities():
    results = {}
    for provider, models in PROVIDER_MODELS.items():
        results[provider] = {}
        for model_name in models:
            results[provider][model_name] = await check_provider_model_availability(provider, model_name)
    return results

# Memory store.
session_memory: dict[str, list] = {}
rana_learning: list[dict] = []  # Store cross-session feedback.


def get_memory(session_id: str) -> list:
    return session_memory.get(session_id, [])


def save_memory(session_id: str, messages: list):
    session_memory[session_id] = messages[-6:]  # Keep the latest 20 messages.


# Agent state.
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
    opts: Optional[dict[str, str]]


StateUpdate = dict[str, Any]


# System prompts live in plain text files so non-engineers can edit them.
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
PROMPT_FILES = {
    "rana": "rana.txt",
    "hara": "hara.txt",
    "bombom": "bombom.txt",
    "luna": "luna.txt",
    "hagen": "hagen.txt",
}

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(2 * 1024 * 1024)))
ALLOWED_UPLOAD_EXTENSIONS = {".txt", ".md", ".csv"}
ALLOWED_UPLOAD_CONTENT_TYPES = {
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/octet-stream",
}


def load_prompt(agent_name: str) -> str:
    filename = PROMPT_FILES.get(agent_name)
    if not filename:
        raise RuntimeError(f"Unknown prompt agent: {agent_name}")

    prompt_path = PROMPTS_DIR / filename
    try:
        return prompt_path.read_text(encoding="utf-8").strip()
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"Prompt file not found for {agent_name}: {prompt_path}"
        ) from exc


def render_prompt(agent_name: str, replacements: Optional[dict[str, str]] = None) -> str:
    prompt = load_prompt(agent_name)
    for key, value in (replacements or {}).items():
        prompt = prompt.replace(f"[[{key}]]", value)
    return prompt

HARA_JSON_SCHEMA = """
{
  "target_market": {
    "demographics": "...",
    "psychographics": "...",
    "fb_interest_targeting": ["interest1", "interest2", "interest3"]
  },
  "core_problem": {
    "main_pain_point": "...",
    "problem_logic": "..."
  },
  "decision_trigger": {
    "trigger": "...",
    "penjelasan": "..."
  },
  "faq": [
    {"question": "...", "answer": "..."}
  ],
  "objection": [
    {"objection": "...", "handling": "..."}
  ],
  "ad_insight": "...",
  "assumptions_used": ["..."],
  "clarification_questions": ["..."]
}
"""

BOMBOM_JSON_SCHEMA = """
{
  "ad_concepts": [
    {
      "nomor": 1,
      "visual_idea": "...",
      "hook": "...",
      "primary_text": "...",
      "headline": "..."
    }
  ],
  "production_notes": "..."
}
"""

LUNA_JSON_SCHEMA = """
{
  "video_concepts": [
    {
      "nomor": 1,
      "angle_konten": "...",
      "hook_scene": {
        "duration": "0-3 seconds",
        "description": "...",
        "dialogue_or_text": "...",
        "visual": "..."
      },
      "body_scenes": [
        {"scene": "Scene 2", "duration": "3-10 seconds", "scene_text": "...", "visual": "..."}
      ],
      "production_requirements": {
        "talent": "...",
        "location": "...",
        "props": "...",
        "estimated_total_duration": "..."
      }
    }
  ]
}
"""

RANA_FINAL_JSON_SCHEMA = """
{
  "top_image_ads": [1, 2, 3],
  "top_video_concepts": [1, 2],
  "choice_rationale": "...",
  "needs_human_review": ["item1", "item2"],
  "next_steps": ["step1", "step2"],
  "run_hagen": false,
  "user_summary": "..."
}
"""

HAGEN_JSON_SCHEMA = """
{
  "script_breakdown": [
    {
      "scene_number": 1,
      "duration": "...",
      "visual_direction": "...",
      "dialog": "...",
      "on_screen_text": "...",
      "audio": "...",
      "director_notes": "...",
      "reusable": true
    }
  ],
  "heygen_notes": "...",
  "production_checklist": ["item1", "item2"]
}
"""


# Claude helpers.
def extract_text_from_message(message) -> str:
    text_blocks = []
    for block in getattr(message, "content", []):
        if getattr(block, "type", None) == "text" and hasattr(block, "text"):
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


def call_claude(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = 2000,
    max_continuations: int = 2,
) -> str:
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not set. Anthropic requests cannot be processed."
        )
    messages: list[MessageParam] = [
        {"role": "user", "content": user_message}
    ]
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )
    text = extract_text_from_message(response)

    for attempt in range(max_continuations):
        if getattr(response, "stop_reason", None) != "max_tokens":
            break

        logger.warning(
            "Claude response hit max_tokens; requesting continuation %s/%s",
            attempt + 1,
            max_continuations,
        )
        messages = [
            {"role": "user", "content": user_message},
            {"role": "assistant", "content": text},
            {
                "role": "user",
                "content": (
                    "Output kamu terpotong karena token limit. "
                    "Continue exactly from the next character without repeating previous content. "
                    "Do not add an intro, explanation, or anything outside the same valid JSON."
                ),
            },
        ]
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        )
        text += extract_text_from_message(response)

    return text


def call_gemini(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = 2000,
) -> str:
    if not API_KEYS["gemini"]:
        raise HTTPException(
            status_code=503,
            detail="GOOGLE_GEMINI_API_KEY not set. Gemini requests cannot be processed."
        )

    prompt_text = f"{system}\n\n{user_message}"
    url = f"https://generativelanguage.googleapis.com/v1/models/{model}:generateContent?key={API_KEYS['gemini']}"
    response = httpx.post(
        url,
        json={
            "contents": [{"parts": [{"text": prompt_text}]}],
        },
        timeout=30.0,
    )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Gemini API error: {response.status_code}. "
                f"Response: {response.text}"
            ),
        )

    data = response.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise HTTPException(
            status_code=502,
            detail="Gemini API returned no candidates. Check the Gemini model response or API key configuration."
        )

    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(part.get("text", "") for part in parts)


def call_openai(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = 2000,
) -> str:
    if not API_KEYS["openai"]:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY not set. OpenAI requests cannot be processed."
        )

    max_retries = 3
    retry_delay = 1  # Start with 1 second
    
    for attempt in range(max_retries):
        try:
            response = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {API_KEYS['openai']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": max_tokens,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user_message},
                    ],
                },
                timeout=30.0,
            )

            # Handle rate limiting with exponential backoff
            if response.status_code == 429:
                if attempt < max_retries - 1:
                    logger.warning(
                        f"OpenAI rate limit hit (429). Retrying in {retry_delay}s (attempt {attempt + 1}/{max_retries})..."
                    )
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                    continue
                else:
                    raise HTTPException(
                        status_code=429,
                        detail="OpenAI API rate limit exceeded. Please try again later."
                    )
            
            # Handle authentication errors
            if response.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail="OpenAI API authentication failed. Check your API key."
                )
            
            # Handle other errors
            if response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"OpenAI API error: {response.status_code}. "
                        f"Response: {response.text}"
                    ),
                )

            data = response.json()
            choices = data.get("choices", [])
            if not choices:
                raise HTTPException(
                    status_code=502,
                    detail="OpenAI API returned no choices. Check the API response."
                )
            return choices[0].get("message", {}).get("content", "")
            
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"OpenAI API connection error: {str(e)}"
            )


def call_grok(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = 2000,
) -> str:
    if not API_KEYS["grok"]:
        raise HTTPException(
            status_code=503,
            detail="XAI_API_KEY not set. Grok requests cannot be processed."
        )

    try:
        response = httpx.post(
            "https://api.x.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {API_KEYS['grok']}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_message},
                ],
            },
            timeout=30.0,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Grok API error: {response.status_code}. "
                    f"Response: {response.text}"
                ),
            )

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            raise HTTPException(
                status_code=502,
                detail="Grok API returned no choices. Check the API response."
            )
        return choices[0].get("message", {}).get("content", "")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Grok API connection error: {str(e)}"
        )


def call_nvidia(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = 2000,
) -> str:
    """Call NVIDIA NIM API (OpenAI-compatible endpoint)."""
    if not API_KEYS["nvidia"]:
        raise HTTPException(
            status_code=503,
            detail="NVIDIA_API_KEY not set. NVIDIA requests cannot be processed."
        )

    try:
        response = httpx.post(
            f"{NVIDIA_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {API_KEYS['nvidia']}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_message},
                ],
            },
            timeout=30.0,
        )

        if response.status_code == 401:
            raise HTTPException(
                status_code=401,
                detail="NVIDIA API authentication failed. Check your NVIDIA_API_KEY."
            )

        if response.status_code == 429:
            raise HTTPException(
                status_code=429,
                detail="NVIDIA API rate limit exceeded. Please try again later."
            )

        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"NVIDIA API error: {response.status_code}. "
                    f"Response: {response.text}"
                ),
            )

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            raise HTTPException(
                status_code=502,
                detail="NVIDIA API returned no choices. Check the API response."
            )
        return choices[0].get("message", {}).get("content", "")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"NVIDIA API connection error: {str(e)}"
        )
def call_openrouter(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = 1200,
) -> str:
    if not API_KEYS["openrouter"]:
        raise HTTPException(
            status_code=503,
            detail="OPENROUTER_API_KEY not set. OpenRouter requests cannot be processed."
        )

    try:
        response = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {API_KEYS['openrouter']}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5173",
                "X-OpenRouter-Title": "Rana Agent",
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_message},
                ],
            },
            timeout=30.0,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"OpenRouter API error: {response.status_code}. Response: {response.text}",
            )

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            raise HTTPException(
                status_code=502,
                detail="OpenRouter API returned no choices."
            )

        return choices[0].get("message", {}).get("content", "")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter API connection error: {str(e)}"
        )




def call_model(
    provider: str,
    model_name: str,
    system: str,
    user_message: str,
    max_tokens: int = 2000,
) -> str:
    model = get_model(model_name, provider)
    logger.info(f"Using provider={provider}, model={model_name}")
    if provider == "anthropic":
        return call_claude(system, user_message, model, max_tokens=max_tokens)
    if provider == "gemini":
        return call_gemini(system, user_message, model, max_tokens=max_tokens)
    if provider == "openai":
        return call_openai(system, user_message, model, max_tokens=max_tokens)
    if provider == "grok":
        return call_grok(system, user_message, model, max_tokens=max_tokens)
    if provider == "nvidia":
        return call_nvidia(system, user_message, model, max_tokens=max_tokens)
    if provider == "openrouter":
        return call_openrouter(system, user_message, model, max_tokens=max_tokens)

    raise HTTPException(
        status_code=400,
        detail=f"Provider '{provider}' is not supported by the backend yet. Supported providers: anthropic, gemini, openai, grok, nvidia, openrouter."
    )


def call_claude_stream(system: str, user_message: str, max_tokens: int = 2000):
    """Stream a Claude response."""
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not set. Anthropic streaming requests cannot be processed."
        )
    messages: list[MessageParam] = [
        {"role": "user", "content": user_message}
    ]
    with client.messages.stream(
        model="claude-haiku-4-5-20251001",
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    ) as stream:
        for text in stream.text_stream:
            yield text


def strip_json_fence(text: str) -> str:
    """Remove JSON markdown fences from model output."""
    if not isinstance(text, str):
        return text
    text = text.strip()
    text = re.sub(r'\s*```$', '', text)
    return text.strip()


def is_valid_json(text: str) -> bool:
    try:
        json.loads(text)
        return True
    except Exception:
        return False


def repair_truncated_json(text: str) -> str:
    """Repair JSON truncated by token limits."""
    if not isinstance(text, str):
        return text
    text = text.strip()

    # Return valid JSON unchanged.
    try:
        json.loads(text)
        return text
    except json.JSONDecodeError:
        pass

    # Find a safe cut point before closing brackets.

    def try_close(s: str) -> str:
        """Add missing brackets or braces."""
        # Trim incomplete trailing syntax.
        s = re.sub(r',\s*$', '', s.rstrip())
        # Track brackets outside strings.
        stack = []
        in_str = False
        esc = False
        for i, ch in enumerate(s):
            if esc:
                esc = False
                continue
            if ch == '\\' and in_str:
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch in ('{', '['):
                stack.append('}' if ch == '{' else ']')
            elif ch in ('}', ']'):
                if stack and stack[-1] == ch:
                    stack.pop()
        # Cut before an unfinished string.
        if in_str:
            # Find the last opening quote.
            last_open = s.rfind('"')
            if last_open > 0:
                s = s[:last_open].rstrip().rstrip(',').rstrip()
                # Recalculate stack
                stack = []
                in_str2 = False
                esc2 = False
                for ch in s:
                    if esc2:
                        esc2 = False
                        continue
                    if ch == '\\' and in_str2:
                        esc2 = True
                        continue
                    if ch == '"':
                        in_str2 = not in_str2
                        continue
                    if in_str2:
                        continue
                    if ch in ('{', '['):
                        stack.append('}' if ch == '{' else ']')
                    elif ch in ('}', ']'):
                        if stack and stack[-1] == ch:
                            stack.pop()
        closing = ''.join(reversed(stack))
        return s + closing

    repaired = try_close(text)
    try:
        json.loads(repaired)
        return repaired
    except json.JSONDecodeError:
        pass

    # Try closing from the last complete bracket.
    for i in range(len(text) - 1, max(len(text) - 500, 0), -1):
        if text[i] in ('}', ']'):
            candidate = try_close(text[:i+1])
            try:
                json.loads(candidate)
                return candidate
            except json.JSONDecodeError:
                continue

    # Return the original text if repair fails.
    return text


def convert_to_schema_json(raw_text: str, schema_hint: str, max_tokens: int = 4000) -> str:
    prompt = f"""Convert the following output into VALID JSON that matches the schema.

REQUIRED RULES:
- Return valid JSON only.
- Do not use markdown, headings, bullets outside JSON, or code fences.
- Do not remove important information from the raw output.
- If the raw output contains clarification questions, put them in clarification_questions when supported.
- If data is missing, provide honest best-effort analysis and note assumptions in the closest field.

SCHEMA:
{schema_hint}

RAW OUTPUT:
{raw_text}
"""
    converted = call_claude(
        "You are a JSON repair and conversion engine. Return valid JSON only.",
        prompt,
        DEFAULT_MODEL_BY_PROVIDER["anthropic"],
        max_tokens=max_tokens,
        max_continuations=1,
    )
    return repair_truncated_json(strip_json_fence(converted))


def clean_agent_json_output(raw_text: str, schema_hint: Optional[str] = None, max_tokens: int = 4000) -> str:
    cleaned = repair_truncated_json(strip_json_fence(raw_text))
    if is_valid_json(cleaned):
        return cleaned

    if schema_hint:
        logger.warning(
            "Agent output is invalid JSON; converting to requested schema")
        try:
            converted = convert_to_schema_json(
                cleaned, schema_hint, max_tokens=max_tokens)
            if is_valid_json(converted):
                return converted
        except APIError:
            logger.exception(
                "JSON conversion pass failed due to Anthropic API error")
        except Exception:
            logger.exception("JSON conversion pass failed unexpectedly")

    logger.warning(
        "Agent output is still invalid JSON after repair; wrapping raw output")
    return json.dumps(
        {
            "_status": "partial_or_invalid_json",
            "_warning": (
                "The AI output was truncated or was not valid JSON. "
                "The raw output was preserved so no information is lost."
            ),
            "raw_output": cleaned,
        },
        ensure_ascii=False,
    )


def build_creative_brief(hara_output: str) -> str:
    if not isinstance(hara_output, str) or not hara_output.strip():
        return ""

    cleaned = repair_truncated_json(strip_json_fence(hara_output)).strip()
    if not cleaned:
        return ""

    try:
        parsed = json.loads(cleaned)
    except Exception:
        return cleaned[:2500].strip()

    if not isinstance(parsed, dict):
        return cleaned[:2500].strip()

    sections = []
    keys = [
        ("target_market", "Target Market"),
        ("core_problem", "Core Problem"),
        ("decision_trigger", "Decision Trigger"),
        ("objection", "Objection"),
        ("ad_insight", "Ad Insight"),
        ("assumptions_used", "Assumptions Used"),
    ]

    for key, label in keys:
        if key not in parsed or parsed[key] in (None, "", [], {}):
            continue
        value = parsed[key]
        if isinstance(value, (dict, list)):
            value_text = json.dumps(value, ensure_ascii=False, indent=2)
        else:
            value_text = str(value)
        sections.append(f"{label}:\n{value_text}")

    if not sections:
        return cleaned[:2500].strip()

    creative_brief = "\n\n".join(sections).strip()
    return creative_brief[:2500]


def rana_init(state: AgentState) -> StateUpdate:
    """Prepare context for Hara."""
    learning = "\n".join([
        f"- {item['insight']}" for item in rana_learning[-5:]
    ]) or "No previous learning is available."

    system = render_prompt("rana", {"LEARNING_CONTEXT": learning})

    file_context = ""
    if state.get("uploaded_files"):
        file_context = f"\n\nUPLOADED FILE CONTENT:\n{chr(10).join(state['uploaded_files'])}"

    session_context = ""
    prior_messages = state.get("messages", [])[-2:]
    if prior_messages:
        session_lines = []
        for msg in prior_messages:
            content = extract_message_content(msg)
            if content:
                session_lines.append(str(content)[:400])
        if session_lines:
            session_context = f"\n\nPREVIOUS SESSION CONTEXT:\n{chr(10).join(session_lines)}"

    prompt = f"""Product context from the user:
{state['product_context']}{file_context}{session_context}

Task: Summarize the context that will be sent to Hara for research.
Also decide whether any information is missing. Return JSON.

Format:
{{
  "context_for_hara": "...",
  "additional_info_needed": "none / [specify]",
  "rana_notes": "..."
}}"""

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, system, prompt)
    return {"current_step": "hara", "messages": [{"role": "assistant", "content": f"[RANA] {result}"}]}


def hara_research(state: AgentState) -> StateUpdate:
    """Run Hara market research."""
    rana_msg = ""
    for msg in reversed(state.get("messages", [])):
        content = extract_message_content(msg)
        if "[RANA]" in str(content):
            rana_msg = content
            break

    prompt = f"""Context from Rana:
{rana_msg}

Product: {state['product_context']}

Do deep research and produce a comprehensive market analysis.

REQUIRED:
- Return valid JSON only according to the Hara schema.
- Do not use markdown, headings, or code fences.
- If data is missing, do not stop at clarification questions only.
- Still provide best-effort analysis, put assumptions in `assumptions_used`, and put questions in `clarification_questions`."""

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, render_prompt("hara"), prompt, max_tokens=1000)
    cleaned_result = clean_agent_json_output(
        result, HARA_JSON_SCHEMA, max_tokens=1000)
    return {"hara_output": cleaned_result, "current_step": "rana_validates_hara",
            "messages": [{"role": "assistant", "content": f"[HARA] {cleaned_result}"}]}


def rana_validate_hara(state: AgentState) -> StateUpdate:
    """Validate Hara output."""
    learning = "\n".join(
        [f"- {item['insight']}" for item in rana_learning[-5:]]) or "None."
    system = render_prompt("rana", {"LEARNING_CONTEXT": learning})

    prompt = f"""Output from Hara (Research Agent):
{state['hara_output']}


Format JSON:
{{
  "status": "approved" / "revision_needed",
  "assessment": "...",
  "what_needs_improvement": "none / [specify]",
  "key_insight_for_creative_team": "Summary of the most important insight in 200 words"
}}"""

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, system, prompt)
    return {"current_step": "creative_agents",
            "messages": [{"role": "assistant", "content": f"[RANA VALIDATES HARA] {result}"}]}


def bombom_create_ads(state: AgentState) -> StateUpdate:
    """Create image ad concepts with Bombom."""
    creative_brief = build_creative_brief(state.get("hara_output") or "")
    if not creative_brief:
        creative_brief = "Hara output unavailable. Use the product context and the validated Rana direction to generate creative concepts."

    prompt = f"""Creative brief from Hara:
{creative_brief}

Product: {state['product_context']}

Create 3 powerful image ad concepts with strong stopping power."""

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, render_prompt("bombom"), prompt, max_tokens=1000)
    cleaned_result = clean_agent_json_output(
        result, BOMBOM_JSON_SCHEMA, max_tokens=1000)
    return {"bombom_output": cleaned_result,
            "messages": [{"role": "assistant", "content": f"[BOMBOM] {cleaned_result}"}]}


def luna_create_video(state: AgentState) -> StateUpdate:
    """Create video ad concepts with Luna."""
    creative_brief = build_creative_brief(state.get("hara_output") or "")
    if not creative_brief:
        creative_brief = "Hara output unavailable. Use the product context and the validated Rana direction to generate creative concepts."

    prompt = f"""Creative brief from Hara:
{creative_brief}

Product: {state['product_context']}

Create 2 video ad concepts with varied angles."""

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, render_prompt("luna"), prompt, max_tokens=1000)
    cleaned_result = clean_agent_json_output(
        result, LUNA_JSON_SCHEMA, max_tokens=1000)
    return {"luna_output": cleaned_result,
            "messages": [{"role": "assistant", "content": f"[LUNA] {cleaned_result}"}]}


def rana_final_decision(state: AgentState) -> StateUpdate:
    """Create Rana final decision."""
    learning = "\n".join(
        [f"- {item['insight']}" for item in rana_learning[-5:]]) or "None."
    system = render_prompt("rana", {"LEARNING_CONTEXT": learning})

    prompt = f"""Output from Bombom (Image Ads):
{state.get('bombom_output', 'None')}

Output from Luna (Video Concept):
{state.get('luna_output', 'None')}

Give the final decision:
1. Which image ad concepts are strongest (choose top 3)
2. Which video concepts are strongest (choose top 2)
3. What needs human review
4. Recommended next steps

Format JSON:
{{
  "top_image_ads": [1, 2, 3],
  "top_video_concepts": [1, 2],
  "choice_rationale": "...",
  "needs_human_review": ["item1", "item2"],
  "next_steps": ["step1", "step2"],
  "run_hagen": true/false,
  "user_summary": "Summary to show to the user"
}}"""

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, system, prompt, max_tokens=1000)
    cleaned_result = clean_agent_json_output(
        result, RANA_FINAL_JSON_SCHEMA, max_tokens=1000)

    # Read the Hagen routing flag.
    run_hagen = False
    try:
        parsed = json.loads(cleaned_result)
        run_hagen = parsed.get("run_hagen", False)
    except Exception:
        pass

    return {"rana_decision": cleaned_result, "run_hagen": run_hagen,
            "current_step": "hagen" if run_hagen else "done",
            "messages": [{"role": "assistant", "content": f"[RANA FINAL] {cleaned_result}"}]}


def hagen_execute(state: AgentState) -> StateUpdate:
    """Create the optional Hagen execution script."""
    prompt = f"""Best video concepts from Luna:
{state.get('luna_output', '')}

Rana decision:
{state.get('rana_decision', '')}

Create a detailed production script breakdown."""

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, render_prompt("hagen"), prompt, max_tokens=1000)
    cleaned_result = clean_agent_json_output(
        result, HAGEN_JSON_SCHEMA, max_tokens=1000)
    return {"hagen_output": cleaned_result, "current_step": "done",
            "messages": [{"role": "assistant", "content": f"[HAGEN] {cleaned_result}"}]}


def route_after_rana_decision(state: AgentState) -> str:
    if state.get("run_hagen"):
        return "hagen"
    return END


# Build the graph.
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
    # Run Bombom and Luna after Hara validation.
    graph.add_edge("rana_validate_hara", "bombom_create_ads")
    graph.add_edge("rana_validate_hara", "luna_create_video")
    graph.add_edge("bombom_create_ads", "rana_final_decision")
    graph.add_edge("luna_create_video", "rana_final_decision")
    graph.add_conditional_edges(
        "rana_final_decision",
        route_after_rana_decision,
        {
            "hagen": "hagen_execute",
            END: END,
        }
    )
    graph.add_edge("hagen_execute", END)

    return graph.compile()


compiled_graph = build_graph()


# API endpoints.
class RunRequest(BaseModel):
    session_id: str
    product_context: str
    run_hagen: bool = False
    opts: Optional[dict[str, str]] = None


class ContinueRequest(RunRequest):
    additional_input: str


class FeedbackRequest(BaseModel):
    session_id: str
    feedback: str


def is_meaningful_text(value: str, min_length: int = 2) -> bool:
    cleaned = str(value or "").strip().lower()
    compact = re.sub(r"[^a-z0-9]", "", cleaned)
    if len(compact) < min_length:
        return False
    if len(compact) <= 3 and len(set(compact)) == 1:
        return False
    return cleaned not in {"test", "testing", "dummy", "placeholder", "na", "n/a", "none"}


def extract_context_fields(product_context: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in str(product_context or "").splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip().lower()] = value.strip()
    return fields


def validate_product_context(product_context: str) -> None:
    fields = extract_context_fields(product_context)
    required_fields = {
        "product name": 2,
        "category": 2,
        "key advantage": 8,
        "target audience": 8,
        "pain point": 8,
        "price range": 2,
        "ad platforms": 2,
    }
    missing = [
        field for field, min_length in required_fields.items()
        if not is_meaningful_text(fields.get(field, ""), min_length)
    ]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Product context is incomplete or too short. "
                f"Complete these fields: {', '.join(missing)}."
            ),
        )


def validate_opts(opts: Optional[dict[str, str]]) -> tuple[str, str]:
    provider = (opts or {}).get("provider", "anthropic")
    supported_providers = set(PROVIDER_MODELS.keys())
    if provider not in supported_providers:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Provider '{provider}' is not supported by the backend yet. "
                f"Supported providers: {', '.join(sorted(supported_providers))}."
            ),
        )
    model_name = (opts or {}).get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    if model_name not in PROVIDER_MODELS[provider]:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Model '{model_name}' is not supported for provider '{provider}'. "
                f"Use one of: {', '.join(PROVIDER_MODELS[provider])}."
            ),
        )
    return provider, model_name


def anthropic_http_exception(api_err: APIError) -> HTTPException:
    err_type = type(api_err).__name__
    message = getattr(api_err, "message", str(api_err))
    body = getattr(api_err, "body", None)
    upstream_status = getattr(api_err, "status_code", None)

    if isinstance(api_err, anthropic.AuthenticationError):
        return HTTPException(
            status_code=401,
            detail=f"Anthropic authentication failed. Check ANTHROPIC_API_KEY. Detail: {message}",
        )
    if isinstance(api_err, anthropic.PermissionDeniedError):
        return HTTPException(
            status_code=403,
            detail=f"Anthropic permission denied. The API key does not have access to this model or resource. Detail: {message}",
        )
    if isinstance(api_err, anthropic.RateLimitError):
        return HTTPException(
            status_code=429,
            detail=(
                "Anthropic rate/quota limit reached. This can happen because of a temporary rate limit, "
                f"credits/quota are exhausted, or the usage plan limit was reached. Detail: {message}. Body: {body}"
            ),
        )
    if isinstance(api_err, (anthropic.APIConnectionError, anthropic.APITimeoutError)):
        return HTTPException(
            status_code=503,
            detail=f"Cannot connect to the Anthropic API. Check network connectivity. Detail: {message}",
        )
    if isinstance(api_err, anthropic.APIStatusError):
        status_code = upstream_status if upstream_status in {
            400, 401, 403, 404, 422, 429, 500, 503} else 502
        return HTTPException(
            status_code=status_code,
            detail=f"Anthropic API status error ({err_type}, upstream {upstream_status}): {message}. Body: {body}",
        )

    return HTTPException(
        status_code=502,
        detail=f"Anthropic API error ({err_type}): {message}. Body: {body}",
    )


@app.post("/api/run")
async def run_agents(request: RunRequest):
    """Jalankan full multi-agent pipeline"""
    validate_product_context(request.product_context)
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
        "opts": request.opts,
    }

    validate_opts(request.opts)

    try:
        result = await asyncio.to_thread(compiled_graph.invoke, initial_state)
    except HTTPException:
        raise
    except APIError as api_err:
        logger.exception("Anthropic API error during run_agents")
        raise anthropic_http_exception(api_err)
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


@app.post("/api/continue")
async def continue_agents(request: ContinueRequest):
    """Add user input to an existing session and rerun the pipeline."""
    validate_product_context(request.product_context)
    if not is_meaningful_text(request.additional_input, 8):
        raise HTTPException(
            status_code=400,
            detail="additional_input is too short. Add specific context for the revision."
        )

    history = get_memory(request.session_id)
    additional_entry = {
        "role": "user",
        "content": f"[USER ADDITIONAL INPUT]\n{request.additional_input.strip()}"
    }
    updated_context = f"""{request.product_context.strip()}

ADDITIONAL USER INPUT FOR THIS SESSION:
{request.additional_input.strip()}

Use this additional input to complete or revise the previous output in this session.
"""

    initial_state: AgentState = {
        "session_id": request.session_id,
        "product_context": updated_context,
        "uploaded_files": [],
        "hara_output": None,
        "bombom_output": None,
        "luna_output": None,
        "hagen_output": None,
        "rana_decision": None,
        "current_step": "start",
        "messages": [*history, additional_entry],
        "run_hagen": request.run_hagen,
        "opts": request.opts,
    }

    validate_opts(request.opts)

    try:
        result = await asyncio.to_thread(compiled_graph.invoke, initial_state)
    except HTTPException:
        raise
    except APIError as api_err:
        logger.exception("Anthropic API error during continue_agents")
        raise anthropic_http_exception(api_err)
    except Exception as err:
        logger.exception("Unhandled error during continue_agents")
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
    """Upload a product brief or document."""
    filename = file.filename or "uploaded-file"
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported file type. Upload a plain text file: "
                f"{', '.join(sorted(ALLOWED_UPLOAD_EXTENSIONS))}."
            ),
        )
    if file.content_type and file.content_type not in ALLOWED_UPLOAD_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {file.content_type}."
        )

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File is too large. Maximum upload size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
        )

    text_content = content.decode("utf-8", errors="ignore")
    if not is_meaningful_text(text_content, 20):
        raise HTTPException(
            status_code=400,
            detail="Uploaded file does not contain enough readable text."
        )

    if session_id not in session_memory:
        session_memory[session_id] = []

    # Store uploaded file text in session memory.
    file_entry = f"[FILE: {filename}]\n{text_content[:3000]}"
    session_memory[session_id].append({"role": "user", "content": file_entry})
    save_memory(session_id, session_memory[session_id])

    return {"status": "ok", "file_name": filename, "preview": text_content[:200]}


@app.post("/api/feedback")
async def save_feedback(data: FeedbackRequest):
    """Save user feedback for Rana learning."""
    if not data.feedback.strip():
        raise HTTPException(
            status_code=400, detail="feedback must not be empty")

    rana_learning.append({
        "session_id": data.session_id,
        "insight": data.feedback,
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


@app.get("/api/availability")
async def get_model_availability():
    """Get availability status for all model providers and models."""
    try:
        availabilities = await get_all_availabilities()
        return {"availabilities": availabilities}
    except Exception as e:
        logger.exception("Error checking model availability")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok", "agents": ["Rana", "Hara", "Bombom", "Luna", "Hagen"]}

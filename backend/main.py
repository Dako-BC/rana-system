"""
RANA Multi-Agent Marketing System - Backend.
Stack: FastAPI, LangGraph, and Claude.
Deploy: Railway or Render.
"""

import os
import re
import json
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

api_key = os.environ.get("ANTHROPIC_API_KEY")
if not api_key:
    raise RuntimeError(
        "ANTHROPIC_API_KEY was not found. Add it to backend/.env or set it before starting the backend."
    )
client = anthropic.Anthropic(api_key=api_key)

# Model configuration.
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
        "gemini-1.5-flash",
        "gemini-1.5-pro",
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
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": API_KEYS["anthropic"],
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "test"}],
                },
                timeout=10.0,
            )
        if response.status_code == 200:
            return {"available": True, "quota": "Unknown"}
        elif response.status_code == 401:
            return {"available": False, "reason": "Invalid API key"}
        elif response.status_code == 429:
            return {"available": False, "reason": "Rate limit exceeded"}
        else:
            return {"available": False, "reason": f"API error: {response.status_code}"}
    except Exception as e:
        return {"available": False, "reason": f"Network error: {str(e)}"}


async def check_openai_availability(model: str):
    if not API_KEYS["openai"]:
        return {"available": False, "reason": "API key not set"}
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {API_KEYS['openai']}"},
                timeout=10.0,
            )
        data = response.json()
        available_models = [m["id"] for m in data.get("data", [])]
        if model in available_models:
            return {"available": True, "quota": "Check dashboard"}
        else:
            return {"available": False, "reason": "Model not available"}
    except Exception as e:
        return {"available": False, "reason": f"Error: {str(e)}"}


async def check_grok_availability(model: str):
    if not API_KEYS["grok"]:
        return {"available": False, "reason": "API key not set"}
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {API_KEYS['grok']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "test"}],
                },
                timeout=10.0,
            )
        if response.status_code == 200:
            return {"available": True, "quota": "Check Grok dashboard"}
        elif response.status_code == 401 or response.status_code == 403:
            return {"available": False, "reason": "Invalid API key"}
        elif response.status_code == 429:
            return {"available": False, "reason": "Rate limit exceeded"}
        else:
            return {"available": False, "reason": f"API error: {response.status_code}"}
    except Exception as e:
        return {"available": False, "reason": f"Error: {str(e)}"}


async def check_gemini_availability(model: str):
    if not API_KEYS["gemini"]:
        return {"available": False, "reason": "API key not set"}
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEYS['gemini']}",
                json={
                    "contents": [{"parts": [{"text": "test"}]}],
                },
                timeout=10.0,
            )
        if response.status_code == 200:
            return {"available": True, "quota": "Check Google AI dashboard"}
        elif response.status_code == 401 or response.status_code == 403:
            return {"available": False, "reason": "Invalid API key"}
        elif response.status_code == 404:
            return {"available": False, "reason": "Model not found - check model name"}
        else:
            return {"available": False, "reason": f"API error: {response.status_code}"}
    except Exception as e:
        return {"available": False, "reason": f"Error: {str(e)}"}


async def check_openrouter_availability(model: str):
    if not API_KEYS["openrouter"]:
        return {"available": False, "reason": "API key not set"}
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {API_KEYS['openrouter']}"},
                timeout=10.0,
            )
        if response.status_code != 200:
            return {"available": False, "reason": f"API error: {response.status_code}"}

        data = response.json()
        available_models = []
        for item in data.get("data", []) or data.get("models", []):
            if isinstance(item, dict):
                available_models.append(item.get("id") or item.get("name"))
            else:
                available_models.append(str(item))

        if model in available_models:
            return {"available": True, "quota": "Check OpenRouter dashboard"}
        return {"available": False, "reason": "Model not available"}
    except Exception as e:
        return {"available": False, "reason": f"Error: {str(e)}"}

AVAILABILITY_CHECKERS = {
    "anthropic": check_anthropic_availability,
    "grok": check_grok_availability,
    "openai": check_openai_availability,
    "gemini": check_gemini_availability,
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
user_learning: dict[str, list[dict]] = {}  # Store cross-session learning per local user.
rana_learning: list[dict] = []  # Store legacy global feedback.


def get_memory(session_id: str) -> list:
    return session_memory.get(session_id, [])


def save_memory(session_id: str, messages: list):
    session_memory[session_id] = messages[-MAX_SESSION_MESSAGES:]


def get_user_learning(user_id: str) -> list[dict]:
    return user_learning.get(user_id or "anonymous", [])


def save_user_insight(user_id: str, session_id: str, insight: str):
    cleaned = str(insight or "").strip()
    if not cleaned:
        return
    key = user_id or "anonymous"
    existing = user_learning.get(key, [])
    existing.append({
        "session_id": session_id,
        "insight": cleaned[:1200],
        "timestamp": str(asyncio.get_event_loop().time()),
    })
    user_learning[key] = existing[-MAX_USER_PROFILE_INSIGHTS:]


# Agent state.
class AgentState(TypedDict):
    session_id: str
    user_id: str
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
    "schema_hara": "schemas/hara.txt",
    "schema_bombom": "schemas/bombom.txt",
    "schema_luna": "schemas/luna.txt",
    "schema_rana_final": "schemas/rana_final.txt",
    "schema_hagen": "schemas/hagen.txt",
    "json_repair": "system/json_repair.txt",
    "json_repair_system": "system/json_repair_system.txt",
    "workflow_rana_init": "workflows/rana_init.txt",
    "workflow_hara_research": "workflows/hara_research.txt",
    "workflow_rana_validate_hara": "workflows/rana_validate_hara.txt",
    "workflow_bombom_create_ads": "workflows/bombom_create_ads.txt",
    "workflow_luna_create_video": "workflows/luna_create_video.txt",
    "workflow_rana_final_decision": "workflows/rana_final_decision.txt",
    "workflow_hagen_execute": "workflows/hagen_execute.txt",
}

MAX_UPLOAD_BYTES = int(os.environ.get(
    "MAX_UPLOAD_BYTES", str(2 * 1024 * 1024)))
ALLOWED_UPLOAD_EXTENSIONS = {".txt", ".md", ".csv"}
ALLOWED_UPLOAD_CONTENT_TYPES = {
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/octet-stream",
}


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning("Invalid %s=%r; using default %s", name, value, default)
        return default


# Output budgets. Keep coordinator steps moderate, but give structured agent
# outputs enough room so JSON is less likely to be truncated.
DEFAULT_MAX_TOKENS = env_int("DEFAULT_MAX_TOKENS", 5000)
AGENT_MAX_TOKENS = env_int("AGENT_MAX_TOKENS", 10000)
FINAL_MAX_TOKENS = env_int("FINAL_MAX_TOKENS", 6000)
JSON_REPAIR_MAX_TOKENS = env_int("JSON_REPAIR_MAX_TOKENS", 7000)
CLAUDE_MAX_CONTINUATIONS = env_int("CLAUDE_MAX_CONTINUATIONS", 1)
MAX_SESSION_MESSAGES = env_int("MAX_SESSION_MESSAGES", 18)
MAX_USER_PROFILE_INSIGHTS = env_int("MAX_USER_PROFILE_INSIGHTS", 12)


def load_prompt(prompt_name: str) -> str:
    filename = PROMPT_FILES.get(prompt_name)
    if not filename:
        raise RuntimeError(f"Unknown prompt file: {prompt_name}")

    prompt_path = PROMPTS_DIR / filename
    try:
        return prompt_path.read_text(encoding="utf-8").strip()
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"Prompt file not found for {prompt_name}: {prompt_path}"
        ) from exc


def render_prompt(prompt_name: str, replacements: Optional[dict[str, str]] = None) -> str:
    prompt = load_prompt(prompt_name)
    for key, value in (replacements or {}).items():
        prompt = prompt.replace(f"[[{key}]]", value)
    return prompt


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


def extract_agent_outputs_from_messages(messages: list) -> dict[str, str]:
    outputs: dict[str, str] = {}
    markers = {
        "hara_output": "[HARA]",
        "bombom_output": "[BOMBOM]",
        "luna_output": "[LUNA]",
        "hagen_output": "[HAGEN]",
        "rana_decision": "[RANA FINAL]",
    }
    for message in messages or []:
        content = str(extract_message_content(message) or "")
        for key, marker in markers.items():
            if marker in content:
                outputs[key] = content.split(marker, 1)[1].strip()
    return outputs


def call_claude(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    max_continuations: int = CLAUDE_MAX_CONTINUATIONS,
) -> str:
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
    max_tokens: int = DEFAULT_MAX_TOKENS,
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
            "generationConfig": {
                "maxOutputTokens": max_tokens,
            },
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


def call_openrouter(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    if not API_KEYS["openrouter"]:
        raise HTTPException(
            status_code=503,
            detail="OPENROUTER_API_KEY not set. OpenRouter requests cannot be processed."
        )

    response = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {API_KEYS['openrouter']}",
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
                f"OpenRouter API error: {response.status_code}. "
                f"Response: {response.text}"
            ),
        )

    data = response.json()
    choices = data.get("choices", [])
    if not choices:
        raise HTTPException(
            status_code=502,
            detail="OpenRouter API returned no choices. Check the API response."
        )
    return choices[0].get("message", {}).get("content", "")


def call_openai(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    if not API_KEYS["openai"]:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY not set. OpenAI requests cannot be processed."
        )

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
    max_tokens: int = DEFAULT_MAX_TOKENS,
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


def call_model(
    provider: str,
    model_name: str,
    system: str,
    user_message: str,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    model = get_model(model_name, provider)
    if provider == "anthropic":
        return call_claude(system, user_message, model, max_tokens=max_tokens)
    if provider == "gemini":
        return call_gemini(system, user_message, model, max_tokens=max_tokens)
    if provider == "openai":
        return call_openai(system, user_message, model, max_tokens=max_tokens)
    if provider == "grok":
        return call_grok(system, user_message, model, max_tokens=max_tokens)
    if provider == "openrouter":
        return call_openrouter(system, user_message, model, max_tokens=max_tokens)

    raise HTTPException(
        status_code=400,
        detail=f"Provider '{provider}' is not supported by the backend yet. Supported providers: anthropic, gemini, openai, grok, openrouter."
    )


def call_claude_stream(system: str, user_message: str, max_tokens: int = DEFAULT_MAX_TOKENS):
    """Stream a Claude response."""
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
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s*```$', '', text)
    return text.strip()


def extract_json_candidate(text: str) -> str:
    """Extract the first balanced JSON object or array from mixed model output."""
    if not isinstance(text, str):
        return text

    text = strip_json_fence(text)
    if is_valid_json(text):
        return text

    starts = [idx for idx in (text.find("{"), text.find("[")) if idx != -1]
    if not starts:
        return text

    start = min(starts)
    stack = []
    in_str = False
    esc = False
    for idx in range(start, len(text)):
        ch = text[idx]
        if esc:
            esc = False
            continue
        if ch == "\\" and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch in ("{", "["):
            stack.append("}" if ch == "{" else "]")
        elif ch in ("}", "]"):
            if not stack or stack[-1] != ch:
                continue
            stack.pop()
            if not stack:
                candidate = text[start:idx + 1].strip()
                if is_valid_json(candidate):
                    return candidate

    return text[start:].strip()


def is_valid_json(text: str) -> bool:
    try:
        json.loads(text)
        return True
    except Exception:
        return False


def has_meaningful_json_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (int, float, bool)):
        return True
    if isinstance(value, list):
        return any(has_meaningful_json_value(item) for item in value)
    if isinstance(value, dict):
        return any(
            not str(key).startswith("_")
            and key != "raw_output"
            and has_meaningful_json_value(child)
            for key, child in value.items()
        )
    return False


def humanize_key(key: str) -> str:
    labels = {
        "target_market": "Target Market",
        "core_problem": "Core Problem",
        "decision_trigger": "Decision Trigger",
        "fb_interest_targeting": "FB Interest Targeting",
        "main_pain_point": "Main Pain Point",
        "problem_logic": "Problem Logic",
        "ad_insight": "Ad Insight",
        "assumptions_used": "Assumptions Used",
        "clarification_questions": "Clarification Questions",
        "video_concepts": "Video Concepts",
        "content_angle": "Content Angle",
        "angle_konten": "Content Angle",
        "hook_scene": "Hook Scene",
        "dialogue_or_text": "Dialogue / On-screen Text",
        "body_scenes": "Body Scenes",
        "scene_text": "Scene Text",
        "production_requirements": "Production Requirements",
        "estimated_total_duration": "Estimated Total Duration",
        "top_image_ads": "Top Image Ads",
        "top_video_concepts": "Top Video Concepts",
        "choice_rationale": "Choice Rationale",
        "needs_human_review": "Needs Human Review",
        "next_steps": "Next Steps",
        "run_hagen": "Run Hagen",
        "user_summary": "Summary",
    }
    if key in labels:
        return labels[key]
    return str(key or "").replace("_", " ").title()


def format_value_as_text(value: Any, indent: int = 0) -> list[str]:
    prefix = "  " * indent
    if value is None:
        return []
    if isinstance(value, (str, int, float, bool)):
        text = str(value).strip()
        return [f"{prefix}{text}"] if text else []
    if isinstance(value, list):
        lines: list[str] = []
        for index, item in enumerate(value, start=1):
            if isinstance(item, dict):
                title = (
                    item.get("number")
                    or item.get("nomor")
                    or item.get("scene_number")
                    or index
                )
                lines.append(f"{prefix}{index}. Item {title}")
                lines.extend(format_value_as_text(item, indent + 1))
            else:
                item_lines = format_value_as_text(item, indent + 1)
                if item_lines:
                    first = item_lines[0].strip()
                    lines.append(f"{prefix}- {first}")
                    lines.extend(item_lines[1:])
        return lines
    if isinstance(value, dict):
        lines: list[str] = []
        for key, child in value.items():
            if str(key).startswith("_") or key == "raw_output":
                continue
            child_lines = format_value_as_text(child, indent + 1)
            if not child_lines:
                continue
            lines.append(f"{prefix}{humanize_key(key)}:")
            lines.extend(child_lines)
        return lines
    return [f"{prefix}{str(value)}"]


def parse_agent_json_output(raw_text: Optional[str]) -> Optional[Any]:
    if raw_text is None:
        return None
    if isinstance(raw_text, (dict, list)):
        return raw_text
    text = str(raw_text).strip()
    if not text:
        return None
    for candidate in (text, extract_json_candidate(text), repair_truncated_json(text)):
        try:
            return json.loads(candidate)
        except Exception:
            continue
    return None


def format_hara_output(data: dict[str, Any]) -> str:
    target_market = data.get("target_market") or {}
    core_problem = data.get("core_problem") or {}
    decision_trigger = data.get("decision_trigger") or {}
    lines = [
        "## Target Market",
        f"Demographics: {target_market.get('demographics', '')}",
        f"Psychographics: {target_market.get('psychographics', '')}",
    ]
    interests = target_market.get("fb_interest_targeting") or []
    if interests:
        lines.append(f"FB Interest Targeting: {', '.join(map(str, interests))}")

    lines.extend([
        "",
        "## Core Problem",
        f"Main Pain Point: {core_problem.get('main_pain_point', '')}",
        f"Problem Logic: {core_problem.get('problem_logic', '')}",
        "",
        "## Decision Trigger",
        f"Trigger: {decision_trigger.get('trigger', '')}",
        f"Explanation: {decision_trigger.get('explanation') or decision_trigger.get('penjelasan', '')}",
    ])

    faq = data.get("faq") or []
    if faq:
        lines.extend(["", "## FAQ"])
        for index, item in enumerate(faq, start=1):
            lines.append(f"{index}. Q: {item.get('question', '')}")
            lines.append(f"   A: {item.get('answer', '')}")

    objections = data.get("objection") or []
    if objections:
        lines.extend(["", "## Objection Handling"])
        for index, item in enumerate(objections, start=1):
            lines.append(f"{index}. Objection: {item.get('objection', '')}")
            lines.append(f"   Handling: {item.get('handling', '')}")

    if data.get("ad_insight"):
        lines.extend(["", "## Ad Insight", str(data["ad_insight"])])
    if data.get("assumptions_used"):
        lines.extend(["", "## Assumptions Used"])
        lines.extend(f"- {item}" for item in data["assumptions_used"])
    if data.get("clarification_questions"):
        lines.extend(["", "## Clarification Questions"])
        lines.extend(f"- {item}" for item in data["clarification_questions"])

    return "\n".join(line for line in lines if line is not None).strip()


def format_luna_output(data: dict[str, Any]) -> str:
    concepts = data.get("video_concepts") or []
    blocks: list[str] = []
    for index, concept in enumerate(concepts, start=1):
        number = concept.get("number") or concept.get("nomor") or index
        hook = concept.get("hook_scene") or {}
        production = concept.get("production_requirements") or {}
        lines = [
            f"## Video Concept {number}",
            f"Content Angle: {concept.get('content_angle') or concept.get('angle_konten', '')}",
            "",
            "## Hook Scene",
            f"Duration: {hook.get('duration', '')}",
            f"Description: {hook.get('description', '')}",
            f"Dialogue / Text: {hook.get('dialogue_or_text', '')}",
            f"Visual: {hook.get('visual', '')}",
        ]
        body_scenes = concept.get("body_scenes") or []
        if body_scenes:
            lines.extend(["", "## Storyboard"])
            for scene in body_scenes:
                lines.append(f"- {scene.get('scene', 'Scene')} ({scene.get('duration', '')})")
                lines.append(f"  Text: {scene.get('scene_text', '')}")
                if scene.get("visual"):
                    lines.append(f"  Visual: {scene.get('visual')}")
        if production:
            lines.extend([
                "",
                "## Production Requirements",
                f"Talent: {production.get('talent', '')}",
                f"Location: {production.get('location', '')}",
                f"Props: {production.get('props', '')}",
                f"Estimated Duration: {production.get('estimated_total_duration', '')}",
            ])
        blocks.append("\n".join(line for line in lines if line is not None).strip())
    return "\n\n".join(blocks).strip() or "\n".join(format_value_as_text(data)).strip()


def format_rana_output(data: dict[str, Any]) -> str:
    lines = []
    if data.get("user_summary"):
        lines.extend(["## Summary", str(data["user_summary"]), ""])
    if data.get("top_image_ads"):
        lines.append("## Top Image Ads")
        lines.append(", ".join(f"#{item}" for item in data["top_image_ads"]))
        lines.append("")
    if data.get("top_video_concepts"):
        lines.append("## Top Video Concepts")
        lines.append(", ".join(f"Concept {item}" for item in data["top_video_concepts"]))
        lines.append("")
    if data.get("choice_rationale"):
        lines.extend(["## Choice Rationale", str(data["choice_rationale"]), ""])
    if data.get("needs_human_review"):
        lines.append("## Needs Human Review")
        lines.extend(f"- {item}" for item in data["needs_human_review"])
        lines.append("")
    if data.get("next_steps"):
        lines.append("## Next Steps")
        lines.extend(f"{index}. {step}" for index, step in enumerate(data["next_steps"], start=1))
        lines.append("")
    if "run_hagen" in data:
        lines.extend(["## Run Hagen", "Yes" if data.get("run_hagen") else "No"])
    return "\n".join(lines).strip() or "\n".join(format_value_as_text(data)).strip()


def format_public_agent_output(agent_key: str, raw_text: Optional[str]) -> Optional[str]:
    if raw_text is None:
        return None
    parsed = parse_agent_json_output(raw_text)
    if not isinstance(parsed, dict):
        return str(raw_text)
    if agent_key == "hara":
        return format_hara_output(parsed)
    if agent_key == "luna":
        return format_luna_output(parsed)
    if agent_key == "rana":
        return format_rana_output(parsed)
    return str(raw_text)


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


def convert_to_schema_json(raw_text: str, schema_hint: str, max_tokens: int = JSON_REPAIR_MAX_TOKENS) -> str:
    prompt = render_prompt("json_repair", {
        "SCHEMA_HINT": schema_hint,
        "RAW_OUTPUT": raw_text,
    })
    converted = call_claude(
        load_prompt("json_repair_system"),
        prompt,
        DEFAULT_MODEL_BY_PROVIDER["anthropic"],
        max_tokens=max_tokens,
        max_continuations=1,
    )
    return repair_truncated_json(extract_json_candidate(converted))


def clean_agent_json_output(raw_text: str, schema_hint: Optional[str] = None, max_tokens: int = JSON_REPAIR_MAX_TOKENS) -> str:
    original_raw = str(raw_text or "").strip()

    def is_technical_key(k: str) -> bool:
        return isinstance(k, str) and (k.startswith("_") or k in ("raw_output", "_warning", "_parse_error"))

    def sanitize_obj(o: Any) -> Any:
        if isinstance(o, dict):
            res = {}
            for k, v in o.items():
                if is_technical_key(k):
                    continue
                sanitized_v = sanitize_obj(v)
                res[k] = sanitized_v
            return res
        if isinstance(o, list):
            return [sanitize_obj(i) for i in o]
        return o

    def parse_sanitized_meaningful(candidate: str) -> Optional[str]:
        try:
            parsed = json.loads(candidate)
        except Exception:
            return None
        sanitized = sanitize_obj(parsed)
        if has_meaningful_json_value(sanitized):
            return json.dumps(sanitized, ensure_ascii=False)
        return None

    candidates = []
    for candidate in (original_raw, extract_json_candidate(original_raw)):
        if isinstance(candidate, str):
            candidate = strip_json_fence(candidate).strip()
            if candidate and candidate not in candidates:
                candidates.append(candidate)

    # Try direct parse first. Do not repair before validating the original data.
    for candidate in candidates:
        parsed_candidate = parse_sanitized_meaningful(candidate)
        if parsed_candidate:
            return parsed_candidate

    repaired_candidates = []
    for candidate in candidates:
        repaired = repair_truncated_json(candidate)
        if isinstance(repaired, str):
            repaired = repaired.strip()
            if repaired and repaired not in repaired_candidates:
                repaired_candidates.append(repaired)

    for candidate in repaired_candidates:
        parsed_candidate = parse_sanitized_meaningful(candidate)
        if parsed_candidate:
            return parsed_candidate

    # Try converting to schema-guided JSON if provided
    if schema_hint:
        logger.warning("Agent output is invalid JSON; converting to requested schema")
        try:
            converted = convert_to_schema_json(original_raw, schema_hint, max_tokens=max_tokens)
            converted_candidate = parse_sanitized_meaningful(converted)
            if converted_candidate:
                return converted_candidate
        except APIError:
            logger.exception("JSON conversion pass failed due to Anthropic API error")
        except Exception:
            logger.exception("JSON conversion pass failed unexpectedly")

    # Final fallback: preserve the full original raw output inside a wrapper.
    logger.warning("Agent output is still invalid JSON after repair; returning raw_output wrapper so no data is lost")
    parse_error = None
    try:
        json.loads(original_raw)
    except Exception as exc:
        parse_error = str(exc)

    return json.dumps(
        {
            "_status": "partial_or_invalid_json",
            "_warning": (
                "Model output could not be parsed safely. Showing raw output."
            ),
            "_parse_error": parse_error,
            "raw_output": original_raw,
        },
        ensure_ascii=False,
    )


def rana_init(state: AgentState) -> StateUpdate:
    """Prepare context for Hara."""
    user_id = state.get("user_id", "anonymous")
    user_insights = get_user_learning(user_id)
    learning = "\n".join([
        f"- {item['insight']}" for item in user_insights[-5:]
    ]) or "No previous learning is available."

    system = render_prompt("rana", {"LEARNING_CONTEXT": learning})

    file_context = ""
    if state.get("uploaded_files"):
        file_context = f"\n\nUPLOADED FILE CONTENT:\n{chr(10).join(state['uploaded_files'])}"

    session_context = ""
    prior_messages = state.get("messages", [])[-8:]
    if prior_messages:
        session_lines = []
        for msg in prior_messages:
            content = extract_message_content(msg)
            if content:
                session_lines.append(str(content)[:1500])
        if session_lines:
            session_context = f"\n\nPREVIOUS SESSION CONTEXT:\n{chr(10).join(session_lines)}"

    prompt = render_prompt("workflow_rana_init", {
        "PRODUCT_CONTEXT": state["product_context"],
        "FILE_CONTEXT": file_context,
        "SESSION_CONTEXT": session_context,
    })

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

    prompt = render_prompt("workflow_hara_research", {
        "RANA_MESSAGE": str(rana_msg),
        "PRODUCT_CONTEXT": state["product_context"],
    })

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, render_prompt(
        "hara"), prompt, max_tokens=AGENT_MAX_TOKENS)
    cleaned_result = clean_agent_json_output(
        result, load_prompt("schema_hara"), max_tokens=JSON_REPAIR_MAX_TOKENS)
    return {"hara_output": cleaned_result, "current_step": "rana_validates_hara",
            "messages": [{"role": "assistant", "content": f"[HARA] {cleaned_result}"}]}


def rana_validate_hara(state: AgentState) -> StateUpdate:
    """Validate Hara output."""
    user_id = state.get("user_id", "anonymous")
    user_insights = get_user_learning(user_id)
    learning = "\n".join(
        [f"- {item['insight']}" for item in user_insights[-5:]]) or "None."
    system = render_prompt("rana", {"LEARNING_CONTEXT": learning})

    prompt = render_prompt("workflow_rana_validate_hara", {
        "HARA_OUTPUT": state["hara_output"] or "",
    })

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, system, prompt)
    return {"current_step": "creative_agents",
            "messages": [{"role": "assistant", "content": f"[RANA VALIDATES HARA] {result}"}]}


def bombom_create_ads(state: AgentState) -> StateUpdate:
    """Create image ad concepts with Bombom."""
    prompt = render_prompt("workflow_bombom_create_ads", {
        "HARA_OUTPUT": state["hara_output"] or "",
        "PRODUCT_CONTEXT": state["product_context"],
    })

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, render_prompt(
        "bombom"), prompt, max_tokens=AGENT_MAX_TOKENS)
    cleaned_result = clean_agent_json_output(
        result, load_prompt("schema_bombom"), max_tokens=JSON_REPAIR_MAX_TOKENS)
    return {"bombom_output": cleaned_result,
            "messages": [{"role": "assistant", "content": f"[BOMBOM] {cleaned_result}"}]}


def luna_create_video(state: AgentState) -> StateUpdate:
    """Create video ad concepts with Luna."""
    prompt = render_prompt("workflow_luna_create_video", {
        "HARA_OUTPUT": state["hara_output"] or "",
        "PRODUCT_CONTEXT": state["product_context"],
    })

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, render_prompt(
        "luna"), prompt, max_tokens=AGENT_MAX_TOKENS)
    cleaned_result = clean_agent_json_output(
        result, load_prompt("schema_luna"), max_tokens=JSON_REPAIR_MAX_TOKENS)
    return {"luna_output": cleaned_result,
            "messages": [{"role": "assistant", "content": f"[LUNA] {cleaned_result}"}]}


def rana_final_decision(state: AgentState) -> StateUpdate:
    """Create Rana final decision."""
    user_id = state.get("user_id", "anonymous")
    user_insights = get_user_learning(user_id)
    learning = "\n".join(
        [f"- {item['insight']}" for item in user_insights[-5:]]) or "None."
    system = render_prompt("rana", {"LEARNING_CONTEXT": learning})

    prompt = render_prompt("workflow_rana_final_decision", {
        "BOMBOM_OUTPUT": state.get("bombom_output") or "None",
        "LUNA_OUTPUT": state.get("luna_output") or "None",
    })

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, system, prompt, max_tokens=FINAL_MAX_TOKENS)
    cleaned_result = clean_agent_json_output(
        result, load_prompt("schema_rana_final"), max_tokens=JSON_REPAIR_MAX_TOKENS)

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
    prompt = render_prompt("workflow_hagen_execute", {
        "LUNA_OUTPUT": state.get("luna_output") or "",
        "RANA_DECISION": state.get("rana_decision") or "",
    })

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, render_prompt(
        "hagen"), prompt, max_tokens=AGENT_MAX_TOKENS)
    cleaned_result = clean_agent_json_output(
        result, load_prompt("schema_hagen"), max_tokens=JSON_REPAIR_MAX_TOKENS)
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
    # Keep creative agents sequential so the final decision sees both complete outputs.
    graph.add_edge("rana_validate_hara", "bombom_create_ads")
    graph.add_edge("bombom_create_ads", "luna_create_video")
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
    user_id: str = "anonymous"
    product_context: str
    run_hagen: bool = False
    opts: Optional[dict[str, str]] = None


class ContinueRequest(RunRequest):
    additional_input: str


class FeedbackRequest(BaseModel):
    session_id: str
    user_id: str = "anonymous"
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
    model_name = (opts or {}).get(
        "model") or DEFAULT_MODEL_BY_PROVIDER[provider]
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
    """Run the full multi-agent pipeline."""
    validate_product_context(request.product_context)
    history = get_memory(request.session_id)

    initial_state: AgentState = {
        "session_id": request.session_id,
        "user_id": request.user_id,
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
    save_user_insight(
        request.user_id,
        request.session_id,
        f"Product context used in this session:\n{request.product_context}",
    )

    output_fallbacks = extract_agent_outputs_from_messages(result.get("messages", []))
    hara_output = result.get("hara_output") or output_fallbacks.get("hara_output")
    bombom_output = result.get("bombom_output") or output_fallbacks.get("bombom_output")
    luna_output = result.get("luna_output") or output_fallbacks.get("luna_output")
    hagen_output = result.get("hagen_output") or output_fallbacks.get("hagen_output")
    rana_decision = result.get("rana_decision") or output_fallbacks.get("rana_decision")

    return {
        "session_id": request.session_id,
        "hara_output": format_public_agent_output("hara", hara_output),
        "bombom_output": bombom_output,
        "luna_output": format_public_agent_output("luna", luna_output),
        "hagen_output": hagen_output,
        "rana_decision": format_public_agent_output("rana", rana_decision),
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
        "user_id": request.user_id,
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
    save_user_insight(
        request.user_id,
        request.session_id,
        f"User revision preference or extra context:\n{request.additional_input.strip()}",
    )

    output_fallbacks = extract_agent_outputs_from_messages(result.get("messages", []))
    hara_output = result.get("hara_output") or output_fallbacks.get("hara_output")
    bombom_output = result.get("bombom_output") or output_fallbacks.get("bombom_output")
    luna_output = result.get("luna_output") or output_fallbacks.get("luna_output")
    hagen_output = result.get("hagen_output") or output_fallbacks.get("hagen_output")
    rana_decision = result.get("rana_decision") or output_fallbacks.get("rana_decision")

    return {
        "session_id": request.session_id,
        "hara_output": format_public_agent_output("hara", hara_output),
        "bombom_output": bombom_output,
        "luna_output": format_public_agent_output("luna", luna_output),
        "hagen_output": hagen_output,
        "rana_decision": format_public_agent_output("rana", rana_decision),
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
    save_user_insight(data.user_id, data.session_id, data.feedback)
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

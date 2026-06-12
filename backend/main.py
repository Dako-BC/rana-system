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
import threading
from pathlib import Path
from typing import Any, Optional, Annotated
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx
import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials as firebase_credentials

# LangGraph integration.
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

# Anthropic client.
import anthropic
from anthropic import APIError
from anthropic.types import MessageParam

ENV_DIR = Path(__file__).resolve().parent
load_dotenv(ENV_DIR / ".env")
load_dotenv(ENV_DIR / ".env.local", override=True)
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

DATA_DIR = Path(os.environ.get("RANA_DATA_DIR",
                Path(__file__).resolve().parent / "data"))
HISTORY_DB_PATH = DATA_DIR / "history.json"
history_db_lock = threading.Lock()
FIREBASE_AUTH_REQUIRED = os.environ.get("FIREBASE_AUTH_REQUIRED", "true").lower() not in {
    "0",
    "false",
    "no",
}
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()
TELEGRAM_ALLOWED_USER_IDS = {
    item.strip()
    for item in os.environ.get("TELEGRAM_ALLOWED_USER_IDS", "").split(",")
    if item.strip()
}
TELEGRAM_DEFAULT_RUN_HAGEN = os.environ.get("TELEGRAM_DEFAULT_RUN_HAGEN", "false").lower() in {
    "1",
    "true",
    "yes",
}
TELEGRAM_MESSAGE_LIMIT = 3500

api_key = os.environ.get("ANTHROPIC_API_KEY")
if not api_key:
    raise RuntimeError(
        "ANTHROPIC_API_KEY was not found. Add it to backend/.env or set it before starting the backend."
    )
client = anthropic.Anthropic(api_key=api_key)


def initialize_firebase_admin() -> bool:
    if not FIREBASE_AUTH_REQUIRED:
        logger.info("Firebase auth is disabled for the backend.")
        return False

    if firebase_admin._apps:
        return True

    service_account_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    app_credentials = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")

    if not service_account_json and not project_id and not app_credentials:
        logger.warning(
            "Firebase auth is required, but Firebase Admin credentials are missing. "
            "Set FIREBASE_SERVICE_ACCOUNT_JSON, set GOOGLE_APPLICATION_CREDENTIALS, "
            "or set FIREBASE_AUTH_REQUIRED=false for local development."
        )
        return False

    try:
        if service_account_json:
            service_account = json.loads(service_account_json)
            private_key = service_account.get("private_key")
            if isinstance(private_key, str):
                service_account["private_key"] = private_key.replace(
                    "\\n", "\n")
            firebase_admin.initialize_app(
                firebase_credentials.Certificate(service_account))
        else:
            options = {"projectId": project_id} if project_id else None
            firebase_admin.initialize_app(options=options)
        return True
    except Exception:
        logger.exception("Failed to initialize Firebase Admin")
        return False


FIREBASE_ADMIN_READY = initialize_firebase_admin()


def require_firebase_user(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    if not FIREBASE_AUTH_REQUIRED:
        return {}

    if not FIREBASE_ADMIN_READY:
        raise HTTPException(
            status_code=503,
            detail=(
                "Firebase Admin is not configured on the backend. "
                "Set FIREBASE_SERVICE_ACCOUNT_JSON or Firebase application credentials."
            ),
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing Firebase ID token. Sign in again and retry.",
        )

    token = authorization.split(" ", 1)[1].strip()
    try:
        return firebase_auth.verify_id_token(token)
    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail=f"Invalid Firebase ID token: {type(exc).__name__}",
        ) from exc


def resolve_authenticated_user_id(
    provided_user_id: Optional[str],
    claims: dict[str, Any],
) -> str:
    token_uid = claims.get("uid")
    provided = (provided_user_id or "").strip()

    if FIREBASE_AUTH_REQUIRED:
        if not token_uid:
            raise HTTPException(
                status_code=401, detail="Firebase token is missing a uid claim.")
        if provided and provided != token_uid:
            raise HTTPException(
                status_code=403,
                detail="Request user_id does not match the authenticated Firebase user.",
            )
        return token_uid

    resolved = provided or str(token_uid or "").strip()
    if not resolved:
        raise HTTPException(status_code=400, detail="user_id is required")
    return resolved


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
        "openai/gpt-oss-120b:free",
        "deepseek/deepseek-chat-v3-0324",
        "qwen/qwen3-32b",
        "mistralai/mistral-small-3.1-24b-instruct",
        "openai/gpt-4o-mini",
    ],
    "groq": [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "mixtral-8x7b-32768",
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
    "groq": os.environ.get("GROQ_API_KEY"),
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


async def check_groq_availability(model: str):
    if not API_KEYS["groq"]:
        return {"available": False, "reason": "API key not set"}
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {API_KEYS['groq']}",
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
            return {"available": True, "quota": "Free tier - check console.groq.com"}
        elif response.status_code == 401 or response.status_code == 403:
            return {"available": False, "reason": "Invalid API key"}
        elif response.status_code == 429:
            return {"available": False, "reason": "Rate limit exceeded"}
        else:
            return {"available": False, "reason": f"API error: {response.status_code}"}
    except Exception as e:
        return {"available": False, "reason": f"Error: {str(e)}"}
AVAILABILITY_CHECKERS = {
    "anthropic": check_anthropic_availability,
    "grok": check_grok_availability,
    "openai": check_openai_availability,
    "gemini": check_gemini_availability,
    "openrouter": check_openrouter_availability,
    "groq": check_groq_availability,
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

# Memory store. The key includes user_id so future Firebase Auth users do not share sessions.
session_memory: dict[str, list] = {}
rana_learning: list[dict] = []  # Store cross-session feedback.
MAX_SESSION_MESSAGES = int(os.environ.get("MAX_SESSION_MESSAGES", "14"))


def memory_key(session_id: str, user_id: Optional[str] = None) -> str:
    scoped_user = (user_id or "guest").strip() or "guest"
    return f"{scoped_user}:{session_id}"


def get_memory(session_id: str, user_id: Optional[str] = None) -> list:
    return session_memory.get(memory_key(session_id, user_id), [])


def save_memory(session_id: str, messages: list, user_id: Optional[str] = None):
    session_memory[memory_key(session_id, user_id)
                   ] = messages[-MAX_SESSION_MESSAGES:]


def ensure_session_capacity(session_id: str, user_id: Optional[str] = None, added_messages: int = 0):
    current_size = len(get_memory(session_id, user_id))
    if current_size + added_messages >= MAX_SESSION_MESSAGES:
        raise HTTPException(
            status_code=429,
            detail=(
                "This conversation is getting too long for one session. "
                "Start a new conversation so the agents can keep enough context and avoid wasting quota."
            ),
        )


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


def call_claude(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = 5000,
    max_continuations: int = 2,
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
    max_tokens: int = 5000,
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


def call_openrouter(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = 5000,
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
    max_tokens: int = 5000,
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
    max_tokens: int = 5000,
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


def call_groq(
    system: str,
    user_message: str,
    model: str,
    max_tokens: int = 5000,
) -> str:
    if not API_KEYS["groq"]:
        raise HTTPException(
            status_code=503,
            detail="GROQ_API_KEY not set. Groq requests cannot be processed."
        )

    try:
        response = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {API_KEYS['groq']}",
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
                    f"Groq API error: {response.status_code}. "
                    f"Response: {response.text}"
                ),
            )

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            raise HTTPException(
                status_code=502,
                detail="Groq API returned no choices. Check the API response."
            )
        return choices[0].get("message", {}).get("content", "")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Groq API connection error: {str(e)}"
        )


def call_model(
    provider: str,
    model_name: str,
    system: str,
    user_message: str,
    max_tokens: int = 5000,
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
    if provider == "groq":
        return call_groq(system, user_message, model, max_tokens=max_tokens)

    raise HTTPException(
        status_code=400,
        detail=f"Provider '{provider}' is not supported by the backend yet. Supported providers: anthropic, gemini, openai, grok, openrouter, groq."
    )


def call_claude_stream(system: str, user_message: str, max_tokens: int = 5000):
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


def convert_to_schema_json(raw_text: str, schema_hint: str, max_tokens: int = 5000) -> str:
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
    return repair_truncated_json(strip_json_fence(converted))


def clean_agent_json_output(raw_text: str, schema_hint: Optional[str] = None, max_tokens: int = 5000) -> str:
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


AWARENESS_LEVELS = {
    "completely unaware",
    "problem aware",
    "solution aware",
    "product aware",
    "most aware",
}


def normalize_awareness_level(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def has_clear_hara_awareness(hara_output: Optional[str]) -> bool:
    """Require Hara to diagnose awareness before creative agents run."""
    try:
        parsed = json.loads(hara_output or "{}")
    except Exception:
        return False

    awareness = parsed.get("awareness_analysis")
    if not isinstance(awareness, dict):
        awareness = {}

    current_level = normalize_awareness_level(
        parsed.get("awareness_level") or awareness.get("awareness_level")
    )
    target_level = normalize_awareness_level(
        parsed.get("awareness_target")
        or awareness.get("awareness_target")
        or awareness.get("target_awareness_level")
    )
    evidence = str(
        parsed.get("awareness_evidence")
        or awareness.get("awareness_evidence")
        or awareness.get("evidence")
        or ""
    ).strip()
    strategy = str(
        parsed.get("awareness_strategy")
        or awareness.get("awareness_strategy")
        or ""
    ).strip()
    triggers = parsed.get("psychological_triggers") or awareness.get(
        "psychological_triggers")
    if not isinstance(triggers, list):
        triggers = []

    meaningful_triggers = [
        trigger for trigger in triggers
        if is_meaningful_text(str(trigger), min_length=4)
    ]

    return (
        current_level in AWARENESS_LEVELS
        and target_level in AWARENESS_LEVELS
        and is_meaningful_text(evidence, min_length=12)
        and is_meaningful_text(strategy, min_length=12)
        and len(meaningful_triggers) >= 1
    )


def awareness_blocked_decision() -> str:
    return json.dumps(
        {
            "top_image_ads": [],
            "top_video_concepts": [],
            "choice_rationale": (
                "Creative agents were not dispatched because Hara did not provide a clear "
                "awareness diagnosis with awareness_level, awareness_evidence, awareness_target, "
                "psychological_triggers, and awareness_strategy."
            ),
            "awareness_check": "Blocked before creative work because Hara's awareness diagnosis was incomplete.",
            "needs_human_review": [
                "Review Hara output and add a clear Schwartz awareness diagnosis.",
            ],
            "next_steps": [
                "Rerun with clearer product context, previous winning copy, customer objections, or audience research.",
                "Make sure Hara identifies awareness_level, awareness_evidence, awareness_target, psychological_triggers, and awareness_strategy before creative work starts.",
            ],
            "run_hagen": False,
            "user_summary": (
                "Rana stopped the creative stage because the audience awareness level was not clear enough. "
                "This protects the system from producing generic ads for the wrong buyer mindset. "
                "Add stronger market context or rerun Hara so Bombom and Luna can create conversion-focused copy."
            ),
        },
        ensure_ascii=False,
    )


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
    result = call_model(provider, model_name, system, prompt, max_tokens=500)
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
        "hara"), prompt, max_tokens=1500)
    cleaned_result = clean_agent_json_output(
        result, load_prompt("schema_hara"), max_tokens=1500)
    return {"hara_output": cleaned_result, "current_step": "rana_validates_hara",
            "messages": [{"role": "assistant", "content": f"[HARA] {cleaned_result}"}]}


def rana_validate_hara(state: AgentState) -> StateUpdate:
    """Validate Hara output."""
    learning = "\n".join(
        [f"- {item['insight']}" for item in rana_learning[-5:]]) or "None."
    system = render_prompt("rana", {"LEARNING_CONTEXT": learning})

    prompt = render_prompt("workflow_rana_validate_hara", {
        "HARA_OUTPUT": state["hara_output"] or "",
    })

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, system, prompt, max_tokens=600)
    if not has_clear_hara_awareness(state.get("hara_output")):
        return {
            "current_step": "done",
            "rana_decision": awareness_blocked_decision(),
            "run_hagen": False,
            "messages": [{"role": "assistant", "content": f"[RANA VALIDATES HARA] {result}"}],
        }
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
        "bombom"), prompt, max_tokens=3000)
    cleaned_result = clean_agent_json_output(
        result, load_prompt("schema_bombom"), max_tokens=3000)
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
        "luna"), prompt, max_tokens=3000)
    cleaned_result = clean_agent_json_output(
        result, load_prompt("schema_luna"), max_tokens=3000)
    return {"luna_output": cleaned_result,
            "messages": [{"role": "assistant", "content": f"[LUNA] {cleaned_result}"}]}


def rana_final_decision(state: AgentState) -> StateUpdate:
    """Create Rana final decision."""
    learning = "\n".join(
        [f"- {item['insight']}" for item in rana_learning[-5:]]) or "None."
    system = render_prompt("rana", {"LEARNING_CONTEXT": learning})

    prompt = render_prompt("workflow_rana_final_decision", {
        "BOMBOM_OUTPUT": state.get("bombom_output") or "None",
        "LUNA_OUTPUT": state.get("luna_output") or "None",
    })

    opts = state.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model_name = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER[provider]
    result = call_model(provider, model_name, system, prompt, max_tokens=1000)
    cleaned_result = clean_agent_json_output(
        result, load_prompt("schema_rana_final"), max_tokens=1000)

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
        "hagen"), prompt, max_tokens=2500)
    cleaned_result = clean_agent_json_output(
        result, load_prompt("schema_hagen"), max_tokens=2500)
    return {"hagen_output": cleaned_result, "current_step": "done",
            "messages": [{"role": "assistant", "content": f"[HAGEN] {cleaned_result}"}]}


def route_after_rana_decision(state: AgentState) -> str:
    if state.get("run_hagen"):
        return "hagen"
    return END


def route_after_hara_validation(state: AgentState) -> str:
    if has_clear_hara_awareness(state.get("hara_output")):
        return "creative_agents"
    return END


def dispatch_creative_agents(state: AgentState) -> StateUpdate:
    """No-op graph node used to fan out only after awareness validation passes."""
    return {"current_step": "creative_agents"}


# Build the graph.
def build_graph():
    graph = StateGraph(AgentState)

    graph.add_node("rana_init", rana_init)
    graph.add_node("hara_research", hara_research)
    graph.add_node("rana_validate_hara", rana_validate_hara)
    graph.add_node("dispatch_creative_agents", dispatch_creative_agents)
    graph.add_node("bombom_create_ads", bombom_create_ads)
    graph.add_node("luna_create_video", luna_create_video)
    graph.add_node("rana_final_decision", rana_final_decision)
    graph.add_node("hagen_execute", hagen_execute)

    graph.set_entry_point("rana_init")
    graph.add_edge("rana_init", "hara_research")
    graph.add_edge("hara_research", "rana_validate_hara")
    # Run Bombom and Luna only after Hara has a clear awareness diagnosis.
    graph.add_conditional_edges(
        "rana_validate_hara",
        route_after_hara_validation,
        {
            "creative_agents": "dispatch_creative_agents",
            END: END,
        },
    )
    graph.add_edge("dispatch_creative_agents", "bombom_create_ads")
    graph.add_edge("dispatch_creative_agents", "luna_create_video")
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
    user_id: Optional[str] = None
    product_context: str
    run_hagen: bool = False
    opts: Optional[dict[str, str]] = None


class ContinueRequest(RunRequest):
    additional_input: str


class FeedbackRequest(BaseModel):
    session_id: str
    user_id: Optional[str] = None
    feedback: str


class HistoryPayload(BaseModel):
    sessions: list[dict[str, Any]] = []
    states: dict[str, Any] = {}


def read_history_db() -> dict[str, Any]:
    with history_db_lock:
        if not HISTORY_DB_PATH.exists():
            return {}
        try:
            return json.loads(HISTORY_DB_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to read history database")
            return {}


def write_history_db(data: dict[str, Any]) -> None:
    with history_db_lock:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp_path = HISTORY_DB_PATH.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(
            data, ensure_ascii=False), encoding="utf-8")
        tmp_path.replace(HISTORY_DB_PATH)


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


def extract_provider_opts_from_context(product_context: str) -> dict[str, str] | None:
    fields = extract_context_fields(product_context)
    provider = fields.get("provider")
    model = fields.get("model")
    if not provider:
        return None
    opts: dict[str, str] = {"provider": provider.lower()}
    if model:
        opts["model"] = model
    return opts


def normalize_provider_opts(opts: Optional[dict[str, str]]) -> dict[str, str] | None:
    if not opts:
        return None
    provider = (opts.get("provider") or "").strip().lower()
    if not provider:
        return None
    result: dict[str, str] = {"provider": provider}
    model = (opts.get("model") or "").strip()
    if model:
        result["model"] = model
    return result


def parse_provider_opts_from_command(text: str) -> dict[str, str] | None:
    parts = text.strip().split()
    if not parts or parts[0] != "/provider":
        return None
    if len(parts) < 2:
        return {}
    provider = parts[1].lower()
    opts: dict[str, str] = {"provider": provider}
    if len(parts) > 2:
        opts["model"] = parts[2]
    return opts


def validate_product_context(product_context: str) -> None:
    fields = extract_context_fields(product_context)
    required_fields = {
        "product name": 2,
        "category": 2,
        "key advantage": 2,
        "target audience": 2,
        "pain point": 2,
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


async def run_rana_pipeline(
    session_id: str,
    user_id: str,
    product_context: str,
    run_hagen: bool = False,
    opts: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    validate_product_context(product_context)
    ensure_session_capacity(session_id, user_id, added_messages=6)
    history = get_memory(session_id, user_id)

    provider, model_name = validate_opts(opts)
    opts = {"provider": provider, "model": model_name}

    initial_state: AgentState = {
        "session_id": session_id,
        "product_context": product_context,
        "uploaded_files": [],
        "hara_output": None,
        "bombom_output": None,
        "luna_output": None,
        "hagen_output": None,
        "rana_decision": None,
        "current_step": "start",
        "messages": history,
        "run_hagen": run_hagen,
        "opts": opts,
    }

    try:
        result = await asyncio.to_thread(compiled_graph.invoke, initial_state)
    except HTTPException:
        raise
    except APIError as api_err:
        logger.exception("Anthropic API error during run_rana_pipeline")
        raise anthropic_http_exception(api_err)
    except Exception as err:
        logger.exception("Unhandled error during run_rana_pipeline")
        raise HTTPException(status_code=500, detail=str(err))

    save_memory(session_id, result["messages"], user_id)
    memory_message_count = len(get_memory(session_id, user_id))

    return {
        "session_id": session_id,
        "hara_output": result.get("hara_output"),
        "bombom_output": result.get("bombom_output"),
        "luna_output": result.get("luna_output"),
        "hagen_output": result.get("hagen_output"),
        "rana_decision": result.get("rana_decision"),
        "steps_completed": result.get("current_step"),
        "memory_message_count": memory_message_count,
    }


telegram_sessions: dict[str, dict[str, Any]] = {}


def telegram_user_id(from_user: Optional[dict[str, Any]]) -> Optional[str]:
    if not from_user:
        return None
    raw_id = from_user.get("id")
    if raw_id is None:
        return None
    return str(raw_id)


def telegram_internal_user_id(raw_user_id: str) -> str:
    return f"telegram_{raw_user_id}"


def get_telegram_session(raw_user_id: str) -> dict[str, Any]:
    session = telegram_sessions.get(raw_user_id)
    if not session:
        session = {
            "session_id": f"telegram_{raw_user_id}",
            "product_context": "",
            "opts": {},
        }
        telegram_sessions[raw_user_id] = session
    return session


def reset_telegram_session(raw_user_id: str) -> dict[str, Any]:
    user_id = telegram_internal_user_id(raw_user_id)
    old_session = get_telegram_session(raw_user_id)
    session_memory.pop(memory_key(old_session["session_id"], user_id), None)
    session = {
        "session_id": f"telegram_{raw_user_id}_{int(asyncio.get_event_loop().time())}",
        "product_context": "",
        "opts": {},
    }
    telegram_sessions[raw_user_id] = session
    return session


def telegram_help_text() -> str:
    return (
        "Halo, ini Rana via Telegram.\n\n"
        "Kirim brief produk dengan format ini:\n\n"
        "Product name:\n"
        "Category:\n"
        "Key advantage:\n"
        "Target audience:\n"
        "Pain point:\n"
        "Price range:\n"
        "Ad platforms:\n\n"
        "Command:\n"
        "/new - mulai session baru\n"
        "/help - lihat format input\n"
        "/run - jalankan ulang brief terakhir\n"
        "/continue <tambahan> - tambah konteks untuk session terakhir\n"
        "/provider <provider> [model] - pilih provider untuk session ini\n"
        "/list providers - lihat provider yang didukung\n"
        "/list models <provider> - lihat model untuk provider tertentu\n"
        "/status - lihat provider/model yang aktif untuk sesi ini\n"
        "/full - lihat hasil JSON lengkap dari run terakhir\n\n"
        "Provider juga bisa ditentukan di brief dengan baris: Provider: openai"
    )


def format_telegram_error(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        detail = str(exc.detail)
        if exc.status_code == 400 and "Product context" in detail:
            return f"Brief belum lengkap.\n\n{detail}\n\nKetik /help untuk lihat format yang dibutuhkan."
        if exc.status_code == 429:
            return f"Session ini sudah terlalu panjang.\n\n{detail}\n\nKetik /new untuk mulai session baru."
        return f"Rana belum bisa memproses request ini.\n\n{detail}"
    return f"Rana mengalami error saat memproses request.\n\n{type(exc).__name__}: {exc}"


def summarize_json_text(raw: Optional[str], fallback_key: str) -> str:
    if not raw:
        return ""
    text = str(raw).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text
    # If parsed is not a dict, pretty-print and return.
    if not isinstance(parsed, dict):
        return json.dumps(parsed, ensure_ascii=False, indent=2)

    # Unwrap common top-level wrapper keys like 'rana_decision' or 'hara_output'.
    if isinstance(parsed, dict) and len(parsed) == 1:
        key = next(iter(parsed))
        inner = parsed.get(key)
        if isinstance(inner, dict):
            parsed = inner

    # If the agent returned a repair wrapper containing 'raw_output', try to parse it.
    if isinstance(parsed, dict) and "raw_output" in parsed and isinstance(parsed.get("raw_output"), str):
        raw_inner = parsed.get("raw_output") or ""
        try:
            inner = json.loads(raw_inner)
            if isinstance(inner, dict):
                parsed = inner
        except Exception:
            # leave parsed unchanged if raw_output isn't valid JSON
            pass

    priority_keys = [
        "final_decision",
        "recommendation",
        "user_summary",
        "ad_insight",
        "main_pain_point",
        "winning_concept",
        "concept",
        "concept_name",
        "headline",
        "script",
        "awareness_level",
        "awareness_target",
        "top_image_ads",
        "top_video_concepts",
        "concepts",
        "cta",
        "urgency_mechanism",
    ]

    lines: list[str] = []
    for key in priority_keys:
        value = parsed.get(key)
        if value:
            if isinstance(value, (list, dict)):
                pretty = json.dumps(value, ensure_ascii=False, indent=2)
                lines.append(f"{key.replace('_', ' ').title()}:\n{pretty}")
            else:
                lines.append(f"{key.replace('_', ' ').title()}: {value}")
    if lines:
        return "\n".join(lines)

    # Fallback: pretty-print the parsed dict under the fallback_key label.
    return json.dumps({fallback_key: parsed}, ensure_ascii=False, indent=2)


def summarize_json_text_compact(raw: Optional[str], section_name: str) -> str:
    """Compact summary for Telegram: key field + top 2-3 items."""
    if raw is None:
        return ""

    if isinstance(raw, dict):
        parsed = raw
    else:
        text = str(raw).strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return text[:200]  # Just first 200 chars if not JSON

    if isinstance(parsed, list):
        parsed = {section_name: parsed}
    if not isinstance(parsed, dict):
        return str(parsed)[:200]

    # Unwrap wrapper
    if len(parsed) == 1:
        key = next(iter(parsed))
        inner = parsed.get(key)
        if isinstance(inner, dict):
            parsed = inner

    # Unwrap raw_output if present
    if "raw_output" in parsed and isinstance(parsed.get("raw_output"), str):
        try:
            parsed = json.loads(parsed["raw_output"])
        except Exception:
            pass

    lines: list[str] = []

    # Section-specific extraction
    if section_name == "rana_decision":
        if "user_summary" in parsed:
            lines.append(f"User Summary: {str(parsed['user_summary'])[:200]}")

    elif section_name == "hara_output":
        if "awareness_level" in parsed:
            lines.append(
                f"{parsed['awareness_level']} -> {parsed.get('awareness_target', 'N/A')}")
        if "psychological_triggers" in parsed and isinstance(parsed["psychological_triggers"], list):
            triggers = parsed["psychological_triggers"][:2]
            for t in triggers:
                if isinstance(t, dict) and "trigger" in t:
                    lines.append(f"  - {t['trigger']}")

    elif section_name == "bombom_output":
        if "concepts" in parsed and isinstance(parsed["concepts"], list):
            concepts = parsed["concepts"][:3]
            for i, c in enumerate(concepts, 1):
                if isinstance(c, dict) and "headline" in c:
                    lines.append(f"{i}. {c['headline'][:60]}")

    elif section_name == "luna_output":
        if "concepts" in parsed and isinstance(parsed["concepts"], list):
            concepts = parsed["concepts"][:3]
            for i, c in enumerate(concepts, 1):
                if isinstance(c, dict):
                    name = c.get("name") or c.get("concept_name", "Concept")
                    lines.append(f"{i}. {name}")

    elif section_name == "hagen_output":
        if "execution_script" in parsed:
            lines.append(str(parsed["execution_script"])[:150])
        elif "script" in parsed:
            lines.append(str(parsed["script"])[:150])

    if lines:
        return "\n".join(lines)
    return ""


def format_rana_result_for_telegram(result: dict[str, Any]) -> str:
    sections = [
        ("RANA DECISION", summarize_json_text_compact(
            result.get("rana_decision"), "rana_decision")),
        ("HARA INSIGHT", summarize_json_text_compact(
            result.get("hara_output"), "hara_output")),
        ("BOMBOM ADS", summarize_json_text_compact(
            result.get("bombom_output"), "bombom_output")),
        ("LUNA VIDEO", summarize_json_text_compact(
            result.get("luna_output"), "luna_output")),
    ]
    hagen = summarize_json_text_compact(
        result.get("hagen_output"), "hagen_output")
    if hagen:
        sections.append(("HAGEN SCRIPT", hagen))

    rendered = []
    for title, body in sections:
        if body:
            rendered.append(f"{title}\n{body}")

    if not rendered:
        return "Rana selesai, tapi tidak ada output terstruktur yang bisa ditampilkan."

    msg = "\n\n---\n\n".join(rendered)
    msg += "\n\nKetik /full untuk lihat detail JSON lengkap."
    return msg


def split_telegram_message(text: str) -> list[str]:
    text = str(text or "")
    if len(text) <= TELEGRAM_MESSAGE_LIMIT:
        return [text]

    chunks = []
    remaining = text
    while len(remaining) > TELEGRAM_MESSAGE_LIMIT:
        split_at = remaining.rfind("\n\n", 0, TELEGRAM_MESSAGE_LIMIT)
        if split_at < TELEGRAM_MESSAGE_LIMIT // 2:
            split_at = TELEGRAM_MESSAGE_LIMIT
        chunks.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


async def send_telegram_message(chat_id: int | str, text: str) -> None:
    if not TELEGRAM_BOT_TOKEN:
        logger.warning(
            "TELEGRAM_BOT_TOKEN is not configured; cannot send Telegram message.")
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    async with httpx.AsyncClient(timeout=15.0) as client:
        for chunk in split_telegram_message(text):
            response = await client.post(url, json={
                "chat_id": chat_id,
                "text": chunk,
                "disable_web_page_preview": True,
            })
            if response.status_code >= 400:
                logger.warning("Telegram sendMessage failed: %s %s",
                               response.status_code, response.text)


def telegram_list_providers_text() -> str:
    return "Provider tersedia: " + ", ".join(sorted(PROVIDER_MODELS.keys()))


def telegram_list_models_text(provider: str) -> str:
    provider_lower = provider.lower()
    if provider_lower not in PROVIDER_MODELS:
        supported = ", ".join(sorted(PROVIDER_MODELS.keys()))
        return (
            f"Provider '{provider}' tidak dikenal. Provider yang didukung: {supported}."
        )
    models = PROVIDER_MODELS[provider_lower]
    return f"Model untuk {provider_lower}: " + ", ".join(models)


def telegram_session_status(session: dict[str, Any]) -> str:
    opts = session.get("opts") or {}
    provider = opts.get("provider", "anthropic")
    model = opts.get("model") or DEFAULT_MODEL_BY_PROVIDER.get(
        provider, "(default)")
    return f"Provider aktif: {provider}, Model aktif: {model}"


async def handle_telegram_text(chat_id: int | str, raw_user_id: str, text: str) -> None:
    text = str(text or "").strip()
    session = get_telegram_session(raw_user_id)

    if not text or text.startswith("/start") or text.startswith("/help"):
        await send_telegram_message(chat_id, telegram_help_text())
        return

    if text.startswith("/new"):
        reset_telegram_session(raw_user_id)
        await send_telegram_message(chat_id, "Session baru sudah dibuat. Kirim brief produk lengkap untuk mulai.")
        return

    if text.startswith("/status"):
        await send_telegram_message(chat_id, telegram_session_status(session))
        return

    if text.startswith("/list"):
        parts = text.split()
        if len(parts) == 1:
            await send_telegram_message(
                chat_id,
                "Gunakan /list providers atau /list models <provider>."
            )
            return
        if parts[1] == "providers":
            await send_telegram_message(chat_id, telegram_list_providers_text())
            return
        if parts[1] == "models":
            if len(parts) < 3:
                await send_telegram_message(
                    chat_id,
                    "Gunakan /list models <provider>. Contoh: /list models openai"
                )
                return
            await send_telegram_message(chat_id, telegram_list_models_text(parts[2]))
            return
        await send_telegram_message(
            chat_id,
            "Perintah /list tidak dikenal. Gunakan /list providers atau /list models <provider>."
        )
        return

    if text.startswith("/full"):
        session = get_telegram_session(raw_user_id)
        stored_result = session.get("last_result")
        if not stored_result:
            await send_telegram_message(chat_id, "Belum ada hasil untuk ditampilkan. Jalankan /run atau kirim brief dulu.")
            return
        full_json = json.dumps(stored_result, ensure_ascii=False, indent=2)
        for chunk in split_telegram_message(full_json):
            await send_telegram_message(chat_id, chunk)
        return

    if text.startswith("/provider"):
        opts = parse_provider_opts_from_command(text)
        if not opts or not opts.get("provider"):
            supported = ", ".join(sorted(PROVIDER_MODELS.keys()))
            await send_telegram_message(
                chat_id,
                f"Gunakan: /provider <provider> [model].\nContoh: /provider openai gpt-4o-mini\nProvider tersedia: {supported}"
            )
            return
        try:
            validate_opts(opts)
        except HTTPException as exc:
            await send_telegram_message(chat_id, format_telegram_error(exc))
            return
        session["opts"] = opts
        model_note = f" model {opts['model']}" if opts.get("model") else ""
        await send_telegram_message(chat_id, f"Provider Telegram disetel ke {opts['provider']}{model_note}.")
        return

    if text.startswith("/run"):
        if not session.get("product_context"):
            await send_telegram_message(chat_id, "Belum ada brief tersimpan. Kirim brief produk dulu, atau ketik /help.")
            return
        product_context = session["product_context"]
    elif text.startswith("/continue"):
        additional_input = text.replace("/continue", "", 1).strip()
        if not session.get("product_context"):
            await send_telegram_message(chat_id, "Belum ada brief tersimpan. Kirim brief produk dulu sebelum continue.")
            return
        if not is_meaningful_text(additional_input, 8):
            await send_telegram_message(chat_id, "Tambahan konteks terlalu pendek. Contoh: /continue target utamanya ibu bekerja usia 25-40.")
            return
        product_context = f"""{session["product_context"].strip()}

Additional context:
{additional_input}
"""
        session["product_context"] = product_context
    else:
        product_context = text
        session["product_context"] = product_context

    provider_opts = extract_provider_opts_from_context(product_context)
    if provider_opts:
        normalized_opts = normalize_provider_opts(provider_opts)
        try:
            validate_opts(normalized_opts)
        except HTTPException as exc:
            await send_telegram_message(chat_id, format_telegram_error(exc))
            return
        session["opts"] = normalized_opts

    await send_telegram_message(chat_id, "Rana mulai memproses brief. Ini bisa butuh beberapa menit.")
    await send_telegram_message(chat_id, telegram_session_status(session))
    try:
        result = await run_rana_pipeline(
            session["session_id"],
            telegram_internal_user_id(raw_user_id),
            product_context,
            TELEGRAM_DEFAULT_RUN_HAGEN,
            session.get("opts"),
        )
        session["last_result"] = result
    except Exception as exc:
        logger.exception("Telegram Rana run failed")
        await send_telegram_message(chat_id, format_telegram_error(exc))
        return

    await send_telegram_message(chat_id, format_rana_result_for_telegram(result))


@app.post("/telegram/webhook")
async def telegram_webhook(
    update: dict[str, Any],
    background_tasks: BackgroundTasks,
    x_telegram_bot_api_secret_token: Optional[str] = Header(None),
):
    """Receive Telegram updates and run Rana for allowed Telegram users."""
    if TELEGRAM_WEBHOOK_SECRET and x_telegram_bot_api_secret_token != TELEGRAM_WEBHOOK_SECRET:
        raise HTTPException(
            status_code=403, detail="Invalid Telegram webhook secret.")

    message = update.get("message") or update.get("edited_message") or {}
    chat = message.get("chat") or {}
    from_user = message.get("from") or {}
    chat_id = chat.get("id")
    raw_user_id = telegram_user_id(from_user)
    text = str(message.get("text") or "").strip()

    if not chat_id or not raw_user_id:
        return {"status": "ignored"}

    if TELEGRAM_ALLOWED_USER_IDS and raw_user_id not in TELEGRAM_ALLOWED_USER_IDS:
        background_tasks.add_task(
            send_telegram_message,
            chat_id,
            "Akses Telegram bot Rana belum diizinkan untuk akun ini. Kirim user ID ini ke admin: "
            f"{raw_user_id}",
        )
        return {"status": "forbidden"}

    if not text:
        background_tasks.add_task(
            send_telegram_message,
            chat_id,
            "Saat ini Rana Telegram hanya menerima pesan teks. Ketik /help untuk format brief.",
        )
        return {"status": "unsupported"}

    background_tasks.add_task(handle_telegram_text, chat_id, raw_user_id, text)
    return {"status": "accepted"}


@app.post("/api/run")
async def run_agents(
    request: RunRequest,
    claims: dict[str, Any] = Depends(require_firebase_user),
):
    """Run the full multi-agent pipeline."""
    user_id = resolve_authenticated_user_id(request.user_id, claims)
    return await run_rana_pipeline(
        request.session_id,
        user_id,
        request.product_context,
        request.run_hagen,
        request.opts,
    )


@app.post("/api/continue")
async def continue_agents(
    request: ContinueRequest,
    claims: dict[str, Any] = Depends(require_firebase_user),
):
    """Add user input to an existing session and rerun the pipeline."""
    user_id = resolve_authenticated_user_id(request.user_id, claims)
    validate_product_context(request.product_context)
    if not is_meaningful_text(request.additional_input, 8):
        raise HTTPException(
            status_code=400,
            detail="additional_input is too short. Add specific context for the revision."
        )

    ensure_session_capacity(
        request.session_id, user_id, added_messages=7)
    history = get_memory(request.session_id, user_id)
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

    save_memory(request.session_id, result["messages"], user_id)
    memory_message_count = len(get_memory(request.session_id, user_id))

    return {
        "session_id": request.session_id,
        "hara_output": result.get("hara_output"),
        "bombom_output": result.get("bombom_output"),
        "luna_output": result.get("luna_output"),
        "hagen_output": result.get("hagen_output"),
        "rana_decision": result.get("rana_decision"),
        "steps_completed": result.get("current_step"),
        "memory_message_count": memory_message_count,
    }


@app.post("/api/upload")
async def upload_file(
    session_id: str = Form(...),
    user_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
    claims: dict[str, Any] = Depends(require_firebase_user),
):
    """Upload a product brief or document."""
    resolved_user_id = resolve_authenticated_user_id(user_id, claims)
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

    key = memory_key(session_id, resolved_user_id)
    if key not in session_memory:
        session_memory[key] = []

    # Store uploaded file text in session memory.
    file_entry = f"[FILE: {filename}]\n{text_content[:3000]}"
    session_memory[key].append({"role": "user", "content": file_entry})
    save_memory(session_id, session_memory[key], resolved_user_id)

    return {
        "status": "ok",
        "file_name": filename,
        "preview": text_content[:200],
        "memory_message_count": len(get_memory(session_id, resolved_user_id)),
    }


@app.post("/api/feedback")
async def save_feedback(
    data: FeedbackRequest,
    claims: dict[str, Any] = Depends(require_firebase_user),
):
    """Save user feedback for Rana learning."""
    user_id = resolve_authenticated_user_id(data.user_id, claims)
    if not data.feedback.strip():
        raise HTTPException(
            status_code=400, detail="feedback must not be empty")

    rana_learning.append({
        "session_id": data.session_id,
        "user_id": user_id,
        "insight": data.feedback,
        "timestamp": str(asyncio.get_event_loop().time())
    })
    return {"status": "saved"}


@app.get("/api/history/{user_id}")
async def get_user_history(
    user_id: str,
    claims: dict[str, Any] = Depends(require_firebase_user),
):
    """Return persisted account history shared across browsers."""
    resolved_user_id = resolve_authenticated_user_id(user_id, claims)
    db = read_history_db()
    history = db.get(resolved_user_id, {})
    return {
        "sessions": history.get("sessions", []),
        "states": history.get("states", {}),
    }


@app.put("/api/history/{user_id}")
async def save_user_history(
    user_id: str,
    payload: HistoryPayload,
    claims: dict[str, Any] = Depends(require_firebase_user),
):
    """Persist account history on the backend so browsers share one source."""
    resolved_user_id = resolve_authenticated_user_id(user_id, claims)
    db = read_history_db()
    db[resolved_user_id] = {
        "sessions": payload.sessions[:10],
        "states": payload.states,
    }
    write_history_db(db)
    return {"status": "saved"}


@app.get("/api/memory/{session_id}")
async def get_session_memory(
    session_id: str,
    user_id: Optional[str] = Query(None),
    claims: dict[str, Any] = Depends(require_firebase_user),
):
    resolved_user_id = resolve_authenticated_user_id(user_id, claims)
    return {"messages": get_memory(session_id, resolved_user_id)}


@app.delete("/api/memory/{session_id}")
async def clear_session_memory(
    session_id: str,
    user_id: Optional[str] = Query(None),
    claims: dict[str, Any] = Depends(require_firebase_user),
):
    resolved_user_id = resolve_authenticated_user_id(user_id, claims)
    session_memory.pop(memory_key(session_id, resolved_user_id), None)
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
    return {
        "status": "ok",
        "agents": ["Rana", "Hara", "Bombom", "Luna", "Hagen"],
        "firebase_auth_required": FIREBASE_AUTH_REQUIRED,
        "firebase_admin_ready": FIREBASE_ADMIN_READY,
        "telegram_bot_configured": bool(TELEGRAM_BOT_TOKEN),
        "telegram_allowed_users_configured": bool(TELEGRAM_ALLOWED_USER_IDS),
    }

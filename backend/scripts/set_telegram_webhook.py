import os
from pathlib import Path

import httpx
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR / ".env.local", override=True)

bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
backend_public_url = os.environ.get("BACKEND_PUBLIC_URL", "").strip().rstrip("/")
webhook_secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()

if not bot_token:
    raise SystemExit("TELEGRAM_BOT_TOKEN is missing in backend/.env")
if not backend_public_url:
    raise SystemExit("BACKEND_PUBLIC_URL is missing in backend/.env")

webhook_url = f"{backend_public_url}/telegram/webhook"
payload = {
    "url": webhook_url,
    "drop_pending_updates": True,
}
if webhook_secret:
    payload["secret_token"] = webhook_secret

response = httpx.post(
    f"https://api.telegram.org/bot{bot_token}/setWebhook",
    json=payload,
    timeout=20,
)
data = response.json()
if not data.get("ok"):
    raise SystemExit(f"Telegram setWebhook failed: {data}")

info = httpx.get(
    f"https://api.telegram.org/bot{bot_token}/getWebhookInfo",
    timeout=20,
).json()
result = info.get("result", {})

print("Telegram webhook set.")
print(f"url: {result.get('url')}")
print(f"pending_update_count: {result.get('pending_update_count')}")
print(f"last_error_message: {result.get('last_error_message')}")

"""Platform-neutral publishing with durable idempotency receipts."""

from __future__ import annotations

import json
import uuid
from typing import Any

from config import utc_now
from db import db, row_dict
from .instagram import InstagramPublisher
from .tiktok import TikTokPublisher
from .youtube import YouTubePublisher

PUBLISHERS = {
    "instagram": InstagramPublisher(),
    "tiktok": TikTokPublisher(),
    "youtube": YouTubePublisher(),
}


def publish(platform: str, project: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    publisher = PUBLISHERS.get(platform)
    if not publisher:
        raise ValueError("Unsupported publishing platform.")
    key = str(payload.get("idempotency_key", "")).strip()[:160]
    if not key:
        raise ValueError("idempotency_key is required for publishing.")
    with db() as conn:
        existing = conn.execute("SELECT * FROM publish_receipts WHERE platform = ? AND idempotency_key = ?", (platform, key)).fetchone()
    receipt = row_dict(existing)
    if receipt and receipt["status"] == "succeeded":
        return {**(receipt.get("result_json") or {}), "deduplicated": True, "idempotency_key": key}
    now = utc_now()
    with db() as conn:
        conn.execute("""INSERT INTO publish_receipts
            (id, platform, idempotency_key, project_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'running', ?, ?)
            ON CONFLICT(platform, idempotency_key) DO UPDATE SET status = 'running', error_text = NULL, updated_at = excluded.updated_at""",
            (str(uuid.uuid4()), platform, key, project["id"], now, now))
    try:
        result = publisher.publish(project, payload)
        with db() as conn:
            conn.execute("UPDATE publish_receipts SET status = 'succeeded', result_json = ?, updated_at = ? WHERE platform = ? AND idempotency_key = ?", (json.dumps(result), utc_now(), platform, key))
        return {**result, "deduplicated": False, "idempotency_key": key}
    except Exception as exc:
        with db() as conn:
            conn.execute("UPDATE publish_receipts SET status = 'failed', error_text = ?, updated_at = ? WHERE platform = ? AND idempotency_key = ?", (str(exc), utc_now(), platform, key))
        raise

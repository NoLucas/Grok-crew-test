"""Platform-neutral publishing with durable idempotency receipts."""

from __future__ import annotations

import json
import os
import re
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

_PREFIXED_SECRET_RE = re.compile(
    r"(?i)(bearer\s+|oauth\s+|authorization[=:\s]+|refresh_token[=:\s]+|access_token[=:\s]+|client_secret[=:\s]+|api[_-]?key[=:\s]+|token=)\S+"
)
_BARE_SECRET_RE = re.compile(
    r"(?i)(ya29\.[A-Za-z0-9._-]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9]+)"
)
_RETRY_PAYLOAD_KEYS = frozenset(
    {
        "render_path",
        "caption",
        "title",
        "description",
        "privacy_status",
        "privacy_level",
        "share_to_feed",
        "made_for_kids",
        "tags",
        "category_id",
        "disable_duet",
        "disable_comment",
        "disable_stitch",
        "is_aigc",
    }
)


def sanitize_publish_error(value: str) -> str:
    text = _PREFIXED_SECRET_RE.sub(r"\1[redacted]", str(value)[:500])
    return _BARE_SECRET_RE.sub("[redacted]", text)


def publisher_credentials() -> dict[str, dict[str, Any]]:
    instagram = bool(os.getenv("INSTAGRAM_ACCESS_TOKEN") and os.getenv("INSTAGRAM_USER_ID") and os.getenv("INSTAGRAM_API_VERSION"))
    return {
        "instagram": {"configured": instagram, "oauth": "external_or_env"},
        "tiktok": {"configured": bool(os.getenv("TIKTOK_ACCESS_TOKEN", "").strip()), "oauth": "external_or_env"},
        "youtube": {"configured": bool(os.getenv("YOUTUBE_ACCESS_TOKEN", "").strip()), "oauth": "external_or_env"},
    }


def receipt_dict(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row["id"],
        "platform": row["platform"],
        "idempotency_key": row["idempotency_key"],
        "project_id": row["project_id"],
        "status": row["status"],
        "result": row.get("result_json") or {},
        "error_text": row.get("error_text"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_publish_receipts(project_id: str) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM publish_receipts WHERE project_id = ? ORDER BY updated_at DESC LIMIT 50",
            (project_id,),
        ).fetchall()
    return [item for item in (receipt_dict(row_dict(row)) for row in rows) if item]


def reconcile_publish_receipts() -> int:
    now = utc_now()
    with db() as conn:
        changed = conn.execute(
            "UPDATE publish_receipts SET status = 'failed', error_text = ?, updated_at = ? WHERE status = 'running'",
            ("Interrupted by an unclean Local Studio shutdown.", now),
        )
        return int(changed.rowcount or 0)


def retry_publish(project: dict[str, Any], receipt_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM publish_receipts WHERE id = ? AND project_id = ?", (receipt_id, project["id"])).fetchone()
    receipt = row_dict(row)
    if not receipt:
        raise ValueError("Publish receipt not found.")
    if receipt["status"] == "succeeded":
        return {**(receipt.get("result_json") or {}), "deduplicated": True, "idempotency_key": receipt["idempotency_key"]}
    if receipt["status"] == "running":
        raise ValueError("This publish receipt is already running.")
    incoming = payload if isinstance(payload, dict) else {}
    retry_payload = {key: incoming[key] for key in _RETRY_PAYLOAD_KEYS if key in incoming}
    retry_payload["idempotency_key"] = receipt["idempotency_key"]
    return publish(receipt["platform"], project, retry_payload)


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
            conn.execute("UPDATE publish_receipts SET status = 'failed', error_text = ?, updated_at = ? WHERE platform = ? AND idempotency_key = ?", (sanitize_publish_error(str(exc)), utc_now(), platform, key))
        raise RuntimeError(sanitize_publish_error(str(exc))) from exc

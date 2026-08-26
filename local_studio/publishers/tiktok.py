from __future__ import annotations

import math
import os
from typing import Any

from config import workspace_relative

from .base import media_path, mime_type, request_with_backoff, require_https_upload_url


class TikTokPublisher:
    platform = "tiktok"

    def publish(self, project: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        try:
            import requests
        except ImportError as exc:
            raise RuntimeError("Requests is not installed.") from exc
        token = os.getenv("TIKTOK_ACCESS_TOKEN", "").strip()
        if not token:
            raise RuntimeError("TikTok OAuth is not configured locally. Set TIKTOK_ACCESS_TOKEN or connect the official OAuth flow.")
        path = media_path(project, payload)
        total = path.stat().st_size
        chunk = min(64 * 1024 ** 2, max(5 * 1024 ** 2, int(payload.get("chunk_size", 10 * 1024 ** 2))))
        chunks = max(1, math.ceil(total / chunk))
        audited = os.getenv("TIKTOK_APP_AUDITED", "").lower() in {"1", "true", "yes"}
        requested_privacy = str(payload.get("privacy_level", "SELF_ONLY"))
        privacy = requested_privacy if audited else "SELF_ONLY"
        init = request_with_backoff(requests, "POST", "https://open.tiktokapis.com/v2/post/publish/video/init/", headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"}, json={
            "post_info": {
                "title": str(payload.get("caption", project.get("caption", "")))[:2200],
                "privacy_level": privacy,
                "disable_duet": bool(payload.get("disable_duet", False)),
                "disable_comment": bool(payload.get("disable_comment", False)),
                "disable_stitch": bool(payload.get("disable_stitch", False)),
                "is_aigc": bool(payload.get("is_aigc", False)),
            },
            "source_info": {"source": "FILE_UPLOAD", "video_size": total, "chunk_size": chunk, "total_chunk_count": chunks},
        }, timeout=45)
        init.raise_for_status(); value = init.json()
        if value.get("error", {}).get("code") not in {None, "ok"}:
            raise RuntimeError(f"TikTok initialization failed: {value.get('error')}")
        data = value.get("data") or {}; upload_url, publish_id = data.get("upload_url"), data.get("publish_id")
        if not upload_url or not publish_id:
            raise RuntimeError("TikTok did not return upload_url and publish_id.")
        upload_url = require_https_upload_url(str(upload_url), field="TikTok upload URL")
        with path.open("rb") as media:
            offset = 0
            while offset < total:
                body = media.read(chunk); last = offset + len(body) - 1
                uploaded = request_with_backoff(requests, "PUT", upload_url, headers={"Content-Type": mime_type(path), "Content-Length": str(len(body)), "Content-Range": f"bytes {offset}-{last}/{total}"}, data=body, timeout=900)
                uploaded.raise_for_status(); offset = last + 1
        return {"platform": "tiktok", "publish_id": publish_id, "privacy_level": privacy, "audit_fallback": not audited and requested_privacy != "SELF_ONLY", "source_path": workspace_relative(path)}

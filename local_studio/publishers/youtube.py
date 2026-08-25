from __future__ import annotations

import os
from typing import Any

from .base import media_path, mime_type, request_with_backoff


class YouTubePublisher:
    platform = "youtube"

    def publish(self, project: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        try:
            import requests
        except ImportError as exc:
            raise RuntimeError("Requests is not installed.") from exc
        token = os.getenv("YOUTUBE_ACCESS_TOKEN", "").strip()
        if not token:
            raise RuntimeError("YouTube OAuth is not configured locally. Set YOUTUBE_ACCESS_TOKEN or connect the official OAuth flow.")
        path = media_path(project, payload, maximum=256 * 1024 ** 3)
        size, content_type = path.stat().st_size, mime_type(path)
        privacy = str(payload.get("privacy_status", "private"))
        if privacy not in {"private", "unlisted", "public"}:
            raise ValueError("YouTube privacy_status must be private, unlisted, or public.")
        metadata = {
            "snippet": {
                "title": str(payload.get("title", project.get("title", "Grok Crew video")))[:100],
                "description": str(payload.get("description", payload.get("caption", project.get("caption", ""))))[:5000],
                "categoryId": str(payload.get("category_id", "22")),
                "tags": list(payload.get("tags", []))[:30] if isinstance(payload.get("tags"), list) else [],
            },
            "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": bool(payload.get("made_for_kids", False))},
        }
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": str(size), "X-Upload-Content-Type": content_type}
        initiated = request_with_backoff(requests, "POST", "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", headers=headers, json=metadata, timeout=45)
        initiated.raise_for_status(); upload_url = initiated.headers.get("Location")
        if not upload_url:
            raise RuntimeError("YouTube did not return a resumable upload URL.")
        with path.open("rb") as media:
            uploaded = request_with_backoff(requests, "PUT", upload_url, headers={"Authorization": f"Bearer {token}", "Content-Type": content_type, "Content-Length": str(size)}, data=media, timeout=1800)
        uploaded.raise_for_status(); value = uploaded.json()
        if not value.get("id"):
            raise RuntimeError(f"YouTube upload returned no video id: {value}")
        return {"platform": "youtube", "youtube_video_id": value["id"], "privacy_status": privacy, "source_path": str(path)}

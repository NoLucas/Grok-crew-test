"""Local Video Studio: Instagram Reels resumable-upload publishing."""

from __future__ import annotations

import os
import re
import time
from typing import Any

from config import require_path, workspace_relative
from publishers.base import require_https_upload_url

_API_VERSION_RE = re.compile(r"^v\d+(\.\d+)?$")
_SAFE_ID_RE = re.compile(r"^[\w.-]+$")


def instagram_publish(project: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    try:
        import requests
    except ImportError as exc:
        raise RuntimeError("Requests is not installed. Install local_studio/requirements.txt first.") from exc
    token = os.getenv("INSTAGRAM_ACCESS_TOKEN", "").strip()
    user_id = os.getenv("INSTAGRAM_USER_ID", "").strip()
    version = os.getenv("INSTAGRAM_API_VERSION", "").strip()
    if not token or not user_id or not version:
        raise RuntimeError("Instagram credentials are not configured locally. Set INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, and INSTAGRAM_API_VERSION in local_studio/.env.")
    if not _API_VERSION_RE.fullmatch(version):
        raise RuntimeError("INSTAGRAM_API_VERSION must look like v21.0.")
    if not _SAFE_ID_RE.fullmatch(user_id):
        raise RuntimeError("INSTAGRAM_USER_ID is invalid.")
    media_path = require_path(payload.get("render_path", project["output_path"]), "render_path")
    if not media_path.exists():
        raise RuntimeError(f"Approved render does not exist: {media_path}")
    if media_path.stat().st_size > 1024 * 1024 * 1024:
        raise RuntimeError("Instagram Reel file exceeds the 1 GB local upload limit.")
    if media_path.suffix.lower() not in {".mp4", ".mov", ".mkv", ".avi"}:
        raise RuntimeError("Instagram upload expects a supported local video format.")
    caption = str(payload.get("caption", project.get("caption", "")))[:2200]
    api = f"https://graph.instagram.com/{version}/{user_id}"
    container = requests.post(f"{api}/media", data={"media_type": "REELS", "upload_type": "resumable", "caption": caption, "share_to_feed": str(bool(payload.get("share_to_feed", False))).lower()}, headers={"Authorization": f"Bearer {token}"}, timeout=45)
    container.raise_for_status()
    container_data = container.json()
    container_id, upload_uri = container_data.get("id"), container_data.get("uri")
    if not container_id or not upload_uri:
        raise RuntimeError("Instagram did not return a resumable upload container URI.")
    if not _SAFE_ID_RE.fullmatch(str(container_id)):
        raise RuntimeError("Instagram returned an invalid container id.")
    upload_uri = require_https_upload_url(str(upload_uri), field="Instagram upload URI")
    with media_path.open("rb") as media:
        upload = requests.post(upload_uri, headers={"Authorization": f"OAuth {token}", "offset": "0", "file_size": str(media_path.stat().st_size), "Content-Type": "application/octet-stream"}, data=media, timeout=900)
        upload.raise_for_status()
    deadline = time.time() + 90
    status_data: dict[str, Any] = {}
    while time.time() < deadline:
        status = requests.get(f"https://graph.instagram.com/{version}/{container_id}", params={"fields": "status_code,status"}, headers={"Authorization": f"Bearer {token}"}, timeout=30)
        status.raise_for_status(); status_data = status.json()
        if status_data.get("status_code") == "FINISHED":
            break
        if status_data.get("status_code") in {"ERROR", "EXPIRED"}:
            raise RuntimeError(f"Instagram container failed: {status_data}")
        time.sleep(3)
    else:
        raise RuntimeError("Instagram processing did not finish within 90 seconds.")
    published = requests.post(f"{api}/media_publish", data={"creation_id": container_id}, headers={"Authorization": f"Bearer {token}"}, timeout=45)
    published.raise_for_status()
    return {"container_id": container_id, "container_status": status_data, "instagram_media_id": published.json().get("id"), "source_path": workspace_relative(media_path)}

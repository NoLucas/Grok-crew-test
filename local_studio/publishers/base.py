"""Shared Publisher contract and upload helpers."""

from __future__ import annotations

import mimetypes
import time
from pathlib import Path
from typing import Any, Protocol

from config import require_path


class Publisher(Protocol):
    platform: str

    def publish(self, project: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]: ...


def media_path(project: dict[str, Any], payload: dict[str, Any], *, maximum: int = 4 * 1024 ** 3) -> Path:
    path = require_path(payload.get("render_path", project["output_path"]), "render_path")
    if not path.exists() or not path.is_file():
        raise RuntimeError(f"Approved render does not exist: {path}")
    if path.stat().st_size > maximum:
        raise RuntimeError(f"Publish file exceeds the {maximum}-byte local limit.")
    if path.suffix.lower() not in {".mp4", ".mov", ".webm"}:
        raise RuntimeError("Publisher expects MP4, MOV, or WebM video.")
    return path


def mime_type(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def request_with_backoff(requests_module, method: str, url: str, *, attempts: int = 5, **kwargs):
    last = None
    for attempt in range(attempts):
        try:
            response = requests_module.request(method, url, **kwargs)
            if response.status_code not in {429, 500, 502, 503, 504}:
                return response
            last = RuntimeError(f"{response.status_code}: {response.text[:500]}")
        except requests_module.RequestException as exc:
            last = exc
        if attempt + 1 < attempts:
            time.sleep(min(16, 2 ** attempt))
    raise RuntimeError(f"Publish request failed after {attempts} attempts: {last}")

"""Shared Publisher contract and upload helpers."""

from __future__ import annotations

import ipaddress
import mimetypes
import socket
import time
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.parse import urlparse

from config import require_path

_ALLOWED_UPLOAD_HOST_SUFFIXES = (
    "googleapis.com",
    "googleusercontent.com",
    "instagram.com",
    "facebook.com",
    "fbcdn.net",
    "tiktok.com",
    "tiktokapis.com",
    "tiktokv.com",
    "byteoversea.com",
    "byteoversea.net",
    "ibytedtos.com",
)


def _hostname_allowed(hostname: str) -> bool:
    host = hostname.rstrip(".").lower()
    if not host or host == "localhost":
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in _ALLOWED_UPLOAD_HOST_SUFFIXES)


def require_https_upload_url(
    url: str,
    *,
    field: str = "upload URL",
    resolver: Callable[..., list[tuple[Any, ...]]] | None = None,
) -> str:
    """Reject SSRF-prone upload targets before the sidecar follows a platform URL."""
    parsed = urlparse(str(url))
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise RuntimeError(f"{field} must be a https URL without credentials")
    hostname = parsed.hostname or ""
    if not _hostname_allowed(hostname):
        raise RuntimeError(f"{field} host is not allowed")
    lookup = resolver or socket.getaddrinfo
    try:
        infos = lookup(hostname, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise RuntimeError(f"{field} host could not be resolved") from exc
    for info in infos:
        address = info[4][0]
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise RuntimeError(f"{field} resolved to a blocked address")
    return url


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
    require_https_upload_url(url)
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

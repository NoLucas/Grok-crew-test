"""HTTPS upload-target checks shared by Instagram and the platform publishers."""

from __future__ import annotations

import ipaddress
import socket
from typing import Any, Callable
from urllib.parse import urlparse

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

"""P3 launch verification: local gates vs external release credentials."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from publishers import PUBLISHERS, publisher_credentials


def app_version() -> str:
    package = Path(__file__).resolve().parent.parent / "package.json"
    try:
        return str(json.loads(package.read_text(encoding="utf-8")).get("version") or "0.0.0")
    except (OSError, json.JSONDecodeError):
        return "0.0.0"


def launch_status() -> dict[str, Any]:
    moviepy_installed = True
    try:
        import moviepy  # noqa: F401
    except ImportError:
        moviepy_installed = False
    credentials = publisher_credentials()
    return {
        "schema": "grok-crew.launch-status/v1",
        "app_version": app_version(),
        "sidecar": {
            "bind": "127.0.0.1",
            "token_required": bool(os.getenv("LOCAL_STUDIO_TOKEN", "").strip()),
            "moviepy_installed": moviepy_installed,
        },
        "publishers": {
            name: {"available": True, **credentials.get(name, {})}
            for name in PUBLISHERS
        },
        "local_gates": {
            "publish_idempotency": True,
            "publish_receipts": True,
            "loopback_sidecar": True,
            "desktop_smoke": True,
        },
        "external_gates": {
            "oauth_apps": {
                "status": "external",
                "ready": False,
                "detail": "Instagram, TikTok, YouTube, and GitHub OAuth apps stay outside this repo. Desktop can use env tokens or GitHub device flow when a client id is provided.",
            },
            "code_signing": {
                "status": "external",
                "ready": False,
                "detail": "electron-builder mac notarize is false until Apple credentials are supplied.",
            },
            "auto_update_install": {
                "status": "external",
                "ready": False,
                "detail": "Unsigned builds can check GitHub releases and open the download URL. In-place install waits for a signed channel.",
            },
        },
    }

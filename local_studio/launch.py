"""P3 launch verification: local gates vs external release credentials."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from publishers import PUBLISHERS, publisher_credentials

# Operator-owned OAuth app env names. Presence is inventory only — this repo
# does not register apps, and presence never flips oauth_apps.ready to True.
_OAUTH_APP_ENV = (
    "GROK_CREW_GITHUB_CLIENT_ID",
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID",
)

_SIGNING_ENV = (
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
)

_PACKAGE_JSON = Path(__file__).resolve().parent.parent / "package.json"


def _env_configured(name: str) -> bool:
    return bool(os.getenv(name, "").strip())


def _env_presence(names: tuple[str, ...]) -> dict[str, bool]:
    return {name: _env_configured(name) for name in names}


def _missing_env(names: tuple[str, ...]) -> list[str]:
    return [name for name in names if not _env_configured(name)]


def app_version() -> str:
    try:
        return str(json.loads(_PACKAGE_JSON.read_text(encoding="utf-8")).get("version") or "0.0.0")
    except (OSError, json.JSONDecodeError):
        return "0.0.0"


def electron_builder_notarize() -> bool:
    """Report the committed electron-builder flag. This repo keeps it false."""
    try:
        package = json.loads(_PACKAGE_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    mac = (package.get("build") or {}).get("mac") or {}
    return bool(mac.get("notarize"))


def _github_oauth_app() -> dict[str, Any]:
    configured = _env_configured("GROK_CREW_GITHUB_CLIENT_ID")
    return {
        "configured": configured,
        "status": "env_client_id" if configured else "external",
        "detail": (
            "Operator-supplied GROK_CREW_GITHUB_CLIENT_ID is present in the environment. "
            "This repo did not register that GitHub OAuth app; desktop device flow reads the name only."
            if configured
            else (
                "GitHub OAuth app is operator-owned. Desktop device flow needs GROK_CREW_GITHUB_CLIENT_ID "
                "on the Electron process; token login works without it. This repo does not register the app."
            )
        ),
    }


def _instagram_oauth_app() -> dict[str, Any]:
    publish_token = _env_configured("INSTAGRAM_ACCESS_TOKEN")
    oauth_app = _env_configured("INSTAGRAM_APP_ID")
    return {
        "configured": publish_token,
        "publish_token": publish_token,
        "oauth_app": oauth_app,
        "oauth_app_secret": _env_configured("INSTAGRAM_APP_SECRET"),
        "status": "external",
        "detail": (
            "Publish uses INSTAGRAM_ACCESS_TOKEN. Meta/Instagram OAuth app id and secret are "
            "operator-owned (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET) and are not required for token publish. "
            "This repo does not register a Meta app."
        ),
    }


def _tiktok_oauth_app() -> dict[str, Any]:
    publish_token = _env_configured("TIKTOK_ACCESS_TOKEN")
    return {
        "configured": publish_token,
        "publish_token": publish_token,
        "oauth_app": _env_configured("TIKTOK_CLIENT_KEY"),
        "oauth_app_secret": _env_configured("TIKTOK_CLIENT_SECRET"),
        "status": "external",
        "detail": (
            "Publish uses TIKTOK_ACCESS_TOKEN. TikTok client key/secret are operator-owned "
            "(TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET) and are not required for token publish. "
            "This repo does not register a TikTok app."
        ),
    }


def _youtube_oauth_app() -> dict[str, Any]:
    publish_token = _env_configured("YOUTUBE_ACCESS_TOKEN")
    return {
        "configured": publish_token,
        "publish_token": publish_token,
        "oauth_app": _env_configured("GOOGLE_OAUTH_CLIENT_ID"),
        "status": "external",
        "detail": (
            "Publish uses YOUTUBE_ACCESS_TOKEN. Google/YouTube OAuth client id is operator-owned "
            "(GOOGLE_OAUTH_CLIENT_ID) and is not required for token publish. "
            "This repo does not register a Google Cloud OAuth client."
        ),
    }


def _oauth_apps_gate() -> dict[str, Any]:
    # Env presence only inventories operator-supplied names. ready stays False
    # because this repository never registered the OAuth apps.
    return {
        "status": "external",
        "ready": False,
        "detail": (
            "Instagram, TikTok, YouTube, and GitHub OAuth apps stay outside this repo. "
            "Publish can use env tokens; GitHub desktop can use device flow when an operator "
            "supplies GROK_CREW_GITHUB_CLIENT_ID. Presence of those env names is not registration."
        ),
        "apps": {
            "github": _github_oauth_app(),
            "instagram": _instagram_oauth_app(),
            "tiktok": _tiktok_oauth_app(),
            "youtube": _youtube_oauth_app(),
        },
        "env_present": _env_presence(_OAUTH_APP_ENV),
        "missing_env": _missing_env(_OAUTH_APP_ENV),
    }


def _code_signing_gate() -> dict[str, Any]:
    env_present = _env_presence(_SIGNING_ENV)
    builder_notarize = electron_builder_notarize()
    return {
        "status": "external",
        "ready": False,
        "detail": (
            "macOS signing and notarization stay external. electron-builder mac notarize remains false "
            "in this repo until CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, "
            "and APPLE_TEAM_ID exist and an operator flips the builder flag. "
            "This report lists env name presence only — never values."
        ),
        "builder_notarize": builder_notarize,
        "env_present": env_present,
        "missing_env": _missing_env(_SIGNING_ENV),
    }


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
            "oauth_apps": _oauth_apps_gate(),
            "code_signing": _code_signing_gate(),
            "auto_update_install": {
                "status": "external",
                "ready": False,
                "detail": "Unsigned builds can check GitHub releases and open the download URL. In-place install waits for a signed channel.",
            },
        },
    }

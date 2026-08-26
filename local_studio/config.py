"""Local Video Studio: shared configuration, paths, and small path/font helpers."""

from __future__ import annotations

import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def load_dotenv() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


# Must run before any os.getenv() default below is evaluated -- these are module-level
# constants read once at import time, so a caller loading .env later (e.g. in main())
# would be too late for them.
load_dotenv()

BUNDLED_CAPTION_FONT = BASE_DIR / "assets" / "fonts" / "NotoSansKR-Bold.ttf"
DATA_DIR = Path(os.getenv("LOCAL_STUDIO_DATA", BASE_DIR / "data")).resolve()
WORKSPACE_DIR = Path(os.getenv("LOCAL_STUDIO_WORKSPACE", BASE_DIR / "workspace")).resolve()
DB_PATH = DATA_DIR / "studio.db"
BOT_GUIDE_PATH = BASE_DIR / "bot-guide.json"
BOT_GUIDE_KO_PATH = BASE_DIR / "bot-guide.ko.json"
BOT_GUIDE_ZH_PATH = BASE_DIR / "bot-guide.zh.json"
BOT_GUIDE_JA_PATH = BASE_DIR / "bot-guide.ja.json"
TERMINAL_CLI_PATH = BASE_DIR / "grok_crew.py"


def parse_allowed_origins(raw: str) -> frozenset[str]:
    """Comma-separated LOCAL_STUDIO_ALLOWED_ORIGINS override, falling back to the
    stock localhost:3000 pair so a blank/unset value stays exactly as restrictive
    as before this was configurable."""
    origins = {origin.strip() for origin in raw.split(",") if origin.strip()}
    return frozenset(origins) if origins else frozenset({"http://localhost:3000", "http://127.0.0.1:3000"})


_LOOPBACK_ORIGIN = re.compile(r"^https?://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$")


def origin_is_allowed(origin: str | None, allowed: frozenset[str] | None = None) -> bool:
    """Same-origin (no Origin) and loopback preview ports can call the sidecar.

    Remote websites stay blocked. Extra non-loopback origins still come from
    LOCAL_STUDIO_ALLOWED_ORIGINS.
    """
    if origin is None or origin == "":
        return True
    allowlist = ALLOWED_ORIGINS if allowed is None else allowed
    return origin in allowlist or bool(_LOOPBACK_ORIGIN.fullmatch(origin))


ALLOWED_ORIGINS = parse_allowed_origins(os.getenv("LOCAL_STUDIO_ALLOWED_ORIGINS", ""))
SITE_BASE_URL = "http://localhost:3000"
BROWSER_PAGE_PATHS = {"/", "/edit", "/cut", "/production", "/operations", "/bots", "/bot-guide", "/terminal", "/library", "/agent", "/connect", "/packet", "/gates", "/export", "/privacy"}
PUBLIC_GET_PATHS = frozenset({"/health", "/api/terminal-contract", "/api/bot-guide", "/api/bot-entry", "/downloads/grok-crew.py"})
DEFAULT_EDIT_METHOD = {
    "schema": "local-video-workspace.edit-method/v1",
    "hook_strategy": "payoff_first",
    "pacing": "tight",
    "filler_policy": "remove",
    "caption_mode": "burn_in",
    "reframe_anchor": "center",
    "look": "natural",
    "audio_policy": "normalize",
    "speed": 1.0,
    "fps": 30,
    "quality": "balanced",
}
BOT_ENTRY_SCHEMA = "local-video-workspace.bot-entry/v1"
PROJECT_BUNDLE_SCHEMA = "local-video-workspace.project-bundle/v1"
ARTIFACT_TYPES = {"audio_plan", "bot_task", "brand_kit", "cut_map", "edit_variant", "media_inspection", "overlay_slots", "performance_note", "preflight_report", "project_memory", "quality_report"}
EXECUTION_MODES = {"auto_local", "approval_required"}
RENDER_EXECUTOR = ThreadPoolExecutor(max_workers=max(1, int(os.getenv("LOCAL_STUDIO_RENDER_WORKERS", "1"))))
PLATFORM_PRESETS = {
    "reels_tiktok_shorts": {"width": 1080, "height": 1920, "label": "Reels / TikTok / Shorts (9:16)"},
    "feed_square": {"width": 1080, "height": 1080, "label": "Feed / Square (1:1)"},
    "landscape_x": {"width": 1920, "height": 1080, "label": "Landscape / X (16:9)"},
}
QUALITY_PRESETS = {
    "fast_draft": {"quality": "compact", "fps": 24},
    "balanced": {"quality": "balanced", "fps": 30},
    "high_quality": {"quality": "high", "fps": 30},
    "archive": {"quality": "high", "fps": 60},
}
CAPTION_LAYOUT_PRESETS = {
    "bottom_bold": {"caption_y": 78, "caption_size": 84, "caption_stroke": 4, "caption_bg": True, "caption_bg_color": "#000000"},
    "top_minimal": {"caption_y": 48, "caption_size": 52, "caption_stroke": 1, "caption_bg": False},
    "subtitle_classic": {"caption_y": 80, "caption_size": 58, "caption_stroke": 2, "caption_bg": True, "caption_bg_color": "#00000090"},
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def workspace_path(value: str) -> Path:
    candidate = Path(value)
    resolved = (WORKSPACE_DIR / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()
    if resolved != WORKSPACE_DIR and WORKSPACE_DIR not in resolved.parents:
        raise ValueError("Paths must stay inside local_studio/workspace.")
    return resolved


def require_path(value: Any, field: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required.")
    return workspace_path(value)


def caption_font() -> str | None:
    """Find a usable local font without downloading or relying on a font name."""
    windir = Path(os.environ.get("WINDIR", "C:/Windows"))
    candidates = [
        os.getenv("LOCAL_STUDIO_FONT", ""),
        # Bundled (OFL-licensed, see assets/fonts/README.md) so Korean and other
        # non-Latin captions render correctly regardless of what's installed on
        # this OS -- checked before any system font.
        str(BUNDLED_CAPTION_FONT),
        str(windir / "Fonts" / "arialbd.ttf"),
        str(windir / "Fonts" / "arial.ttf"),
        str(windir / "Fonts" / "segoeuib.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ]
    return next((candidate for candidate in candidates if candidate and Path(candidate).exists()), None)

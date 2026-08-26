"""Copy the bundled sample clip and open a first project without a second terminal."""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

import config
from db import db, row_dict

SAMPLE_RELATIVE = "inputs/grok-crew-sample.mp4"
SAMPLE_OUTPUT = "outputs/grok-crew-sample-render.mp4"
SAMPLE_TITLE = "Grok Crew Sample"


def sample_destination() -> Path:
    return (config.WORKSPACE_DIR / SAMPLE_RELATIVE).resolve()


def bundled_sample_candidates() -> list[Path]:
    roots = [
        config.BASE_DIR.parent / "public" / "demo" / "bot-edit-result-source.mp4",
        config.BASE_DIR / "assets" / "sample" / "grok-crew-sample.mp4",
    ]
    env = os.getenv("GROK_CREW_SAMPLE_SOURCE", "").strip()
    if env:
        roots.insert(0, Path(env))
    if getattr(sys, "frozen", False):
        roots.append(Path(sys.executable).resolve().parent / "sample" / "grok-crew-sample.mp4")
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            roots.append(Path(meipass) / "sample" / "grok-crew-sample.mp4")
    return roots


def find_bundled_sample() -> Path | None:
    for candidate in bundled_sample_candidates():
        if candidate.is_file() and candidate.stat().st_size > 0:
            return candidate
    return None


def provision_sample_media() -> bool:
    """Place grok-crew-sample.mp4 in the active workspace. Safe to call on every start."""
    destination = sample_destination()
    if destination.is_file() and destination.stat().st_size > 0:
        return True
    source = find_bundled_sample()
    if source is None:
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return destination.is_file()


def sample_manifest() -> dict[str, Any]:
    path = config.BASE_DIR.parent / "sample-project" / "grok-crew-sample.project.json"
    if path.is_file():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance((payload.get("timeline") or {}).get("clips"), list):
            return payload
    return {
        "title": f"{SAMPLE_TITLE} — two-cut Reel",
        "source_path": SAMPLE_RELATIVE,
        "output_path": SAMPLE_OUTPUT,
        "caption": "A bundled local Grok Crew sample. No upload.",
        "timeline": {
            "schema": "local-video-workspace.edl/v1",
            "clips": [
                {"in": 0, "out": 4, "keep": True, "caption": "ONE ASK"},
                {"in": 4, "out": 8, "keep": True, "caption": "SIX LINES"},
            ],
            "render_settings": {
                "platform": "reels_tiktok_shorts",
                "quality": "compact",
                "fps": 24,
                "captions_enabled": True,
            },
        },
    }


def _projects() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
    return [row_dict(row) or {} for row in rows]


def existing_sample_project() -> dict[str, Any] | None:
    suffix = SAMPLE_RELATIVE.replace("\\", "/")
    for project in _projects():
        source = str(project.get("source_path") or "").replace("\\", "/")
        title = str(project.get("title") or "")
        if source.endswith(suffix) or title.startswith(SAMPLE_TITLE):
            return project
    return None


def first_run_status() -> dict[str, Any]:
    destination = sample_destination()
    return {
        "schema": "grok-crew.first-run/v1",
        "sample_available": destination.is_file() and destination.stat().st_size > 0,
        "sample_open": existing_sample_project() is not None,
        "sample_path": SAMPLE_RELATIVE,
        "has_projects": bool(_projects()),
    }


def open_sample_project() -> dict[str, Any]:
    if not provision_sample_media():
        raise ValueError("The bundled sample clip is missing from this clone.")
    existing = existing_sample_project()
    if existing:
        return {"project": existing, "reused": True}
    from studio_server import new_project

    project = new_project(sample_manifest())
    return {"project": project, "reused": False}

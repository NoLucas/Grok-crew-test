"""Collector drop-box: clips for the editor, not a finished cut.

The collector never calls this PC. It writes manifest.json plus video files
under local_studio/workspace/handoff-materials/{spec_id}/, or git materials/{id}/.
This desk does not scrape websites.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

import config
from edit_spec import get_spec, normalize_agent, set_spec_status

MATERIALS_SCHEMA = "grok-crew.materials/v1"
ALLOWED_MEDIA_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
MAX_MEDIA_BYTES = int(os.getenv("HANDOFF_MAX_MEDIA_BYTES", str(2 * 1024 ** 3)))
RESERVED = {".git", ".processed"}


def local_materials_dir() -> Path:
    path = (config.WORKSPACE_DIR / "handoff-materials").resolve()
    path.mkdir(parents=True, exist_ok=True)
    (path / ".processed").mkdir(parents=True, exist_ok=True)
    return path


def materials_folder(spec_id: str) -> Path:
    return local_materials_dir() / spec_id


def find_materials(spec_id: str) -> Path | None:
    folder = materials_folder(spec_id)
    if (folder / "manifest.json").is_file():
        return folder
    processed = local_materials_dir() / ".processed" / spec_id
    if (processed / "manifest.json").is_file():
        return processed
    return None


def find_materials_clip(spec_id: str) -> Path | None:
    folder = find_materials(spec_id)
    if folder is None:
        return None
    try:
        payload = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        payload = {}
    clips = payload.get("clips") if isinstance(payload, dict) else []
    if isinstance(clips, list):
        for clip in clips:
            name = str((clip or {}).get("file") if isinstance(clip, dict) else clip or "").strip()
            candidate = folder / Path(name).name
            if candidate.is_file():
                return candidate
    for item in sorted(folder.iterdir()):
        if item.is_file() and item.suffix.lower() in ALLOWED_MEDIA_EXTENSIONS:
            return item
    return None


def _read_manifest(folder: Path) -> dict[str, Any] | None:
    path = folder / "manifest.json"
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def apply_materials_folder(folder: Path, spec_id: str | None = None) -> dict[str, Any]:
    manifest = _read_manifest(folder)
    if manifest is None:
        return {"ok": False, "folder": folder.name, "reason": "materials package needs manifest.json"}
    if manifest.get("schema") != MATERIALS_SCHEMA:
        return {"ok": False, "folder": folder.name, "reason": f"manifest.json must use schema {MATERIALS_SCHEMA}"}
    resolved_id = str(spec_id or manifest.get("edit_spec_id") or folder.name).strip()
    record = get_spec(resolved_id)
    if not record:
        return {"ok": False, "folder": folder.name, "reason": "edit_spec_id not found", "edit_spec_id": resolved_id}
    spec = record.get("spec") if isinstance(record.get("spec"), dict) else {}
    if not spec.get("crew"):
        return {"ok": False, "folder": folder.name, "reason": "that spec is not a two-bot crew"}
    dest = materials_folder(resolved_id)
    dest.mkdir(parents=True, exist_ok=True)
    clips: list[dict[str, Any]] = []
    listed = manifest.get("clips") if isinstance(manifest.get("clips"), list) else []
    sources = listed or [
        {"file": item.name} for item in sorted(folder.iterdir())
        if item.is_file() and item.suffix.lower() in ALLOWED_MEDIA_EXTENSIONS
    ]
    copied: list[str] = []
    for raw in sources:
        name = str((raw or {}).get("file") if isinstance(raw, dict) else raw or "").strip()
        source = folder / Path(name).name
        if not source.is_file():
            return {"ok": False, "folder": folder.name, "reason": f"clip '{name}' is missing"}
        if source.suffix.lower() not in ALLOWED_MEDIA_EXTENSIONS:
            return {"ok": False, "folder": folder.name, "reason": f"unsupported clip extension on '{source.name}'"}
        if source.stat().st_size > MAX_MEDIA_BYTES:
            return {"ok": False, "folder": folder.name, "reason": f"clip '{source.name}' is over the handoff size limit"}
        target = dest / source.name
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        clips.append({
            "file": source.name,
            "note": str((raw or {}).get("note") or "") if isinstance(raw, dict) else "",
            "origin": str((raw or {}).get("origin") or "") if isinstance(raw, dict) else "",
        })
        copied.append(source.name)
    if not clips:
        return {"ok": False, "folder": folder.name, "reason": "collector package must include at least one video clip"}
    collector = spec.get("collector") if isinstance(spec.get("collector"), dict) else {}
    agent = normalize_agent(manifest.get("agent") or collector.get("agent") or "Claude", "agent")
    written = {
        "schema": MATERIALS_SCHEMA,
        "edit_spec_id": resolved_id,
        "role": "collect",
        "door": "agent",
        "agent": agent,
        "clips": clips,
        "notes": str(manifest.get("notes") or ""),
        "never": [
            "Do not connect to 127.0.0.1.",
            "Do not put a finished cut in any inbox.",
            "Only collect sources the operator may use.",
        ],
    }
    (dest / "manifest.json").write_text(json.dumps(written, ensure_ascii=False, indent=2), encoding="utf-8")
    set_spec_status(resolved_id, "waiting_for_editor")
    from handoff_outbox import archive_outbox

    archive_outbox(resolved_id, door="agent")
    return {
        "ok": True,
        "folder": dest.name,
        "path": str(dest),
        "edit_spec_id": resolved_id,
        "agent": agent,
        "role": "collect",
        "copied": copied,
        "spec": get_spec(resolved_id),
    }


def write_demo_materials(spec_id: str) -> dict[str, Any]:
    from first_run import find_bundled_sample, provision_sample_media

    record = get_spec(spec_id)
    if not record:
        raise ValueError("Edit spec not found.")
    if not provision_sample_media():
        raise ValueError("The bundled sample clip is missing, so demo materials cannot be written.")
    sample = find_bundled_sample()
    if sample is None:
        raise ValueError("The bundled sample clip is missing, so demo materials cannot be written.")
    spec = record.get("spec") if isinstance(record.get("spec"), dict) else {}
    collector = spec.get("collector") if isinstance(spec.get("collector"), dict) else {}
    agent = normalize_agent(collector.get("agent") or "Claude", "agent")
    folder = materials_folder(spec_id)
    folder.mkdir(parents=True, exist_ok=True)
    shutil.copy2(sample, folder / "source.mp4")
    manifest = {
        "schema": MATERIALS_SCHEMA,
        "edit_spec_id": spec_id,
        "role": "collect",
        "door": "agent",
        "agent": agent,
        "clips": [{"file": "source.mp4", "note": "Bundled sample used as collected source.", "origin": "bundled-sample"}],
        "notes": "Demo materials. A real collector would drop allowed clips here.",
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return apply_materials_folder(folder, spec_id)


def pending_material_folders() -> list[Path]:
    root = local_materials_dir()
    folders: list[Path] = []
    for item in sorted(root.iterdir()):
        if not item.is_dir() or item.name in RESERVED:
            continue
        if (item / "manifest.json").is_file():
            folders.append(item)
    return folders


def materials_status() -> dict[str, Any]:
    pending = pending_material_folders()
    items: list[dict[str, Any]] = []
    for folder in pending:
        manifest = _read_manifest(folder) or {}
        items.append({
            "id": folder.name,
            "path": str(folder),
            "agent": str(manifest.get("agent") or ""),
            "clip_count": len(manifest.get("clips") or []) if isinstance(manifest.get("clips"), list) else 0,
        })
    return {
        "schema": "grok-crew.materials-status/v1",
        "materials_dir": str(local_materials_dir()),
        "pending_count": len(items),
        "pending": items,
        "note": "Collector drops clips here. The editor reads them. This is not the operator inbox.",
    }


def archive_materials(spec_id: str) -> dict[str, Any] | None:
    folder = materials_folder(spec_id)
    if not folder.is_dir():
        return None
    processed = local_materials_dir() / ".processed" / spec_id
    if processed.exists():
        shutil.rmtree(processed)
    shutil.move(str(folder), str(processed))
    return {"folder": spec_id, "path": str(processed)}


def pull_materials(body: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = body if isinstance(body, dict) else {}
    spec_id = str(payload.get("edit_spec_id") or "").strip()
    demo = bool(payload.get("demo"))
    written = None
    if demo:
        if not spec_id:
            raise ValueError("edit_spec_id is required to write demo materials.")
        written = write_demo_materials(spec_id)
    imported: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    if written:
        imported.append(written)
    else:
        for folder in pending_material_folders():
            if spec_id and folder.name != spec_id:
                continue
            result = apply_materials_folder(folder, spec_id or folder.name)
            (imported if result.get("ok") else skipped).append(result)
    return {
        "source": "materials",
        "materials": materials_status(),
        "imported": imported,
        "skipped": skipped,
        "demo_package": written,
    }

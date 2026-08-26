"""Collector drop-box: clips for the editor, not a finished cut.

The collector never calls this PC. It writes manifest.json plus video files
under local_studio/workspace/handoff-materials/{spec_id}/, or git materials/{id}/.
This desk does not scrape websites.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
from pathlib import Path
from typing import Any

import config
from edit_spec import COLLECTOR_DOOR, EDITOR_DOOR, get_spec, normalize_agent, set_spec_status, source_mode_of
from style_recipes import needs_collector, normalize_license, normalize_origin

MATERIALS_SCHEMA = "grok-crew.materials/v1"
ALLOWED_MEDIA_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
MAX_MEDIA_BYTES = int(os.getenv("HANDOFF_MAX_MEDIA_BYTES", str(2 * 1024 ** 3)))
RESERVED = {".git", ".processed"}
_PULL_LOCK = threading.Lock()


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
    mode = source_mode_of(spec)
    if mode == "own":
        return {"ok": False, "folder": folder.name, "reason": "that spec uses operator files, not collector clips"}
    if not spec.get("crew") and not needs_collector(mode):
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
        license_value = normalize_license((raw or {}).get("license") if isinstance(raw, dict) else "")
        origin = normalize_origin((raw or {}).get("origin") if isinstance(raw, dict) else "", license_value=license_value)
        clips.append({
            "file": source.name,
            "note": str((raw or {}).get("note") or "") if isinstance(raw, dict) else "",
            "origin": origin,
            "license": license_value,
            "source_url": str((raw or {}).get("source_url") or "")[:400] if isinstance(raw, dict) else "",
        })
        copied.append(source.name)
    existing = _read_manifest(dest) if dest.exists() and dest.resolve() != folder.resolve() else _read_manifest(dest)
    if existing and isinstance(existing.get("clips"), list):
        incoming = {item["file"] for item in clips}
        for old in existing["clips"]:
            if not isinstance(old, dict):
                continue
            name = str(old.get("file") or "").strip()
            if not name or name in incoming:
                continue
            if normalize_origin(old.get("origin"), license_value=normalize_license(old.get("license"), default="operator")) != "owned":
                continue
            if (dest / Path(name).name).is_file():
                clips.insert(0, {
                    "file": Path(name).name,
                    "note": str(old.get("note") or ""),
                    "origin": "owned",
                    "license": "operator",
                    "source_url": str(old.get("source_url") or ""),
                    "local_path": str(old.get("local_path") or ""),
                })
    if not clips:
        return {"ok": False, "folder": folder.name, "reason": "collector package must include at least one video clip"}
    collector = spec.get("collector") if isinstance(spec.get("collector"), dict) else {}
    agent = normalize_agent(manifest.get("agent") or collector.get("agent") or "collector", COLLECTOR_DOOR)
    written = {
        "schema": MATERIALS_SCHEMA,
        "edit_spec_id": resolved_id,
        "role": "collect",
        "door": COLLECTOR_DOOR,
        "agent": agent,
        "clips": clips,
        "notes": str(manifest.get("notes") or ""),
        "unknown_license_count": sum(1 for item in clips if item.get("license") == "unknown"),
        "never": [
            "Do not connect to 127.0.0.1.",
            "Do not put a finished cut in any inbox.",
            "Only collect sources the operator may use.",
            "Write license operator, stock, public, or unknown on every clip.",
        ],
    }
    (dest / "manifest.json").write_text(json.dumps(written, ensure_ascii=False, indent=2), encoding="utf-8")
    set_spec_status(resolved_id, "waiting_for_editor")
    from handoff_outbox import archive_outbox

    archive_outbox(resolved_id, door=COLLECTOR_DOOR)
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


def write_owned_materials(spec_id: str, paths: list[Any] | tuple[Any, ...] | str) -> dict[str, Any]:
    record = get_spec(spec_id)
    if not record:
        raise ValueError("Edit spec not found.")
    spec = record.get("spec") if isinstance(record.get("spec"), dict) else {}
    mode = source_mode_of(spec)
    if mode not in {"own", "own_and_collect"}:
        raise ValueError("owned files are only for own or own_and_collect specs.")
    if isinstance(paths, str):
        items = [line.strip() for line in paths.splitlines() if line.strip()]
    else:
        items = [str(item).strip() for item in (paths or []) if str(item).strip()]
    if not items:
        raise ValueError("owned_paths must include at least one local video file.")
    folder = materials_folder(spec_id)
    folder.mkdir(parents=True, exist_ok=True)
    existing = _read_manifest(folder) or {}
    clips: list[dict[str, Any]] = []
    if isinstance(existing.get("clips"), list):
        for old in existing["clips"]:
            if isinstance(old, dict) and str(old.get("file") or "").strip():
                clips.append(old)
    copied: list[str] = []
    known = {str(item.get("file") or "") for item in clips}
    for raw in items:
        source = Path(raw).expanduser()
        if not source.is_file():
            raise ValueError(f"owned file not found: {source}")
        if source.suffix.lower() not in ALLOWED_MEDIA_EXTENSIONS:
            raise ValueError(f"unsupported clip extension on '{source.name}'")
        if source.stat().st_size > MAX_MEDIA_BYTES:
            raise ValueError(f"clip '{source.name}' is over the handoff size limit")
        dest = folder / source.name
        if dest.exists() and dest.resolve() != source.resolve():
            dest = folder / f"{source.stem}-owned{source.suffix}"
        if source.resolve() != dest.resolve():
            shutil.copy2(source, dest)
        if dest.name in known:
            continue
        clips.append({
            "file": dest.name,
            "note": "Operator-owned source",
            "origin": "owned",
            "license": "operator",
            "local_path": str(source.resolve()),
        })
        known.add(dest.name)
        copied.append(dest.name)
    if not clips:
        raise ValueError("owned_paths must include at least one local video file.")
    written = {
        "schema": MATERIALS_SCHEMA,
        "edit_spec_id": spec_id,
        "role": "owned",
        "door": EDITOR_DOOR,
        "agent": "operator",
        "clips": clips,
        "notes": str(existing.get("notes") or "Operator-owned clips. The editor cuts these."),
        "unknown_license_count": sum(1 for item in clips if normalize_license(item.get("license")) == "unknown"),
        "never": [
            "Do not connect to 127.0.0.1.",
            "Do not put a finished cut in any inbox.",
        ],
    }
    (folder / "manifest.json").write_text(json.dumps(written, ensure_ascii=False, indent=2), encoding="utf-8")
    if mode == "own":
        set_spec_status(spec_id, "waiting_for_editor")
    return {
        "ok": True,
        "folder": folder.name,
        "path": str(folder),
        "edit_spec_id": spec_id,
        "origin": "owned",
        "copied": copied,
        "clip_count": len(clips),
        "spec": get_spec(spec_id),
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
    if source_mode_of(spec) == "own":
        return write_owned_materials(spec_id, [str(sample)])
    collector = spec.get("collector") if isinstance(spec.get("collector"), dict) else {}
    agent = normalize_agent(collector.get("agent") or "collector", COLLECTOR_DOOR)
    folder = materials_folder(spec_id)
    folder.mkdir(parents=True, exist_ok=True)
    existing = _read_manifest(folder) or {}
    owned = [
        item for item in (existing.get("clips") or [])
        if isinstance(item, dict) and normalize_origin(item.get("origin"), license_value="operator") == "owned"
    ]
    shutil.copy2(sample, folder / "source.mp4")
    manifest = {
        "schema": MATERIALS_SCHEMA,
        "edit_spec_id": spec_id,
        "role": "collect",
        "door": COLLECTOR_DOOR,
        "agent": agent,
        "clips": owned + [{
            "file": "source.mp4",
            "note": "Bundled sample used as collected source.",
            "origin": "bundled-sample",
            "license": "operator",
        }],
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
        clips = manifest.get("clips") if isinstance(manifest.get("clips"), list) else []
        unknown = sum(1 for item in clips if isinstance(item, dict) and normalize_license(item.get("license")) == "unknown")
        items.append({
            "id": folder.name,
            "path": str(folder),
            "agent": str(manifest.get("agent") or ""),
            "clip_count": len(clips),
            "unknown_license_count": unknown,
            "has_unknown_license": unknown > 0,
        })
    unknown_total = sum(int(item.get("unknown_license_count") or 0) for item in items)
    return {
        "schema": "grok-crew.materials-status/v1",
        "materials_dir": str(local_materials_dir()),
        "pending_count": len(items),
        "pending": items,
        "unknown_license_count": unknown_total,
        "has_unknown_license": unknown_total > 0,
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
    with _PULL_LOCK:
        return _pull_materials_locked(body)


def _pull_materials_locked(body: dict[str, Any] | None) -> dict[str, Any]:
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

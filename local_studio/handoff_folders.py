"""List files saved after a bot (or operator) drop, for the desktop folder board.

Only two roots are readable here:
- inputs/handoff/<package>/ — imported editor-cut media
- handoff-materials/<spec_id>/ — collector / owned clips

Inbox and outbox folders are not listed. Paths stay workspace-relative.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config
from config import workspace_relative
from db import db, row_dict
from edit_spec import get_spec, list_specs

PACKAGE_ROOT = Path("inputs") / "handoff"
MATERIALS_ROOT = Path("handoff-materials")
RESERVED = {".git", ".processed"}
RESERVED_FILES = {"manifest.json"}
MAX_FILES = 80
MAX_FOLDERS = 40
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
AUDIO_EXT = {".mp3", ".wav", ".m4a"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_EXT = VIDEO_EXT | AUDIO_EXT | IMAGE_EXT
SCHEMA = "grok-crew.handoff-folders/v1"


def _safe_leaf_name(name: str) -> str:
    text = str(name or "").strip()
    if not text or text in RESERVED or text.startswith("."):
        raise ValueError("Folder name is not allowed.")
    if text in {".", ".."} or ".." in text or "/" in text or "\\" in text or "\x00" in text:
        raise ValueError("Folder name is not allowed.")
    return text


def _safe_child_dir(root: Path, name: str) -> Path:
    leaf = _safe_leaf_name(name)
    base = root.resolve()
    destination = (base / leaf).resolve()
    if destination.parent != base:
        raise ValueError("Folder leaves the allowed root.")
    return destination


def _file_kind(path: Path) -> str | None:
    suffix = path.suffix.lower()
    if suffix in VIDEO_EXT:
        return "video"
    if suffix in AUDIO_EXT:
        return "audio"
    if suffix in IMAGE_EXT:
        return "image"
    return None


def _iso_mtime(path: Path) -> str:
    stamp = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return stamp.isoformat(timespec="seconds")


def _package_id_from_source(source_path: str) -> str | None:
    relative = workspace_relative(source_path)
    parts = relative.split("/")
    if len(parts) >= 4 and parts[0] == "inputs" and parts[1] == "handoff":
        try:
            return _safe_leaf_name(parts[2])
        except ValueError:
            return None
    return None


def _projects() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, title, source_path, edit_spec_id, handoff_agent, handoff_door, updated_at "
            "FROM projects ORDER BY updated_at DESC LIMIT 80"
        ).fetchall()
    return [row_dict(row) or {} for row in rows]


def _list_media_files(folder: Path, relative_dir: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    root = folder.resolve()
    if not root.is_dir():
        return items
    for path in sorted(root.iterdir(), key=lambda item: item.name.lower()):
        if len(items) >= MAX_FILES:
            break
        if not path.is_file() or path.name.startswith("."):
            continue
        kind = _file_kind(path)
        if kind is None:
            continue
        resolved = path.resolve()
        try:
            resolved.relative_to(root)
        except ValueError:
            continue
        if resolved.parent != root:
            continue
        items.append({
            "name": path.name,
            "path": f"{relative_dir}/{path.name}",
            "kind": kind,
            "size_bytes": path.stat().st_size,
        })
    return items


def _scan_child_dirs(relative_root: Path) -> list[Path]:
    root = (config.WORKSPACE_DIR / relative_root).resolve()
    if not root.is_dir():
        return []
    found: list[Path] = []
    for item in root.iterdir():
        try:
            child = _safe_child_dir(root, item.name)
        except ValueError:
            continue
        if child.is_dir():
            found.append(child)
    found.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return found[:MAX_FOLDERS]


def describe_package_folder(name: str, project: dict[str, Any] | None = None) -> dict[str, Any]:
    folder = _safe_child_dir((config.WORKSPACE_DIR / PACKAGE_ROOT).resolve(), name)
    relative_dir = f"{PACKAGE_ROOT.as_posix()}/{folder.name}"
    source_name = ""
    if project and project.get("source_path"):
        source_name = Path(workspace_relative(str(project["source_path"]))).name.lower()
    files: list[dict[str, Any]] = []
    for item in _list_media_files(folder, relative_dir):
        role = "source" if source_name and item["name"].lower() == source_name else "broll" if source_name else "clip"
        files.append({**item, "role": role})
    return {
        "kind": "package",
        "id": folder.name,
        "relative_dir": relative_dir,
        "title": str((project or {}).get("title") or folder.name),
        "agent": str((project or {}).get("handoff_agent") or ""),
        "door": str((project or {}).get("handoff_door") or "editor"),
        "project_id": (project or {}).get("id") or None,
        "spec_id": str((project or {}).get("edit_spec_id") or "") or None,
        "notes": "",
        "updated_at": _iso_mtime(folder) if folder.exists() else "",
        "file_count": len(files),
        "files": files,
    }


def describe_materials_folder(spec_id: str, project: dict[str, Any] | None = None) -> dict[str, Any]:
    from handoff_materials import _read_manifest

    folder = _safe_child_dir((config.WORKSPACE_DIR / MATERIALS_ROOT).resolve(), spec_id)
    relative_dir = f"{MATERIALS_ROOT.as_posix()}/{folder.name}"
    manifest = _read_manifest(folder) if folder.is_dir() else None
    clips_meta: dict[str, dict[str, Any]] = {}
    notes = ""
    agent = ""
    if isinstance(manifest, dict):
        notes = str(manifest.get("notes") or "")[:400]
        agent = str(manifest.get("agent") or "")
        listed = manifest.get("clips") if isinstance(manifest.get("clips"), list) else []
        for raw in listed:
            if not isinstance(raw, dict):
                continue
            name = Path(str(raw.get("file") or "")).name
            if not name:
                continue
            clips_meta[name.lower()] = {
                "note": str(raw.get("note") or "")[:200],
                "origin": str(raw.get("origin") or ""),
                "license": str(raw.get("license") or ""),
            }
    spec = get_spec(folder.name)
    collector = spec.get("collector") if isinstance((spec or {}).get("collector"), dict) else {}
    files: list[dict[str, Any]] = []
    for item in _list_media_files(folder, relative_dir):
        extra = clips_meta.get(item["name"].lower(), {})
        files.append({
            **item,
            "role": "clip",
            "note": extra.get("note") or "",
            "origin": extra.get("origin") or "",
            "license": extra.get("license") or "",
        })
    title = str((project or {}).get("title") or (spec or {}).get("title") or folder.name)
    return {
        "kind": "materials",
        "id": folder.name,
        "relative_dir": relative_dir,
        "title": title,
        "agent": agent or str(collector.get("agent") or ""),
        "door": "collector",
        "project_id": (project or {}).get("id") or (spec or {}).get("project_id") or None,
        "spec_id": folder.name,
        "notes": notes,
        "updated_at": _iso_mtime(folder) if folder.exists() else "",
        "file_count": len(files),
        "files": files,
    }


def workspace_handoff_folders(
    *,
    project_id: str | None = None,
    kind: str | None = None,
) -> dict[str, Any]:
    if kind not in (None, "", "package", "materials"):
        raise ValueError("kind must be package or materials.")
    wanted_kind = kind or None
    wanted_project = str(project_id or "").strip() or None
    projects = _projects()
    package_owner: dict[str, dict[str, Any]] = {}
    materials_owner: dict[str, dict[str, Any]] = {}
    for project in projects:
        package_name = _package_id_from_source(str(project.get("source_path") or ""))
        if package_name and package_name not in package_owner:
            package_owner[package_name] = project
        spec_id = str(project.get("edit_spec_id") or "").strip()
        if spec_id and spec_id not in materials_owner:
            materials_owner[spec_id] = project
    for spec in list_specs():
        spec_id = str(spec.get("id") or "")
        linked = str(spec.get("project_id") or "").strip()
        if spec_id and linked and spec_id not in materials_owner:
            match = next((item for item in projects if item.get("id") == linked), None)
            if match:
                materials_owner[spec_id] = match

    folders: list[dict[str, Any]] = []
    if wanted_kind in (None, "package"):
        for folder in _scan_child_dirs(PACKAGE_ROOT):
            described = describe_package_folder(folder.name, package_owner.get(folder.name))
            if described["file_count"]:
                folders.append(described)
    if wanted_kind in (None, "materials"):
        for folder in _scan_child_dirs(MATERIALS_ROOT):
            described = describe_materials_folder(folder.name, materials_owner.get(folder.name))
            if described["file_count"] or described["notes"]:
                folders.append(described)
    if wanted_project:
        folders = [item for item in folders if item.get("project_id") == wanted_project]
    folders.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    return {
        "schema": SCHEMA,
        "folders": folders[:MAX_FOLDERS],
    }


def _source_paths() -> set[Path]:
    found: set[Path] = set()
    for project in _projects():
        raw = str(project.get("source_path") or "").strip()
        if not raw:
            continue
        try:
            candidate = Path(raw).expanduser()
            if not candidate.is_absolute():
                candidate = config.WORKSPACE_DIR / candidate
            found.add(candidate.resolve())
        except OSError:
            continue
    return found


def _resolve_handoff_file(rel_path: str) -> tuple[Path, tuple[str, ...]]:
    text = str(rel_path or "").strip().replace("\\", "/")
    if not text:
        raise ValueError("path is required.")
    rel = Path(text)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError("path is not allowed.")
    parts = rel.parts
    if len(parts) == 4 and parts[0] == "inputs" and parts[1] == "handoff":
        _safe_leaf_name(parts[2])
        name = _safe_leaf_name(parts[3])
    elif len(parts) == 3 and parts[0] == "handoff-materials":
        _safe_leaf_name(parts[1])
        name = _safe_leaf_name(parts[2])
        if name.lower() in RESERVED_FILES:
            raise ValueError("reserved file")
    else:
        raise ValueError("only files in the handoff inbox or materials box can be used.")
    workspace = config.WORKSPACE_DIR.resolve()
    expected_parent = (workspace.joinpath(*parts[:-1])).resolve()
    target = (workspace / rel).resolve()
    if workspace not in target.parents:
        raise ValueError("path leaves the workspace.")
    if target.parent != expected_parent:
        raise ValueError("path leaves the allowed root.")
    if not target.is_file():
        raise ValueError("file not found.")
    return target, parts


def _drop_clip_from_manifest(folder: Path, name: str) -> None:
    from handoff_materials import _read_manifest

    manifest = _read_manifest(folder)
    if not isinstance(manifest, dict):
        return
    clips = manifest.get("clips")
    if not isinstance(clips, list):
        return
    kept: list[Any] = []
    removed = False
    for raw in clips:
        if isinstance(raw, dict) and Path(str(raw.get("file") or "")).name.lower() == name.lower():
            removed = True
            continue
        kept.append(raw)
    if not removed:
        return
    manifest["clips"] = kept
    (folder / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _open_in_file_manager(target: Path) -> bool:
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", "-R", str(target)], check=False, timeout=5)
            return True
        if sys.platform == "win32":
            subprocess.run(["explorer", "/select,", str(target)], check=False, timeout=5)
            return True
        opener = shutil.which("xdg-open")
        if opener:
            subprocess.run([opener, str(target.parent)], check=False, timeout=5)
            return True
    except (OSError, subprocess.TimeoutExpired):
        return False
    return False


def delete_handoff_file(rel_path: str) -> dict[str, Any]:
    target, parts = _resolve_handoff_file(rel_path)
    if target in _source_paths():
        raise ValueError("file is the project's source and cannot be deleted.")
    name = target.name
    os.unlink(target)
    if parts[0] == "handoff-materials":
        _drop_clip_from_manifest(config.WORKSPACE_DIR / MATERIALS_ROOT / parts[1], name)
    return {"ok": True, "deleted": "/".join(parts)}


def reveal_handoff_file(rel_path: str) -> dict[str, Any]:
    target, parts = _resolve_handoff_file(rel_path)
    return {
        "ok": True,
        "path": "/".join(parts),
        "absolute_path": str(target),
        "revealed": _open_in_file_manager(target),
    }

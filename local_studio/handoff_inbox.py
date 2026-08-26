"""Apply bot-owned handoff packages from a local inbox (and optional git).

A remote bot never calls this PC. It pushes a folder. The operator (or this
sidecar, on the operator's click) copies media into the workspace and imports
the bundle through the existing local API.
"""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config
from edit_spec import attach_spec_project

BUNDLE_SCHEMA = "local-video-workspace.project-bundle/v1"
ALLOWED_MEDIA_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
MAX_MEDIA_BYTES = int(os.getenv("HANDOFF_MAX_MEDIA_BYTES", str(2 * 1024 ** 3)))
MAX_BUNDLE_BYTES = int(os.getenv("HANDOFF_MAX_BUNDLE_BYTES", str(4 * 1024 * 1024)))
DEFAULT_MAX_PACKAGES_PER_CYCLE = 5


def local_inbox_dir() -> Path:
    path = (config.WORKSPACE_DIR / "handoff-inbox").resolve()
    path.mkdir(parents=True, exist_ok=True)
    (path / ".processed").mkdir(parents=True, exist_ok=True)
    return path


def media_relpaths(project: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()

    def add(value: Any) -> None:
        text = str(value or "").strip()
        if not text:
            return
        key = Path(text).name.lower()
        if key in seen:
            return
        seen.add(key)
        paths.append(text)

    add(project.get("source_path"))
    timeline = project.get("timeline")
    if isinstance(timeline, dict):
        for asset in timeline.get("assets") or []:
            if isinstance(asset, dict):
                add(asset.get("path"))
    return paths


def copy_media(folder: Path, workspace: Path, relative_path: str) -> None:
    source = folder / Path(relative_path).name
    if not source.is_file():
        raise RuntimeError(f"Media file '{source.name}' referenced by the bundle was not found in the package.")
    if source.suffix.lower() not in ALLOWED_MEDIA_EXTENSIONS:
        raise RuntimeError(f"Media file '{source.name}' has an unsupported extension. Allowed: {', '.join(sorted(ALLOWED_MEDIA_EXTENSIONS))}.")
    size = source.stat().st_size
    if size > MAX_MEDIA_BYTES:
        raise RuntimeError(f"Media file '{source.name}' is {size} bytes, over the {MAX_MEDIA_BYTES}-byte handoff limit (set HANDOFF_MAX_MEDIA_BYTES to change it).")
    destination = (workspace / relative_path).resolve()
    if destination != workspace and workspace not in destination.parents:
        raise RuntimeError(f"Refusing to write outside the workspace: {relative_path}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def copy_package_media(folder: Path, workspace: Path, project: dict[str, Any]) -> list[str]:
    copied: list[str] = []
    for relative in media_relpaths(project):
        copy_media(folder, workspace, relative)
        copied.append(relative)
    if not copied:
        raise RuntimeError("The package must include a source video. The operator does not supply footage.")
    return copied


def _read_bundle(folder: Path) -> tuple[dict[str, Any] | None, str | None]:
    bundle_path = folder / "bundle.json"
    if not bundle_path.exists():
        return None, "no bundle.json"
    bundle_size = bundle_path.stat().st_size
    if bundle_size > MAX_BUNDLE_BYTES:
        return None, f"bundle.json is {bundle_size} bytes, over the {MAX_BUNDLE_BYTES}-byte limit"
    try:
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return None, f"invalid bundle.json ({exc})"
    if not isinstance(bundle, dict) or bundle.get("schema") != BUNDLE_SCHEMA:
        return None, f"bundle.json must use schema {BUNDLE_SCHEMA}"
    project = bundle.get("project")
    if not isinstance(project, dict) or not project.get("source_path"):
        return None, "bundle.project.source_path is required"
    return bundle, None


def apply_package_local(folder: Path, workspace: Path | None = None) -> dict[str, Any]:
    """Copy bot media and import the bundle in-process. Does not open a port."""
    from studio_server import import_project_bundle

    workspace = (workspace or config.WORKSPACE_DIR).resolve()
    bundle, reason = _read_bundle(folder)
    if bundle is None:
        return {"ok": False, "folder": folder.name, "reason": reason}
    project = bundle["project"]
    try:
        copied = copy_package_media(folder, workspace, project)
    except RuntimeError as exc:
        return {"ok": False, "folder": folder.name, "reason": str(exc)}
    try:
        imported = import_project_bundle({"bundle": bundle})
    except (RuntimeError, ValueError) as exc:
        return {"ok": False, "folder": folder.name, "reason": f"import failed ({exc})"}
    created = imported.get("project") if isinstance(imported.get("project"), dict) else {}
    spec_id = str(project.get("edit_spec_id") or "").strip()
    if spec_id and created.get("id"):
        attach_spec_project(spec_id, str(created["id"]))
    return {
        "ok": True,
        "folder": folder.name,
        "project": created,
        "jobs": imported.get("jobs") if isinstance(imported.get("jobs"), list) else [],
        "copied": copied,
        "edit_spec_id": spec_id or None,
    }


def pending_inbox_folders(inbox: Path | None = None) -> list[Path]:
    root = inbox or local_inbox_dir()
    folders = [item for item in sorted(root.iterdir()) if item.is_dir() and item.name not in {".git", ".processed"}]
    return folders


def _archive_folder(folder: Path) -> None:
    processed = local_inbox_dir() / ".processed" / folder.name
    if processed.exists():
        shutil.rmtree(processed)
    shutil.move(str(folder), str(processed))


def pull_local_inbox(*, max_per_cycle: int = DEFAULT_MAX_PACKAGES_PER_CYCLE) -> dict[str, Any]:
    folders = pending_inbox_folders()
    selected = folders[: max(1, int(max_per_cycle))]
    results: list[dict[str, Any]] = []
    for folder in selected:
        result = apply_package_local(folder)
        if result.get("ok"):
            _archive_folder(folder)
        results.append(result)
    return {
        "source": "local-inbox",
        "pending": len(folders),
        "processed": results,
        "imported": [item for item in results if item.get("ok")],
        "skipped": [item for item in results if not item.get("ok")],
    }


def write_demo_package(spec_id: str | None = None) -> dict[str, Any]:
    """Build a local inbox package from the bundled sample, as if a bot sent it."""
    from first_run import find_bundled_sample, provision_sample_media, sample_manifest

    if not provision_sample_media():
        raise ValueError("The bundled sample clip is missing, so a demo package cannot be written.")
    sample = find_bundled_sample()
    if sample is None:
        raise ValueError("The bundled sample clip is missing, so a demo package cannot be written.")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    folder = local_inbox_dir() / f"{stamp}-bot-source"
    folder.mkdir(parents=True, exist_ok=False)
    shutil.copy2(sample, folder / "source.mp4")
    manifest = sample_manifest()
    title = str(manifest.get("title") or "Bot-delivered cut")
    if spec_id:
        from edit_spec import get_spec

        record = get_spec(spec_id)
        if record:
            title = str(record.get("title") or title)
    bundle = {
        "schema": BUNDLE_SCHEMA,
        "project": {
            "title": title,
            "source_path": f"inputs/handoff/{folder.name}/source.mp4",
            "output_path": f"outputs/handoff/{folder.name}.mp4",
            "timeline": manifest.get("timeline") or {"clips": [{"in": 0, "out": 8, "keep": True, "caption": ""}]},
            "caption": str(manifest.get("caption") or ""),
            "edit_spec_id": spec_id or "",
        },
        "jobs": [{"kind": "render", "approved": True, "payload": {}}],
        "artifacts": [],
    }
    (folder / "bundle.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"folder": folder.name, "path": str(folder), "edit_spec_id": spec_id or None}


def handoff_status() -> dict[str, Any]:
    inbox = local_inbox_dir()
    pending = pending_inbox_folders(inbox)
    remote = str(os.getenv("HANDOFF_REPO_REMOTE") or "").strip()
    return {
        "schema": "grok-crew.handoff-status/v1",
        "inbox_dir": str(inbox),
        "pending_count": len(pending),
        "pending": [item.name for item in pending],
        "git_configured": bool(remote),
        "git_remote_set": bool(remote),
        "source_owner": "bot",
        "note": "The operator writes a spec. A bot on another computer supplies the source video and the cut.",
    }


def pull_handoff(body: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = body if isinstance(body, dict) else {}
    demo = bool(payload.get("demo"))
    spec_id = str(payload.get("edit_spec_id") or "").strip() or None
    written = None
    if demo:
        written = write_demo_package(spec_id)
    pulled = pull_local_inbox()
    if written:
        pulled["demo_package"] = written
    return pulled

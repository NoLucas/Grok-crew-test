"""Door-scoped outbox: the operator writes a spec; the assigned bot picks it up.

Two doors, never mixed:

- Editor: local_studio/workspace/handoff-outbox/editor/{spec_id}/
- Collector: local_studio/workspace/handoff-outbox/collector/{spec_id}/

Leftover grok/ and agents/ folders are still read. New writes go only to
editor/ and collector/. A remote bot never calls this PC. It reads spec.json
from its door (local folder or git prefix outbox/editor, outbox/collector),
then returns a package to the matching inbox. Git push is optional and never
blocks saving a spec.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import config
from edit_spec import (
    COLLECTOR_DOOR,
    DOORS,
    EDITOR_DOOR,
    default_agent_for_door,
    door_folder,
    door_folder_aliases,
    get_spec,
    normalize_door,
    spec_brief,
)

OUTBOX_SCHEMA = "grok-crew.outbox-spec/v1"
RESERVED = {".git", ".processed", "editor", "collector", "grok", "agents", "agent", "outbox"}


def local_outbox_dir() -> Path:
    path = (config.WORKSPACE_DIR / "handoff-outbox").resolve()
    path.mkdir(parents=True, exist_ok=True)
    (path / ".processed").mkdir(parents=True, exist_ok=True)
    for folder in (door_folder(EDITOR_DOOR), door_folder(COLLECTOR_DOOR)):
        door_dir = path / folder
        door_dir.mkdir(parents=True, exist_ok=True)
        (door_dir / ".processed").mkdir(parents=True, exist_ok=True)
    return path


def door_outbox_dir(door: str) -> Path:
    normalized = normalize_door(door, required=True)
    path = (local_outbox_dir() / door_folder(normalized)).resolve()
    path.mkdir(parents=True, exist_ok=True)
    (path / ".processed").mkdir(parents=True, exist_ok=True)
    return path


def outbox_folder(spec_id: str, door: str) -> Path:
    return door_outbox_dir(door) / spec_id


def _package(record: dict[str, Any], brief_text: str, *, door: str, agent: str, role: str = "") -> dict[str, Any]:
    folder = door_folder(door)
    if role == "collect":
        returned = {
            "kind": "materials",
            "box": f"local_studio/workspace/handoff-materials/{record['id']}/",
            "git_prefix": f"materials/{record['id']}/",
        }
        never = [
            "Do not connect to 127.0.0.1.",
            "Do not put a finished cut in any inbox.",
            "Only collect sources the operator may use.",
            "This desk does not scrape login-walled sites for you.",
        ]
    else:
        returned = {
            "kind": "cut",
            "inbox": f"local_studio/workspace/handoff-inbox/{folder}/",
            "git_prefix": f"{folder}/",
            "bundle_project_door": door,
            "created_by": agent,
        }
        never = [
            "Do not connect to 127.0.0.1.",
            "Do not use the other door's outbox or inbox.",
        ]
        if role == "edit":
            never.append("Read handoff-materials first. Do not hunt a new source unless that box is empty.")
    return {
        "schema": OUTBOX_SCHEMA,
        "id": record["id"],
        "door": door,
        "agent": agent,
        "role": role or ("edit" if door == EDITOR_DOOR else "collect" if (record.get("spec") or {}).get("crew") else ""),
        "status": record.get("status") or "waiting_for_bot",
        "created_at": record.get("created_at"),
        "spec": record.get("spec") or {},
        "brief": brief_text,
        "return": returned,
        "never": never,
    }


def write_outbox(
    record: dict[str, Any],
    *,
    door: str | None = None,
    role: str | None = None,
    push_git: bool = True,
) -> dict[str, Any]:
    if not record or not record.get("id"):
        raise ValueError("Edit spec is missing.")
    resolved_door = normalize_door(door or record.get("door") or (record.get("spec") or {}).get("door"))
    printed = spec_brief(record["id"], role=role)
    agent = str(printed.get("agent") or record.get("agent") or default_agent_for_door(resolved_door))
    folder = outbox_folder(record["id"], resolved_door)
    folder.mkdir(parents=True, exist_ok=True)
    payload = _package(record, printed["text"], door=resolved_door, agent=agent, role=str(printed.get("role") or role or ""))
    (folder / "spec.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (folder / "brief.txt").write_text(printed["text"], encoding="utf-8")
    result = {
        "folder": folder.name,
        "path": str(folder),
        "door": resolved_door,
        "agent": payload["agent"],
        "role": payload.get("role") or "",
        "edit_spec_id": record["id"],
        "git_prefix": f"outbox/{door_folder(resolved_door)}/{folder.name}",
    }
    if push_git:
        result["git"] = push_outbox({**result, "path": str(folder)}, door=resolved_door)
    else:
        result["git"] = {"ok": False, "skipped": True, "reason": "git push not requested"}
    return result


def write_crew_outbox(record: dict[str, Any], *, push_git: bool = True) -> dict[str, Any]:
    collect = write_outbox(record, door=COLLECTOR_DOOR, role="collect", push_git=push_git)
    edit = write_outbox(record, door=EDITOR_DOOR, role="edit", push_git=push_git)
    return {
        "crew": True,
        "collect": collect,
        "edit": edit,
        "path": collect["path"],
        "git": {"collect": collect.get("git"), "edit": edit.get("git")},
    }


def pending_outbox_folders(door: str) -> list[Path]:
    root = local_outbox_dir()
    seen: set[str] = set()
    folders: list[Path] = []
    for alias in door_folder_aliases(door):
        door_dir = root / alias
        if not door_dir.is_dir():
            continue
        for item in sorted(door_dir.iterdir()):
            if not item.is_dir() or item.name in {".git", ".processed"} or item.name in seen:
                continue
            seen.add(item.name)
            folders.append(item)
    return folders


def _read_outbox_item(folder: Path) -> dict[str, Any]:
    spec_path = folder / "spec.json"
    title = folder.name
    agent = ""
    role = ""
    if spec_path.is_file():
        try:
            payload = json.loads(spec_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
        if isinstance(payload, dict):
            spec = payload.get("spec") if isinstance(payload.get("spec"), dict) else {}
            title = str(spec.get("title") or payload.get("id") or title)
            agent = str(payload.get("agent") or "")
            role = str(payload.get("role") or "")
    return {
        "id": folder.name,
        "title": title,
        "agent": agent,
        "role": role,
        "path": str(folder),
        "folder": folder.name,
    }


def _door_outbox_status(door: str) -> dict[str, Any]:
    folders = pending_outbox_folders(door)
    return {
        "door": door,
        "outbox_dir": str(door_outbox_dir(door)),
        "git_prefix": f"outbox/{door_folder(door)}/",
        "pending_count": len(folders),
        "pending": [_read_outbox_item(item) for item in folders],
    }


def outbox_status() -> dict[str, Any]:
    editor = _door_outbox_status(EDITOR_DOOR)
    collector = _door_outbox_status(COLLECTOR_DOOR)
    remote = str(os.getenv("HANDOFF_REPO_REMOTE") or "").strip()
    return {
        "schema": "grok-crew.outbox-status/v1",
        "outbox_dir": str(local_outbox_dir()),
        "pending_count": editor["pending_count"] + collector["pending_count"],
        "doors": {EDITOR_DOOR: editor, COLLECTOR_DOOR: collector},
        "git_configured": bool(remote),
        "note": (
            "On a crew spec the collector reads handoff-outbox/collector and drops clips "
            "in handoff-materials. The editor reads handoff-outbox/editor, then those clips, "
            "and returns the cut to handoff-inbox/editor. Leftover grok/ and agents/ folders are still read."
        ),
    }


def find_outbox_folder(spec_id: str, door: str | None = None) -> Path | None:
    doors = [normalize_door(door, required=True)] if door else list(DOORS)
    live: Path | None = None
    saw_processed = False
    for item in doors:
        for alias in door_folder_aliases(item):
            folder = local_outbox_dir() / alias / spec_id
            if folder.is_dir() and live is None:
                live = folder
            if (local_outbox_dir() / alias / ".processed" / spec_id).is_dir():
                saw_processed = True
    if live is not None:
        return live
    if saw_processed:
        return None
    return None


def archive_outbox(spec_id: str, door: str | None = None) -> dict[str, Any] | None:
    doors = [normalize_door(door, required=True)] if door else list(DOORS)
    archived: list[dict[str, Any]] = []
    for item in doors:
        for alias in door_folder_aliases(item):
            folder = local_outbox_dir() / alias / spec_id
            if not folder.is_dir():
                continue
            processed = local_outbox_dir() / alias / ".processed" / folder.name
            processed.parent.mkdir(parents=True, exist_ok=True)
            if processed.exists():
                shutil.rmtree(processed)
            shutil.move(str(folder), str(processed))
            git = _remove_outbox_from_git(spec_id, item)
            archived.append({"folder": folder.name, "door": item, "path": str(processed), "git": git})
    if not archived:
        return None
    if len(archived) == 1:
        return archived[0]
    return {"archived": archived}


def _run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True, timeout=120)


def _mirror_dir() -> Path:
    return (config.DATA_DIR / "handoff-outbox-mirror").resolve()


def _ensure_mirror(remote: str, branch: str) -> Path:
    remote = config.require_git_remote(remote)
    branch = config.require_git_branch(branch)
    mirror = _mirror_dir()
    if not (mirror / ".git").exists():
        mirror.parent.mkdir(parents=True, exist_ok=True)
        if mirror.exists():
            shutil.rmtree(mirror)
        clone = _run_git(["clone", "--single-branch", "--branch", branch, "--", remote, str(mirror)], cwd=config.DATA_DIR)
        if clone.returncode != 0:
            raise RuntimeError(clone.stderr.strip() or clone.stdout.strip() or "Could not clone the handoff repo.")
        return mirror
    fetch = _run_git(["fetch", "origin", "--", branch], cwd=mirror)
    if fetch.returncode != 0:
        raise RuntimeError(fetch.stderr.strip() or "Could not fetch the handoff repo.")
    reset = _run_git(["reset", "--hard", f"origin/{branch}"], cwd=mirror)
    if reset.returncode != 0:
        raise RuntimeError(reset.stderr.strip() or "Could not update the handoff checkout.")
    return mirror


def _commit_and_push(mirror: Path, branch: str, message: str) -> None:
    add = _run_git(["add", "outbox"], cwd=mirror)
    if add.returncode != 0:
        raise RuntimeError(add.stderr.strip() or "Could not stage the outbox.")
    status = _run_git(["status", "--porcelain", "--", "outbox"], cwd=mirror)
    if not status.stdout.strip():
        return
    commit = _run_git(["-c", "user.email=outbox@local", "-c", "user.name=Grok Crew Outbox", "commit", "-m", message], cwd=mirror)
    if commit.returncode != 0:
        raise RuntimeError(commit.stderr.strip() or "Could not commit the outbox.")
    push = _run_git(["push", "origin", f"HEAD:{branch}"], cwd=mirror)
    if push.returncode != 0:
        raise RuntimeError(push.stderr.strip() or "Could not push the outbox.")


def push_outbox(item: dict[str, Any] | None = None, *, door: str | None = None) -> dict[str, Any]:
    remote = str(os.getenv("HANDOFF_REPO_REMOTE") or "").strip()
    if not remote:
        return {"ok": False, "skipped": True, "reason": "HANDOFF_REPO_REMOTE is not set. The spec stays in the local outbox."}
    branch = str(os.getenv("HANDOFF_BRANCH") or "handoff-inbox").strip() or "handoff-inbox"
    try:
        mirror = _ensure_mirror(remote, branch)
        copied: list[str] = []
        if item and item.get("path") and item.get("folder"):
            resolved = normalize_door(door or item.get("door") or EDITOR_DOOR, required=True)
            dest = mirror / "outbox" / door_folder(resolved) / str(item["folder"])
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(item["path"], dest)
            copied.append(f"outbox/{door_folder(resolved)}/{item['folder']}")
        else:
            doors = [normalize_door(door, required=True)] if door else list(DOORS)
            for item_door in doors:
                for folder in pending_outbox_folders(item_door):
                    dest = mirror / "outbox" / door_folder(item_door) / folder.name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    if dest.exists():
                        shutil.rmtree(dest)
                    shutil.copytree(folder, dest)
                    copied.append(f"outbox/{door_folder(item_door)}/{folder.name}")
        if not copied:
            return {"ok": True, "remote": remote, "branch": branch, "copied": [], "note": "No pending outbox specs to push."}
        _commit_and_push(mirror, branch, f"Outbox {', '.join(copied)}")
        return {"ok": True, "remote": remote, "branch": branch, "copied": copied}
    except (RuntimeError, OSError, ValueError) as exc:
        return {"ok": False, "remote": remote, "reason": str(exc)}


def _remove_outbox_from_git(spec_id: str, door: str) -> dict[str, Any]:
    remote = str(os.getenv("HANDOFF_REPO_REMOTE") or "").strip()
    if not remote:
        return {"ok": False, "skipped": True, "reason": "HANDOFF_REPO_REMOTE is not set"}
    branch = str(os.getenv("HANDOFF_BRANCH") or "handoff-inbox").strip() or "handoff-inbox"
    try:
        mirror = _ensure_mirror(remote, branch)
        removed: list[str] = []
        for alias in door_folder_aliases(door):
            dest = mirror / "outbox" / alias / spec_id
            if not dest.exists():
                continue
            remove = _run_git(["rm", "-r", "-q", "--", str(dest.relative_to(mirror))], cwd=mirror)
            if remove.returncode != 0:
                raise RuntimeError(remove.stderr.strip() or "Could not remove the fulfilled spec from git.")
            removed.append(f"outbox/{alias}/{spec_id}")
        if not removed:
            return {"ok": True, "skipped": True, "reason": "already absent from git outbox"}
        _commit_and_push(mirror, branch, f"Fulfilled outbox {', '.join(removed)}")
        return {"ok": True, "removed": removed[0] if len(removed) == 1 else removed}
    except (RuntimeError, OSError, ValueError) as exc:
        return {"ok": False, "reason": str(exc)}


def push_handoff_outbox(body: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = body if isinstance(body, dict) else {}
    spec_id = str(payload.get("edit_spec_id") or "").strip()
    door = payload.get("door")
    if spec_id:
        record = get_spec(spec_id)
        if not record:
            raise ValueError("Edit spec not found.")
        folder = find_outbox_folder(spec_id, record.get("door"))
        if folder is None:
            written = write_outbox(record, push_git=False)
            folder = Path(written["path"])
            door = written["door"]
        return {
            "outbox": outbox_status(),
            "git": push_outbox({"path": str(folder), "folder": folder.name, "door": door or record.get("door")}, door=door or record.get("door")),
        }
    return {"outbox": outbox_status(), "git": push_outbox(door=door if door not in (None, "") else None)}

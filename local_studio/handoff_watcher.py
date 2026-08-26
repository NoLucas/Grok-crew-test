#!/usr/bin/env python3
"""Handoff watcher: applies project bundles a remote/cloud bot pushed to a
dedicated git branch, using the same local HTTP API any same-PC bot uses.

Local Studio itself never leaves loopback. This script is the only bridge: it
runs on the same PC as Local Studio, pulls a git branch a remote bot can push
to over the network it already has, and replays the bundle through the
existing /api/projects/import + job endpoints."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from grok_crew import LocalStudioClient
from handoff_inbox import infer_package_door, media_relpaths

BASE_DIR = Path(__file__).resolve().parent


def log(message: str) -> None:
    print(f"[handoff] {message}", flush=True)


def load_dotenv() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


# Must run before the os.getenv() defaults below are evaluated -- these are module-level
# constants read once at import time, so main()'s later load_dotenv() call would be too
# late for them (this script is also imported standalone via `python handoff_watcher.py`,
# so this must not depend on studio_server having loaded .env first either).
load_dotenv()

DATA_DIR = BASE_DIR / "data"
MIRROR_DIR = DATA_DIR / "handoff-mirror"
STATE_PATH = DATA_DIR / "handoff_state.json"
BUNDLE_SCHEMA = "local-video-workspace.project-bundle/v1"
BOT_ID = "cloud-handoff"
BOT_DISPLAY_NAME = "Cloud Handoff Watcher"
ALLOWED_MEDIA_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
MAX_MEDIA_BYTES = int(os.getenv("HANDOFF_MAX_MEDIA_BYTES", str(2 * 1024 ** 3)))  # 2 GB
MAX_BUNDLE_BYTES = int(os.getenv("HANDOFF_MAX_BUNDLE_BYTES", str(4 * 1024 * 1024)))  # 4 MB
DEFAULT_MAX_PACKAGES_PER_CYCLE = 5


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"processed": [], "entered": False}
    try:
        value = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"processed": [], "entered": False}
    return value if isinstance(value, dict) else {"processed": [], "entered": False}


def save_state(state: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True, timeout=120)


def default_remote() -> str:
    result = run_git(["remote", "get-url", "origin"], cwd=BASE_DIR.parent)
    if result.returncode != 0 or not result.stdout.strip():
        raise RuntimeError("Could not determine the repository's origin remote. Pass --repo-remote explicitly.")
    return result.stdout.strip()


def sync_mirror(remote: str, branch: str) -> Path:
    if not (MIRROR_DIR / ".git").exists():
        MIRROR_DIR.parent.mkdir(parents=True, exist_ok=True)
        log(f"Cloning {branch} from {remote} into {MIRROR_DIR}")
        result = run_git(["clone", "--single-branch", "--branch", branch, remote, str(MIRROR_DIR)], cwd=BASE_DIR)
        if result.returncode != 0:
            raise RuntimeError(f"Could not clone the handoff branch: {result.stderr.strip()}")
    else:
        fetch = run_git(["fetch", "origin", branch], cwd=MIRROR_DIR)
        if fetch.returncode != 0:
            raise RuntimeError(f"Could not fetch the handoff branch: {fetch.stderr.strip()}")
        reset = run_git(["reset", "--hard", f"origin/{branch}"], cwd=MIRROR_DIR)
        if reset.returncode != 0:
            raise RuntimeError(f"Could not update the handoff branch checkout: {reset.stderr.strip()}")
    return MIRROR_DIR


RESERVED_MIRROR_NAMES = {".git", ".processed", "editor", "collector", "grok", "agents", "agent", "outbox", "materials"}
DOOR_MIRROR_FOLDERS = ("editor", "collector", "grok", "agents", "agent")


def pending_folders(mirror: Path, processed: set[str]) -> list[Path]:
    folders: list[Path] = []
    for item in sorted(mirror.iterdir()):
        if not item.is_dir() or item.name in RESERVED_MIRROR_NAMES:
            continue
        if item.name not in processed:
            folders.append(item)
    for door_name in DOOR_MIRROR_FOLDERS:
        door_dir = mirror / door_name
        if not door_dir.is_dir():
            continue
        for item in sorted(door_dir.iterdir()):
            if not item.is_dir() or item.name in {".git", ".processed"}:
                continue
            key = f"{door_name}/{item.name}"
            if key in processed or item.name in processed:
                continue
            folders.append(item)
    return folders


def folders_for_cycle(folders: list[Path], max_per_cycle: int) -> list[Path]:
    """Cap pending folders to at most max_per_cycle for this poll; the rest wait for the next one."""
    if len(folders) > max_per_cycle:
        log(f"{len(folders)} package(s) pending; processing the oldest {max_per_cycle} this cycle, the rest will follow on the next cycle.")
        return folders[:max_per_cycle]
    return folders


def ensure_bot_entered(client: LocalStudioClient, state: dict[str, Any]) -> None:
    if state.get("entered"):
        return
    client.request("/api/bot-entry", {
        "bot_id": BOT_ID,
        "display_name": BOT_DISPLAY_NAME,
        "purpose": "apply_cloud_bundle",
        "task": "Import project bundles pushed by a remote bot and run their queued jobs.",
    })
    state["entered"] = True


def heartbeat(client: LocalStudioClient, action: str, detail: dict[str, Any]) -> None:
    try:
        client.request("/api/bots/heartbeat", {"bot_id": BOT_ID, "display_name": BOT_DISPLAY_NAME, "action": action, "detail": detail})
    except RuntimeError as exc:
        log(f"Heartbeat failed (non-fatal): {exc}")


def copy_media(folder: Path, workspace: Path, relative_path: str) -> None:
    source = folder / Path(relative_path).name
    if not source.is_file():
        raise RuntimeError(f"Media file '{source.name}' referenced by bundle.project.source_path was not found in the package.")
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


def run_job(client: LocalStudioClient, job_id: str, folder_name: str, kind: str) -> None:
    try:
        result = client.request(f"/api/jobs/{job_id}/run", {})
        status = result.get("job", {}).get("status")
        log(f"{folder_name}: ran {kind} job {job_id} -> {status}")
    except RuntimeError as exc:
        log(f"{folder_name}: could not run {kind} job {job_id}: {exc}")


def process_folder(client: LocalStudioClient, folder: Path, workspace: Path, *, allow_auto_upload: bool) -> None:
    bundle_path = folder / "bundle.json"
    if not bundle_path.exists():
        log(f"Skipping {folder.name}: no bundle.json.")
        return
    bundle_size = bundle_path.stat().st_size
    if bundle_size > MAX_BUNDLE_BYTES:
        log(f"Skipping {folder.name}: bundle.json is {bundle_size} bytes, over the {MAX_BUNDLE_BYTES}-byte limit.")
        return
    try:
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        log(f"Skipping {folder.name}: invalid bundle.json ({exc}).")
        return
    if not isinstance(bundle, dict) or bundle.get("schema") != BUNDLE_SCHEMA:
        log(f"Skipping {folder.name}: bundle.json must use schema {BUNDLE_SCHEMA}.")
        return
    project = bundle.get("project")
    if not isinstance(project, dict) or not project.get("source_path"):
        log(f"Skipping {folder.name}: bundle.project.source_path is required.")
        return
    try:
        from edit_spec import EDITOR_DOOR, normalize_door

        package_door = infer_package_door(project, folder)
        location = folder.parent.name.lower()
        try:
            location_door = normalize_door(location, required=True)
        except ValueError:
            location_door = EDITOR_DOOR
        if package_door != location_door:
            log(f"Skipping {folder.name}: package door {package_door} does not match this inbox ({location_door}).")
            return
    except ValueError as exc:
        log(f"Skipping {folder.name}: {exc}")
        return
    try:
        for relative in media_relpaths(project):
            copy_media(folder, workspace, relative)
    except RuntimeError as exc:
        log(f"Skipping {folder.name}: {exc}")
        return
    auto_upload_requested = bool(project.get("handoff_auto_upload_requested"))
    try:
        response = client.request("/api/projects/import", {"bundle": bundle})
    except RuntimeError as exc:
        log(f"Skipping {folder.name}: import failed ({exc}).")
        return
    jobs = response.get("jobs") if isinstance(response.get("jobs"), list) else []
    log(f"Imported {folder.name} as project {(response.get('project') or {}).get('id')} with {len(jobs)} job(s).")
    for job in jobs:
        if not isinstance(job, dict) or job.get("status") != "queued":
            continue
        job_id, kind = job.get("id"), job.get("kind")
        if not job_id:
            continue
        if kind == "render":
            run_job(client, job_id, folder.name, "render")
        elif kind == "instagram_publish":
            if allow_auto_upload and auto_upload_requested:
                run_job(client, job_id, folder.name, "instagram_publish")
            else:
                log(f"{folder.name}: leaving Instagram job {job_id} queued for a human to run.")


def cleanup_folder(mirror: Path, folder: Path, branch: str) -> None:
    relative = folder.relative_to(mirror)
    remove = run_git(["rm", "-r", "-q", str(relative)], cwd=mirror)
    if remove.returncode != 0:
        log(f"Could not remove {relative} from the handoff branch: {remove.stderr.strip()}")
        return
    commit = run_git(["commit", "-m", f"Processed {relative}"], cwd=mirror)
    if commit.returncode != 0:
        log(f"Could not commit handoff cleanup for {relative}: {commit.stderr.strip()}")
        return
    push = run_git(["push", "origin", f"HEAD:{branch}"], cwd=mirror)
    if push.returncode != 0:
        log(f"Could not push handoff cleanup for {relative}: {push.stderr.strip()}")


def run_once(args: argparse.Namespace) -> None:
    client = LocalStudioClient(args.server, args.token)
    state = load_state()
    ensure_bot_entered(client, state)
    save_state(state)
    remote = args.repo_remote or default_remote()
    mirror = sync_mirror(remote, args.branch)
    processed = set(state.get("processed", []))
    workspace = Path(os.getenv("LOCAL_STUDIO_WORKSPACE", BASE_DIR / "workspace")).resolve()
    folders = pending_folders(mirror, processed)
    if not folders:
        log("No new handoff packages.")
        return
    folders = folders_for_cycle(folders, args.max_per_cycle)
    for folder in folders:
        process_folder(client, folder, workspace, allow_auto_upload=args.allow_auto_upload)
        heartbeat(client, "handoff_processed", {"package": folder.name})
        try:
            processed.add(str(folder.relative_to(mirror)))
        except ValueError:
            processed.add(folder.name)
        processed.add(folder.name)
        state["processed"] = sorted(processed)
        save_state(state)
        if args.cleanup:
            cleanup_folder(mirror, folder, args.branch)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Watch a dedicated git branch for cloud-bot project bundles and apply them through the local Studio API.")
    parser.add_argument("--server", default=os.getenv("GROK_CREW_SERVER", "http://127.0.0.1:7214"), help="Local Studio URL; loopback only.")
    parser.add_argument("--token", default=os.getenv("LOCAL_STUDIO_TOKEN", ""), help="Optional Local Studio token.")
    parser.add_argument("--repo-remote", default=os.getenv("HANDOFF_REPO_REMOTE", ""), help="Git remote URL to pull handoff packages from. Defaults to HANDOFF_REPO_REMOTE in local_studio/.env, or this repository's own origin if that is unset.")
    parser.add_argument("--branch", default=os.getenv("HANDOFF_BRANCH", "handoff-inbox"), help="Branch a remote bot pushes handoff packages to. Defaults to HANDOFF_BRANCH in local_studio/.env, or 'handoff-inbox'.")
    parser.add_argument("--interval", type=float, default=60.0, help="Seconds between polls.")
    parser.add_argument("--once", action="store_true", help="Run a single pass instead of polling forever.")
    parser.add_argument("--allow-auto-upload", action="store_true", help="Allow a package that requests it to publish to Instagram immediately. Off by default; otherwise Instagram jobs stay queued for a human to run.")
    parser.add_argument("--max-per-cycle", type=int, default=int(os.getenv("HANDOFF_MAX_PACKAGES_PER_CYCLE", str(DEFAULT_MAX_PACKAGES_PER_CYCLE))), help=f"Maximum number of pending packages to process per poll cycle (default {DEFAULT_MAX_PACKAGES_PER_CYCLE}); the rest wait for the next cycle.")
    cleanup_group = parser.add_mutually_exclusive_group()
    cleanup_group.add_argument("--cleanup", dest="cleanup", action="store_true", help="Remove processed packages from the handoff branch (default).")
    cleanup_group.add_argument("--no-cleanup", dest="cleanup", action="store_false", help="Keep processed packages on the handoff branch.")
    parser.set_defaults(cleanup=True)
    return parser


def main() -> None:
    load_dotenv()
    args = build_parser().parse_args()
    while True:
        try:
            run_once(args)
        except Exception as exc:  # noqa: BLE001
            log(f"Handoff cycle failed: {exc}")
        if args.once:
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nHandoff watcher stopped.")

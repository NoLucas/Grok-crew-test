"""Low-resolution local proxy generation for P1-04 timeline playback."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

from analysis import _probe as probe_media
from config import utc_now, workspace_path
from db import db, row_dict

PROXY_STATUSES = {"queued", "running", "ready", "failed", "cancelled"}


def _safe_id(value: Any, field: str) -> str:
    identifier = str(value or "").strip()[:120]
    if not identifier or not all(character.isalnum() or character in "-_." for character in identifier):
        raise ValueError(f"{field} must use letters, numbers, hyphen, underscore, or period.")
    return identifier


def source_asset(project: dict[str, Any], asset_id: str) -> tuple[dict[str, Any], Path]:
    timeline = project.get("timeline_json")
    if not isinstance(timeline, dict) or timeline.get("schema") != "grok-crew.timeline/v2":
        raise ValueError("Proxy editing requires a Timeline v2 project.")
    safe_asset_id = _safe_id(asset_id, "asset_id")
    asset = next(
        (
            item for item in timeline.get("assets", [])
            if isinstance(item, dict) and item.get("id") == safe_asset_id
        ),
        None,
    )
    if not asset or asset.get("kind") != "video":
        raise ValueError("A video asset is required for proxy generation.")
    source = workspace_path(str(asset.get("path", "")))
    if not source.is_file():
        raise ValueError("The original video asset does not exist.")
    return asset, source


def proxy_relative_path(project_id: str, asset_id: str, source: Path) -> str:
    safe_project = _safe_id(project_id, "project_id")
    safe_asset = _safe_id(asset_id, "asset_id")
    stat = source.stat()
    return f"proxies/{safe_project}/{safe_asset}-{stat.st_size:x}-{stat.st_mtime_ns:x}.mp4"


def ready_proxy_paths(project_id: str, timeline: dict[str, Any] | None = None) -> dict[str, Path]:
    """Asset ids whose current proxy file can be used for draft preview."""
    assets: dict[str, dict[str, Any]] = {}
    if isinstance(timeline, dict):
        assets = {
            str(item.get("id")): item
            for item in timeline.get("assets", [])
            if isinstance(item, dict) and item.get("id")
        }
    paths: dict[str, Path] = {}
    for proxy in list_proxies(project_id):
        asset_id = str(proxy.get("asset_id") or "")
        if not asset_id:
            continue
        asset = assets.get(asset_id)
        if asset is not None:
            try:
                source = workspace_path(str(asset.get("path", "")))
            except ValueError:
                continue
            if not proxy_is_current(proxy, source):
                continue
        elif proxy.get("status") != "ready" or not proxy.get("proxy_path"):
            continue
        try:
            destination = workspace_path(str(proxy["proxy_path"]))
        except ValueError:
            continue
        if destination.is_file():
            paths[asset_id] = destination
    return paths


def list_proxies(project_id: str) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM media_proxies WHERE project_id = ? ORDER BY updated_at DESC",
            (project_id,),
        ).fetchall()
    return [row_dict(row) or {} for row in rows]


def get_proxy(project_id: str, asset_id: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM media_proxies WHERE project_id = ? AND asset_id = ?",
            (project_id, asset_id),
        ).fetchone()
    return row_dict(row)


def proxy_is_current(proxy: dict[str, Any] | None, source: Path) -> bool:
    if not proxy or proxy.get("status") != "ready" or not proxy.get("proxy_path"):
        return False
    stat = source.stat()
    try:
        destination = workspace_path(str(proxy["proxy_path"]))
    except ValueError:
        return False
    return (
        destination.is_file()
        and str(proxy.get("source_path")) == str(source)
        and int(proxy.get("source_size") or -1) == stat.st_size
        and int(proxy.get("source_mtime_ns") or -1) == stat.st_mtime_ns
    )


def update_proxy(
    project_id: str,
    asset_id: str,
    source: Path,
    *,
    status: str,
    job_id: str | None = None,
    proxy_path: str | None = None,
    progress: int = 0,
    width: int | None = None,
    height: int | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    if status not in PROXY_STATUSES:
        raise ValueError("Unsupported proxy status.")
    now, stat = utc_now(), source.stat()
    with db() as conn:
        conn.execute(
            """INSERT INTO media_proxies
            (project_id, asset_id, source_path, proxy_path, status, job_id, progress,
             width, height, error_text, source_size, source_mtime_ns, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, asset_id) DO UPDATE SET
                source_path = excluded.source_path,
                proxy_path = COALESCE(excluded.proxy_path, media_proxies.proxy_path),
                status = excluded.status,
                job_id = excluded.job_id,
                progress = excluded.progress,
                width = COALESCE(excluded.width, media_proxies.width),
                height = COALESCE(excluded.height, media_proxies.height),
                error_text = excluded.error_text,
                source_size = excluded.source_size,
                source_mtime_ns = excluded.source_mtime_ns,
                updated_at = excluded.updated_at""",
            (
                project_id, asset_id, str(source), proxy_path, status, job_id,
                max(0, min(int(progress), 100)), width, height, error,
                stat.st_size, stat.st_mtime_ns, now, now,
            ),
        )
        row = conn.execute(
            "SELECT * FROM media_proxies WHERE project_id = ? AND asset_id = ?",
            (project_id, asset_id),
        ).fetchone()
    return row_dict(row) or {}


def _ffmpeg_binary() -> str:
    value = shutil.which("ffmpeg")
    if value:
        return value
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return ""


def generate_proxy(
    project: dict[str, Any],
    payload: dict[str, Any],
    progress_cb: Callable[[int], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    asset_id = _safe_id(payload.get("asset_id"), "asset_id")
    _asset, source = source_asset(project, asset_id)
    relative = proxy_relative_path(str(project["id"]), asset_id, source)
    destination = workspace_path(relative)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".part.mp4")
    if destination.is_file() and not payload.get("force"):
        metadata = probe_media(destination)
        video = next(
            (stream for stream in metadata.get("streams", []) if stream.get("codec_type") == "video"),
            {},
        )
        return {
            "asset_id": asset_id,
            "proxy_path": relative,
            "original_path": str(source),
            "width": int(video.get("width") or 0),
            "height": int(video.get("height") or 0),
            "duration": float(metadata.get("duration") or 0),
            "reused": True,
        }

    ffmpeg = _ffmpeg_binary()
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to generate a proxy.")
    metadata = probe_media(source)
    duration = max(0.001, float(metadata.get("duration") or 0.001))
    command = [
        ffmpeg,
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(source),
        "-map", "0:v:0", "-map", "0:a?",
        "-vf", "scale=w='min(960,iw)':h=-2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats",
        str(temporary),
    ]
    if progress_cb:
        progress_cb(2)
    process = subprocess.Popen(  # noqa: S603 - fixed local ffmpeg executable and arguments
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert process.stdout is not None
        for line in process.stdout:
            if should_cancel and should_cancel():
                process.terminate()
                raise RuntimeError("Proxy generation cancelled.")
            key, _, value = line.strip().partition("=")
            if key in {"out_time_ms", "out_time_us"}:
                try:
                    seconds = int(value) / 1_000_000
                except ValueError:
                    continue
                if progress_cb:
                    progress_cb(min(94, 2 + int(92 * seconds / duration)))
        stderr = process.stderr.read() if process.stderr else ""
        code = process.wait()
        if code != 0:
            raise RuntimeError(f"ffmpeg proxy generation failed: {stderr.strip()[-600:]}")
        if should_cancel and should_cancel():
            raise RuntimeError("Proxy generation cancelled.")
        temporary.replace(destination)
    finally:
        if process.poll() is None:
            process.kill()
        if temporary.exists():
            temporary.unlink(missing_ok=True)

    result_metadata = probe_media(destination)
    video = next(
        (stream for stream in result_metadata.get("streams", []) if stream.get("codec_type") == "video"),
        {},
    )
    if progress_cb:
        progress_cb(100)
    return {
        "asset_id": asset_id,
        "proxy_path": relative,
        "original_path": str(source),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "duration": float(result_metadata.get("duration") or 0),
        "reused": False,
    }

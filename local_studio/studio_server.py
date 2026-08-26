"""Local Video Studio: local SQLite jobs, MoviePy rendering, and optional
automatic Instagram upload -- project/job/bot/artifact domain logic and the
process entrypoint. See config.py (shared constants/paths), db.py (SQLite),
render.py (MoviePy), instagram.py (Meta upload), and handlers.py (the HTTP
routing layer that calls into this module) for the rest of the server."""

from __future__ import annotations

import argparse
import json
import os
import sys
import re
import shutil
import sqlite3
import subprocess
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

import config
from config import (
    ARTIFACT_TYPES,
    BOT_ENTRY_SCHEMA,
    BOT_GUIDE_JA_PATH,
    BOT_GUIDE_KO_PATH,
    BOT_GUIDE_PATH,
    BOT_GUIDE_ZH_PATH,
    DEFAULT_EDIT_METHOD,
    EXECUTION_MODES,
    PROJECT_BUNDLE_SCHEMA,
    RENDER_EXECUTOR,
    SITE_BASE_URL,
    load_dotenv,
    require_path,
    utc_now,
    workspace_path,
)
from db import db, event, init_db, row_dict
from instagram import instagram_publish
from launch import launch_status as build_launch_status
from publishers import list_publish_receipts
from publishers import publish
from publishers import reconcile_publish_receipts
from publishers import retry_publish
from proxy import (
    generate_proxy,
    get_proxy,
    list_proxies,
    proxy_is_current,
    source_asset,
    update_proxy,
)
from exchange import export_edl, export_otio, import_edl, import_otio
from preview import preview_at
from render import render_moviepy


def new_project(body: dict[str, Any]) -> dict[str, Any]:
    title = str(body.get("title", "Untitled video project")).strip()[:120] or "Untitled video project"
    source = require_path(body.get("source_path"), "source_path")
    output = require_path(body.get("output_path", "outputs/final-video.mp4"), "output_path")
    timeline = body.get("timeline", {})
    if not isinstance(timeline, dict) or not isinstance(timeline.get("clips"), list):
        raise ValueError("timeline.clips must be a list.")
    project_id = str(uuid.uuid4())
    now = utc_now()
    with db() as conn:
        conn.execute("INSERT INTO projects (id, title, source_path, output_path, timeline_json, caption, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (project_id, title, str(source), str(output), json.dumps(timeline), str(body.get("caption", ""))[:2200], now, now))
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    event(project_id, None, "project_created", {"title": title, "source": str(source), "output": str(output)})
    return row_dict(row) or {}


def get_project(project_id: str) -> dict[str, Any] | None:
    with db() as conn:
        return row_dict(conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())


def list_projects() -> list[dict[str, Any]]:
    with db() as conn:
        return [row_dict(row) or {} for row in conn.execute("SELECT * FROM projects ORDER BY updated_at DESC LIMIT 50")]


def list_jobs(project_id: str | None = None) -> list[dict[str, Any]]:
    query = "SELECT * FROM jobs" + (" WHERE project_id = ?" if project_id else "") + " ORDER BY created_at DESC LIMIT 100"
    with db() as conn:
        rows = conn.execute(query, (project_id,) if project_id else ()).fetchall()
    return [row_dict(row) or {} for row in rows]


def get_job(job_id: str) -> dict[str, Any] | None:
    with db() as conn:
        return row_dict(conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())


def safe_detail(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        detail = value
    else:
        detail = {"message": str(value or "")}
    raw = json.dumps(detail, ensure_ascii=False)
    return detail if len(raw) <= 1200 else {"truncated": True, "summary": raw[:1000]}


def valid_bot_id(value: Any) -> str:
    bot_id = str(value or "").strip()[:80]
    if not bot_id or not all(character.isalnum() or character in "-_." for character in bot_id):
        raise ValueError("bot_id must use letters, numbers, hyphen, underscore, or period.")
    return bot_id


def record_bot_heartbeat(body: dict[str, Any]) -> dict[str, Any]:
    bot_id = valid_bot_id(body.get("bot_id"))
    display_name = str(body.get("display_name", bot_id)).strip()[:120] or bot_id
    action = str(body.get("action", "heartbeat")).strip()[:120] or "heartbeat"
    detail = safe_detail(body.get("detail", {}))
    now = utc_now()
    with db() as conn:
        conn.execute("""INSERT INTO bot_sessions (bot_id, display_name, last_action, last_detail_json, last_seen, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(bot_id) DO UPDATE SET display_name = excluded.display_name, last_action = excluded.last_action,
            last_detail_json = excluded.last_detail_json, last_seen = excluded.last_seen""", (bot_id, display_name, action, json.dumps(detail), now, now))
        conn.execute("INSERT INTO bot_activity (id, bot_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)", (str(uuid.uuid4()), bot_id, action, json.dumps(detail), now))
        row = conn.execute("SELECT * FROM bot_sessions WHERE bot_id = ?", (bot_id,)).fetchone()
    event(None, None, "bot_heartbeat", {"bot_id": bot_id, "action": action})
    return row_dict(row) or {}


def list_bots() -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM bot_sessions ORDER BY last_seen DESC LIMIT 100").fetchall()
        policy_rows = conn.execute("SELECT * FROM bot_execution_policies").fetchall()
    policies = {str(row["bot_id"]): row_dict(row) or {} for row in policy_rows}
    now = datetime.now(timezone.utc)
    bots = []
    for row in rows:
        bot = row_dict(row) or {}
        seen = datetime.fromisoformat(str(bot["last_seen"]))
        seconds_since_checkin = max(0, int((now - seen).total_seconds()))
        bot["seconds_since_checkin"] = seconds_since_checkin
        bot["presence"] = "active" if seconds_since_checkin <= 300 else "idle"
        bot["execution_policy"] = policies.get(bot["bot_id"], {"bot_id": bot["bot_id"], "mode": "approval_required", "updated_by": "local_default", "updated_at": None, "is_default": True})
        bots.append(bot)
    return {"bots": bots, "summary": {"total_known": len(bots), "active_now": sum(bot["presence"] == "active" for bot in bots), "activity_rule": "active means a recorded check-in within the last 5 minutes"}}


def list_bot_activity() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM bot_activity ORDER BY created_at DESC LIMIT 80").fetchall()
    return [row_dict(row) or {} for row in rows]


def execution_policy(bot_id: str) -> dict[str, Any]:
    bot_id = valid_bot_id(bot_id)
    with db() as conn:
        row = conn.execute("SELECT * FROM bot_execution_policies WHERE bot_id = ?", (bot_id,)).fetchone()
    if row:
        return row_dict(row) or {}
    return {"bot_id": bot_id, "mode": "approval_required", "updated_by": "local_default", "updated_at": None, "is_default": True}


def set_execution_policy(body: dict[str, Any]) -> dict[str, Any]:
    bot_id = valid_bot_id(body.get("bot_id"))
    mode = str(body.get("mode", "")).strip()
    if mode not in EXECUTION_MODES:
        raise ValueError("mode must be auto_local or approval_required.")
    updated_by = str(body.get("updated_by", bot_id)).strip()[:80] or bot_id
    now = utc_now()
    with db() as conn:
        conn.execute("""INSERT INTO bot_execution_policies (bot_id, mode, updated_by, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(bot_id) DO UPDATE SET mode = excluded.mode, updated_by = excluded.updated_by, updated_at = excluded.updated_at""", (bot_id, mode, updated_by, now))
        row = conn.execute("SELECT * FROM bot_execution_policies WHERE bot_id = ?", (bot_id,)).fetchone()
    policy = row_dict(row) or {}
    event(None, None, "bot_execution_policy_set", {"bot_id": bot_id, "mode": mode, "updated_by": updated_by})
    record_bot_heartbeat({"bot_id": bot_id, "display_name": body.get("display_name", bot_id), "action": "execution_policy_set", "detail": {"mode": mode}})
    return policy


def ensure_execution_policy(bot_id: str, mode: Any = None) -> dict[str, Any]:
    current = execution_policy(bot_id)
    if current.get("is_default"):
        return set_execution_policy({"bot_id": bot_id, "mode": str(mode or "auto_local"), "updated_by": bot_id})
    if mode is not None:
        return set_execution_policy({"bot_id": bot_id, "mode": mode, "updated_by": bot_id})
    return current


def bot_auto_executes(body: dict[str, Any]) -> tuple[bool, dict[str, Any] | None]:
    bot_id = str(body.get("bot_id", "")).strip()
    if not bot_id:
        return False, None
    policy = execution_policy(bot_id)
    return policy.get("mode") == "auto_local", policy


def artifact_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    value = dict(row)
    value["payload"] = json.loads(value.pop("payload_json"))
    return value


def artifact_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("artifact payload must be a JSON object.")
    raw = json.dumps(value, ensure_ascii=False)
    if len(raw) > 30_000:
        raise ValueError("artifact payload is too large.")
    return value


def save_artifact(project_id: str | None, kind: str, title: Any, payload: Any, created_by: Any = "local_user") -> dict[str, Any]:
    if kind not in ARTIFACT_TYPES:
        raise ValueError("Unsupported project artifact type.")
    if project_id and not get_project(project_id):
        raise ValueError("Project not found.")
    artifact_id, now = str(uuid.uuid4()), utc_now()
    safe_title = str(title or kind.replace("_", " ")).strip()[:160] or kind.replace("_", " ")
    safe_actor = str(created_by or "local_user").strip()[:80] or "local_user"
    safe_payload = artifact_payload(payload)
    with db() as conn:
        conn.execute("""INSERT INTO project_artifacts (id, project_id, type, title, payload_json, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", (artifact_id, project_id, kind, safe_title, json.dumps(safe_payload), safe_actor, now, now))
        row = conn.execute("SELECT * FROM project_artifacts WHERE id = ?", (artifact_id,)).fetchone()
    event(project_id, None, "artifact_saved", {"artifact_id": artifact_id, "type": kind, "title": safe_title, "created_by": safe_actor})
    return artifact_dict(row) or {}


def list_artifacts(project_id: str | None = None, kind: str | None = None) -> list[dict[str, Any]]:
    clauses, params = [], []
    if project_id is not None:
        clauses.append("project_id = ?"); params.append(project_id)
    if kind is not None:
        clauses.append("type = ?"); params.append(kind)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with db() as conn:
        rows = conn.execute(f"SELECT * FROM project_artifacts{where} ORDER BY updated_at DESC LIMIT 160", tuple(params)).fetchall()
    return [artifact_dict(row) or {} for row in rows]


def update_artifact(artifact_id: str, body: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM project_artifacts WHERE id = ?", (artifact_id,)).fetchone()
        current = artifact_dict(row)
        if not current:
            raise ValueError("Artifact not found.")
        title = str(body.get("title", current["title"])).strip()[:160] or current["title"]
        current_payload = current["payload"]
        change = artifact_payload(body.get("payload", {}))
        payload = {**current_payload, **change}
        now = utc_now()
        conn.execute("UPDATE project_artifacts SET title = ?, payload_json = ?, updated_at = ? WHERE id = ?", (title, json.dumps(payload), now, artifact_id))
        updated = conn.execute("SELECT * FROM project_artifacts WHERE id = ?", (artifact_id,)).fetchone()
    event(current["project_id"], None, "artifact_updated", {"artifact_id": artifact_id, "type": current["type"]})
    return artifact_dict(updated) or {}


def build_cut_map(project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    if not get_project(project_id):
        raise ValueError("Project not found.")
    raw_segments = body.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise ValueError("segments must contain timestamped transcript entries.")
    if len(raw_segments) > 500:
        raise ValueError("A cut map may contain up to 500 transcript entries.")
    segments, suggestions, previous_end = [], [], 0.0
    filler = {"um", "uh", "erm", "hmm", "음", "어", "저기"}
    for index, raw in enumerate(raw_segments):
        if not isinstance(raw, dict):
            raise ValueError("Each transcript segment must be an object.")
        try:
            start, end = float(raw.get("start")), float(raw.get("end"))
        except (TypeError, ValueError) as exc:
            raise ValueError("Transcript start and end must be numbers.") from exc
        text = str(raw.get("text", "")).strip()[:280]
        if start < 0 or end <= start or not text:
            raise ValueError("Each transcript segment needs a non-negative range and text.")
        segment = {"index": index + 1, "start": round(start, 3), "end": round(end, 3), "text": text}
        segments.append(segment)
        gap = start - previous_end
        if index and gap >= .4:
            suggestions.append({"kind": "silence_gap", "start": round(previous_end, 3), "end": round(start, 3), "action": "review_or_remove", "reason": f"{gap:.2f}s silence between speech segments"})
        normalized = re.sub(r"[^\w가-힣 ]", "", text.lower()).strip()
        if normalized in filler:
            suggestions.append({"kind": "filler", "start": round(start, 3), "end": round(end, 3), "action": "remove", "reason": f"Detected filler phrase: {text}"})
        previous_end = max(previous_end, end)
    payload = {"segments": segments, "suggestions": suggestions, "summary": {"segment_count": len(segments), "suggested_reviews": len(suggestions), "source": "bot_or_user_supplied_transcript", "rule": "Suggestions do not modify the EDL until a bot or person creates an approved project."}}
    return save_artifact(project_id, "cut_map", body.get("title", "Transcript cut map"), payload, body.get("created_by", "grok_bot"))


def probe_media(path: Path) -> dict[str, Any]:
    report: dict[str, Any] = {"path": str(path), "exists": path.exists(), "extension": path.suffix.lower(), "size_bytes": path.stat().st_size if path.exists() else None, "duration_seconds": None, "width": None, "height": None, "fps": None, "video_codec": None, "audio_codec": None, "has_audio": None, "silence_ranges": [], "black_ranges": [], "analysis": []}
    if not path.exists():
        report["analysis"].append("Source file is missing from the local workspace.")
        return report
    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        try:
            result = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", str(path)], capture_output=True, text=True, timeout=25, check=True)
            data = json.loads(result.stdout)
            report["duration_seconds"] = round(float(data.get("format", {}).get("duration", 0)), 3) or None
            for stream in data.get("streams", []):
                if stream.get("codec_type") == "video":
                    report["width"], report["height"], report["video_codec"] = stream.get("width"), stream.get("height"), stream.get("codec_name")
                    frame_rate = str(stream.get("r_frame_rate", "0/1"))
                    numerator, denominator = frame_rate.split("/", 1)
                    report["fps"] = round(float(numerator) / max(float(denominator), 1), 3)
                elif stream.get("codec_type") == "audio":
                    report["has_audio"], report["audio_codec"] = True, stream.get("codec_name")
            if report["has_audio"] is None:
                report["has_audio"] = False
            report["analysis"].append("Media metadata read with local ffprobe.")
        except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError) as exc:
            report["analysis"].append(f"Metadata probe was unavailable: {exc}")
    else:
        report["analysis"].append("ffprobe is not installed, so detailed media metadata is unavailable.")
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg and report["has_audio"]:
        try:
            result = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path), "-af", "silencedetect=noise=-35dB:d=0.5", "-f", "null", "-"], capture_output=True, text=True, timeout=90)
            starts = re.findall(r"silence_start: ([0-9.]+)", result.stderr)
            ends = re.findall(r"silence_end: ([0-9.]+)", result.stderr)
            report["silence_ranges"] = [{"start": float(start), "end": float(end)} for start, end in zip(starts[:20], ends[:20])]
            report["analysis"].append("Silence scan completed locally.")
        except (OSError, subprocess.SubprocessError):
            report["analysis"].append("Silence scan could not complete.")
    if ffmpeg:
        try:
            result = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path), "-vf", "blackdetect=d=0.3:pix_th=0.10", "-an", "-f", "null", "-"], capture_output=True, text=True, timeout=90)
            ranges = re.findall(r"black_start:([0-9.]+) black_end:([0-9.]+)", result.stderr)
            report["black_ranges"] = [{"start": float(start), "end": float(end)} for start, end in ranges[:20]]
            report["analysis"].append("Black-frame scan completed locally.")
        except (OSError, subprocess.SubprocessError):
            report["analysis"].append("Black-frame scan could not complete.")
    return report


def inspect_project_media(project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found.")
    report = probe_media(Path(project["source_path"]))
    return save_artifact(project_id, "media_inspection", body.get("title", "Media preflight"), report, body.get("created_by", "local_inspector"))


def quality_report(project_id: str, stage: str, body: dict[str, Any]) -> dict[str, Any]:
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found.")
    if stage not in {"pre_render", "post_render", "publish"}:
        raise ValueError("Unsupported quality-check stage.")
    timeline = project.get("timeline_json", {}) if isinstance(project.get("timeline_json"), dict) else {}
    clips = timeline.get("clips", []) if isinstance(timeline.get("clips"), list) else []
    checks: list[dict[str, str]] = []
    source = Path(project["source_path"]); output = Path(project["output_path"])
    checks.append({"level": "pass" if source.exists() else "error", "rule": "source_file", "detail": "Source file is available." if source.exists() else "Source file is missing from the local workspace."})
    checks.append({"level": "pass" if clips else "error", "rule": "timeline", "detail": f"{len(clips)} EDL clip(s) are ready." if clips else "No EDL clips are available."})
    invalid_clips = [clip for clip in clips if not isinstance(clip, dict) or float(clip.get("out", 0)) <= float(clip.get("in", 0))]
    checks.append({"level": "pass" if not invalid_clips else "error", "rule": "clip_ranges", "detail": "All clip ranges have positive duration." if not invalid_clips else f"{len(invalid_clips)} clip range(s) need correction."})
    total_duration = round(sum(max(0, float(clip.get("out", 0)) - float(clip.get("in", 0))) for clip in clips if isinstance(clip, dict)), 3)
    checks.append({"level": "pass" if 3 <= total_duration <= 90 else "warning", "rule": "duration", "detail": f"Estimated edit duration: {total_duration}s."})
    settings = timeline.get("render_settings", {}) if isinstance(timeline.get("render_settings"), dict) else {}
    checks.append({"level": "pass" if settings.get("captions_enabled", True) else "warning", "rule": "captions", "detail": "Captions are enabled." if settings.get("captions_enabled", True) else "Captions are disabled; confirm this is intentional."})
    checks.append({"level": "pass" if output.suffix.lower() == ".mp4" else "warning", "rule": "output_format", "detail": "MP4 output is selected." if output.suffix.lower() == ".mp4" else "MP4 is recommended for local Reel export."})
    if stage == "post_render":
        checks.append({"level": "pass" if output.exists() else "error", "rule": "render_output", "detail": "Rendered output exists." if output.exists() else "No rendered output exists yet."})
    if stage == "publish":
        checks.append({"level": "pass" if len(project.get("caption", "")) <= 2200 else "error", "rule": "caption_length", "detail": f"Caption length: {len(project.get('caption', ''))}/2200."})
    passed = not any(check["level"] == "error" for check in checks)
    payload = {"stage": stage, "passed": passed, "checks": checks, "estimated_duration_seconds": total_duration, "created_from": "local EDL and workspace files", "note": "A report identifies issues; it never bypasses approval or starts a render."}
    kind = "preflight_report" if stage == "publish" else "quality_report"
    return save_artifact(project_id, kind, body.get("title", f"{stage.replace('_', ' ')} quality report"), payload, body.get("created_by", "local_qa"))


def project_operations(project_id: str) -> dict[str, Any]:
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found.")
    jobs = list_jobs(project_id)
    return {"project": project, "jobs": jobs, "artifacts": list_artifacts(project_id), "failed_jobs": [job for job in jobs if job.get("status") == "failed"]}


def _relative_workspace_path(value: str) -> str:
    try:
        return str(Path(value).resolve().relative_to(config.WORKSPACE_DIR))
    except ValueError:
        return value


def export_project_bundle(project_id: str) -> dict[str, Any]:
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found.")
    jobs = list_jobs(project_id)
    artifacts = list_artifacts(project_id)
    return {
        "schema": PROJECT_BUNDLE_SCHEMA,
        "exported_at": utc_now(),
        "project": {
            "title": project["title"],
            "source_path": _relative_workspace_path(project["source_path"]),
            "output_path": _relative_workspace_path(project["output_path"]),
            "timeline": project["timeline_json"],
            "caption": project["caption"],
        },
        "jobs": [{
            "kind": job["kind"], "status": job["status"], "approved": bool(job["approved"]),
            "payload": job.get("payload_json") or {}, "result": job.get("result_json"), "error_text": job.get("error_text"),
            "created_at": job["created_at"], "updated_at": job["updated_at"],
        } for job in jobs],
        "artifacts": [{
            "type": artifact["type"], "title": artifact["title"], "payload": artifact["payload"],
            "created_by": artifact["created_by"], "created_at": artifact["created_at"], "updated_at": artifact["updated_at"],
        } for artifact in artifacts],
    }


def import_project_bundle(body: dict[str, Any]) -> dict[str, Any]:
    bundle = body.get("bundle")
    if not isinstance(bundle, dict):
        raise ValueError("bundle must be a JSON object.")
    if bundle.get("schema") != PROJECT_BUNDLE_SCHEMA:
        raise ValueError(f"Unsupported bundle schema. Expected {PROJECT_BUNDLE_SCHEMA}.")
    project_data = bundle.get("project")
    if not isinstance(project_data, dict):
        raise ValueError("bundle.project must be a JSON object.")
    project = new_project({
        "title": f"{project_data.get('title', 'Untitled video project')} (imported)",
        "source_path": project_data.get("source_path"),
        "output_path": project_data.get("output_path", "outputs/final-video.mp4"),
        "timeline": project_data.get("timeline", {}),
        "caption": project_data.get("caption", ""),
    })
    imported_jobs = []
    for job_data in bundle.get("jobs") if isinstance(bundle.get("jobs"), list) else []:
        if not isinstance(job_data, dict) or job_data.get("kind") not in {"render", "instagram_publish"}:
            continue
        payload = job_data.get("payload") if isinstance(job_data.get("payload"), dict) else {}
        job = create_job(project["id"], job_data["kind"], payload, bool(job_data.get("approved")))
        if job_data.get("status") in {"succeeded", "failed"}:
            result = job_data.get("result") if isinstance(job_data.get("result"), dict) else None
            job = update_job(job["id"], status=job_data["status"], result=result, error=job_data.get("error_text"))
        imported_jobs.append(job)
    imported_artifacts = []
    for artifact_data in bundle.get("artifacts") if isinstance(bundle.get("artifacts"), list) else []:
        if not isinstance(artifact_data, dict) or artifact_data.get("type") not in ARTIFACT_TYPES:
            continue
        payload = artifact_data.get("payload") if isinstance(artifact_data.get("payload"), dict) else {}
        imported_artifacts.append(save_artifact(project["id"], artifact_data["type"], artifact_data.get("title"), payload, artifact_data.get("created_by", "bundle_import")))
    event(project["id"], None, "project_bundle_imported", {"jobs": len(imported_jobs), "artifacts": len(imported_artifacts)})
    return {"project": project, "jobs": imported_jobs, "artifacts": imported_artifacts}


def bot_entry_manifest() -> dict[str, Any]:
    return {
        "schema": BOT_ENTRY_SCHEMA,
        "scope": "Same workstation and 127.0.0.1 only.",
        "entry_endpoint": "POST /api/bot-entry",
        "entry_body": {
            "bot_id": "local-editor-bot",
            "display_name": "Local Editor Bot",
            "purpose": "edit_video",
            "task": "Prepare a transcript-first local edit plan.",
            "execution_mode": "auto_local | approval_required",
        },
        "first_requests": ["GET /api/bot-guide", "GET /api/projects", "GET /api/jobs", "GET /api/edit-method", "GET /api/bots/{bot_id}/execution-policy"],
        "keep_alive": "POST /api/bots/heartbeat at each meaningful state change and at least once every five minutes while active.",
        "execution_policy": "On first entry, a bot receives auto_local for local project, inspection, planning, and rendering work. The bot can change its own policy to approval_required. Instagram upload is queued manually or run immediately with auto_upload.",
        "approval_boundary": "auto_local controls local rendering. Instagram upload can be queued manually or run immediately when auto_upload is enabled for that job.",
        "credential_rule": "If LOCAL_STUDIO_TOKEN is enabled, receive it from the bot runtime configuration. Never read .env, SQLite, or browser storage for a token.",
    }


def terminal_contract() -> dict[str, Any]:
    return {
        "schema": "local-video-workspace.terminal-cli/v1",
        "scope": "Same workstation and loopback HTTP only.",
        "api_base_url": "http://127.0.0.1:7214",
        "browser_site_base_url": SITE_BASE_URL,
        "browser_rule": "Port 7214 is the CLI and JSON API only. Open or capture browser pages at http://localhost:3000; never append /production or other browser paths to port 7214.",
        "clone_cli_path": "local_studio/grok_crew.py",
        "clone_bootstrap": "python local_studio/grok_crew.py contract",
        "download": "GET /downloads/grok-crew.py",
        "bootstrap": "python grok-crew.py contract",
        "auth": "Set LOCAL_STUDIO_TOKEN in the bot terminal only when Local Studio token protection is enabled.",
        "commands": {
            "start": ["health", "contract", "guide", "site --page production", "entry", "policy get|set", "heartbeat", "bots list|activity|entries"],
            "editing": ["projects list|get|create", "method get|set", "ops show|inspect|cut-map|quality|artifact|update", "brand list|save"],
            "delivery": ["jobs list|render [auto local or human approved]|instagram|run|cancel", "render, instagram, and run accept --wait to poll until the job finishes; renders execute in the background and report progress via GET /api/jobs/{id}"],
        },
        "execution_policy": {"auto_local": "The connected bot can queue and run its own local render work automatically.", "approval_required": "The bot records a request and requires --human-approved for local render work.", "instagram": "Instagram upload can run immediately when auto_upload is enabled, or remain queued for manual execution."},
        "browser_pages": {
            "studio": f"{SITE_BASE_URL}/",
            "edit": f"{SITE_BASE_URL}/edit",
            "cut": f"{SITE_BASE_URL}/cut",
            "production": f"{SITE_BASE_URL}/production",
            "operations": f"{SITE_BASE_URL}/operations",
            "bot_check": f"{SITE_BASE_URL}/bots",
            "bot_guide": f"{SITE_BASE_URL}/bot-guide",
            "terminal": f"{SITE_BASE_URL}/terminal",
            "library": f"{SITE_BASE_URL}/library",
            "agent_desk": f"{SITE_BASE_URL}/agent",
            "local_desk": f"{SITE_BASE_URL}/connect",
            "packet": f"{SITE_BASE_URL}/packet",
            "gate_board": f"{SITE_BASE_URL}/gates",
            "export": f"{SITE_BASE_URL}/export",
            "privacy": f"{SITE_BASE_URL}/privacy",
        },
    }


def list_bot_entries() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("""SELECT e.*, s.last_seen FROM bot_entries e
            LEFT JOIN bot_sessions s ON s.bot_id = e.bot_id
            ORDER BY e.joined_at DESC LIMIT 80""").fetchall()
    now = datetime.now(timezone.utc)
    entries = []
    for row in rows:
        entry = dict(row)
        last_seen = entry.pop("last_seen", None)
        if last_seen:
            seconds = max(0, int((now - datetime.fromisoformat(str(last_seen))).total_seconds()))
            entry["presence"] = "active" if seconds <= 300 else "idle"
            entry["seconds_since_checkin"] = seconds
        else:
            entry["presence"] = "idle"
            entry["seconds_since_checkin"] = None
        entries.append(entry)
    return entries


def enter_bot_workspace(body: dict[str, Any]) -> dict[str, Any]:
    bot_id = valid_bot_id(body.get("bot_id"))
    display_name = str(body.get("display_name", bot_id)).strip()[:120] or bot_id
    purpose = str(body.get("purpose", "edit_video")).strip()[:120] or "edit_video"
    task = str(body.get("task", "")).strip()[:320]
    entry_id, now = str(uuid.uuid4()), utc_now()
    with db() as conn:
        conn.execute("""INSERT INTO bot_entries (id, bot_id, display_name, purpose, task, joined_at)
            VALUES (?, ?, ?, ?, ?, ?)""", (entry_id, bot_id, display_name, purpose, task, now))
    policy = ensure_execution_policy(bot_id, body.get("execution_mode"))
    bot = record_bot_heartbeat({"bot_id": bot_id, "display_name": display_name, "action": "entered_local_studio", "detail": {"entry_id": entry_id, "purpose": purpose, "task": task, "execution_mode": policy["mode"], "next": "read local bot guide"}})
    event(None, None, "bot_entered", {"entry_id": entry_id, "bot_id": bot_id, "purpose": purpose, "task": task, "execution_mode": policy["mode"]})
    return {"entry": {"id": entry_id, "bot_id": bot_id, "display_name": display_name, "purpose": purpose, "task": task, "joined_at": now}, "bot": bot, "execution_policy": policy, "next_requests": bot_entry_manifest()["first_requests"], "execution_policy_note": bot_entry_manifest()["execution_policy"]}


BOT_GUIDE_PATHS_BY_LANGUAGE = {"ko": BOT_GUIDE_KO_PATH, "zh": BOT_GUIDE_ZH_PATH, "ja": BOT_GUIDE_JA_PATH, "en": BOT_GUIDE_PATH}


def bot_guide(language: str = "en") -> dict[str, Any]:
    try:
        path = BOT_GUIDE_PATHS_BY_LANGUAGE.get(language, BOT_GUIDE_PATH)
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Local bot guide is unavailable or invalid JSON.") from exc
    if not isinstance(value, dict):
        raise RuntimeError("Local bot guide must be a JSON object.")
    return value


def current_edit_method() -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM edit_method WHERE id = 'current'").fetchone()
    if not row:
        return {"method": DEFAULT_EDIT_METHOD.copy(), "updated_by": "local_default", "updated_at": None, "origin": "default", "is_default": True}
    value = dict(row)
    return {"method": json.loads(value["method_json"]), "updated_by": value["updated_by"], "updated_at": value["updated_at"], "origin": value.get("origin", "bot"), "is_default": False}


def validated_edit_method(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("method must be a JSON object.")
    unknown = set(value) - (set(DEFAULT_EDIT_METHOD) - {"schema"})
    if unknown:
        raise ValueError(f"Unsupported edit-method field: {sorted(unknown)[0]}")
    method = {**DEFAULT_EDIT_METHOD, **value}
    choices = {
        "hook_strategy": {"payoff_first", "question_first", "chronological"},
        "pacing": {"tight", "balanced", "deliberate"},
        "filler_policy": {"remove", "review", "keep"},
        "caption_mode": {"burn_in", "off"},
        "reframe_anchor": {"left", "center", "right"},
        "look": {"natural", "punchy", "mono", "night"},
        "audio_policy": {"preserve", "normalize", "mute"},
        "quality": {"compact", "balanced", "high"},
    }
    for field, allowed in choices.items():
        if method[field] not in allowed:
            raise ValueError(f"{field} must be one of: {', '.join(sorted(allowed))}.")
    if method["fps"] not in {24, 30, 60}:
        raise ValueError("fps must be 24, 30, or 60.")
    try:
        method["speed"] = float(method["speed"])
    except (TypeError, ValueError) as exc:
        raise ValueError("speed must be a number between 0.5 and 2.0.") from exc
    if not .5 <= method["speed"] <= 2.0:
        raise ValueError("speed must be a number between 0.5 and 2.0.")
    return method


def set_edit_method(body: dict[str, Any]) -> dict[str, Any]:
    origin = str(body.get("origin", "bot")).strip()
    if origin not in {"human", "bot"}:
        raise ValueError("origin must be human or bot.")
    bot_id = str(body.get("bot_id", "")).strip()
    if origin == "bot" and not bot_id:
        raise ValueError("bot_id is required when a bot configures an edit method.")
    method = validated_edit_method(body.get("method"))
    updated_by = str(body.get("updated_by", "operator" if origin == "human" else bot_id)).strip()[:80] or ("operator" if origin == "human" else bot_id)
    now = utc_now()
    with db() as conn:
        conn.execute("""INSERT INTO edit_method (id, method_json, updated_by, updated_at, origin) VALUES ('current', ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET method_json = excluded.method_json, updated_by = excluded.updated_by,
            updated_at = excluded.updated_at, origin = excluded.origin""", (json.dumps(method), updated_by, now, origin))
    if origin == "bot":
        record_bot_heartbeat({"bot_id": bot_id, "display_name": body.get("display_name", bot_id), "action": "edit_method_configured", "detail": {"method": method, "next": "await human application or review"}})
    event(None, None, "edit_method_configured", {"origin": origin, "updated_by": updated_by, "method": method})
    return current_edit_method()


def create_job(project_id: str, kind: str, payload: dict[str, Any], approved: bool) -> dict[str, Any]:
    if kind not in {"proxy", "render", "instagram_publish", "tiktok_publish", "youtube_publish"}:
        raise ValueError("Unsupported job kind.")
    if not get_project(project_id):
        raise ValueError("Project not found.")
    job_id = str(uuid.uuid4())
    now = utc_now()
    with db() as conn:
        conn.execute("INSERT INTO jobs (id, project_id, kind, status, approved, payload_json, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)", (job_id, project_id, kind, int(approved), json.dumps(payload), now, now))
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    event(project_id, job_id, "job_queued", {"kind": kind, "approved": approved})
    return row_dict(row) or {}


def project_proxies(project_id: str) -> list[dict[str, Any]]:
    if not get_project(project_id):
        raise ValueError("Project not found.")
    return list_proxies(project_id)


def request_proxy(project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    from desktop_domain import ensure_timeline_version

    ensure_timeline_version(project_id)
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found.")
    asset_id = str(body.get("asset_id", "")).strip()
    _asset, source = source_asset(project, asset_id)
    existing = get_proxy(project_id, asset_id)
    if proxy_is_current(existing, source) and not body.get("force"):
        return {"proxy": existing, "job": None, "reused": True}
    if existing and existing.get("status") in {"queued", "running"} and existing.get("job_id"):
        return {
            "proxy": existing,
            "job": get_job(str(existing["job_id"])),
            "reused": True,
        }
    job = create_job(
        project_id,
        "proxy",
        {"asset_id": asset_id, "force": bool(body.get("force"))},
        True,
    )
    proxy = update_proxy(
        project_id,
        asset_id,
        source,
        status="queued",
        job_id=job["id"],
        progress=0,
        error=None,
    )
    if body.get("run_immediately", True):
        job = start_job(job["id"], wait=bool(body.get("wait", False)))
    return {"proxy": proxy, "job": job, "reused": False}


def update_job(job_id: str, *, status: str, result: dict[str, Any] | None = None, error: str | None = None, progress: int | None = None) -> dict[str, Any]:
    with db() as conn:
        if progress is None:
            conn.execute("UPDATE jobs SET status = ?, result_json = ?, error_text = ?, updated_at = ? WHERE id = ?", (status, json.dumps(result) if result is not None else None, error, utc_now(), job_id))
        else:
            conn.execute("UPDATE jobs SET status = ?, result_json = ?, error_text = ?, progress = ?, updated_at = ? WHERE id = ?", (status, json.dumps(result) if result is not None else None, error, max(0, min(100, int(progress))), utc_now(), job_id))
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return row_dict(row) or {}


def update_job_progress(job_id: str, progress: int) -> None:
    with db() as conn:
        conn.execute("UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ? AND status = 'running'", (max(0, min(100, int(progress))), utc_now(), job_id))


def job_cancel_requested(job_id: str) -> bool:
    with db() as conn:
        row = conn.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return bool(row and row["cancel_requested"])


def request_job_cancel(job_id: str) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise ValueError("Job not found.")
        conn.execute("UPDATE jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?", (utc_now(), job_id))
        updated = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return row_dict(updated) or {}


def _validate_runnable(job: dict[str, Any]) -> dict[str, Any]:
    if job["kind"] in {"render", "instagram_publish", "tiktok_publish", "youtube_publish"} and not job["approved"]:
        raise ValueError("Job has no recorded human approval.")
    if job["status"] not in {"queued", "failed"}:
        raise ValueError("Only queued or failed jobs can run.")
    project = get_project(job["project_id"])
    if not project:
        raise ValueError("Project no longer exists.")
    return project


def execute_job(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise ValueError("Job not found.")
    project = _validate_runnable(job)
    update_job(job_id, status="running", progress=0)
    event(project["id"], job_id, "job_started", {"kind": job["kind"]})
    proxy_source: Path | None = None
    proxy_asset_id = str(job["payload_json"].get("asset_id", ""))
    try:
        if job["kind"] == "proxy":
            _asset, proxy_source = source_asset(project, proxy_asset_id)
            update_proxy(
                project["id"], proxy_asset_id, proxy_source,
                status="running", job_id=job_id, progress=0, error=None,
            )

            def proxy_progress(progress: int) -> None:
                update_job_progress(job_id, progress)
                if proxy_source is not None:
                    update_proxy(
                        project["id"], proxy_asset_id, proxy_source,
                        status="running", job_id=job_id, progress=progress, error=None,
                    )

            result = generate_proxy(
                project,
                job["payload_json"],
                progress_cb=proxy_progress,
                should_cancel=lambda: job_cancel_requested(job_id),
            )
            update_proxy(
                project["id"], proxy_asset_id, proxy_source,
                status="ready", job_id=job_id, proxy_path=result["proxy_path"],
                progress=100, width=result.get("width"), height=result.get("height"), error=None,
            )
        elif job["kind"] == "render":
            result = render_moviepy(project, progress_cb=lambda pct: update_job_progress(job_id, pct), should_cancel=lambda: job_cancel_requested(job_id))
        elif job["kind"] == "instagram_publish" and not job["payload_json"].get("idempotency_key"):
            result = instagram_publish(project, job["payload_json"])
        else:
            result = publish(job["kind"].removesuffix("_publish"), project, job["payload_json"])
        final = update_job(job_id, status="succeeded", result=result, progress=100)
        event(project["id"], job_id, "job_succeeded", result)
        return final
    except Exception as exc:  # noqa: BLE001
        if job["kind"] == "proxy" and proxy_source is not None:
            update_proxy(
                project["id"], proxy_asset_id, proxy_source,
                status="cancelled" if "cancelled" in str(exc).lower() else "failed",
                job_id=job_id, error=str(exc),
            )
        final = update_job(job_id, status="failed", error=str(exc))
        event(project["id"], job_id, "job_failed", {"error": str(exc)})
        return final


def start_job(job_id: str, *, wait: bool) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise ValueError("Job not found.")
    _validate_runnable(job)
    future: Future = RENDER_EXECUTOR.submit(execute_job, job_id)
    if wait:
        return future.result()
    return get_job(job_id) or job


def project_preview(project_id: str, at: float, *, include_image: bool = True) -> dict[str, Any]:
    from desktop_domain import get_timeline

    payload = get_timeline(project_id)
    preview = preview_at(payload["timeline"], at, include_image=include_image)
    preview.pop("frame", None)
    preview["project_id"] = project_id
    return preview


def project_scopes(project_id: str, at: float) -> dict[str, Any]:
    from desktop_domain import get_timeline
    from render import sample_timeline_frame

    payload = get_timeline(project_id)
    sampled = sample_timeline_frame(payload["timeline"], at)
    return {
        "project_id": project_id,
        "at": sampled["at"],
        "revision": payload["timeline"].get("revision"),
        "scopes": sampled["scopes"],
        "caption": sampled.get("caption", ""),
    }


def project_exchange(project_id: str, fmt: str) -> dict[str, Any]:
    from desktop_domain import get_timeline

    payload = get_timeline(project_id)
    timeline = payload["timeline"]
    project = get_project(project_id) or {}
    title = str(project.get("title") or "Grok Crew")
    if fmt == "edl":
        return {"format": "edl", "text": export_edl(timeline, title)}
    if fmt == "otio":
        return {"format": "otio", "otio": export_otio(timeline, title)}
    raise ValueError("Exchange format must be edl or otio.")


def import_exchange(project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    from desktop_domain import apply_timeline_patch, get_timeline

    current = get_timeline(project_id)
    timeline = current["timeline"]
    fps = int(timeline["settings"].get("fps", 30))
    if body.get("edl"):
        imported = import_edl(str(body["edl"]), fps)
    elif body.get("otio"):
        if not isinstance(body.get("otio"), dict):
            raise ValueError("otio must be an object.")
        imported = import_otio(body["otio"])
    else:
        raise ValueError("Provide edl text or an otio object.")
    existing_ids = {str(asset.get("id")) for asset in timeline.get("assets", [])}
    operations: list[dict[str, Any]] = []
    for asset in imported.get("assets", []):
        if asset.get("id") not in existing_ids:
            operations.append({"op": "add_asset", "asset": asset})
    target = next((track for track in timeline["tracks"] if track.get("type") == "video"), None)
    if target is None:
        raise ValueError("A video track is required before importing an edit list.")
    for clip in list(target.get("clips", [])):
        operations.append({"op": "remove_clip", "clip_id": clip["id"]})
    incoming = next((track for track in imported.get("tracks", []) if track.get("type") == "video"), {"clips": []})
    for clip in incoming.get("clips", []):
        if clip.get("asset_id") not in existing_ids and clip.get("asset_id") != "source":
            clip["asset_id"] = next(iter(existing_ids), clip.get("asset_id"))
        elif "source" in existing_ids:
            clip["asset_id"] = "source"
        operations.append({"op": "add_clip", "track_id": target["id"], "clip": clip})
    if not operations:
        raise ValueError("The exchange file did not contain any clips.")
    return apply_timeline_patch(project_id, {
        "schema": "grok-crew.timeline-patch/v1",
        "base_revision": timeline["revision"],
        "origin": "human",
        "operations": operations,
    })


def render_queue(project_id: str) -> list[dict[str, Any]]:
    return [job for job in list_jobs(project_id) if job.get("kind") == "render"]


def enqueue_render(project_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = body or {}
    auto_local, _policy = bot_auto_executes(payload)
    human_approved = bool(payload.get("approved"))
    if not human_approved and not auto_local:
        raise ValueError(
            "This bot requires human approval before a local render. "
            "Set its execution policy to auto_local or send approved: true."
        )
    job = create_job(
        project_id,
        "render",
        {
            "requested_by": payload.get("requested_by", "local_user"),
            "bot_id": payload.get("bot_id"),
            "execution_authorization": "bot_auto_local" if auto_local and not human_approved else "human_approved",
        },
        True,
    )
    if payload.get("run_immediately", True):
        job = start_job(job["id"], wait=bool(payload.get("wait", False)))
    return {"job": job, "queue": render_queue(project_id)}


def project_publish_receipts(project_id: str) -> dict[str, Any]:
    if not get_project(project_id):
        raise ValueError("Project not found.")
    return {"receipts": list_publish_receipts(project_id)}


def retry_project_publish(project_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found.")
    body = payload or {}
    if not body.get("approved"):
        raise ValueError("Publishing requires a recorded human approval or an approved project auto-publish policy.")
    receipt_id = str(body.get("receipt_id") or "").strip()
    if not receipt_id:
        raise ValueError("receipt_id is required.")
    try:
        result = retry_publish(project, receipt_id, body)
    except RuntimeError as exc:
        raise ValueError(str(exc)) from exc
    return {"result": result, "receipts": list_publish_receipts(project_id)}


def launch_status() -> dict[str, Any]:
    return build_launch_status()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Local Video Studio on loopback only.")
    parser.add_argument("--port", type=int, default=7214)
    args = parser.parse_args(); load_dotenv(); init_db()
    from handlers import StudioHandler  # deferred: handlers.py imports this module, so avoid a top-level cycle
    with db() as conn:
        conn.execute("UPDATE jobs SET status = 'failed', error_text = ?, updated_at = ? WHERE status = 'running'", ("Interrupted by an unclean Local Studio shutdown.", utc_now()))
    recovered_receipts = reconcile_publish_receipts()
    if recovered_receipts:
        print(f"recovered {recovered_receipts} interrupted publish receipts", file=sys.stderr)
    if not os.getenv("LOCAL_STUDIO_TOKEN", "").strip():
        print("Warning: LOCAL_STUDIO_TOKEN is unset; loopback clients can call the API without a bearer token.")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), StudioHandler)
    print(f"Local Video Studio listening at http://127.0.0.1:{args.port}")
    print(f"Workspace: {config.WORKSPACE_DIR}")
    print("Instagram upload runs when a queued job is started or auto_upload is enabled.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nLocal Studio stopped.")
    finally:
        RENDER_EXECUTOR.shutdown(wait=False)
        server.server_close()


if __name__ == "__main__":
    main()

"""Desktop v2 domain: versioned timelines, settings-driven Grok jobs, and runners.

This module deliberately has no HTTP concerns.  The browser app, Electron shell,
and remote runner all use the same validated state transitions through handlers.py.
"""

from __future__ import annotations

import copy
import json
import uuid
from pathlib import Path
from typing import Any

import config
from config import utc_now
from db import db, event, row_dict

TIMELINE_SCHEMA = "grok-crew.timeline/v2"
PATCH_SCHEMA = "grok-crew.timeline-patch/v1"
CONTROL_JOB_SCHEMA = "grok-crew.control-job/v1"
RUNNER_EVENT_SCHEMA = "grok-crew.runner-event/v1"
PUBLISH_POLICY_SCHEMA = "grok-crew.publish-policy/v1"

TRACK_TYPES = {"video", "audio", "caption", "overlay", "adjustment"}
ASSET_TYPES = {"video", "image", "audio", "title", "generator"}
ORIGINS = {"human", "remote_bot", "local_system"}
CONTROL_STATUSES = {
    "queued", "claimed", "analyzing", "planning", "needs_input",
    "proposal_ready", "applied", "rendering", "rendered",
    "publish_waiting", "publishing", "completed", "cancel_requested",
    "cancelled", "pause_requested", "paused", "failed", "conflict",
}
RUNNER_STAGES = {"connected", "claimed", "analyzing", "planning", "needs_input", "proposal_ready", "completed", "failed", "cancelled", "paused", "resumed"}
RUNNER_STATUSES = {"active", "waiting", "succeeded", "failed", "cancelled"}
EXECUTION_POLICIES = {"auto_edit_render", "review_before_render"}
PUBLISH_MODES = {"export_only", "ask", "auto"}


def default_publish_policy() -> dict[str, str]:
    return {"schema": PUBLISH_POLICY_SCHEMA, "instagram": "ask", "tiktok": "ask", "youtube": "ask"}


def _project(project_id: str) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    value = row_dict(row)
    if not value:
        raise ValueError("Project not found.")
    return value


def _safe_identifier(value: Any, field: str) -> str:
    identifier = str(value or "").strip()[:120]
    if not identifier or not all(character.isalnum() or character in "-_." for character in identifier):
        raise ValueError(f"{field} must use letters, numbers, hyphen, underscore, or period.")
    return identifier


def _legacy_to_v2(project: dict[str, Any]) -> dict[str, Any]:
    legacy = project.get("timeline_json") if isinstance(project.get("timeline_json"), dict) else {}
    settings = legacy.get("render_settings") if isinstance(legacy.get("render_settings"), dict) else {}
    width, height = (1920, 1080) if settings.get("platform") == "youtube_landscape" else (1080, 1920)
    source_asset_id = "source-main"
    video_clips, caption_clips, cursor = [], [], 0.0
    raw_clips = legacy.get("clips") if isinstance(legacy.get("clips"), list) else []
    for index, raw in enumerate(raw_clips):
        if not isinstance(raw, dict) or not raw.get("keep", True):
            continue
        try:
            source_in, source_out = float(raw.get("in", 0)), float(raw.get("out", 0))
        except (TypeError, ValueError):
            continue
        if source_out <= source_in:
            continue
        duration = round(source_out - source_in, 3)
        clip_id = f"clip-{index + 1}"
        video_clips.append({
            "id": clip_id, "asset_id": source_asset_id, "timeline_start": round(cursor, 3),
            "duration": duration, "source_in": source_in, "source_out": source_out,
            "locked": False, "transform": {}, "audio": {"volume": 1, "muted": False},
            "effects": [], "keyframes": {},
        })
        caption = str(raw.get("caption", "")).strip()
        if caption:
            caption_clips.append({
                "id": f"caption-{index + 1}", "asset_id": None, "timeline_start": round(cursor, 3),
                "duration": duration, "locked": False, "text": caption,
                "style": {"position_y": settings.get("caption_y", 74), "size": settings.get("caption_size", 78)},
                "effects": [], "keyframes": {},
            })
        cursor += duration
    return {
        "schema": TIMELINE_SCHEMA,
        "revision": 1,
        "settings": {
            "width": width, "height": height, "fps": settings.get("fps", 30),
            "quality": settings.get("quality", "balanced"), "background": "#000000",
            **settings,
        },
        "assets": [{"id": source_asset_id, "kind": "video", "name": Path(project["source_path"]).name, "path": project["source_path"]}],
        "tracks": [
            {"id": "video-main", "type": "video", "name": "Main video", "order": 0, "locked": False, "muted": False, "clips": video_clips},
            {"id": "captions-main", "type": "caption", "name": "Captions", "order": 10, "locked": False, "muted": False, "clips": caption_clips},
        ],
        "markers": [],
    }


def validate_timeline(timeline: Any) -> dict[str, Any]:
    if not isinstance(timeline, dict) or timeline.get("schema") != TIMELINE_SCHEMA:
        raise ValueError(f"timeline.schema must be {TIMELINE_SCHEMA}.")
    if not isinstance(timeline.get("settings"), dict):
        raise ValueError("timeline.settings must be an object.")
    assets, tracks = timeline.get("assets"), timeline.get("tracks")
    if not isinstance(assets, list) or not isinstance(tracks, list):
        raise ValueError("timeline.assets and timeline.tracks must be arrays.")
    asset_ids: set[str] = set()
    for asset in assets:
        if not isinstance(asset, dict) or asset.get("kind") not in ASSET_TYPES:
            raise ValueError("Every asset needs a supported kind.")
        asset_id = _safe_identifier(asset.get("id"), "asset.id")
        if asset_id in asset_ids:
            raise ValueError(f"Duplicate asset id: {asset_id}")
        asset_ids.add(asset_id)
    track_ids, clip_ids = set(), set()
    for track in tracks:
        if not isinstance(track, dict) or track.get("type") not in TRACK_TYPES or not isinstance(track.get("clips"), list):
            raise ValueError("Every track needs a supported type and clips array.")
        track_id = _safe_identifier(track.get("id"), "track.id")
        if track_id in track_ids:
            raise ValueError(f"Duplicate track id: {track_id}")
        track_ids.add(track_id)
        track["locked"], track["muted"] = bool(track.get("locked")), bool(track.get("muted"))
        track["order"] = int(track.get("order", 0))
        for clip in track["clips"]:
            if not isinstance(clip, dict):
                raise ValueError("Every clip must be an object.")
            clip_id = _safe_identifier(clip.get("id"), "clip.id")
            if clip_id in clip_ids:
                raise ValueError(f"Duplicate clip id: {clip_id}")
            clip_ids.add(clip_id)
            try:
                clip["timeline_start"], clip["duration"] = float(clip.get("timeline_start", 0)), float(clip.get("duration", 0))
            except (TypeError, ValueError) as exc:
                raise ValueError("Clip timing must be numeric.") from exc
            if clip["timeline_start"] < 0 or clip["duration"] <= 0:
                raise ValueError("Clip start must be non-negative and duration must be positive.")
            asset_id = clip.get("asset_id")
            if asset_id is not None and asset_id not in asset_ids:
                raise ValueError(f"Clip {clip_id} references an unknown asset.")
            clip["locked"] = bool(clip.get("locked"))
    timeline["revision"] = int(timeline.get("revision", 1))
    timeline["markers"] = timeline.get("markers") if isinstance(timeline.get("markers"), list) else []
    return timeline


def ensure_timeline_version(project_id: str) -> dict[str, Any]:
    project = _project(project_id)
    with db() as conn:
        row = conn.execute("SELECT * FROM timeline_versions WHERE project_id = ? ORDER BY revision DESC LIMIT 1", (project_id,)).fetchone()
    if row:
        return row_dict(row) or {}
    timeline = validate_timeline(_legacy_to_v2(project) if project.get("timeline_json", {}).get("schema") != TIMELINE_SCHEMA else project["timeline_json"])
    timeline["revision"] = 1
    version_id, now = str(uuid.uuid4()), utc_now()
    with db() as conn:
        conn.execute("""INSERT INTO timeline_versions
            (id, project_id, revision, parent_revision, timeline_json, origin, created_by, created_at)
            VALUES (?, ?, 1, NULL, ?, 'local_system', 'migration', ?)""", (version_id, project_id, json.dumps(timeline), now))
        conn.execute("UPDATE projects SET timeline_json = ?, updated_at = ? WHERE id = ?", (json.dumps(timeline), now, project_id))
        row = conn.execute("SELECT * FROM timeline_versions WHERE id = ?", (version_id,)).fetchone()
    event(project_id, None, "timeline_v2_migrated", {"revision": 1})
    return row_dict(row) or {}


def get_timeline(project_id: str) -> dict[str, Any]:
    version = ensure_timeline_version(project_id)
    return {"version": version, "timeline": version["timeline_json"]}


def list_timeline_versions(project_id: str) -> list[dict[str, Any]]:
    ensure_timeline_version(project_id)
    with db() as conn:
        rows = conn.execute("SELECT * FROM timeline_versions WHERE project_id = ? ORDER BY revision DESC LIMIT 100", (project_id,)).fetchall()
    return [row_dict(row) or {} for row in rows]


def _find_track(timeline: dict[str, Any], track_id: Any) -> dict[str, Any]:
    value = next((track for track in timeline["tracks"] if track.get("id") == track_id), None)
    if not value:
        raise ValueError("Track not found.")
    return value


def _find_clip(timeline: dict[str, Any], clip_id: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    for track in timeline["tracks"]:
        clip = next((item for item in track["clips"] if item.get("id") == clip_id), None)
        if clip:
            return track, clip
    raise ValueError("Clip not found.")


def _assert_mutable(track: dict[str, Any], clip: dict[str, Any] | None, origin: str) -> None:
    if origin == "remote_bot" and (track.get("locked") or (clip and clip.get("locked"))):
        raise ValueError("Remote bot cannot modify a locked track or clip.")


def apply_timeline_patch(project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    if body.get("schema") != PATCH_SCHEMA:
        raise ValueError(f"schema must be {PATCH_SCHEMA}.")
    origin = str(body.get("origin", "human"))
    if origin not in ORIGINS:
        raise ValueError("Unsupported timeline origin.")
    current = get_timeline(project_id)
    timeline = copy.deepcopy(current["timeline"])
    base_revision = int(body.get("base_revision", 0))
    if base_revision != int(timeline["revision"]):
        raise ValueError(f"stale_timeline_revision: expected {timeline['revision']}, received {base_revision}.")
    operations = body.get("operations")
    if not isinstance(operations, list) or not operations:
        raise ValueError("operations must be a non-empty array.")
    if len(operations) > 250:
        raise ValueError("A timeline patch may contain up to 250 operations.")
    for operation in operations:
        if not isinstance(operation, dict):
            raise ValueError("Every operation must be an object.")
        kind = operation.get("op")
        if kind == "add_track":
            track = copy.deepcopy(operation.get("track"))
            if not isinstance(track, dict):
                raise ValueError("add_track requires track.")
            timeline["tracks"].append(track)
        elif kind == "update_track":
            track = _find_track(timeline, operation.get("track_id")); _assert_mutable(track, None, origin)
            changes = operation.get("changes")
            if not isinstance(changes, dict): raise ValueError("update_track requires changes.")
            if origin == "remote_bot" and changes.get("locked") is False and track.get("locked"):
                raise ValueError("Remote bot cannot unlock a track.")
            track.update({key: value for key, value in changes.items() if key not in {"id", "clips"}})
        elif kind == "remove_track":
            track = _find_track(timeline, operation.get("track_id")); _assert_mutable(track, None, origin)
            timeline["tracks"].remove(track)
        elif kind == "add_clip":
            track = _find_track(timeline, operation.get("track_id")); _assert_mutable(track, None, origin)
            clip = copy.deepcopy(operation.get("clip"))
            if not isinstance(clip, dict): raise ValueError("add_clip requires clip.")
            track["clips"].append(clip)
        elif kind == "update_clip":
            track, clip = _find_clip(timeline, operation.get("clip_id")); _assert_mutable(track, clip, origin)
            changes = operation.get("changes")
            if not isinstance(changes, dict): raise ValueError("update_clip requires changes.")
            if origin == "remote_bot" and changes.get("locked") is False and clip.get("locked"):
                raise ValueError("Remote bot cannot unlock a clip.")
            clip.update({key: value for key, value in changes.items() if key != "id"})
        elif kind == "move_clip":
            source_track, clip = _find_clip(timeline, operation.get("clip_id")); _assert_mutable(source_track, clip, origin)
            target_track = _find_track(timeline, operation.get("track_id", source_track["id"])); _assert_mutable(target_track, None, origin)
            source_track["clips"].remove(clip); target_track["clips"].append(clip)
            clip["timeline_start"] = float(operation.get("timeline_start", clip["timeline_start"]))
        elif kind == "remove_clip":
            track, clip = _find_clip(timeline, operation.get("clip_id")); _assert_mutable(track, clip, origin)
            track["clips"].remove(clip)
        elif kind == "split_clip":
            track, clip = _find_clip(timeline, operation.get("clip_id")); _assert_mutable(track, clip, origin)
            split_at = float(operation.get("at", -1)); relative = split_at - float(clip["timeline_start"])
            if relative <= 0 or relative >= float(clip["duration"]): raise ValueError("Split point must be inside the clip.")
            left, right = copy.deepcopy(clip), copy.deepcopy(clip)
            left["id"] = _safe_identifier(operation.get("left_id", f"{clip['id']}-a"), "left_id")
            right["id"] = _safe_identifier(operation.get("right_id", f"{clip['id']}-b"), "right_id")
            left["duration"] = relative
            right["timeline_start"], right["duration"] = split_at, float(clip["duration"]) - relative
            if "source_in" in clip:
                left["source_out"] = float(clip.get("source_in", 0)) + relative
                right["source_in"] = left["source_out"]
            index = track["clips"].index(clip); track["clips"][index:index + 1] = [left, right]
        elif kind == "set_settings":
            changes = operation.get("changes")
            if not isinstance(changes, dict): raise ValueError("set_settings requires changes.")
            timeline["settings"].update(changes)
        elif kind == "add_marker":
            marker = copy.deepcopy(operation.get("marker"))
            if not isinstance(marker, dict): raise ValueError("add_marker requires marker.")
            timeline["markers"].append(marker)
        elif kind == "remove_marker":
            timeline["markers"] = [marker for marker in timeline["markers"] if marker.get("id") != operation.get("marker_id")]
        else:
            raise ValueError(f"Unsupported timeline operation: {kind}")
    next_revision = base_revision + 1
    timeline["revision"] = next_revision
    timeline = validate_timeline(timeline)
    version_id, now = str(uuid.uuid4()), utc_now()
    created_by = str(body.get("created_by", origin)).strip()[:80] or origin
    with db() as conn:
        conn.execute("""INSERT INTO timeline_versions
            (id, project_id, revision, parent_revision, timeline_json, origin, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", (version_id, project_id, next_revision, base_revision, json.dumps(timeline), origin, created_by, now))
        conn.execute("UPDATE projects SET timeline_json = ?, updated_at = ? WHERE id = ?", (json.dumps(timeline), now, project_id))
        row = conn.execute("SELECT * FROM timeline_versions WHERE id = ?", (version_id,)).fetchone()
    event(project_id, None, "timeline_version_created", {"revision": next_revision, "origin": origin, "created_by": created_by, "operation_count": len(operations)})
    return {"version": row_dict(row), "timeline": timeline}


def restore_timeline_version(project_id: str, revision: int, created_by: str = "operator") -> dict[str, Any]:
    current = get_timeline(project_id)
    with db() as conn:
        row = conn.execute("SELECT * FROM timeline_versions WHERE project_id = ? AND revision = ?", (project_id, revision)).fetchone()
    source = row_dict(row)
    if not source:
        raise ValueError("Timeline version not found.")
    restored = copy.deepcopy(source["timeline_json"])
    next_revision = int(current["timeline"]["revision"]) + 1
    restored["revision"] = next_revision
    now, version_id = utc_now(), str(uuid.uuid4())
    with db() as conn:
        conn.execute("""INSERT INTO timeline_versions
            (id, project_id, revision, parent_revision, timeline_json, origin, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, 'human', ?, ?)""", (version_id, project_id, next_revision, int(current["timeline"]["revision"]), json.dumps(restored), created_by[:80], now))
        conn.execute("UPDATE projects SET timeline_json = ?, updated_at = ? WHERE id = ?", (json.dumps(restored), now, project_id))
        result = conn.execute("SELECT * FROM timeline_versions WHERE id = ?", (version_id,)).fetchone()
    event(project_id, None, "timeline_version_restored", {"source_revision": revision, "revision": next_revision})
    return {"version": row_dict(result), "timeline": restored}


def validate_publish_policy(value: Any) -> dict[str, str]:
    policy = {**default_publish_policy(), **(value if isinstance(value, dict) else {})}
    if policy.get("schema") != PUBLISH_POLICY_SCHEMA:
        raise ValueError(f"publish_policy.schema must be {PUBLISH_POLICY_SCHEMA}.")
    for platform in ("instagram", "tiktok", "youtube"):
        if policy.get(platform) not in PUBLISH_MODES:
            raise ValueError(f"Unsupported {platform} publish mode.")
    return policy


def create_control_job(project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    timeline = get_timeline(project_id)["timeline"]
    base_revision = int(body.get("base_revision", timeline["revision"]))
    if base_revision != int(timeline["revision"]):
        raise ValueError("A control job must target the current timeline revision.")
    settings = body.get("settings") if isinstance(body.get("settings"), dict) else {}
    execution = str(body.get("execution_policy", "auto_edit_render"))
    if execution not in EXECUTION_POLICIES:
        raise ValueError("Unsupported execution policy.")
    publish = validate_publish_policy(body.get("publish_policy"))
    job_id, now = str(uuid.uuid4()), utc_now()
    with db() as conn:
        conn.execute("""INSERT INTO control_jobs
            (id, project_id, base_revision, status, settings_json, execution_policy,
             publish_policy_json, origin, created_at, updated_at)
            VALUES (?, ?, ?, 'queued', ?, ?, ?, 'human', ?, ?)""",
            (job_id, project_id, base_revision, json.dumps(settings), execution, json.dumps(publish), now, now))
        row = conn.execute("SELECT * FROM control_jobs WHERE id = ?", (job_id,)).fetchone()
    event(project_id, None, "control_job_queued", {"control_job_id": job_id, "base_revision": base_revision, "execution_policy": execution})
    return row_dict(row) or {}


def list_control_jobs(project_id: str | None = None) -> list[dict[str, Any]]:
    query = "SELECT * FROM control_jobs" + (" WHERE project_id = ?" if project_id else "") + " ORDER BY updated_at DESC LIMIT 160"
    with db() as conn:
        rows = conn.execute(query, (project_id,) if project_id else ()).fetchall()
    return [row_dict(row) or {} for row in rows]


def update_control_job(
    control_job_id: str,
    status: str,
    *,
    error: str | None = None,
    result_revision: int | None = None,
    runner_id: str | None = None,
    render_job_id: str | None = None,
    conflict: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if status not in CONTROL_STATUSES:
        raise ValueError("Unsupported control job status.")
    with db() as conn:
        row = conn.execute("SELECT * FROM control_jobs WHERE id = ?", (control_job_id,)).fetchone()
        if not row: raise ValueError("Control job not found.")
        completed_at = utc_now() if status in {"completed", "cancelled", "failed"} else None
        conn.execute("""UPDATE control_jobs SET status = ?, error_text = ?,
            result_revision = COALESCE(?, result_revision), runner_id = COALESCE(?, runner_id),
            render_job_id = COALESCE(?, render_job_id), conflict_json = ?,
            completed_at = COALESCE(?, completed_at), updated_at = ? WHERE id = ?""",
            (status, error, result_revision, runner_id, render_job_id,
             json.dumps(conflict, ensure_ascii=False) if conflict is not None else None,
             completed_at, utc_now(), control_job_id))
        updated = conn.execute("SELECT * FROM control_jobs WHERE id = ?", (control_job_id,)).fetchone()
    return row_dict(updated) or {}


def control_control_job(control_job_id: str, command: str, reason: str | None = None) -> dict[str, Any]:
    """Record a durable human control command before it is signed for the Runner."""
    command = str(command).strip().lower()
    if command not in {"cancel", "pause", "resume", "retry"}:
        raise ValueError("Unsupported control command.")
    with db() as conn:
        row = conn.execute("SELECT * FROM control_jobs WHERE id = ?", (control_job_id,)).fetchone()
        if not row:
            raise ValueError("Control job not found.")
        current = row_dict(row) or {}
        status = str(current.get("status", ""))
        terminal = {"completed", "cancelled"}
        if command in {"cancel", "pause"} and status in terminal:
            raise ValueError(f"A {status} job cannot be {command}d.")
        if command == "resume" and status not in {"paused", "pause_requested"}:
            raise ValueError("Only a paused job can be resumed.")
        if command == "retry" and status not in {"failed", "conflict", "cancelled"}:
            raise ValueError("Only a failed, conflicted, or cancelled job can be retried.")
        next_status = {"cancel": "cancel_requested", "pause": "pause_requested", "resume": "queued", "retry": "queued"}[command]
        next_attempt = int(current.get("attempt") or 1) + (1 if command in {"resume", "retry"} else 0)
        next_sequence = int(current.get("control_sequence") or 0) + 1
        now = utc_now()
        conn.execute("""UPDATE control_jobs SET status = ?, attempt = ?, control_sequence = ?,
            error_text = CASE WHEN ? IN ('resume', 'retry') THEN NULL ELSE error_text END,
            conflict_json = CASE WHEN ? IN ('resume', 'retry') THEN NULL ELSE conflict_json END,
            completed_at = CASE WHEN ? IN ('resume', 'retry') THEN NULL ELSE completed_at END,
            updated_at = ? WHERE id = ?""",
            (next_status, next_attempt, next_sequence, command, command, command, now, control_job_id))
        updated = conn.execute("SELECT * FROM control_jobs WHERE id = ?", (control_job_id,)).fetchone()
    event(current.get("project_id"), None, "control_job_commanded", {
        "control_job_id": control_job_id, "command": command, "sequence": next_sequence,
        "attempt": next_attempt, "reason": str(reason or "")[:500], "origin": "human",
    })
    return row_dict(updated) or {}


def resolve_control_conflict(control_job_id: str, action: str) -> dict[str, Any]:
    action = str(action).strip().lower()
    if action not in {"discard", "retry_current"}:
        raise ValueError("Conflict action must be discard or retry_current.")
    with db() as conn:
        row = conn.execute("SELECT * FROM control_jobs WHERE id = ?", (control_job_id,)).fetchone()
        if not row:
            raise ValueError("Control job not found.")
        current = row_dict(row) or {}
        if current.get("status") != "conflict":
            raise ValueError("The control job is not awaiting conflict review.")
        if action == "discard":
            now = utc_now()
            conn.execute("UPDATE control_jobs SET status = 'cancelled', conflict_json = NULL, completed_at = ?, updated_at = ? WHERE id = ?", (now, now, control_job_id))
        else:
            timeline_revision = int(get_timeline(current["project_id"])["timeline"]["revision"])
            conn.execute("""UPDATE control_jobs SET status = 'queued', base_revision = ?, attempt = attempt + 1,
                control_sequence = control_sequence + 1, error_text = NULL, conflict_json = NULL,
                completed_at = NULL, updated_at = ? WHERE id = ?""", (timeline_revision, utc_now(), control_job_id))
        updated = conn.execute("SELECT * FROM control_jobs WHERE id = ?", (control_job_id,)).fetchone()
    event(current.get("project_id"), None, "control_job_conflict_resolved", {"control_job_id": control_job_id, "action": action, "origin": "human"})
    return row_dict(updated) or {}


def answer_control_job(control_job_id: str, answer: dict[str, Any]) -> dict[str, Any]:
    """Persist a human answer without turning it into a bot heartbeat.

    The next encrypted request contains this answer and keeps the same control-job
    id, allowing Grok Build to resume the same headless session.
    """
    if not isinstance(answer, dict) or not str(answer.get("value", "")).strip():
        raise ValueError("A non-empty structured answer is required.")
    safe_answer = {
        "question_id": str(answer.get("question_id", "decision"))[:120],
        "value": str(answer["value"])[:2_000],
        "answered_at": utc_now(),
        "origin": "human",
    }
    with db() as conn:
        row = conn.execute("SELECT * FROM control_jobs WHERE id = ?", (control_job_id,)).fetchone()
        if not row:
            raise ValueError("Control job not found.")
        current = row_dict(row) or {}
        settings = current.get("settings_json") if isinstance(current.get("settings_json"), dict) else {}
        settings = {**settings, "runner_input": safe_answer}
        now = utc_now()
        conn.execute(
            """UPDATE control_jobs SET settings_json = ?, status = 'queued', attempt = attempt + 1,
                error_text = NULL, completed_at = NULL, updated_at = ? WHERE id = ?""",
            (json.dumps(settings, ensure_ascii=False), now, control_job_id),
        )
        updated = conn.execute("SELECT * FROM control_jobs WHERE id = ?", (control_job_id,)).fetchone()
    event(current.get("project_id"), None, "control_job_answered", {"control_job_id": control_job_id, "question_id": safe_answer["question_id"]})
    return row_dict(updated) or {}


def record_runner_event(body: dict[str, Any]) -> dict[str, Any]:
    if body.get("schema") != RUNNER_EVENT_SCHEMA:
        raise ValueError(f"schema must be {RUNNER_EVENT_SCHEMA}.")
    control_job_id = str(body.get("control_job_id", "")); runner_id = _safe_identifier(body.get("runner_id"), "runner_id")
    sequence, stage, status = int(body.get("sequence", 0)), str(body.get("stage", "")), str(body.get("status", ""))
    if sequence < 1 or stage not in RUNNER_STAGES or status not in RUNNER_STATUSES:
        raise ValueError("Invalid runner event sequence, stage, or status.")
    detail = body.get("detail") if isinstance(body.get("detail"), dict) else {}
    raw = json.dumps(detail, ensure_ascii=False)
    if len(raw) > 30_000: raise ValueError("Runner event detail is too large.")
    verified_at, now, event_id = str(body.get("verified_at") or utc_now()), utc_now(), str(uuid.uuid4())
    # Runner completion means the remote proposal is ready. Only the desktop may
    # mark the whole control job completed after local apply/render/publish gates.
    mapped = {"claimed": "claimed", "analyzing": "analyzing", "planning": "planning", "needs_input": "needs_input", "proposal_ready": "proposal_ready", "completed": "proposal_ready", "failed": "failed", "cancelled": "cancelled", "paused": "paused", "resumed": "claimed"}.get(stage)
    with db() as conn:
        if not conn.execute("SELECT id FROM control_jobs WHERE id = ?", (control_job_id,)).fetchone():
            raise ValueError("Control job not found.")
        existing = conn.execute("SELECT * FROM runner_events WHERE control_job_id = ? AND runner_id = ? AND sequence = ?", (control_job_id, runner_id, sequence)).fetchone()
        if existing:
            current = row_dict(existing) or {}
            if current.get("stage") != stage or current.get("status") != status or current.get("detail_json") != detail:
                raise ValueError("Runner event sequence was replayed with different contents.")
            return current
        latest = conn.execute("SELECT MAX(sequence) AS sequence FROM runner_events WHERE control_job_id = ? AND runner_id = ?", (control_job_id, runner_id)).fetchone()
        if latest and int(latest["sequence"] or 0) >= sequence:
            raise ValueError("Runner event sequence is not monotonic.")
        conn.execute("""INSERT INTO runner_events
            (id, control_job_id, runner_id, sequence, stage, status, detail_json, verified_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", (event_id, control_job_id, runner_id, sequence, stage, status, raw, verified_at, now))
        job_row = conn.execute("SELECT attempt FROM control_jobs WHERE id = ?", (control_job_id,)).fetchone()
        stale_attempt = int(detail.get("attempt", 1) or 1) < int(job_row["attempt"] or 1)
        if mapped and not stale_attempt:
            conn.execute("""UPDATE control_jobs SET status = ?, error_text = ?, runner_id = ?,
                completed_at = CASE WHEN ? IN ('completed', 'cancelled', 'failed') THEN ? ELSE completed_at END,
                updated_at = ? WHERE id = ?""",
                (mapped, detail.get("error") if mapped == "failed" else None, runner_id, mapped, now, now, control_job_id))
        conn.execute("UPDATE runner_pairings SET status = 'connected', last_seen = ?, updated_at = ? WHERE runner_id = ?", (verified_at, now, runner_id))
        row = conn.execute("SELECT * FROM runner_events WHERE id = ?", (event_id,)).fetchone()
    return row_dict(row) or {}


def list_runner_events(control_job_id: str | None = None) -> list[dict[str, Any]]:
    query = "SELECT * FROM runner_events" + (" WHERE control_job_id = ?" if control_job_id else "") + " ORDER BY created_at DESC LIMIT 240"
    with db() as conn:
        rows = conn.execute(query, (control_job_id,) if control_job_id else ()).fetchall()
    return [row_dict(row) or {} for row in rows]


def pair_runner(body: dict[str, Any]) -> dict[str, Any]:
    runner_id = _safe_identifier(body.get("runner_id"), "runner_id")
    display_name = str(body.get("display_name", runner_id)).strip()[:120] or runner_id
    public_key, encryption_key = str(body.get("public_key", "")).strip(), str(body.get("encryption_key", "")).strip()
    if len(public_key) < 20 or len(encryption_key) < 20:
        raise ValueError("Runner signing and encryption public keys are required.")
    now = utc_now()
    with db() as conn:
        conn.execute("""INSERT INTO runner_pairings
            (runner_id, display_name, status, public_key, encryption_key, created_at, updated_at)
            VALUES (?, ?, 'paired', ?, ?, ?, ?)
            ON CONFLICT(runner_id) DO UPDATE SET display_name = excluded.display_name,
            public_key = excluded.public_key, encryption_key = excluded.encryption_key,
            status = 'paired', updated_at = excluded.updated_at""", (runner_id, display_name, public_key, encryption_key, now, now))
        row = conn.execute("SELECT * FROM runner_pairings WHERE runner_id = ?", (runner_id,)).fetchone()
    return row_dict(row) or {}


def list_runners() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM runner_pairings ORDER BY updated_at DESC LIMIT 40").fetchall()
    return [row_dict(row) or {} for row in rows]


def media_catalog() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    allowed = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".mp3", ".wav", ".m4a", ".png", ".jpg", ".jpeg", ".webp"}
    for area in ("inputs", "outputs"):
        root = config.WORKSPACE_DIR / area
        if not root.exists(): continue
        for path in root.rglob("*"):
            if path.is_file() and path.suffix.lower() in allowed:
                items.append({"name": path.name, "path": str(path.relative_to(config.WORKSPACE_DIR)).replace("\\", "/"), "kind": "video" if path.suffix.lower() in {".mp4", ".mov", ".mkv", ".avi", ".webm"} else "audio" if path.suffix.lower() in {".mp3", ".wav", ".m4a"} else "image", "size_bytes": path.stat().st_size, "area": area})
    return sorted(items, key=lambda item: (item["area"], item["name"].lower()))


def workspace_v2() -> dict[str, Any]:
    with db() as conn:
        projects = [row_dict(row) or {} for row in conn.execute("SELECT * FROM projects ORDER BY updated_at DESC LIMIT 80").fetchall()]
    for project in projects:
        version = ensure_timeline_version(project["id"])
        project["current_revision"] = version["revision"]
    return {"schema": "grok-crew.desktop-workspace/v1", "projects": projects, "control_jobs": list_control_jobs(), "runner_events": list_runner_events(), "runners": list_runners(), "media": media_catalog()}

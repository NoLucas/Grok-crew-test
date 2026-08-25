"""Desktop v2 domain: versioned timelines, settings-driven Grok jobs, and runners.

This module deliberately has no HTTP concerns.  The browser app, Electron shell,
and remote runner all use the same validated state transitions through handlers.py.
"""

from __future__ import annotations

import copy
import json
import math
import uuid
from pathlib import Path
from typing import Any

import config
from config import utc_now
from db import db, event, row_dict

TIMELINE_SCHEMA = "grok-crew.timeline/v2"
PATCH_SCHEMA = "grok-crew.timeline-patch/v1"
HISTORY_SCHEMA = "grok-crew.timeline-history/v1"
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
TIMELINE_EPSILON = 0.000001
DEFAULT_SNAP_TOLERANCE_FRAMES = 6


class TimelinePatchError(ValueError):
    """A stable, renderer-safe error contract for Timeline v2 patch failures."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details or {}

    def payload(self) -> dict[str, Any]:
        return {"error": str(self), "code": self.code, "details": self.details}


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
            "snapping_enabled": True, "snap_tolerance_frames": DEFAULT_SNAP_TOLERANCE_FRAMES,
            **settings,
        },
        "assets": [{"id": source_asset_id, "kind": "video", "name": Path(project["source_path"]).name, "path": project["source_path"]}],
        "tracks": [
            {"id": "video-main", "type": "video", "name": "Main video", "order": 0, "locked": False, "muted": False, "solo": False, "clips": video_clips},
            {"id": "captions-main", "type": "caption", "name": "Captions", "order": 10, "locked": False, "muted": False, "solo": False, "clips": caption_clips},
        ],
        "markers": [],
    }


def validate_timeline(timeline: Any) -> dict[str, Any]:
    if not isinstance(timeline, dict) or timeline.get("schema") != TIMELINE_SCHEMA:
        raise ValueError(f"timeline.schema must be {TIMELINE_SCHEMA}.")
    if not isinstance(timeline.get("settings"), dict):
        raise ValueError("timeline.settings must be an object.")
    settings = timeline["settings"]
    snapping_enabled = settings.get("snapping_enabled", True)
    if not isinstance(snapping_enabled, bool):
        raise ValueError("timeline.settings.snapping_enabled must be a boolean.")
    tolerance = settings.get("snap_tolerance_frames", DEFAULT_SNAP_TOLERANCE_FRAMES)
    if isinstance(tolerance, bool) or not isinstance(tolerance, int) or not 1 <= tolerance <= 60:
        raise ValueError("timeline.settings.snap_tolerance_frames must be an integer from 1 to 60.")
    settings["snapping_enabled"] = snapping_enabled
    settings["snap_tolerance_frames"] = tolerance
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
        track["locked"], track["muted"], track["solo"] = (
            bool(track.get("locked")), bool(track.get("muted")), bool(track.get("solo")),
        )
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
            group_id = clip.get("group_id")
            if group_id is not None:
                clip["group_id"] = _safe_identifier(group_id, "clip.group_id")
    timeline["revision"] = int(timeline.get("revision", 1))
    markers = timeline.get("markers")
    if not isinstance(markers, list):
        raise ValueError("timeline.markers must be an array.")
    marker_ids: set[str] = set()
    for marker in markers:
        if not isinstance(marker, dict):
            raise ValueError("Every marker must be an object.")
        marker_id = _safe_identifier(marker.get("id"), "marker.id")
        if marker_id in marker_ids:
            raise ValueError(f"Duplicate marker id: {marker_id}")
        marker_ids.add(marker_id)
        try:
            marker_at = float(marker.get("at"))
        except (TypeError, ValueError) as exc:
            raise ValueError("marker.at must be numeric.") from exc
        if not math.isfinite(marker_at) or marker_at < 0:
            raise ValueError("marker.at must be a finite non-negative number.")
        marker["id"], marker["at"] = marker_id, marker_at
        marker["label"] = str(marker.get("label", "")).strip()[:120]
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


def _history_stacks(conn: Any, project_id: str, head_revision: int) -> tuple[list[int], list[int]]:
    row = conn.execute(
        "SELECT head_revision, undo_json, redo_json FROM timeline_history WHERE project_id = ?",
        (project_id,),
    ).fetchone()
    if not row or int(row["head_revision"]) != head_revision:
        # Existing projects predate P1-03. Every chronological revision is a
        # valid immutable snapshot, so initialise the stack without rewriting it.
        return list(range(1, head_revision)), []
    try:
        undo = [int(value) for value in json.loads(row["undo_json"])]
        redo = [int(value) for value in json.loads(row["redo_json"])]
    except (TypeError, ValueError, json.JSONDecodeError):
        return list(range(1, head_revision)), []
    return undo, redo


def _save_history_stacks(
    conn: Any,
    project_id: str,
    head_revision: int,
    undo: list[int],
    redo: list[int],
) -> None:
    conn.execute(
        """INSERT INTO timeline_history (project_id, head_revision, undo_json, redo_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
            head_revision = excluded.head_revision,
            undo_json = excluded.undo_json,
            redo_json = excluded.redo_json,
            updated_at = excluded.updated_at""",
        (project_id, head_revision, json.dumps(undo[-250:]), json.dumps(redo[-250:]), utc_now()),
    )


def _record_history_command(conn: Any, project_id: str, base_revision: int, next_revision: int) -> None:
    undo, _redo = _history_stacks(conn, project_id, base_revision)
    if not undo or undo[-1] != base_revision:
        undo.append(base_revision)
    _save_history_stacks(conn, project_id, next_revision, undo, [])


def _history_payload(head_revision: int, undo: list[int], redo: list[int]) -> dict[str, Any]:
    return {
        "schema": HISTORY_SCHEMA,
        "head_revision": head_revision,
        "can_undo": bool(undo),
        "can_redo": bool(redo),
        "undo_count": len(undo),
        "redo_count": len(redo),
        "undo_revision": undo[-1] if undo else None,
        "redo_revision": redo[-1] if redo else None,
    }


def get_timeline_history(project_id: str) -> dict[str, Any]:
    current = get_timeline(project_id)
    head_revision = int(current["timeline"]["revision"])
    with db() as conn:
        undo, redo = _history_stacks(conn, project_id, head_revision)
    return _history_payload(head_revision, undo, redo)


def _find_track(timeline: dict[str, Any], track_id: Any) -> dict[str, Any]:
    value = next((track for track in timeline["tracks"] if track.get("id") == track_id), None)
    if not value:
        raise TimelinePatchError("timeline_item_not_found", "Track not found.", details={"track_id": track_id})
    return value


def _find_clip(timeline: dict[str, Any], clip_id: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    for track in timeline["tracks"]:
        clip = next((item for item in track["clips"] if item.get("id") == clip_id), None)
        if clip:
            return track, clip
    raise TimelinePatchError("timeline_item_not_found", "Clip not found.", details={"clip_id": clip_id})


def _assert_mutable(track: dict[str, Any], clip: dict[str, Any] | None = None) -> None:
    if track.get("locked"):
        raise TimelinePatchError(
            "timeline_item_locked", "A locked track cannot be modified.",
            details={"track_id": track.get("id"), "clip_id": clip.get("id") if clip else None},
        )
    if clip and clip.get("locked"):
        raise TimelinePatchError(
            "timeline_item_locked", "A locked clip cannot be modified.",
            details={"track_id": track.get("id"), "clip_id": clip.get("id")},
        )


def _assert_update_mutable(
    track: dict[str, Any],
    clip: dict[str, Any] | None,
    changes: dict[str, Any],
    origin: str,
) -> None:
    target = clip if clip is not None else track
    human_track_control = (
        clip is None
        and origin in {"human", "local_system"}
        and set(changes).issubset({"locked", "muted", "solo"})
        and all(isinstance(value, bool) for value in changes.values())
    )
    explicit_human_unlock = (
        origin in {"human", "local_system"}
        and target.get("locked")
        and changes == {"locked": False}
        and not (clip is not None and track.get("locked"))
    )
    if not human_track_control and not explicit_human_unlock:
        _assert_mutable(track, clip)


def _number(value: Any, field: str, *, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TimelinePatchError("invalid_operation", f"{field} must be a finite number.", details={"field": field})
    result = float(value)
    if not math.isfinite(result):
        raise TimelinePatchError("invalid_operation", f"{field} must be a finite number.", details={"field": field})
    if minimum is not None and result < minimum:
        raise TimelinePatchError(
            "invalid_time_range", f"{field} must be at least {minimum}.",
            details={"field": field, "minimum": minimum, "received": result},
        )
    return result


def _clip_end(clip: dict[str, Any]) -> float:
    return float(clip["timeline_start"]) + float(clip["duration"])


def _assert_touching(left: dict[str, Any], right: dict[str, Any]) -> None:
    if abs(_clip_end(left) - float(right["timeline_start"])) > TIMELINE_EPSILON:
        raise TimelinePatchError(
            "clips_not_adjacent", "The clips must touch at the same edit point.",
            details={"left_clip_id": left.get("id"), "right_clip_id": right.get("id")},
        )


def _validate_source_window(timeline: dict[str, Any], clip: dict[str, Any], *, required: bool = False) -> None:
    has_in, has_out = "source_in" in clip, "source_out" in clip
    if not has_in and not has_out and not required:
        return
    if not has_in or not has_out:
        raise TimelinePatchError(
            "invalid_source_range", "The clip requires both source_in and source_out.",
            details={"clip_id": clip.get("id")},
        )
    source_in = _number(clip.get("source_in"), "source_in", minimum=0)
    source_out = _number(clip.get("source_out"), "source_out", minimum=0)
    if source_out - source_in <= TIMELINE_EPSILON:
        raise TimelinePatchError(
            "invalid_source_range", "source_out must be greater than source_in.",
            details={"clip_id": clip.get("id"), "source_in": source_in, "source_out": source_out},
        )
    asset = next((item for item in timeline["assets"] if item.get("id") == clip.get("asset_id")), None)
    if asset and asset.get("duration") is not None:
        asset_duration = _number(asset.get("duration"), "asset.duration", minimum=0)
        if source_out - asset_duration > TIMELINE_EPSILON:
            raise TimelinePatchError(
                "source_range_exceeds_asset", "The source range exceeds the asset duration.",
                details={"clip_id": clip.get("id"), "source_out": source_out, "asset_duration": asset_duration},
            )


def _apply_trim(timeline: dict[str, Any], clip: dict[str, Any], edge: Any, at: Any) -> float:
    boundary = _number(at, "at", minimum=0)
    old_start, old_end = float(clip["timeline_start"]), _clip_end(clip)
    if boundary - old_start <= TIMELINE_EPSILON or old_end - boundary <= TIMELINE_EPSILON:
        raise TimelinePatchError(
            "invalid_time_range", "The trim point must be strictly inside the clip.",
            details={"clip_id": clip.get("id"), "start": old_start, "end": old_end, "at": boundary},
        )
    if edge == "start":
        delta = boundary - old_start
        clip["timeline_start"] = boundary
        clip["duration"] = old_end - boundary
        if "source_in" in clip:
            clip["source_in"] = float(clip["source_in"]) + delta
    elif edge == "end":
        delta = boundary - old_end
        clip["duration"] = boundary - old_start
        if "source_out" in clip:
            clip["source_out"] = float(clip["source_out"]) + delta
    else:
        raise TimelinePatchError(
            "invalid_operation", "edge must be start or end.",
            details={"field": "edge", "received": edge},
        )
    _validate_source_window(timeline, clip)
    return delta


def _same_track(
    timeline: dict[str, Any],
    first_id: Any,
    second_id: Any,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    first_track, first = _find_clip(timeline, first_id)
    second_track, second = _find_clip(timeline, second_id)
    if first_track["id"] != second_track["id"]:
        raise TimelinePatchError(
            "clips_on_different_tracks", "The clips must be on the same track.",
            details={"first_clip_id": first_id, "second_clip_id": second_id},
        )
    return first_track, first, second


def apply_timeline_patch(project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise TimelinePatchError("invalid_patch", "Timeline patch must be an object.")
    if body.get("schema") != PATCH_SCHEMA:
        raise TimelinePatchError("invalid_patch_schema", f"schema must be {PATCH_SCHEMA}.")
    origin = str(body.get("origin", "human"))
    if origin not in ORIGINS:
        raise TimelinePatchError("invalid_patch_origin", "Unsupported timeline origin.", details={"origin": origin})
    current = get_timeline(project_id)
    timeline = copy.deepcopy(current["timeline"])
    raw_base_revision = body.get("base_revision")
    if isinstance(raw_base_revision, bool) or not isinstance(raw_base_revision, int) or raw_base_revision < 1:
        raise TimelinePatchError("invalid_base_revision", "base_revision must be an integer of at least 1.")
    base_revision = raw_base_revision
    if base_revision != int(timeline["revision"]):
        raise TimelinePatchError(
            "stale_timeline_revision",
            f"stale_timeline_revision: expected {timeline['revision']}, received {base_revision}.",
            status=409,
            details={"expected_revision": int(timeline["revision"]), "received_revision": base_revision},
        )
    operations = body.get("operations")
    if not isinstance(operations, list) or not operations:
        raise TimelinePatchError("invalid_operations", "operations must be a non-empty array.")
    if len(operations) > 250:
        raise TimelinePatchError("too_many_operations", "A timeline patch may contain up to 250 operations.", details={"maximum": 250})
    for operation_index, operation in enumerate(operations):
        if not isinstance(operation, dict):
            raise TimelinePatchError(
                "invalid_operation", "Every operation must be an object.",
                details={"operation_index": operation_index},
            )
        kind = operation.get("op")
        try:
            if kind == "add_track":
                track = copy.deepcopy(operation.get("track"))
                if not isinstance(track, dict):
                    raise TimelinePatchError("invalid_operation", "add_track requires track.", details={"field": "track"})
                timeline["tracks"].append(track)
            elif kind == "update_track":
                track = _find_track(timeline, operation.get("track_id"))
                changes = operation.get("changes")
                if not isinstance(changes, dict) or not changes:
                    raise TimelinePatchError("invalid_operation", "update_track requires non-empty changes.", details={"field": "changes"})
                for field in {"locked", "muted", "solo"} & set(changes):
                    if not isinstance(changes[field], bool):
                        raise TimelinePatchError(
                            "invalid_operation", f"{field} must be a boolean.",
                            details={"field": field, "received": changes[field]},
                        )
                _assert_update_mutable(track, None, changes, origin)
                track.update({key: value for key, value in changes.items() if key not in {"id", "clips"}})
            elif kind == "remove_track":
                track = _find_track(timeline, operation.get("track_id")); _assert_mutable(track)
                timeline["tracks"].remove(track)
            elif kind == "add_clip":
                track = _find_track(timeline, operation.get("track_id")); _assert_mutable(track)
                clip = copy.deepcopy(operation.get("clip"))
                if not isinstance(clip, dict):
                    raise TimelinePatchError("invalid_operation", "add_clip requires clip.", details={"field": "clip"})
                track["clips"].append(clip)
            elif kind == "update_clip":
                track, clip = _find_clip(timeline, operation.get("clip_id"))
                changes = operation.get("changes")
                if not isinstance(changes, dict) or not changes:
                    raise TimelinePatchError("invalid_operation", "update_clip requires non-empty changes.", details={"field": "changes"})
                if "locked" in changes and not isinstance(changes["locked"], bool):
                    raise TimelinePatchError(
                        "invalid_operation", "locked must be a boolean.",
                        details={"field": "locked", "received": changes["locked"]},
                    )
                if "group_id" in changes and changes["group_id"] is not None:
                    try:
                        changes = {**changes, "group_id": _safe_identifier(changes["group_id"], "group_id")}
                    except ValueError as exc:
                        raise TimelinePatchError(
                            "invalid_operation", str(exc), details={"field": "group_id"},
                        ) from exc
                _assert_update_mutable(track, clip, changes, origin)
                clip.update({key: value for key, value in changes.items() if key != "id"})
                clip["timeline_start"] = _number(clip.get("timeline_start"), "timeline_start", minimum=0)
                clip["duration"] = _number(clip.get("duration"), "duration")
                if clip["duration"] <= TIMELINE_EPSILON:
                    raise TimelinePatchError(
                        "invalid_time_range", "duration must be greater than zero.",
                        details={"field": "duration", "received": clip["duration"]},
                    )
                _validate_source_window(timeline, clip)
            elif kind == "move_clip":
                source_track, clip = _find_clip(timeline, operation.get("clip_id")); _assert_mutable(source_track, clip)
                target_track = _find_track(timeline, operation.get("track_id", source_track["id"])); _assert_mutable(target_track)
                if source_track["id"] != target_track["id"]:
                    source_track["clips"].remove(clip); target_track["clips"].append(clip)
                clip["timeline_start"] = _number(operation.get("timeline_start"), "timeline_start", minimum=0)
            elif kind == "trim_clip":
                track, clip = _find_clip(timeline, operation.get("clip_id")); _assert_mutable(track, clip)
                _apply_trim(timeline, clip, operation.get("edge"), operation.get("at"))
            elif kind == "remove_clip":
                track, clip = _find_clip(timeline, operation.get("clip_id")); _assert_mutable(track, clip)
                track["clips"].remove(clip)
            elif kind == "split_clip":
                track, clip = _find_clip(timeline, operation.get("clip_id")); _assert_mutable(track, clip)
                split_at = _number(operation.get("at"), "at", minimum=0)
                relative = split_at - float(clip["timeline_start"])
                if relative <= TIMELINE_EPSILON or float(clip["duration"]) - relative <= TIMELINE_EPSILON:
                    raise TimelinePatchError(
                        "invalid_time_range", "The split point must be strictly inside the clip.",
                        details={"clip_id": clip.get("id"), "at": split_at},
                    )
                left, right = copy.deepcopy(clip), copy.deepcopy(clip)
                try:
                    left["id"] = _safe_identifier(operation.get("left_id", f"{clip['id']}-a"), "left_id")
                    right["id"] = _safe_identifier(operation.get("right_id", f"{clip['id']}-b"), "right_id")
                except ValueError as exc:
                    raise TimelinePatchError("invalid_operation", str(exc)) from exc
                left["duration"] = relative
                right["timeline_start"], right["duration"] = split_at, float(clip["duration"]) - relative
                if "source_in" in clip and "source_out" in clip:
                    left["source_out"] = float(clip["source_in"]) + relative
                    right["source_in"] = left["source_out"]
                    _validate_source_window(timeline, left); _validate_source_window(timeline, right)
                index = track["clips"].index(clip); track["clips"][index:index + 1] = [left, right]
            elif kind == "ripple_trim":
                track, clip = _find_clip(timeline, operation.get("clip_id")); _assert_mutable(track, clip)
                if operation.get("edge") != "end":
                    raise TimelinePatchError(
                        "invalid_operation", "ripple_trim currently supports edge=end only.",
                        details={"field": "edge", "received": operation.get("edge")},
                    )
                old_end = _clip_end(clip)
                followers = [
                    item for item in track["clips"]
                    if item is not clip and float(item["timeline_start"]) >= old_end - TIMELINE_EPSILON
                ]
                for follower in followers:
                    _assert_mutable(track, follower)
                delta = _apply_trim(timeline, clip, "end", operation.get("at"))
                for follower in followers:
                    follower["timeline_start"] = float(follower["timeline_start"]) + delta
            elif kind == "roll_edit":
                track, left, right = _same_track(timeline, operation.get("left_clip_id"), operation.get("right_clip_id"))
                _assert_mutable(track, left); _assert_mutable(track, right); _assert_touching(left, right)
                boundary = _number(operation.get("at"), "at", minimum=0)
                outer_start, outer_end = float(left["timeline_start"]), _clip_end(right)
                if boundary - outer_start <= TIMELINE_EPSILON or outer_end - boundary <= TIMELINE_EPSILON:
                    raise TimelinePatchError(
                        "invalid_time_range", "The roll point must keep both clips longer than zero.",
                        details={"at": boundary, "outer_start": outer_start, "outer_end": outer_end},
                    )
                delta = boundary - _clip_end(left)
                left["duration"] = boundary - outer_start
                right["timeline_start"] = boundary
                right["duration"] = outer_end - boundary
                if "source_out" in left: left["source_out"] = float(left["source_out"]) + delta
                if "source_in" in right: right["source_in"] = float(right["source_in"]) + delta
                _validate_source_window(timeline, left); _validate_source_window(timeline, right)
            elif kind == "slip_clip":
                track, clip = _find_clip(timeline, operation.get("clip_id")); _assert_mutable(track, clip)
                _validate_source_window(timeline, clip, required=True)
                source_span = float(clip["source_out"]) - float(clip["source_in"])
                clip["source_in"] = _number(operation.get("source_in"), "source_in", minimum=0)
                clip["source_out"] = float(clip["source_in"]) + source_span
                _validate_source_window(timeline, clip, required=True)
            elif kind == "slide_clip":
                previous_track, previous, selected = _same_track(
                    timeline, operation.get("previous_clip_id"), operation.get("clip_id"),
                )
                next_track, selected_again, following = _same_track(
                    timeline, operation.get("clip_id"), operation.get("next_clip_id"),
                )
                if previous_track["id"] != next_track["id"] or selected is not selected_again:
                    raise TimelinePatchError("clips_on_different_tracks", "All slide clips must be on the same track.")
                _assert_mutable(previous_track, previous); _assert_mutable(previous_track, selected); _assert_mutable(previous_track, following)
                _assert_touching(previous, selected); _assert_touching(selected, following)
                new_start = _number(operation.get("timeline_start"), "timeline_start", minimum=0)
                delta = new_start - float(selected["timeline_start"])
                previous_duration = float(previous["duration"]) + delta
                following_duration = float(following["duration"]) - delta
                if previous_duration <= TIMELINE_EPSILON or following_duration <= TIMELINE_EPSILON:
                    raise TimelinePatchError(
                        "invalid_time_range", "The slide must keep both neighboring clips longer than zero.",
                        details={"timeline_start": new_start},
                    )
                previous["duration"] = previous_duration
                selected["timeline_start"] = new_start
                following["timeline_start"] = float(following["timeline_start"]) + delta
                following["duration"] = following_duration
                if "source_out" in previous: previous["source_out"] = float(previous["source_out"]) + delta
                if "source_in" in following: following["source_in"] = float(following["source_in"]) + delta
                _validate_source_window(timeline, previous); _validate_source_window(timeline, following)
            elif kind == "set_settings":
                changes = operation.get("changes")
                if not isinstance(changes, dict) or not changes:
                    raise TimelinePatchError("invalid_operation", "set_settings requires non-empty changes.", details={"field": "changes"})
                if "snapping_enabled" in changes and not isinstance(changes["snapping_enabled"], bool):
                    raise TimelinePatchError(
                        "invalid_operation", "snapping_enabled must be a boolean.",
                        details={"field": "snapping_enabled", "received": changes["snapping_enabled"]},
                    )
                if "snap_tolerance_frames" in changes:
                    tolerance = changes["snap_tolerance_frames"]
                    if isinstance(tolerance, bool) or not isinstance(tolerance, int) or not 1 <= tolerance <= 60:
                        raise TimelinePatchError(
                            "invalid_operation", "snap_tolerance_frames must be an integer from 1 to 60.",
                            details={"field": "snap_tolerance_frames", "received": tolerance},
                        )
                timeline["settings"].update(changes)
            elif kind == "add_marker":
                marker = copy.deepcopy(operation.get("marker"))
                if not isinstance(marker, dict):
                    raise TimelinePatchError("invalid_operation", "add_marker requires marker.", details={"field": "marker"})
                try:
                    marker["id"] = _safe_identifier(marker.get("id"), "marker.id")
                except ValueError as exc:
                    raise TimelinePatchError(
                        "invalid_operation", str(exc), details={"field": "marker.id"},
                    ) from exc
                if any(item.get("id") == marker["id"] for item in timeline["markers"]):
                    raise TimelinePatchError(
                        "timeline_item_exists", "A marker with this id already exists.",
                        details={"marker_id": marker["id"]},
                    )
                marker["at"] = _number(marker.get("at"), "marker.at", minimum=0)
                marker["label"] = str(marker.get("label", "")).strip()[:120]
                timeline["markers"].append(marker)
            elif kind == "remove_marker":
                marker_id = operation.get("marker_id")
                marker = next((item for item in timeline["markers"] if item.get("id") == marker_id), None)
                if not marker:
                    raise TimelinePatchError(
                        "timeline_item_not_found", "Marker not found.", details={"marker_id": marker_id},
                    )
                timeline["markers"].remove(marker)
            else:
                raise TimelinePatchError(
                    "unsupported_operation", f"Unsupported timeline operation: {kind}",
                    details={"op": kind},
                )
        except TimelinePatchError as exc:
            raise TimelinePatchError(
                exc.code, str(exc), status=exc.status,
                details={"operation_index": operation_index, "op": kind, **exc.details},
            ) from exc
    next_revision = base_revision + 1
    timeline["revision"] = next_revision
    try:
        timeline = validate_timeline(timeline)
    except (TypeError, ValueError) as exc:
        raise TimelinePatchError("invalid_timeline_result", str(exc)) from exc
    version_id, now = str(uuid.uuid4()), utc_now()
    created_by = str(body.get("created_by", origin)).strip()[:80] or origin
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        latest = conn.execute(
            "SELECT revision FROM timeline_versions WHERE project_id = ? ORDER BY revision DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        latest_revision = int(latest["revision"]) if latest else 0
        if latest_revision != base_revision:
            raise TimelinePatchError(
                "stale_timeline_revision",
                f"stale_timeline_revision: expected {latest_revision}, received {base_revision}.",
                status=409,
                details={"expected_revision": latest_revision, "received_revision": base_revision},
            )
        _record_history_command(conn, project_id, base_revision, next_revision)
        conn.execute("""INSERT INTO timeline_versions
            (id, project_id, revision, parent_revision, timeline_json, origin, created_by, created_at, action_kind)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'edit')""", (version_id, project_id, next_revision, base_revision, json.dumps(timeline), origin, created_by, now))
        conn.execute("UPDATE projects SET timeline_json = ?, updated_at = ? WHERE id = ?", (json.dumps(timeline), now, project_id))
        row = conn.execute("SELECT * FROM timeline_versions WHERE id = ?", (version_id,)).fetchone()
    event(project_id, None, "timeline_version_created", {"revision": next_revision, "origin": origin, "created_by": created_by, "operation_count": len(operations)})
    return {"version": row_dict(row), "timeline": timeline}


def restore_timeline_version(project_id: str, revision: int, created_by: str = "operator") -> dict[str, Any]:
    current = get_timeline(project_id)
    current_revision = int(current["timeline"]["revision"])
    with db() as conn:
        row = conn.execute("SELECT * FROM timeline_versions WHERE project_id = ? AND revision = ?", (project_id, revision)).fetchone()
    source = row_dict(row)
    if not source:
        raise ValueError("Timeline version not found.")
    restored = copy.deepcopy(source["timeline_json"])
    next_revision = current_revision + 1
    restored["revision"] = next_revision
    now, version_id = utc_now(), str(uuid.uuid4())
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        latest = conn.execute(
            "SELECT revision FROM timeline_versions WHERE project_id = ? ORDER BY revision DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        latest_revision = int(latest["revision"]) if latest else 0
        if latest_revision != current_revision:
            raise TimelinePatchError(
                "stale_timeline_revision",
                f"stale_timeline_revision: expected {latest_revision}, received {current_revision}.",
                status=409,
                details={"expected_revision": latest_revision, "received_revision": current_revision},
            )
        _record_history_command(conn, project_id, current_revision, next_revision)
        conn.execute("""INSERT INTO timeline_versions
            (id, project_id, revision, parent_revision, timeline_json, origin, created_by, created_at, action_kind, restored_from_revision)
            VALUES (?, ?, ?, ?, ?, 'human', ?, ?, 'restore', ?)""",
            (version_id, project_id, next_revision, current_revision, json.dumps(restored), created_by[:80], now, revision))
        conn.execute("UPDATE projects SET timeline_json = ?, updated_at = ? WHERE id = ?", (json.dumps(restored), now, project_id))
        result = conn.execute("SELECT * FROM timeline_versions WHERE id = ?", (version_id,)).fetchone()
    event(project_id, None, "timeline_version_restored", {"source_revision": revision, "revision": next_revision})
    return {"version": row_dict(result), "timeline": restored}


def apply_timeline_history_action(project_id: str, body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict) or body.get("schema") != HISTORY_SCHEMA:
        raise TimelinePatchError("invalid_history_schema", f"schema must be {HISTORY_SCHEMA}.")
    action = body.get("action")
    if action not in {"undo", "redo"}:
        raise TimelinePatchError(
            "invalid_history_action", "action must be undo or redo.", details={"action": action},
        )
    raw_base_revision = body.get("base_revision")
    if isinstance(raw_base_revision, bool) or not isinstance(raw_base_revision, int) or raw_base_revision < 1:
        raise TimelinePatchError(
            "invalid_base_revision", "base_revision must be an integer of at least 1.",
        )
    base_revision = raw_base_revision
    created_by = str(body.get("created_by", "operator")).strip()[:80] or "operator"
    now, version_id = utc_now(), str(uuid.uuid4())
    ensure_timeline_version(project_id)

    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        latest = conn.execute(
            "SELECT revision FROM timeline_versions WHERE project_id = ? ORDER BY revision DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        latest_revision = int(latest["revision"]) if latest else 0
        if latest_revision != base_revision:
            raise TimelinePatchError(
                "stale_timeline_revision",
                f"stale_timeline_revision: expected {latest_revision}, received {base_revision}.",
                status=409,
                details={"expected_revision": latest_revision, "received_revision": base_revision},
            )

        undo, redo = _history_stacks(conn, project_id, latest_revision)
        source_stack, destination_stack = (undo, redo) if action == "undo" else (redo, undo)
        if not source_stack:
            raise TimelinePatchError(
                "history_action_unavailable",
                f"There is nothing to {action}.",
                status=409,
                details={"action": action, "head_revision": latest_revision},
            )
        target_revision = source_stack.pop()
        destination_stack.append(latest_revision)
        source = conn.execute(
            "SELECT timeline_json FROM timeline_versions WHERE project_id = ? AND revision = ?",
            (project_id, target_revision),
        ).fetchone()
        if not source:
            raise TimelinePatchError(
                "timeline_item_not_found",
                "The history target no longer exists.",
                details={"revision": target_revision},
            )
        timeline = copy.deepcopy(json.loads(source["timeline_json"]))
        next_revision = latest_revision + 1
        timeline["revision"] = next_revision
        try:
            timeline = validate_timeline(timeline)
        except (TypeError, ValueError) as exc:
            raise TimelinePatchError("invalid_timeline_result", str(exc)) from exc

        _save_history_stacks(conn, project_id, next_revision, undo, redo)
        conn.execute("""INSERT INTO timeline_versions
            (id, project_id, revision, parent_revision, timeline_json, origin, created_by, created_at, action_kind, restored_from_revision)
            VALUES (?, ?, ?, ?, ?, 'human', ?, ?, ?, ?)""",
            (
                version_id, project_id, next_revision, latest_revision, json.dumps(timeline),
                created_by, now, action, target_revision,
            ),
        )
        conn.execute(
            "UPDATE projects SET timeline_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(timeline), now, project_id),
        )
        result = conn.execute("SELECT * FROM timeline_versions WHERE id = ?", (version_id,)).fetchone()

    event(
        project_id,
        None,
        f"timeline_{action}",
        {"source_revision": target_revision, "revision": next_revision, "created_by": created_by},
    )
    return {
        "version": row_dict(result),
        "timeline": timeline,
        "history": _history_payload(next_revision, undo, redo),
    }


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

"""Operator edit specs: the person names the cut; the bot supplies source and edit."""

from __future__ import annotations

import json
import uuid
from typing import Any

from config import utc_now
from db import db, row_dict

SCHEMA = "grok-crew.edit-spec/v1"
PLATFORMS = {
    "reels_tiktok_shorts": "9:16",
    "feed_square": "1:1",
    "landscape": "16:9",
}
SOURCE_RULE = "The operator does not attach footage. The bot must put the source video in the handoff package."


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def normalize_spec(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("Edit spec must be a JSON object.")
    title = str(body.get("title") or "").strip()[:120]
    goal = str(body.get("goal") or "").strip()[:2000]
    if not title:
        raise ValueError("title is required.")
    if not goal:
        raise ValueError("goal is required.")
    platform = str(body.get("platform") or "reels_tiktok_shorts").strip()
    if platform not in PLATFORMS:
        raise ValueError("platform must be reels_tiktok_shorts, feed_square, or landscape.")
    raw_duration = body.get("duration_seconds")
    if isinstance(raw_duration, (int, float)):
        duration = {"min": int(raw_duration), "max": int(raw_duration)}
    elif isinstance(raw_duration, dict):
        duration = {
            "min": int(raw_duration.get("min") or 12),
            "max": int(raw_duration.get("max") or 30),
        }
    else:
        duration = {"min": 12, "max": 30}
    if duration["min"] < 1 or duration["max"] > 180 or duration["min"] > duration["max"]:
        raise ValueError("duration_seconds must be between 1 and 180 seconds.")
    language = str(body.get("language") or "ko").strip().lower()[:8] or "ko"
    return {
        "schema": SCHEMA,
        "title": title,
        "goal": goal,
        "platform": platform,
        "aspect": PLATFORMS[platform],
        "duration_seconds": duration,
        "captions": _as_bool(body.get("captions"), True),
        "look": str(body.get("look") or "").strip()[:400],
        "must_keep": str(body.get("must_keep") or "").strip()[:800],
        "must_drop": str(body.get("must_drop") or "").strip()[:800],
        "upload": _as_bool(body.get("upload"), False),
        "language": language,
        "source": {"owner": "bot", "rule": SOURCE_RULE},
    }


def _record(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    spec = row.get("spec_json")
    if not isinstance(spec, dict):
        spec = {}
    return {
        "id": row["id"],
        "schema": SCHEMA,
        "status": row["status"],
        "project_id": row.get("project_id"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "spec": spec,
        "title": spec.get("title") or "",
        "goal": spec.get("goal") or "",
    }


def create_spec(body: dict[str, Any]) -> dict[str, Any]:
    spec = normalize_spec(body)
    spec_id = str(uuid.uuid4())
    now = utc_now()
    with db() as conn:
        conn.execute(
            "INSERT INTO edit_specs (id, spec_json, status, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (spec_id, json.dumps(spec, ensure_ascii=False), "waiting_for_bot", None, now, now),
        )
        row = conn.execute("SELECT * FROM edit_specs WHERE id = ?", (spec_id,)).fetchone()
    return _record(row_dict(row)) or {}


def get_spec(spec_id: str) -> dict[str, Any] | None:
    with db() as conn:
        return _record(row_dict(conn.execute("SELECT * FROM edit_specs WHERE id = ?", (spec_id,)).fetchone()))


def list_specs() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM edit_specs ORDER BY created_at DESC LIMIT 40").fetchall()
    return [item for item in (_record(row_dict(row)) for row in rows) if item]


def attach_spec_project(spec_id: str, project_id: str) -> dict[str, Any] | None:
    spec = get_spec(spec_id)
    if not spec:
        return None
    now = utc_now()
    with db() as conn:
        conn.execute(
            "UPDATE edit_specs SET status = ?, project_id = ?, updated_at = ? WHERE id = ?",
            ("received", project_id, now, spec_id),
        )
        conn.execute("UPDATE projects SET edit_spec_id = ? WHERE id = ?", (spec_id, project_id))
    return get_spec(spec_id)


def spec_brief(spec_id: str) -> dict[str, Any]:
    record = get_spec(spec_id)
    if not record:
        raise ValueError("Edit spec not found.")
    spec = record["spec"]
    language = str(spec.get("language") or "ko")
    duration = spec.get("duration_seconds") or {}
    captions = "on" if spec.get("captions") else "off"
    upload = "do not upload" if not spec.get("upload") else "queue publish only after the operator confirms"
    if language.startswith("ko"):
        text = (
            f"이 사람은 원본을 주지 않습니다. 당신이 소스 영상과 편집을 만들어 "
            f"Grok Crew 인계 패키지로 넘기세요.\n\n"
            f"규격 id: {record['id']}\n"
            f"제목: {spec.get('title')}\n"
            f"목표: {spec.get('goal')}\n"
            f"길이: {duration.get('min')}–{duration.get('max')}초, {spec.get('aspect')}, 플랫폼 {spec.get('platform')}\n"
            f"자막: {captions}\n"
            f"룩: {spec.get('look') or '자연스럽게'}\n"
            f"남길 것: {spec.get('must_keep') or '가장 강한 대사와 훅'}\n"
            f"버릴 것: {spec.get('must_drop') or '침묵, 재촬영, 군더더기'}\n"
            f"게시: {upload}\n\n"
            f"패키지 한 폴더에 bundle.json과 영상 파일(source.mp4)을 넣으세요. "
            f"bundle.project.edit_spec_id는 {record['id']} 이어야 합니다. "
            f"bundle.project.source_path는 inputs/handoff/<폴더명>/source.mp4 이고, "
            f"실제 파일은 폴더 맨 위 source.mp4 입니다. "
            f"B-roll이 있으면 같은 폴더에 파일을 두고 timeline.assets[].path에 적으세요. "
            f"이 PC의 127.0.0.1에는 접속하지 마세요. git 인계 저장소에만 push 하세요. "
            f"자세한 폴더 규칙은 local_studio/handoff-guide.json 입니다."
        )
    else:
        text = (
            f"The operator will not attach footage. You supply the source video and the edit "
            f"as a Grok Crew handoff package.\n\n"
            f"Spec id: {record['id']}\n"
            f"Title: {spec.get('title')}\n"
            f"Goal: {spec.get('goal')}\n"
            f"Length: {duration.get('min')}–{duration.get('max')}s, {spec.get('aspect')}, platform {spec.get('platform')}\n"
            f"Captions: {captions}\n"
            f"Look: {spec.get('look') or 'natural'}\n"
            f"Keep: {spec.get('must_keep') or 'the strongest lines and the hook'}\n"
            f"Drop: {spec.get('must_drop') or 'silence, retakes, filler'}\n"
            f"Publish: {upload}\n\n"
            f"Put bundle.json and the video (source.mp4) in one folder. "
            f"Set bundle.project.edit_spec_id to {record['id']}. "
            f"bundle.project.source_path must be inputs/handoff/<folder>/source.mp4, "
            f"and the real file sits at the folder root as source.mp4. "
            f"If you add B-roll, put those files in the same folder and list them on timeline.assets[].path. "
            f"Do not connect to 127.0.0.1 on the operator's PC. Push only to the git handoff repository. "
            f"Folder rules: local_studio/handoff-guide.json."
        )
    return {"spec": record, "text": text, "channel": "git-handoff"}

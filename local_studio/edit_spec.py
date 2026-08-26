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
DOORS = ("grok", "agent")


def normalize_door(value: Any, *, required: bool = False) -> str:
    text = str(value or "").strip().lower().replace("_", "-")
    if text in {"", "default"} and not required:
        return "grok"
    if text in {"grok", "grok-bot", "grokbot"}:
        return "grok"
    if text in {"agent", "agents", "other", "other-agent", "other-agents"}:
        return "agent"
    raise ValueError("door must be grok or agent.")


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
    door = normalize_door(body.get("door"))
    agent = str(body.get("agent") or "").strip()[:80]
    if not agent:
        agent = "Grok" if door == "grok" else "agent"
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
        "door": door,
        "agent": agent,
        "source": {"owner": "bot", "rule": SOURCE_RULE, "door": door},
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
        "door": spec.get("door") or "grok",
        "agent": spec.get("agent") or ("Grok" if (spec.get("door") or "grok") == "grok" else "agent"),
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
    door = normalize_door(spec.get("door") or record.get("door"))
    agent = str(spec.get("agent") or ("Grok" if door == "grok" else "agent"))
    common = (
        f"규격 id: {record['id']}\n"
        f"제목: {spec.get('title')}\n"
        f"목표: {spec.get('goal')}\n"
        f"길이: {duration.get('min')}–{duration.get('max')}초, {spec.get('aspect')}, 플랫폼 {spec.get('platform')}\n"
        f"자막: {captions}\n"
        f"룩: {spec.get('look') or '자연스럽게'}\n"
        f"남길 것: {spec.get('must_keep') or '가장 강한 대사와 훅'}\n"
        f"버릴 것: {spec.get('must_drop') or '침묵, 재촬영, 군더더기'}\n"
        f"게시: {upload}\n"
        if language.startswith("ko")
        else (
            f"Spec id: {record['id']}\n"
            f"Title: {spec.get('title')}\n"
            f"Goal: {spec.get('goal')}\n"
            f"Length: {duration.get('min')}–{duration.get('max')}s, {spec.get('aspect')}, platform {spec.get('platform')}\n"
            f"Captions: {captions}\n"
            f"Look: {spec.get('look') or 'natural'}\n"
            f"Keep: {spec.get('must_keep') or 'the strongest lines and the hook'}\n"
            f"Drop: {spec.get('must_drop') or 'silence, retakes, filler'}\n"
            f"Publish: {upload}\n"
        )
    )
    if door == "grok":
        text = (
            f"이 글은 Grok 전용 문입니다. Grok만 이 규격을 이행하세요. "
            f"Claude, Codex, ChatGPT 같은 다른 에이전트는 다른 에이전트 문을 쓰세요.\n\n"
            f"{common}\n"
            f"원본은 운영자가 주지 않습니다. 당신이 소스와 컷을 만드세요.\n"
            f"같은 PC면 `python local_studio/grok_crew.py` 와 Bot Check로 체크인하세요. "
            f"데스크톱 Runner 페어링은 Grok 문에서만 씁니다.\n"
            f"다른 컴퓨터면 패키지를 local_studio/workspace/handoff-inbox/grok/ 에 두거나 "
            f"git 인계의 grok/ 아래에 push 하세요. "
            f"bundle.project.door는 grok, created_by는 grok, edit_spec_id는 {record['id']}. "
            f"agents/ 폴더에는 넣지 마세요. 127.0.0.1에는 접속하지 마세요."
            if language.startswith("ko")
            else (
                f"This is the Grok-only door. Only Grok should fulfill this spec. "
                f"Claude, Codex, ChatGPT, and other agents must use the other-agent door.\n\n"
                f"{common}\n"
                f"The operator will not attach footage. You supply the source and the cut.\n"
                f"On the same PC use `python local_studio/grok_crew.py` and Bot Check. "
                f"Desktop Runner pairing is only for this Grok door.\n"
                f"On another computer put the package in local_studio/workspace/handoff-inbox/grok/ "
                f"or push under grok/ on the git handoff repo. "
                f"Set bundle.project.door to grok, created_by to grok, edit_spec_id to {record['id']}. "
                f"Do not use the agents/ folder. Do not connect to 127.0.0.1."
            )
        )
    else:
        text = (
            f"이 글은 다른 에이전트 전용 문입니다. Grok이 아닙니다. "
            f"Grok 문, Runner 페어링, handoff-inbox/grok/ 는 쓰지 마세요. "
            f"당신은 {agent}이거나 Claude, Codex, ChatGPT, Gemini, Cursor 같은 다른 에이전트입니다.\n\n"
            f"{common}\n"
            f"원본은 운영자가 주지 않습니다. 당신이 소스와 컷을 만드세요.\n"
            f"같은 PC면 `python local_studio/grok_crew.py spec brief --id {record['id']}` 로 이 글을 읽고 CLI로 작업하세요.\n"
            f"다른 컴퓨터면 패키지를 local_studio/workspace/handoff-inbox/agents/ 에 두거나 "
            f"git 인계의 agents/ 아래에 push 하세요. "
            f"bundle.project.door는 agent, created_by는 당신 이름, edit_spec_id는 {record['id']}. "
            f"127.0.0.1에는 접속하지 마세요. 규칙: local_studio/handoff-guide.json."
            if language.startswith("ko")
            else (
                f"This is the other-agent door. You are not Grok. "
                f"Do not use the Grok door, Runner pairing, or handoff-inbox/grok/. "
                f"You are {agent}, or Claude, Codex, ChatGPT, Gemini, Cursor, or another non-Grok agent.\n\n"
                f"{common}\n"
                f"The operator will not attach footage. You supply the source and the cut.\n"
                f"On the same PC re-read this with "
                f"`python local_studio/grok_crew.py spec brief --id {record['id']}` and use the CLI.\n"
                f"On another computer put the package in local_studio/workspace/handoff-inbox/agents/ "
                f"or push under agents/ on the git handoff repo. "
                f"Set bundle.project.door to agent, created_by to your name, edit_spec_id to {record['id']}. "
                f"Do not connect to 127.0.0.1. Rules: local_studio/handoff-guide.json."
            )
        )
    return {"spec": record, "text": text, "channel": f"{door}-door", "door": door, "agent": agent}

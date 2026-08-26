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
CREW_SOURCE_RULE = (
    "The collector gathers source into handoff-materials. "
    "The editor cuts those clips. The operator does not attach footage."
)
DOORS = ("grok", "agent")
ROLES = ("collect", "edit")
CREW_ROLES = {
    "collect": {"door": "agent", "default_agent": "Claude"},
    "edit": {"door": "grok", "default_agent": "Grok"},
}
AGENT_ALIASES = {
    "grok": "Grok",
    "grok-bot": "Grok",
    "grokbot": "Grok",
    "claude": "Claude",
    "claude-code": "Claude",
    "anthropic": "Claude",
    "codex": "Codex",
    "openai-codex": "Codex",
    "chatgpt": "ChatGPT",
    "chat-gpt": "ChatGPT",
    "gpt": "ChatGPT",
    "gpt-4": "ChatGPT",
    "gpt-5": "ChatGPT",
    "openai": "ChatGPT",
    "gemini": "Gemini",
    "gemini-cli": "Gemini",
    "bard": "Gemini",
    "cursor": "Cursor",
    "cursor-agent": "Cursor",
}


def agent_key(value: Any) -> str:
    return str(value or "").strip().lower().replace("_", "-").replace(" ", "-")


def normalize_role(value: Any, *, required: bool = False) -> str:
    text = str(value or "").strip().lower().replace("_", "-")
    if text in {"", "default"} and not required:
        return ""
    if text in {"collect", "collector", "scrape", "scraping", "gather", "research"}:
        return "collect"
    if text in {"edit", "editor", "cut"}:
        return "edit"
    raise ValueError("role must be collect or edit.")


def normalize_door(value: Any, *, required: bool = False) -> str:
    text = str(value or "").strip().lower().replace("_", "-")
    if text in {"", "default"} and not required:
        return "grok"
    if text in {"grok", "grok-bot", "grokbot"}:
        return "grok"
    if text in {"agent", "agents", "other", "other-agent", "other-agents"}:
        return "agent"
    raise ValueError("door must be grok or agent.")


def normalize_agent(value: Any, door: str) -> str:
    """Canonical sender name. Door is the inbox; agent is who used that inbox."""
    resolved_door = normalize_door(door)
    key = agent_key(value)
    canonical = AGENT_ALIASES.get(key)
    if resolved_door == "grok":
        if canonical and canonical != "Grok":
            raise ValueError("Only Grok may deliver through the Grok door.")
        return "Grok"
    if canonical == "Grok":
        raise ValueError("Grok must deliver through the Grok door, not agents/.")
    if canonical:
        return canonical
    text = str(value or "").strip()[:80]
    if not text or key in {"agent", "agents", "bot", "other", "other-agent"}:
        return "agent"
    return text


def resolve_sender(project: dict[str, Any], spec: dict[str, Any] | None = None) -> tuple[str, str]:
    """Return (door, agent) for an incoming package or saved spec."""
    raw_door = project.get("door") if isinstance(project, dict) else None
    if raw_door not in (None, ""):
        door = normalize_door(raw_door, required=True)
    else:
        created = agent_key((project or {}).get("created_by") or (project or {}).get("agent"))
        if created in {"grok", "grok-bot", "grokbot"}:
            door = "grok"
        elif created:
            door = "agent"
        elif spec:
            door = normalize_door(spec.get("door"))
        else:
            door = "grok"
    raw_agent = (project or {}).get("created_by") or (project or {}).get("agent")
    if not raw_agent and spec:
        raw_agent = spec.get("agent")
    return door, normalize_agent(raw_agent, door)


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
    crew = _as_bool(body.get("crew"), False) or body.get("collector") not in (None, "")
    if crew:
        collector_agent = normalize_agent(body.get("collector") or body.get("agent") or CREW_ROLES["collect"]["default_agent"], "agent")
        editor_agent = normalize_agent(body.get("editor") or CREW_ROLES["edit"]["default_agent"], "grok")
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
            "crew": True,
            "door": "grok",
            "agent": editor_agent,
            "collector": {"role": "collect", "door": "agent", "agent": collector_agent},
            "editor": {"role": "edit", "door": "grok", "agent": editor_agent},
            "source": {"owner": "collector", "rule": CREW_SOURCE_RULE, "box": "handoff-materials"},
        }
    door = normalize_door(body.get("door"))
    agent = normalize_agent(body.get("agent"), door)
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
        "crew": False,
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
        "crew": bool(spec.get("crew")),
        "collector": spec.get("collector") if isinstance(spec.get("collector"), dict) else None,
        "editor": spec.get("editor") if isinstance(spec.get("editor"), dict) else None,
    }


def create_spec(body: dict[str, Any]) -> dict[str, Any]:
    spec = normalize_spec(body)
    spec_id = str(uuid.uuid4())
    now = utc_now()
    status = "waiting_for_collector" if spec.get("crew") else "waiting_for_bot"
    with db() as conn:
        conn.execute(
            "INSERT INTO edit_specs (id, spec_json, status, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (spec_id, json.dumps(spec, ensure_ascii=False), status, None, now, now),
        )
        row = conn.execute("SELECT * FROM edit_specs WHERE id = ?", (spec_id,)).fetchone()
    record = _record(row_dict(row)) or {}
    from handoff_outbox import write_crew_outbox, write_outbox

    if spec.get("crew"):
        record["outbox"] = write_crew_outbox(record)
    else:
        record["outbox"] = write_outbox(record)
    return record


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
    from handoff_outbox import archive_outbox
    from handoff_materials import archive_materials

    archive_outbox(spec_id)
    archive_materials(spec_id)
    return get_spec(spec_id)


def set_spec_status(spec_id: str, status: str) -> dict[str, Any] | None:
    if not get_spec(spec_id):
        return None
    now = utc_now()
    with db() as conn:
        conn.execute("UPDATE edit_specs SET status = ?, updated_at = ? WHERE id = ?", (status, now, spec_id))
    return get_spec(spec_id)


def spec_brief(spec_id: str, role: str | None = None) -> dict[str, Any]:
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
    requested = normalize_role(role) if role not in (None, "") else ""
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
    if spec.get("crew"):
        collector = spec.get("collector") if isinstance(spec.get("collector"), dict) else {}
        editor = spec.get("editor") if isinstance(spec.get("editor"), dict) else {}
        collector_name = str(collector.get("agent") or "Claude")
        editor_name = str(editor.get("agent") or "Grok")
        collect_text = (
            f"이 글은 수집 역할입니다. 편집할 자료를 모으세요. 최종 컷은 만들지 마세요. "
            f"당신은 {collector_name}입니다. Grok 문과 Runner는 쓰지 마세요.\n\n"
            f"{common}\n"
            f"운영자가 원본을 주지 않습니다. 운영자가 쓸 수 있는 출처에서만 클립을 모으세요. "
            f"이 책상은 로그인 벽을 넘는 스크래퍼가 아닙니다.\n"
            f"규격은 보낼함 local_studio/workspace/handoff-outbox/agents/{record['id']}/ 에 있습니다. "
            f"git이면 outbox/agents/{record['id']}/ 에서 spec.json 을 읽으세요.\n"
            f"클립과 manifest.json 은 local_studio/workspace/handoff-materials/{record['id']}/ 에 두세요. "
            f"git이면 materials/{record['id']}/ 입니다.\n"
            f"끝난 컷을 인박스에 넣지 마세요. 127.0.0.1에는 접속하지 마세요."
            if language.startswith("ko")
            else (
                f"This is the collector role. Gather source clips. Do not make the final cut. "
                f"You are {collector_name}. Do not use the Grok door or Runner.\n\n"
                f"{common}\n"
                f"The operator will not attach footage. Collect only sources the operator may use. "
                f"This desk is not a scraper for login-walled sites.\n"
                f"This spec is in the outbox at local_studio/workspace/handoff-outbox/agents/{record['id']}/. "
                f"On git read spec.json under outbox/agents/{record['id']}/.\n"
                f"Put clips and manifest.json in local_studio/workspace/handoff-materials/{record['id']}/ "
                f"or under materials/{record['id']}/ on git.\n"
                f"Do not put a finished cut in any inbox. Do not connect to 127.0.0.1."
            )
        )
        edit_text = (
            f"이 글은 편집 역할입니다. Grok만 이 컷을 만드세요. "
            f"수집 봇이 모은 자료만 자르세요.\n\n"
            f"{common}\n"
            f"자료는 local_studio/workspace/handoff-materials/{record['id']}/manifest.json 에 있습니다. "
            f"git이면 materials/{record['id']}/ 입니다. 자료가 오기 전에 새 소스를 찾지 마세요.\n"
            f"규격은 보낼함 local_studio/workspace/handoff-outbox/grok/{record['id']}/ 에 있습니다. "
            f"git이면 outbox/grok/{record['id']}/ 에서 spec.json 을 읽으세요.\n"
            f"끝난 패키지는 local_studio/workspace/handoff-inbox/grok/ 또는 git 인계의 grok/ 아래에 두세요. "
            f"bundle.project.door는 grok, created_by는 grok, edit_spec_id는 {record['id']}. "
            f"agents/ 폴더에는 넣지 마세요. 127.0.0.1에는 접속하지 마세요."
            if language.startswith("ko")
            else (
                f"This is the editor role. Only Grok should make this cut. "
                f"Cut the clips the collector gathered.\n\n"
                f"{common}\n"
                f"Materials are at local_studio/workspace/handoff-materials/{record['id']}/manifest.json "
                f"or materials/{record['id']}/ on git. Do not hunt a new source before those files exist.\n"
                f"This spec is in the outbox at local_studio/workspace/handoff-outbox/grok/{record['id']}/. "
                f"On git read spec.json under outbox/grok/{record['id']}/.\n"
                f"Put the finished package in local_studio/workspace/handoff-inbox/grok/ "
                f"or under grok/ on the git handoff repo. "
                f"Set bundle.project.door to grok, created_by to grok, edit_spec_id to {record['id']}. "
                f"Do not use the agents/ folder. Do not connect to 127.0.0.1."
            )
        )
        if requested == "collect":
            return {
                "spec": record,
                "text": collect_text,
                "channel": "crew-collect",
                "door": "agent",
                "agent": collector_name,
                "role": "collect",
                "crew": True,
            }
        if requested == "edit":
            return {
                "spec": record,
                "text": edit_text,
                "channel": "crew-edit",
                "door": "grok",
                "agent": editor_name,
                "role": "edit",
                "crew": True,
            }
        return {
            "spec": record,
            "text": f"{collect_text}\n\n---\n\n{edit_text}",
            "channel": "crew",
            "door": "grok",
            "agent": editor_name,
            "role": "crew",
            "crew": True,
            "roles": {
                "collect": {"text": collect_text, "door": "agent", "agent": collector_name},
                "edit": {"text": edit_text, "door": "grok", "agent": editor_name},
            },
        }
    if door == "grok":
        text = (
            f"이 글은 Grok 전용 문입니다. Grok만 이 규격을 이행하세요. "
            f"Claude, Codex, ChatGPT 같은 다른 에이전트는 다른 에이전트 문을 쓰세요.\n\n"
            f"{common}\n"
            f"원본은 운영자가 주지 않습니다. 당신이 소스와 컷을 만드세요.\n"
            f"이 규격은 보낼함 local_studio/workspace/handoff-outbox/grok/{record['id']}/ 에 있습니다. "
            f"git이면 outbox/grok/{record['id']}/ 에서 spec.json 을 읽으세요.\n"
            f"같은 PC면 `python local_studio/grok_crew.py` 와 Bot Check로 체크인하세요. "
            f"데스크톱 Runner 페어링은 Grok 문에서만 씁니다.\n"
            f"끝난 패키지는 local_studio/workspace/handoff-inbox/grok/ 또는 git 인계의 grok/ 아래에 두세요. "
            f"bundle.project.door는 grok, created_by는 grok, edit_spec_id는 {record['id']}. "
            f"agents/ 폴더에는 넣지 마세요. 127.0.0.1에는 접속하지 마세요."
            if language.startswith("ko")
            else (
                f"This is the Grok-only door. Only Grok should fulfill this spec. "
                f"Claude, Codex, ChatGPT, and other agents must use the other-agent door.\n\n"
                f"{common}\n"
                f"The operator will not attach footage. You supply the source and the cut.\n"
                f"This spec is in the outbox at local_studio/workspace/handoff-outbox/grok/{record['id']}/. "
                f"On git read spec.json under outbox/grok/{record['id']}/.\n"
                f"On the same PC use `python local_studio/grok_crew.py` and Bot Check. "
                f"Desktop Runner pairing is only for this Grok door.\n"
                f"Put the finished package in local_studio/workspace/handoff-inbox/grok/ "
                f"or under grok/ on the git handoff repo. "
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
            f"이 규격은 보낼함 local_studio/workspace/handoff-outbox/agents/{record['id']}/ 에 있습니다. "
            f"git이면 outbox/agents/{record['id']}/ 에서 spec.json 을 읽으세요.\n"
            f"같은 PC면 `python local_studio/grok_crew.py spec brief --id {record['id']}` 로 이 글을 읽고 CLI로 작업하세요.\n"
            f"끝난 패키지는 local_studio/workspace/handoff-inbox/agents/ 또는 git 인계의 agents/ 아래에 두세요. "
            f"bundle.project.door는 agent, created_by는 당신 이름, edit_spec_id는 {record['id']}. "
            f"127.0.0.1에는 접속하지 마세요. 규칙: local_studio/handoff-guide.json."
            if language.startswith("ko")
            else (
                f"This is the other-agent door. You are not Grok. "
                f"Do not use the Grok door, Runner pairing, or handoff-inbox/grok/. "
                f"You are {agent}, or Claude, Codex, ChatGPT, Gemini, Cursor, or another non-Grok agent.\n\n"
                f"{common}\n"
                f"The operator will not attach footage. You supply the source and the cut.\n"
                f"This spec is in the outbox at local_studio/workspace/handoff-outbox/agents/{record['id']}/. "
                f"On git read spec.json under outbox/agents/{record['id']}/.\n"
                f"On the same PC re-read this with "
                f"`python local_studio/grok_crew.py spec brief --id {record['id']}` and use the CLI.\n"
                f"Put the finished package in local_studio/workspace/handoff-inbox/agents/ "
                f"or under agents/ on the git handoff repo. "
                f"Set bundle.project.door to agent, created_by to your name, edit_spec_id to {record['id']}. "
                f"Do not connect to 127.0.0.1. Rules: local_studio/handoff-guide.json."
            )
        )
    return {"spec": record, "text": text, "channel": f"{door}-door", "door": door, "agent": agent}

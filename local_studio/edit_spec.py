"""Operator edit specs: the person names the cut; the bot supplies source and edit."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from config import utc_now
from db import db, row_dict
from style_recipes import (
    MAX_DURATION_SECONDS,
    apply_recipe_defaults,
    needs_collector,
    normalize_source_mode,
    recipe_label,
    snapshot_recipe,
    take_owned_paths,
)

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
OWN_SOURCE_RULE = "The operator put clips in handoff-materials. The editor cuts those clips."
OWN_AND_COLLECT_RULE = (
    "The operator put owned clips in handoff-materials. "
    "The collector adds matching clips. The editor cuts both."
)
EDITOR_DOOR = "editor"
COLLECTOR_DOOR = "collector"
DOORS = (EDITOR_DOOR, COLLECTOR_DOOR)
DOOR_FOLDERS = {EDITOR_DOOR: "editor", COLLECTOR_DOOR: "collector"}
LEGACY_DOOR_FOLDERS = {EDITOR_DOOR: ("grok",), COLLECTOR_DOOR: ("agents", "agent")}
EDITOR_DOOR_ALIASES = {"editor", "edit", "editor-agent", "grok", "grok-bot", "grokbot"}
COLLECTOR_DOOR_ALIASES = {"collector", "collect", "collector-agent", "agent", "agents", "other", "other-agent", "other-agents"}
ROLES = ("collect", "edit")
EDITOR_AGENT = "Editor Agent"
COLLECTOR_AGENT = "Collector Agent"
CREW_ROLES = {
    "collect": {"door": COLLECTOR_DOOR, "default_agent": COLLECTOR_AGENT},
    "edit": {"door": EDITOR_DOOR, "default_agent": EDITOR_AGENT},
}
COLLECT_PURPOSE_HINTS = ("collect", "collector", "gather", "scrape", "scraping", "research", "materials")
EDIT_PURPOSE_HINTS = ("edit", "editor", "cut", "edit_video", "render")


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
        return EDITOR_DOOR
    if text in EDITOR_DOOR_ALIASES:
        return EDITOR_DOOR
    if text in COLLECTOR_DOOR_ALIASES:
        return COLLECTOR_DOOR
    raise ValueError("door must be editor or collector.")


def door_folder(door: str) -> str:
    return DOOR_FOLDERS[normalize_door(door, required=True)]


def door_folder_aliases(door: str) -> tuple[str, ...]:
    normalized = normalize_door(door, required=True)
    return (DOOR_FOLDERS[normalized],) + LEGACY_DOOR_FOLDERS.get(normalized, ())


def default_agent_for_door(door: str) -> str:
    return EDITOR_AGENT if normalize_door(door) == EDITOR_DOOR else COLLECTOR_AGENT


def default_agent_for_role(role: str) -> str:
    return COLLECTOR_AGENT if role == "collect" else EDITOR_AGENT


def normalize_agent(_value: Any, door: str) -> str:
    """Role label only. Brands and typed names do not become the role."""
    return default_agent_for_door(door)


def resolve_sender(project: dict[str, Any], spec: dict[str, Any] | None = None) -> tuple[str, str]:
    """Return (door, agent) for an incoming package or saved spec."""
    raw_door = project.get("door") if isinstance(project, dict) else None
    if raw_door not in (None, ""):
        door = normalize_door(raw_door, required=True)
    else:
        created = agent_key((project or {}).get("created_by") or (project or {}).get("agent"))
        if created in EDITOR_DOOR_ALIASES:
            door = EDITOR_DOOR
        elif created:
            door = COLLECTOR_DOOR
        elif spec:
            door = normalize_door(spec.get("door"))
        else:
            door = EDITOR_DOOR
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


def _duration_range(value: Any, default: dict[str, int]) -> dict[str, int]:
    if isinstance(value, (int, float)):
        seconds = int(value)
        duration = {"min": seconds, "max": seconds}
    elif isinstance(value, dict):
        duration = {
            "min": int(value.get("min") or default["min"]),
            "max": int(value.get("max") or default["max"]),
        }
    else:
        duration = {"min": int(default["min"]), "max": int(default["max"])}
    if duration["min"] < 1 or duration["max"] > MAX_DURATION_SECONDS or duration["min"] > duration["max"]:
        raise ValueError(f"duration_seconds must be between 1 and {MAX_DURATION_SECONDS} seconds.")
    return duration


def _clip_count_range(value: Any, default: dict[str, int] | None = None) -> dict[str, int]:
    fallback = default or {"min": 3, "max": 8}
    if isinstance(value, (int, float)):
        count = max(1, int(value))
        return {"min": count, "max": count}
    if isinstance(value, dict):
        low = int(value.get("min") or fallback["min"])
        high = int(value.get("max") or fallback["max"])
    else:
        low, high = int(fallback["min"]), int(fallback["max"])
    if low < 1 or high > 40 or low > high:
        raise ValueError("collect_clip_count must be between 1 and 40.")
    return {"min": low, "max": high}


def source_mode_of(spec: dict[str, Any] | None) -> str:
    payload = spec if isinstance(spec, dict) else {}
    raw = payload.get("source_mode")
    if raw not in (None, ""):
        return str(raw)
    return "collect" if payload.get("crew") else "bot"


def normalize_spec(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("Edit spec must be a JSON object.")
    filled, recipe = apply_recipe_defaults(body)
    title = str(filled.get("title") or "").strip()[:120]
    goal = str(filled.get("goal") or "").strip()[:2000]
    if not title:
        raise ValueError("title is required.")
    if not goal:
        raise ValueError("goal is required.")
    platform = str(filled.get("platform") or "reels_tiktok_shorts").strip()
    if platform not in PLATFORMS:
        raise ValueError("platform must be reels_tiktok_shorts, feed_square, or landscape.")
    default_duration = (recipe or {}).get("duration_seconds") or {"min": 12, "max": 30}
    duration = _duration_range(filled.get("duration_seconds"), default_duration)
    language = str(filled.get("language") or "ko").strip().lower()[:8] or "ko"
    owned_hint = bool(take_owned_paths(body))
    crew_requested = _as_bool(filled.get("crew"), False) or filled.get("collector") not in (None, "")
    source_mode = normalize_source_mode(filled.get("source_mode"), crew=crew_requested, has_owned=owned_hint)
    crew = needs_collector(source_mode)
    collect_default = ((recipe or {}).get("collect") or {}).get("clip_count")
    collect_query = str(filled.get("collect_query") or "").strip()[:400]
    collect_clip_count = _clip_count_range(filled.get("collect_clip_count"), collect_default) if crew else None
    common = {
        "schema": SCHEMA,
        "title": title,
        "goal": goal,
        "platform": platform,
        "aspect": PLATFORMS[platform],
        "duration_seconds": duration,
        "captions": _as_bool(filled.get("captions"), True),
        "look": str(filled.get("look") or "").strip()[:400],
        "must_keep": str(filled.get("must_keep") or "").strip()[:800],
        "must_drop": str(filled.get("must_drop") or "").strip()[:800],
        "upload": _as_bool(filled.get("upload"), False),
        "language": language,
        "source_mode": source_mode,
        "collect_query": collect_query,
        "collect_clip_count": collect_clip_count,
        "recipe_id": recipe["id"] if recipe else "",
        "recipe_version": recipe["version"] if recipe else None,
        "recipe": snapshot_recipe(recipe) if recipe else None,
    }
    if crew:
        collector_agent = normalize_agent(filled.get("collector") or filled.get("agent") or CREW_ROLES["collect"]["default_agent"], COLLECTOR_DOOR)
        editor_agent = normalize_agent(filled.get("editor") or CREW_ROLES["edit"]["default_agent"], EDITOR_DOOR)
        owner = "operator+collector" if source_mode == "own_and_collect" else "collector"
        rule = OWN_AND_COLLECT_RULE if source_mode == "own_and_collect" else CREW_SOURCE_RULE
        return {
            **common,
            "crew": True,
            "door": EDITOR_DOOR,
            "agent": editor_agent,
            "collector": {"role": "collect", "door": COLLECTOR_DOOR, "agent": collector_agent},
            "editor": {"role": "edit", "door": EDITOR_DOOR, "agent": editor_agent},
            "source": {"owner": owner, "rule": rule, "box": "handoff-materials"},
        }
    door = normalize_door(filled.get("door"))
    agent = normalize_agent(filled.get("agent"), door)
    if source_mode == "own":
        return {
            **common,
            "crew": False,
            "door": EDITOR_DOOR,
            "agent": normalize_agent(filled.get("editor") or CREW_ROLES["edit"]["default_agent"], EDITOR_DOOR),
            "editor": {"role": "edit", "door": EDITOR_DOOR, "agent": normalize_agent(filled.get("editor") or CREW_ROLES["edit"]["default_agent"], EDITOR_DOOR)},
            "source": {"owner": "operator", "rule": OWN_SOURCE_RULE, "box": "handoff-materials"},
        }
    return {
        **common,
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
    source_mode = source_mode_of(spec)
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
        "door": normalize_door(spec.get("door") or EDITOR_DOOR),
        "agent": spec.get("agent") or default_agent_for_door(spec.get("door") or EDITOR_DOOR),
        "crew": bool(spec.get("crew")),
        "source_mode": source_mode,
        "recipe_id": spec.get("recipe_id") or "",
        "recipe_version": spec.get("recipe_version"),
        "collect_query": spec.get("collect_query") or "",
        "collector": spec.get("collector") if isinstance(spec.get("collector"), dict) else None,
        "editor": spec.get("editor") if isinstance(spec.get("editor"), dict) else None,
    }


def _initial_status(spec: dict[str, Any]) -> str:
    mode = source_mode_of(spec)
    if needs_collector(mode):
        return "waiting_for_collector"
    if mode == "own":
        return "waiting_for_editor"
    return "waiting_for_bot"


def create_spec(body: dict[str, Any]) -> dict[str, Any]:
    owned_paths = take_owned_paths(body if isinstance(body, dict) else {})
    spec = normalize_spec(body)
    spec_id = str(uuid.uuid4())
    now = utc_now()
    status = _initial_status(spec)
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
        role = "edit" if source_mode_of(spec) == "own" else None
        record["outbox"] = write_outbox(record, role=role)
    if owned_paths:
        from handoff_materials import write_owned_materials

        materials = write_owned_materials(spec_id, owned_paths)
        refreshed = get_spec(spec_id) or record
        refreshed["outbox"] = record.get("outbox")
        refreshed["materials"] = materials
        return refreshed
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


def _recipe_block(spec: dict[str, Any], language: str) -> str:
    recipe = spec.get("recipe") if isinstance(spec.get("recipe"), dict) else {}
    recipe_id = spec.get("recipe_id") or recipe.get("id")
    if not recipe_id:
        return ""
    name = recipe_label(recipe, language) or str(recipe_id)
    version = spec.get("recipe_version") or recipe.get("version") or 1
    hook = recipe.get("hook") if isinstance(recipe.get("hook"), dict) else {}
    pacing = recipe.get("pacing") if isinstance(recipe.get("pacing"), dict) else {}
    if language.startswith("ko"):
        return (
            f"스타일: {name} ({recipe_id}@{version})\n"
            f"훅: {hook.get('note') or '첫 줄을 강하게'}\n"
            f"속도: {pacing.get('note') or '군더더기 없이'}\n"
            f"자막 결: {recipe.get('caption_style') or '읽기 쉽게'}\n"
        )
    return (
        f"Style: {name} ({recipe_id}@{version})\n"
        f"Hook: {hook.get('note') or 'lead with the strongest line'}\n"
        f"Pacing: {pacing.get('note') or 'cut filler'}\n"
        f"Captions: {recipe.get('caption_style') or 'readable'}\n"
    )


def _collect_hint_block(spec: dict[str, Any], language: str) -> str:
    recipe = spec.get("recipe") if isinstance(spec.get("recipe"), dict) else {}
    collect = recipe.get("collect") if isinstance(recipe.get("collect"), dict) else {}
    query = str(spec.get("collect_query") or collect.get("query") or "").strip()
    counts = spec.get("collect_clip_count") if isinstance(spec.get("collect_clip_count"), dict) else collect.get("clip_count") or {}
    seconds = collect.get("clip_seconds") if isinstance(collect.get("clip_seconds"), dict) else {}
    if language.startswith("ko"):
        lines = [
            "각 클립에 license를 적으세요: operator, stock, public, unknown.",
            "로그인 막힌 인스타/틱톡은 긁지 마세요. 이 책상은 스크래퍼가 아닙니다.",
        ]
        if query:
            lines.insert(0, f"찾아올 것: {query}")
        if counts:
            extra = f"클립 {counts.get('min')}–{counts.get('max')}장"
            if seconds:
                extra += f", 각 {seconds.get('min')}–{seconds.get('max')}초"
            lines.insert(1 if query else 0, extra + ".")
        if source_mode_of(spec) == "own_and_collect":
            lines.append("운영자가 이미 넣은 owned 클립은 지우지 마세요. B롤·커버만 보태세요.")
        return "\n".join(lines) + "\n"
    lines = [
        "Write a license on each clip: operator, stock, public, or unknown.",
        "Do not scrape login-walled Instagram or TikTok. This desk is not a scraper.",
    ]
    if query:
        lines.insert(0, f"Find: {query}")
    if counts:
        extra = f"Clips: {counts.get('min')}–{counts.get('max')}"
        if seconds:
            extra += f", each {seconds.get('min')}–{seconds.get('max')}s"
        lines.insert(1 if query else 0, extra + ".")
    if source_mode_of(spec) == "own_and_collect":
        lines.append("Keep owned clips the operator already put in the materials box. Add matching b-roll only.")
    return "\n".join(lines) + "\n"


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
    agent = str(spec.get("agent") or default_agent_for_door(door))
    requested = normalize_role(role) if role not in (None, "") else ""
    mode = source_mode_of(spec)
    recipe_text = _recipe_block(spec, language)
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
        f"{recipe_text}"
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
            f"{recipe_text}"
        )
    )
    if spec.get("crew"):
        collector = spec.get("collector") if isinstance(spec.get("collector"), dict) else {}
        editor = spec.get("editor") if isinstance(spec.get("editor"), dict) else {}
        collector_name = str(collector.get("agent") or COLLECTOR_AGENT)
        editor_name = str(editor.get("agent") or EDITOR_AGENT)
        collect_hints = _collect_hint_block(spec, language)
        attach_line_ko = (
            "운영자가 원본을 자료함에 일부 넣어 두었습니다. 맞는 클립만 보태세요. "
            if mode == "own_and_collect"
            else "운영자가 원본을 주지 않습니다. 운영자가 쓸 수 있는 출처에서만 클립을 모으세요. "
        )
        attach_line_en = (
            "The operator already put owned clips in the materials box. Add matching clips only. "
            if mode == "own_and_collect"
            else "The operator will not attach footage. Collect only sources the operator may use. "
        )
        collect_text = (
            f"이 글은 수집 역할입니다. 편집할 자료를 모으세요. 최종 컷은 만들지 마세요. "
            f"당신은 {collector_name}입니다. 편집 문(handoff-inbox/editor)과 Runner는 쓰지 마세요.\n\n"
            f"{common}\n"
            f"{collect_hints}"
            f"{attach_line_ko}"
            f"이 책상은 로그인 벽을 넘는 스크래퍼가 아닙니다.\n"
            f"규격은 보낼함 local_studio/workspace/handoff-outbox/collector/{record['id']}/ 에 있습니다. "
            f"git이면 outbox/collector/{record['id']}/ 에서 spec.json 을 읽으세요.\n"
            f"클립과 manifest.json 은 local_studio/workspace/handoff-materials/{record['id']}/ 에 두세요. "
            f"git이면 materials/{record['id']}/ 입니다.\n"
            f"끝난 컷을 인박스에 넣지 마세요. 127.0.0.1에는 접속하지 마세요."
            if language.startswith("ko")
            else (
                f"This is the collector role. Gather source clips. Do not make the final cut. "
                f"You are {collector_name}. Do not use the editor door or Runner.\n\n"
                f"{common}\n"
                f"{collect_hints}"
                f"{attach_line_en}"
                f"This desk is not a scraper for login-walled sites.\n"
                f"This spec is in the outbox at local_studio/workspace/handoff-outbox/collector/{record['id']}/. "
                f"On git read spec.json under outbox/collector/{record['id']}/.\n"
                f"Put clips and manifest.json in local_studio/workspace/handoff-materials/{record['id']}/ "
                f"or under materials/{record['id']}/ on git.\n"
                f"Do not put a finished cut in any inbox. Do not connect to 127.0.0.1."
            )
        )
        edit_attach_ko = (
            "자료함의 클립만 자르세요. 운영자 파일과 수집 클립을 함께 씁니다.\n"
            if mode == "own_and_collect"
            else "Collector Agent가 모은 자료만 자르세요.\n"
        )
        edit_attach_en = (
            "Cut the clips in the materials box. Use owned files and collected clips together.\n"
            if mode == "own_and_collect"
            else "Cut the clips the collector gathered.\n"
        )
        edit_text = (
            f"이 글은 편집 역할입니다. {editor_name}만 이 컷을 만드세요. "
            f"{edit_attach_ko}\n"
            f"{common}\n"
            f"자료는 local_studio/workspace/handoff-materials/{record['id']}/manifest.json 에 있습니다. "
            f"git이면 materials/{record['id']}/ 입니다. 자료가 오기 전에 새 소스를 찾지 마세요.\n"
            f"규격은 보낼함 local_studio/workspace/handoff-outbox/editor/{record['id']}/ 에 있습니다. "
            f"git이면 outbox/editor/{record['id']}/ 에서 spec.json 을 읽으세요.\n"
            f"끝난 패키지는 local_studio/workspace/handoff-inbox/editor/ 또는 git 인계의 editor/ 아래에 두세요. "
            f"bundle.project.door는 editor, created_by는 {editor_name}, edit_spec_id는 {record['id']}. "
            f"collector/ 폴더에는 넣지 마세요. 127.0.0.1에는 접속하지 마세요."
            if language.startswith("ko")
            else (
                f"This is the editor role. Only {editor_name} should make this cut. "
                f"{edit_attach_en}\n"
                f"{common}\n"
                f"Materials are at local_studio/workspace/handoff-materials/{record['id']}/manifest.json "
                f"or materials/{record['id']}/ on git. Do not hunt a new source before those files exist.\n"
                f"This spec is in the outbox at local_studio/workspace/handoff-outbox/editor/{record['id']}/. "
                f"On git read spec.json under outbox/editor/{record['id']}/.\n"
                f"Put the finished package in local_studio/workspace/handoff-inbox/editor/ "
                f"or under editor/ on the git handoff repo. "
                f"Set bundle.project.door to editor, created_by to {editor_name}, edit_spec_id to {record['id']}. "
                f"Do not use the collector/ folder. Do not connect to 127.0.0.1."
            )
        )
        if requested == "collect":
            return {
                "spec": record,
                "text": collect_text,
                "channel": "crew-collect",
                "door": COLLECTOR_DOOR,
                "agent": collector_name,
                "role": "collect",
                "crew": True,
            }
        if requested == "edit":
            return {
                "spec": record,
                "text": edit_text,
                "channel": "crew-edit",
                "door": EDITOR_DOOR,
                "agent": editor_name,
                "role": "edit",
                "crew": True,
            }
        return {
            "spec": record,
            "text": f"{collect_text}\n\n---\n\n{edit_text}",
            "channel": "crew",
            "door": EDITOR_DOOR,
            "agent": editor_name,
            "role": "crew",
            "crew": True,
            "roles": {
                "collect": {"text": collect_text, "door": COLLECTOR_DOOR, "agent": collector_name},
                "edit": {"text": edit_text, "door": EDITOR_DOOR, "agent": editor_name},
            },
        }
    if mode == "own":
        text = (
            f"이 글은 편집 문입니다. {agent}만 이 규격을 이행하세요. "
            f"수집 역할은 다른 문을 쓰세요.\n\n"
            f"{common}\n"
            f"원본은 운영자가 자료함에 둡니다. 그 클립만 자르세요. 새 소스를 찾지 마세요.\n"
            f"자료는 local_studio/workspace/handoff-materials/{record['id']}/manifest.json 에 있습니다.\n"
            f"이 규격은 보낼함 local_studio/workspace/handoff-outbox/editor/{record['id']}/ 에 있습니다. "
            f"git이면 outbox/editor/{record['id']}/ 에서 spec.json 을 읽으세요.\n"
            f"같은 PC면 `python local_studio/grok_crew.py` 와 Bot Check로 체크인하세요. "
            f"데스크톱 Runner 페어링은 편집 문에서만 씁니다.\n"
            f"끝난 패키지는 local_studio/workspace/handoff-inbox/editor/ 또는 git 인계의 editor/ 아래에 두세요. "
            f"bundle.project.door는 editor, created_by는 {agent}, edit_spec_id는 {record['id']}. "
            f"collector/ 폴더에는 넣지 마세요. 127.0.0.1에는 접속하지 마세요."
            if language.startswith("ko")
            else (
                f"This is the editor door. Only {agent} should fulfill this spec. "
                f"A collector must use the other-agent door.\n\n"
                f"{common}\n"
                f"The operator put the footage in the materials box. Cut those clips. Do not hunt a new source.\n"
                f"Materials are at local_studio/workspace/handoff-materials/{record['id']}/manifest.json.\n"
                f"This spec is in the outbox at local_studio/workspace/handoff-outbox/editor/{record['id']}/. "
                f"On git read spec.json under outbox/editor/{record['id']}/.\n"
                f"On the same PC use `python local_studio/grok_crew.py` and Bot Check. "
                f"Desktop Runner pairing is only for this editor door.\n"
                f"Put the finished package in local_studio/workspace/handoff-inbox/editor/ "
                f"or under editor/ on the git handoff repo. "
                f"Set bundle.project.door to editor, created_by to {agent}, edit_spec_id to {record['id']}. "
                f"Do not use the collector/ folder. Do not connect to 127.0.0.1."
            )
        )
        return {"spec": record, "text": text, "channel": "editor-door", "door": EDITOR_DOOR, "agent": agent, "role": "edit"}
    if door == EDITOR_DOOR:
        text = (
            f"이 글은 편집 문입니다. {agent}만 이 규격을 이행하세요. "
            f"수집 역할은 다른 문을 쓰세요.\n\n"
            f"{common}\n"
            f"원본은 운영자가 주지 않습니다. 당신이 소스와 컷을 만드세요.\n"
            f"이 규격은 보낼함 local_studio/workspace/handoff-outbox/editor/{record['id']}/ 에 있습니다. "
            f"git이면 outbox/editor/{record['id']}/ 에서 spec.json 을 읽으세요.\n"
            f"같은 PC면 `python local_studio/grok_crew.py` 와 Bot Check로 체크인하세요. "
            f"데스크톱 Runner 페어링은 편집 문에서만 씁니다.\n"
            f"끝난 패키지는 local_studio/workspace/handoff-inbox/editor/ 또는 git 인계의 editor/ 아래에 두세요. "
            f"bundle.project.door는 editor, created_by는 {agent}, edit_spec_id는 {record['id']}. "
            f"collector/ 폴더에는 넣지 마세요. 127.0.0.1에는 접속하지 마세요."
            if language.startswith("ko")
            else (
                f"This is the editor door. Only {agent} should fulfill this spec. "
                f"A collector must use the other-agent door.\n\n"
                f"{common}\n"
                f"The operator will not attach footage. You supply the source and the cut.\n"
                f"This spec is in the outbox at local_studio/workspace/handoff-outbox/editor/{record['id']}/. "
                f"On git read spec.json under outbox/editor/{record['id']}/.\n"
                f"On the same PC use `python local_studio/grok_crew.py` and Bot Check. "
                f"Desktop Runner pairing is only for this editor door.\n"
                f"Put the finished package in local_studio/workspace/handoff-inbox/editor/ "
                f"or under editor/ on the git handoff repo. "
                f"Set bundle.project.door to editor, created_by to {agent}, edit_spec_id to {record['id']}. "
                f"Do not use the collector/ folder. Do not connect to 127.0.0.1."
            )
        )
    else:
        text = (
            f"이 글은 수집·다른 에이전트 문입니다. 편집 문이 아닙니다. "
            f"편집 문, Runner 페어링, handoff-inbox/editor/ 는 쓰지 마세요. "
            f"당신은 {agent}입니다.\n\n"
            f"{common}\n"
            f"원본은 운영자가 주지 않습니다. 당신이 소스와 컷을 만드세요.\n"
            f"이 규격은 보낼함 local_studio/workspace/handoff-outbox/collector/{record['id']}/ 에 있습니다. "
            f"git이면 outbox/collector/{record['id']}/ 에서 spec.json 을 읽으세요.\n"
            f"같은 PC면 `python local_studio/grok_crew.py spec brief --id {record['id']}` 로 이 글을 읽고 CLI로 작업하세요.\n"
            f"끝난 패키지는 local_studio/workspace/handoff-inbox/collector/ 또는 git 인계의 collector/ 아래에 두세요. "
            f"bundle.project.door는 collector, created_by는 {agent}, edit_spec_id는 {record['id']}. "
            f"127.0.0.1에는 접속하지 마세요. 규칙: local_studio/handoff-guide.json."
            if language.startswith("ko")
            else (
                f"This is the other-agent door. You are not the editor on this spec. "
                f"Do not use the editor door, Runner pairing, or handoff-inbox/editor/. "
                f"You are {agent}.\n\n"
                f"{common}\n"
                f"The operator will not attach footage. You supply the source and the cut.\n"
                f"This spec is in the outbox at local_studio/workspace/handoff-outbox/collector/{record['id']}/. "
                f"On git read spec.json under outbox/collector/{record['id']}/.\n"
                f"On the same PC re-read this with "
                f"`python local_studio/grok_crew.py spec brief --id {record['id']}` and use the CLI.\n"
                f"Put the finished package in local_studio/workspace/handoff-inbox/collector/ "
                f"or under collector/ on the git handoff repo. "
                f"Set bundle.project.door to collector, created_by to {agent}, edit_spec_id to {record['id']}. "
                f"Do not connect to 127.0.0.1. Rules: local_studio/handoff-guide.json."
            )
        )
    return {"spec": record, "text": text, "channel": f"{door}-door", "door": door, "agent": agent}


def _purpose_role(purpose: str) -> str:
    text = str(purpose or "").strip().lower().replace("-", "_")
    if any(hint in text for hint in COLLECT_PURPOSE_HINTS):
        return "collect"
    if any(hint in text for hint in EDIT_PURPOSE_HINTS):
        return "edit"
    return ""


def crew_roster() -> dict[str, Any]:
    """Connected bots stay listed; role slots are always Editor Agent / Collector Agent."""
    now = datetime.now(timezone.utc)
    with db() as conn:
        sessions = conn.execute("SELECT * FROM bot_sessions ORDER BY last_seen DESC LIMIT 40").fetchall()
        entries = conn.execute(
            """SELECT e.bot_id, e.display_name, e.purpose, e.joined_at
               FROM bot_entries e
               INNER JOIN (
                   SELECT bot_id, MAX(joined_at) AS joined_at FROM bot_entries GROUP BY bot_id
               ) latest ON e.bot_id = latest.bot_id AND e.joined_at = latest.joined_at"""
        ).fetchall()
    purpose_by_bot = {str(row["bot_id"]): str(row["purpose"] or "") for row in entries}
    bots: list[dict[str, Any]] = []
    for row in sessions:
        bot = row_dict(row) or {}
        try:
            seen = datetime.fromisoformat(str(bot.get("last_seen") or now.isoformat()))
            seconds = max(0, int((now - seen).total_seconds()))
        except ValueError:
            seconds = 10**9
        detail = bot.get("last_detail_json")
        if isinstance(detail, str):
            try:
                detail = json.loads(detail)
            except json.JSONDecodeError:
                detail = {}
        purpose = str((detail or {}).get("purpose") or purpose_by_bot.get(str(bot.get("bot_id") or "")) or "")
        bots.append({
            "bot_id": bot.get("bot_id"),
            "display_name": str(bot.get("display_name") or bot.get("bot_id") or "").strip(),
            "presence": "active" if seconds <= 300 else "idle",
            "seconds_since_checkin": seconds,
            "purpose": purpose,
            "role_hint": _purpose_role(purpose),
        })
    active = [item for item in bots if item["presence"] == "active"]
    pool = active or bots

    def pick(role: str, taken: str = "") -> dict[str, Any] | None:
        hinted = [item for item in pool if item.get("role_hint") == role and item.get("display_name") != taken]
        if hinted:
            return hinted[0]
        open_bots = [item for item in pool if not item.get("role_hint") and item.get("display_name") != taken]
        if open_bots:
            return open_bots[0]
        leftover = [item for item in pool if item.get("display_name") != taken]
        return leftover[0] if leftover else None

    editor = pick("edit")
    collector = pick("collect", str((editor or {}).get("display_name") or ""))
    return {
        "schema": "grok-crew.crew-roster/v1",
        "bots": bots,
        "suggested_editor": default_agent_for_role("edit") if editor else "",
        "suggested_collector": default_agent_for_role("collect") if collector else "",
    }


def spec_invite(spec_id: str, language: str = "ko") -> dict[str, Any]:
    """Short paste for one bot. No git clone path. The person only copies."""
    record = get_spec(spec_id)
    if not record:
        raise ValueError("Edit spec not found.")
    spec = record.get("spec") if isinstance(record.get("spec"), dict) else {}
    from handoff_inbox import door_inbox_dir
    from style_recipes import RECIPES

    inbox = str(door_inbox_dir(EDITOR_DOOR))
    title = str(spec.get("title") or record.get("title") or "").strip()
    recipe_id = str(spec.get("recipe_id") or "instagram_reel")
    duration = spec.get("duration_seconds") if isinstance(spec.get("duration_seconds"), dict) else {}
    low = int(duration.get("min") or 21)
    high = int(duration.get("max") or 30)
    recipe_name = recipe_label(RECIPES.get(recipe_id) or {"id": recipe_id, "name": {}}, language)
    lang = (language or "ko").strip().lower()
    if lang.startswith("ko"):
        text = (
            f"이 컴퓨터의 Grok Crew 책상이 켜져 있습니다.\n"
            f"제목: {title}\n"
            f"형태: {recipe_name}, 세로, {low}–{high}초.\n"
            f"원본과 첫 컷을 당신이 만듭니다. 운영자는 영상을 주지 않습니다.\n\n"
            f"같은 컴퓨터에서 명령할 수 있으면:\n"
            f"  python grok-crew.py entry --bot-id desk-bot --display-name \"당신의 이름\" --purpose edit_video\n"
            f"  (스크립트는 http://127.0.0.1:7214/downloads/grok-crew.py)\n\n"
            f"끝난 패키지는 이 폴더에 둡니다:\n"
            f"  {inbox}\n"
            f"127.0.0.1 말고는 붙지 마세요."
        )
    else:
        text = (
            f"Grok Crew is open on this computer.\n"
            f"Title: {title}\n"
            f"Shape: {recipe_name}, vertical, {low}–{high}s.\n"
            f"You make the source and the first cut. The operator will not attach footage.\n\n"
            f"If you can run a command on this computer:\n"
            f"  python grok-crew.py entry --bot-id desk-bot --display-name \"your name\" --purpose edit_video\n"
            f"  (script: http://127.0.0.1:7214/downloads/grok-crew.py)\n\n"
            f"Put the finished package in this folder:\n"
            f"  {inbox}\n"
            f"Do not connect anywhere except 127.0.0.1."
        )
    return {
        "schema": "grok-crew.spec-invite/v1",
        "spec": record,
        "text": text,
        "inbox_dir": inbox,
        "language": lang[:2],
    }

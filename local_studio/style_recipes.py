"""Named style recipes: platform numbers plus the edit habit behind them.

A recipe is not a door. The same pack goes to the collector (what to find)
and to Grok (how to cut). This desk does not scrape websites.
"""

from __future__ import annotations

from typing import Any

RECIPE_SCHEMA = "grok-crew.style-recipe/v1"
SOURCE_MODES = ("collect", "own", "own_and_collect", "bot")
LICENSES = ("operator", "stock", "public", "unknown")
ORIGINS = ("owned", "collected", "bundled-sample")
MAX_DURATION_SECONDS = 1200

RECIPES: dict[str, dict[str, Any]] = {
    "instagram_reel": {
        "id": "instagram_reel",
        "version": 1,
        "name": {"ko": "인스타 릴", "en": "Instagram Reel", "zh": "Instagram Reel", "ja": "Instagram リール"},
        "summary": {
            "ko": "첫 줄 훅, 중간 속도, 끝에 한 줄 CTA. 30초 세로.",
            "en": "Hook on the first line, medium pace, a one-line CTA at the end.",
            "zh": "第一句钩子，中等节奏，结尾一句行动号召。",
            "ja": "最初の一文でフック。中くらいの速さ。終わりに一言 CTA。",
        },
        "platform": "reels_tiktok_shorts",
        "aspect": "9:16",
        "duration_seconds": {"min": 21, "max": 30},
        "captions": True,
        "caption_style": "center, one readable line",
        "look": "clean contrast, not muddy, not over-graded",
        "must_keep": "the opening ask and the last call to action",
        "must_drop": "silence, retakes, long b-roll that does not move the ask",
        "hook": {"seconds": 2.0, "note": "Put the strongest line in the first two seconds."},
        "pacing": {"shot_seconds": [1.8, 3.2], "note": "Medium cuts. Leave a breath on the CTA."},
        "collect": {
            "query": "face or product close-up, readable text space, bright vertical clip",
            "clip_count": {"min": 3, "max": 8},
            "clip_seconds": {"min": 3, "max": 12},
            "prefer": "faces, hands, one clear subject, room for a caption",
        },
        "edit": {
            "cta": "one short line at the end",
            "no_logo_intro": True,
            "filler": "remove",
        },
    },
    "tiktok_tight": {
        "id": "tiktok_tight",
        "version": 1,
        "name": {"ko": "틱톡 빠른 컷", "en": "TikTok tight cut", "zh": "TikTok 快剪", "ja": "TikTok 速いカット"},
        "summary": {
            "ko": "더 짧은 샷, 빈 프레임 거의 없음, 큰 자막. 21초.",
            "en": "Shorter shots, almost no empty frames, large captions.",
            "zh": "镜头更短，几乎不留空镜，字幕更大。",
            "ja": "ショットを短く。空きフレームはほぼ無し。字幕は大きく。",
        },
        "platform": "reels_tiktok_shorts",
        "aspect": "9:16",
        "duration_seconds": {"min": 15, "max": 21},
        "captions": True,
        "caption_style": "large, center, one line",
        "look": "high contrast, punchy, cut on the beat",
        "must_keep": "the first-second hook and every line that advances the ask",
        "must_drop": "pauses, logos, long establishing shots, unused b-roll",
        "hook": {"seconds": 1.2, "note": "The first 1.2 seconds must carry the hook."},
        "pacing": {"shot_seconds": [1.4, 2.2], "note": "Tight cuts. Do not hold a still frame."},
        "collect": {
            "query": "tight close-up, hands, face, quick action, vertical, little dead space",
            "clip_count": {"min": 4, "max": 10},
            "clip_seconds": {"min": 2, "max": 8},
            "prefer": "close-ups, motion, faces, clips that can be cut every two seconds",
        },
        "edit": {
            "cta": "optional last beat, no logo intro",
            "no_logo_intro": True,
            "filler": "remove",
        },
    },
    "youtube_short": {
        "id": "youtube_short",
        "version": 1,
        "name": {"ko": "유튜브 쇼츠", "en": "YouTube Short", "zh": "YouTube Shorts", "ja": "YouTube ショート"},
        "summary": {
            "ko": "훅 다음 한 가지 설명, 끝에 이어보기. 38초 세로.",
            "en": "Hook, one explanation, a follow-on at the end.",
            "zh": "钩子、只讲一件事、结尾引导下一条。",
            "ja": "フックのあと説明は一つ。終わりに続きを促す。",
        },
        "platform": "reels_tiktok_shorts",
        "aspect": "9:16",
        "duration_seconds": {"min": 30, "max": 38},
        "captions": True,
        "caption_style": "lower third, readable, not covering the face",
        "look": "clear, slightly warmer, not a harsh TikTok grade",
        "must_keep": "the hook, the one explanation, the follow-on line",
        "must_drop": "second topics, long pauses, unused angles",
        "hook": {"seconds": 2.0, "note": "Hook first, then one explanation only."},
        "pacing": {"shot_seconds": [2.0, 3.6], "note": "A little more room than TikTok. Still vertical."},
        "collect": {
            "query": "talking face, one demo action, vertical, caption space at the bottom",
            "clip_count": {"min": 3, "max": 8},
            "clip_seconds": {"min": 4, "max": 15},
            "prefer": "a presenter plus one supporting action, not a montage dump",
        },
        "edit": {
            "cta": "subscribe or watch next, last two seconds",
            "no_logo_intro": True,
            "filler": "remove",
        },
    },
    "youtube_long": {
        "id": "youtube_long",
        "version": 1,
        "name": {"ko": "유튜브 본편", "en": "YouTube long", "zh": "YouTube 长视频", "ja": "YouTube 本編"},
        "summary": {
            "ko": "짧은 인트로, 챕터, B롤, 아웃로. 8–12분 가로.",
            "en": "Short intro, chapters, b-roll, outro. Landscape, 8–12 minutes.",
            "zh": "短片头、章节、B-roll、片尾。横屏 8–12 分钟。",
            "ja": "短いイントロ、章、Bロール、アウトロ。8–12分の横。",
        },
        "platform": "landscape",
        "aspect": "16:9",
        "duration_seconds": {"min": 480, "max": 720},
        "captions": True,
        "caption_style": "classic lower-third, not center-punch",
        "look": "natural, watchable for minutes, not a short-form grade",
        "must_keep": "the promise in the intro, each chapter beat, the outro ask",
        "must_drop": "long dead air, repeated takes, a logo bumper longer than three seconds",
        "hook": {"seconds": 15.0, "note": "State the promise in the first 15 seconds. No long logo."},
        "pacing": {"shot_seconds": [4.0, 12.0], "note": "Chapter the cut. Use b-roll on holds."},
        "collect": {
            "query": "talking head, supporting b-roll, wide and close, landscape 16:9",
            "clip_count": {"min": 6, "max": 16},
            "clip_seconds": {"min": 8, "max": 45},
            "prefer": "A-roll plus b-roll that can cover chapter holds",
        },
        "edit": {
            "cta": "outro subscribe / next video",
            "no_logo_intro": True,
            "chapters": True,
            "filler": "trim, do not strip every breath",
        },
    },
}


def recipe_ids() -> tuple[str, ...]:
    return tuple(RECIPES)


def get_recipe(recipe_id: Any) -> dict[str, Any]:
    key = str(recipe_id or "").strip().lower().replace("-", "_")
    recipe = RECIPES.get(key)
    if recipe is None:
        raise ValueError("recipe_id must be instagram_reel, tiktok_tight, youtube_short, or youtube_long.")
    return recipe


def snapshot_recipe(recipe: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": RECIPE_SCHEMA,
        "id": recipe["id"],
        "version": recipe["version"],
        "name": recipe["name"],
        "hook": recipe["hook"],
        "pacing": recipe["pacing"],
        "caption_style": recipe["caption_style"],
        "collect": recipe["collect"],
        "edit": recipe["edit"],
    }


def public_recipe(recipe: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": RECIPE_SCHEMA,
        "id": recipe["id"],
        "version": recipe["version"],
        "name": recipe["name"],
        "summary": recipe["summary"],
        "platform": recipe["platform"],
        "aspect": recipe["aspect"],
        "duration_seconds": recipe["duration_seconds"],
        "captions": recipe["captions"],
        "caption_style": recipe["caption_style"],
        "look": recipe["look"],
        "must_keep": recipe["must_keep"],
        "must_drop": recipe["must_drop"],
        "hook": recipe["hook"],
        "pacing": recipe["pacing"],
        "collect": recipe["collect"],
        "edit": recipe["edit"],
    }


def list_recipes() -> list[dict[str, Any]]:
    return [public_recipe(RECIPES[key]) for key in RECIPES]


def apply_recipe_defaults(body: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    filled = dict(body)
    raw = filled.get("recipe_id") if filled.get("recipe_id") not in (None, "") else filled.get("recipe")
    if raw in (None, ""):
        return filled, None
    recipe = get_recipe(raw)
    filled["recipe_id"] = recipe["id"]
    if filled.get("platform") in (None, ""):
        filled["platform"] = recipe["platform"]
    if filled.get("duration_seconds") in (None, ""):
        filled["duration_seconds"] = dict(recipe["duration_seconds"])
    if "captions" not in body:
        filled["captions"] = recipe["captions"]
    if not str(filled.get("look") or "").strip():
        filled["look"] = recipe["look"]
    if not str(filled.get("must_keep") or "").strip():
        filled["must_keep"] = recipe["must_keep"]
    if not str(filled.get("must_drop") or "").strip():
        filled["must_drop"] = recipe["must_drop"]
    if not str(filled.get("collect_query") or "").strip():
        filled["collect_query"] = recipe["collect"]["query"]
    if filled.get("collect_clip_count") in (None, ""):
        filled["collect_clip_count"] = dict(recipe["collect"]["clip_count"])
    return filled, recipe


def normalize_source_mode(value: Any, *, crew: bool = False, has_owned: bool = False) -> str:
    text = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "collect": "collect",
        "collector": "collect",
        "gather": "collect",
        "own": "own",
        "operator": "own",
        "local": "own",
        "mine": "own",
        "owned": "own",
        "own_and_collect": "own_and_collect",
        "both": "own_and_collect",
        "owned_and_collect": "own_and_collect",
        "bot": "bot",
    }
    if text in aliases:
        mode = aliases[text]
    elif text == "":
        if has_owned and crew:
            mode = "own_and_collect"
        elif has_owned:
            mode = "own"
        elif crew:
            mode = "collect"
        else:
            mode = "bot"
    else:
        raise ValueError("source_mode must be collect, own, or own_and_collect.")
    if mode == "bot" and has_owned:
        return "own"
    if mode == "collect" and has_owned:
        return "own_and_collect"
    return mode


def needs_collector(source_mode: str) -> bool:
    return source_mode in {"collect", "own_and_collect"}


def normalize_license(value: Any, *, default: str = "unknown") -> str:
    text = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if text in {"", "unset", "none"}:
        return default
    if text in {"operator", "owned", "owner", "me", "mine", "local"}:
        return "operator"
    if text in {"stock", "getty", "shutterstock", "licensed"}:
        return "stock"
    if text in {"public", "cc", "cc0", "public_domain", "commons"}:
        return "public"
    if text in {"unknown"}:
        return "unknown"
    return "unknown"


def normalize_origin(value: Any, *, license_value: str = "") -> str:
    text = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if text in {"owned", "operator", "local", "mine"}:
        return "owned"
    if text in {"collected", "collector", "scraped", "gathered"}:
        return "collected"
    if text in {"bundled-sample", "bundled_sample", "demo", "sample"}:
        return "bundled-sample"
    if license_value == "operator":
        return "owned"
    return "collected"


def take_owned_paths(body: dict[str, Any]) -> list[str]:
    raw = body.get("owned_paths")
    if raw in (None, ""):
        raw = body.get("owned")
    if raw in (None, ""):
        return []
    if isinstance(raw, str):
        items = [line.strip() for line in raw.splitlines() if line.strip()]
    elif isinstance(raw, list):
        items = [str(item).strip() for item in raw if str(item).strip()]
    else:
        raise ValueError("owned_paths must be a list of local file paths.")
    return items[:40]


def recipe_label(recipe: dict[str, Any], language: str) -> str:
    names = recipe.get("name") if isinstance(recipe.get("name"), dict) else {}
    lang = (language or "en")[:2]
    return str(names.get(lang) or names.get("en") or recipe.get("id") or "")

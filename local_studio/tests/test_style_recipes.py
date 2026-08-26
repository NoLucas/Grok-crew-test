"""Style recipes, source modes, and licensed materials."""
import json
from pathlib import Path

import config
from edit_spec import create_spec, spec_brief
from handoff_materials import MATERIALS_SCHEMA, apply_materials_folder, materials_status, write_owned_materials
from handoff_outbox import outbox_status
from style_recipes import list_recipes


def test_recipe_fills_platform_duration_and_brief(studio):
    record = create_spec({
        "title": "Tight cafe",
        "goal": "Open with the pour",
        "language": "en",
        "recipe_id": "tiktok_tight",
        "crew": True,
        "collector": "Claude",
    })
    spec = record["spec"]
    assert spec["recipe_id"] == "tiktok_tight"
    assert spec["recipe_version"] == 1
    assert spec["platform"] == "reels_tiktok_shorts"
    assert spec["duration_seconds"] == {"min": 15, "max": 21}
    assert spec["collect_query"]
    collect = spec_brief(record["id"], role="collect")
    edit = spec_brief(record["id"], role="edit")
    assert "tiktok_tight@1" in collect["text"]
    assert spec["collect_query"] in collect["text"]
    assert "license" in collect["text"]
    assert "Do not scrape login-walled" in collect["text"]
    assert "tiktok_tight@1" in edit["text"]


def test_youtube_long_allows_twelve_minutes(studio):
    record = create_spec({
        "title": "Long explainer",
        "goal": "Teach one idea",
        "language": "en",
        "recipe_id": "youtube_long",
        "crew": True,
    })
    spec = record["spec"]
    assert spec["platform"] == "landscape"
    assert spec["aspect"] == "16:9"
    assert spec["duration_seconds"]["min"] == 480
    assert spec["duration_seconds"]["max"] == 720


def test_own_mode_skips_collector_outbox(studio, tmp_path):
    clip = tmp_path / "talk.mp4"
    clip.write_bytes(b"owned-bytes")
    record = create_spec({
        "title": "My talk",
        "goal": "Cut the ask",
        "language": "en",
        "recipe_id": "instagram_reel",
        "source_mode": "own",
        "owned_paths": [str(clip)],
    })
    assert record["crew"] is False
    assert record["source_mode"] == "own"
    assert record["status"] == "waiting_for_editor"
    assert record["spec"]["source"]["owner"] == "operator"
    assert not (config.WORKSPACE_DIR / "handoff-outbox" / "collector" / record["id"]).exists()
    assert (config.WORKSPACE_DIR / "handoff-outbox" / "editor" / record["id"] / "spec.json").is_file()
    assert record["id"] not in {item["id"] for item in outbox_status()["doors"]["collector"]["pending"]}
    assert record["id"] in {item["id"] for item in outbox_status()["doors"]["editor"]["pending"]}
    folder = config.WORKSPACE_DIR / "handoff-materials" / record["id"]
    payload = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    assert payload["clips"][0]["origin"] == "owned"
    assert payload["clips"][0]["license"] == "operator"
    assert (folder / "talk.mp4").read_bytes() == b"owned-bytes"
    brief = spec_brief(record["id"])
    assert "materials box" in brief["text"]
    assert "will not attach footage" not in brief["text"]
    assert "Do not hunt a new source" in brief["text"]


def test_own_and_collect_keeps_owned_when_collector_arrives(studio, tmp_path):
    owned = tmp_path / "a-roll.mp4"
    owned.write_bytes(b"a-roll")
    record = create_spec({
        "title": "Both sources",
        "goal": "A-roll plus b-roll",
        "language": "en",
        "recipe_id": "youtube_short",
        "source_mode": "own_and_collect",
        "owned_paths": [str(owned)],
        "collector": "Codex",
    })
    assert record["crew"] is True
    assert record["status"] == "waiting_for_collector"
    assert (config.WORKSPACE_DIR / "handoff-outbox" / "collector" / record["id"]).exists()
    incoming = tmp_path / "collected"
    incoming.mkdir()
    (incoming / "broll.mp4").write_bytes(b"b-roll")
    (incoming / "manifest.json").write_text(json.dumps({
        "schema": MATERIALS_SCHEMA,
        "edit_spec_id": record["id"],
        "agent": "Codex",
        "clips": [{
            "file": "broll.mp4",
            "origin": "collected",
            "license": "stock",
            "note": "Allowed stock clip",
        }],
    }), encoding="utf-8")
    result = apply_materials_folder(incoming, record["id"])
    assert result["ok"] is True
    payload = json.loads((config.WORKSPACE_DIR / "handoff-materials" / record["id"] / "manifest.json").read_text(encoding="utf-8"))
    files = {item["file"]: item for item in payload["clips"]}
    assert files["a-roll.mp4"]["origin"] == "owned"
    assert files["a-roll.mp4"]["license"] == "operator"
    assert files["broll.mp4"]["origin"] == "collected"
    assert files["broll.mp4"]["license"] == "stock"
    collect = spec_brief(record["id"], role="collect")
    assert "owned clips" in collect["text"]
    assert "youtube_short@1" in collect["text"]


def test_collector_omitted_license_is_unknown(studio, tmp_path):
    record = create_spec({
        "title": "Unknown source",
        "goal": "Flag the license",
        "language": "en",
        "crew": True,
    })
    incoming = tmp_path / "bare"
    incoming.mkdir()
    (incoming / "clip.mp4").write_bytes(b"maybe")
    (incoming / "manifest.json").write_text(json.dumps({
        "schema": MATERIALS_SCHEMA,
        "edit_spec_id": record["id"],
        "clips": [{"file": "clip.mp4"}],
    }), encoding="utf-8")
    result = apply_materials_folder(incoming, record["id"])
    assert result["ok"] is True
    payload = json.loads(Path(result["path"]).joinpath("manifest.json").read_text(encoding="utf-8"))
    assert payload["clips"][0]["license"] == "unknown"
    assert payload["unknown_license_count"] == 1
    status = materials_status()
    assert status["has_unknown_license"] is True
    assert status["unknown_license_count"] >= 1


def test_own_files_rejected_on_collect_only_spec(studio, tmp_path):
    record = create_spec({
        "title": "Collect only",
        "goal": "No operator files",
        "language": "en",
        "crew": True,
    })
    clip = tmp_path / "nope.mp4"
    clip.write_bytes(b"x")
    try:
        write_owned_materials(record["id"], [str(clip)])
    except ValueError as exc:
        assert "own" in str(exc)
    else:
        raise AssertionError("collect-only specs must not accept owned files")


def test_http_lists_recipes(live_server):
    from urllib.request import urlopen

    payload = json.loads(urlopen(f"{live_server}/api/v2/style-recipes").read().decode())
    ids = {item["id"] for item in payload["recipes"]}
    assert ids == {item["id"] for item in list_recipes()}
    assert {"instagram_reel", "tiktok_tight", "youtube_short", "youtube_long"} <= ids

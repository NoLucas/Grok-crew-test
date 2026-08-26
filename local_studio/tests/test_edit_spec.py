import io
import json
import zipfile
from urllib.request import Request, urlopen

import pytest

import config
from edit_spec import create_spec, normalize_agent, resolve_sender, spec_brief, spec_invite
from handoff_inbox import apply_package_local, media_relpaths, pull_handoff, write_demo_package
import first_run


def test_spec_requires_title_and_goal(studio):
    with pytest.raises(ValueError, match="title"):
        create_spec({"goal": "Keep the hook"})
    with pytest.raises(ValueError, match="goal"):
        create_spec({"title": "Hook reel"})


def test_spec_marks_bot_as_source_owner(studio):
    record = create_spec({"title": "Hook reel", "goal": "Keep only the ask", "language": "en"})
    assert record["status"] == "waiting_for_bot"
    assert record["door"] == "editor"
    assert record["spec"]["source"]["owner"] == "bot"
    brief = spec_brief(record["id"])
    assert record["id"] in brief["text"]
    assert "will not attach footage" in brief["text"]
    assert "editor door" in brief["text"]
    assert "handoff-outbox/editor" in brief["text"]
    assert "handoff-inbox/editor" in brief["text"]
    assert "Do not use the collector/ folder" in brief["text"]
    assert brief["operator_locks"]["aspect"] == "9:16"
    assert brief["operator_locks"]["captions"] is True
    assert "Do not change those three" in brief["text"]
    assert "Right-click" in brief["text"]
    assert brief["folder_board"]["actions"] == ["preview", "enlarge", "reveal_original", "delete"]


def test_agent_door_brief_excludes_grok_inbox(studio):
    record = create_spec({
        "title": "Agent reel",
        "goal": "Keep only the ask",
        "language": "en",
        "door": "agent",
        "agent": "Claude",
    })
    assert record["door"] == "collector"
    brief = spec_brief(record["id"])
    assert brief["door"] == "collector"
    assert "other-agent door" in brief["text"]
    assert "handoff-outbox/collector" in brief["text"]
    assert "handoff-inbox/collector" in brief["text"]
    assert "Do not use the editor door" in brief["text"]
    assert "Desktop Runner pairing is only" not in brief["text"]
    assert "Collector Agent" in brief["text"]
    assert "Claude" not in brief["text"]


def test_role_names_are_editor_and_collector_agent():
    assert normalize_agent("grok", "grok") == "Editor Agent"
    assert normalize_agent("claude-code", "agent") == "Collector Agent"
    assert normalize_agent("Codex", "agent") == "Collector Agent"
    assert normalize_agent("Nova", "agent") == "Collector Agent"
    assert normalize_agent("Orion", "grok") == "Editor Agent"
    assert normalize_agent("Claude", "grok") == "Editor Agent"
    assert normalize_agent("Grok", "agent") == "Collector Agent"
    assert normalize_agent("", "grok") == "Editor Agent"
    assert normalize_agent("", "agent") == "Collector Agent"
    assert resolve_sender({"door": "agent", "created_by": "Claude"}) == ("collector", "Collector Agent")
    assert resolve_sender({"door": "grok", "created_by": "Claude"}) == ("editor", "Editor Agent")
    assert resolve_sender({"door": "grok", "created_by": "Orion"}) == ("editor", "Editor Agent")
    assert resolve_sender({"door": "editor", "created_by": "Nova"}) == ("editor", "Editor Agent")
    assert resolve_sender({"door": "collector", "created_by": "Orion"}) == ("collector", "Collector Agent")
    assert resolve_sender({"door": "editor", "created_by": "Cursor"}) == ("editor", "Editor Agent")
    assert normalize_agent("Cursor", "editor") == "Editor Agent"


def test_media_relpaths_include_broll():
    paths = media_relpaths({
        "source_path": "inputs/handoff/pkg/source.mp4",
        "timeline": {"assets": [{"id": "broll", "path": "inputs/handoff/pkg/broll.mp4"}]},
    })
    assert paths == ["inputs/handoff/pkg/source.mp4", "inputs/handoff/pkg/broll.mp4"]


def test_apply_package_imports_bot_source_and_links_spec(studio, tmp_path):
    record = create_spec({"title": "Bot cut", "goal": "Strong first line", "language": "en"})
    folder = tmp_path / "2026-08-26T06-00-00Z-bot"
    folder.mkdir()
    (folder / "source.mp4").write_bytes(b"x" * 32)
    (folder / "broll.mp4").write_bytes(b"y" * 32)
    (folder / "bundle.json").write_text(json.dumps({
        "schema": "local-video-workspace.project-bundle/v1",
        "project": {
            "title": "Bot cut",
            "source_path": "inputs/handoff/pkg/source.mp4",
            "output_path": "outputs/handoff/pkg.mp4",
            "edit_spec_id": record["id"],
            "timeline": {
                "clips": [{"in": 0, "out": 4, "keep": True, "caption": "ASK"}],
                "assets": [{"id": "broll", "kind": "video", "path": "inputs/handoff/pkg/broll.mp4"}],
            },
        },
        "jobs": [{"kind": "render", "approved": True, "payload": {}}],
    }), encoding="utf-8")
    result = apply_package_local(folder)
    assert result["ok"] is True
    assert result["edit_spec_id"] == record["id"]
    assert result["door"] == "editor"
    assert result["agent"] == "Editor Agent"
    assert result["project"]["handoff_door"] == "editor"
    assert result["project"]["handoff_agent"] == "Editor Agent"
    import config
    assert (config.WORKSPACE_DIR / "inputs/handoff/pkg/source.mp4").read_bytes() == b"x" * 32
    assert (config.WORKSPACE_DIR / "inputs/handoff/pkg/broll.mp4").read_bytes() == b"y" * 32
    from edit_spec import get_spec
    assert get_spec(record["id"])["status"] == "received"
    assert get_spec(record["id"])["project_id"] == result["project"]["id"]


def test_demo_package_then_pull(studio, tmp_path, monkeypatch):
    source = tmp_path / "sample.mp4"
    source.write_bytes(b"demo-bytes")
    monkeypatch.setattr(first_run, "bundled_sample_candidates", lambda: [source])
    record = create_spec({"title": "Demo spec", "goal": "Show the arrival", "language": "ko"})
    written = write_demo_package(record["id"])
    assert written["door"] == "editor"
    assert written["path"].endswith(f"/editor/{written['folder']}")
    pulled = pull_handoff({})
    assert pulled["door"] == "editor"
    assert any(item.get("ok") for item in pulled["processed"])
    assert written["folder"] in {item.get("folder") for item in pulled["imported"]}


def test_agent_demo_is_invisible_to_grok_pull(studio, tmp_path, monkeypatch):
    source = tmp_path / "sample.mp4"
    source.write_bytes(b"demo-bytes")
    monkeypatch.setattr(first_run, "bundled_sample_candidates", lambda: [source])
    record = create_spec({
        "title": "Agent demo",
        "goal": "Stay off the Grok door",
        "language": "en",
        "door": "agent",
        "agent": "Codex",
    })
    written = write_demo_package(record["id"])
    assert written["door"] == "collector"
    assert "/collector/" in written["path"].replace("\\", "/")
    grok_pull = pull_handoff({"door": "grok"})
    assert written["folder"] not in {item.get("folder") for item in grok_pull["imported"]}
    assert written["folder"] not in {item.get("folder") for item in grok_pull["processed"]}
    agent_pull = pull_handoff({"door": "agent", "edit_spec_id": record["id"]})
    imported = next(item for item in agent_pull["imported"] if item.get("folder") == written["folder"])
    assert imported["agent"] == "Collector Agent"
    assert imported["project"]["handoff_door"] == "collector"
    assert imported["project"]["handoff_agent"] == "Collector Agent"


def test_leftover_grok_inbox_folder_still_pulls(studio, tmp_path, monkeypatch):
    source = tmp_path / "sample.mp4"
    source.write_bytes(b"legacy-bytes")
    monkeypatch.setattr(first_run, "bundled_sample_candidates", lambda: [source])
    record = create_spec({"title": "Legacy folder", "goal": "Read leftover grok/", "language": "en"})
    written = write_demo_package(record["id"], door="editor")
    leftover = config.WORKSPACE_DIR / "handoff-inbox" / "grok" / written["folder"]
    leftover.parent.mkdir(parents=True, exist_ok=True)
    (config.WORKSPACE_DIR / "handoff-inbox" / "editor" / written["folder"]).rename(leftover)
    pulled = pull_handoff({"door": "editor"})
    assert written["folder"] in {item.get("folder") for item in pulled["imported"]}
    imported = next(item for item in pulled["imported"] if item.get("folder") == written["folder"])
    assert imported["door"] == "editor"


def test_grok_pull_rejects_agent_spec(studio):
    record = create_spec({"title": "Agent only", "goal": "Not Grok", "door": "agent", "language": "en"})
    with pytest.raises(ValueError, match="collector door"):
        pull_handoff({"door": "grok", "edit_spec_id": record["id"]})


def test_apply_rejects_door_mismatch(studio, tmp_path):
    record = create_spec({"title": "Grok spec", "goal": "Grok only", "language": "en", "door": "grok"})
    folder = tmp_path / "agents" / "wrong-door"
    folder.mkdir(parents=True)
    (folder / "source.mp4").write_bytes(b"x" * 32)
    (folder / "bundle.json").write_text(json.dumps({
        "schema": "local-video-workspace.project-bundle/v1",
        "project": {
            "title": "Wrong door",
            "source_path": "inputs/handoff/pkg/source.mp4",
            "output_path": "outputs/handoff/pkg.mp4",
            "edit_spec_id": record["id"],
            "door": "agent",
            "created_by": "Claude",
            "timeline": {"clips": [{"in": 0, "out": 4, "keep": True, "caption": ""}]},
        },
        "jobs": [{"kind": "render", "approved": True, "payload": {}}],
    }), encoding="utf-8")
    result = apply_package_local(folder, expected_door="grok")
    assert result["ok"] is False
    assert "collector" in result["reason"]


def test_apply_stores_named_agent(studio, tmp_path):
    record = create_spec({"title": "Claude cut", "goal": "Name the sender", "language": "en", "door": "agent", "agent": "Claude"})
    folder = tmp_path / "agents" / "claude-pkg"
    folder.mkdir(parents=True)
    (folder / "source.mp4").write_bytes(b"x" * 32)
    (folder / "bundle.json").write_text(json.dumps({
        "schema": "local-video-workspace.project-bundle/v1",
        "project": {
            "title": "Claude cut",
            "source_path": "inputs/handoff/pkg/source.mp4",
            "output_path": "outputs/handoff/pkg.mp4",
            "edit_spec_id": record["id"],
            "door": "agent",
            "created_by": "claude-code",
            "timeline": {"clips": [{"in": 0, "out": 4, "keep": True, "caption": ""}]},
        },
        "jobs": [{"kind": "render", "approved": True, "payload": {}}],
    }), encoding="utf-8")
    result = apply_package_local(folder, expected_door="agent")
    assert result["ok"] is True
    assert result["agent"] == "Collector Agent"
    assert result["project"]["handoff_agent"] == "Collector Agent"
    assert result["project"]["handoff_door"] == "collector"


def test_http_spec_brief_and_handoff_status(live_server):
    create = Request(
        f"{live_server}/api/v2/edit-specs",
        data=json.dumps({"title": "HTTP spec", "goal": "Bot brings the file", "language": "en", "door": "grok"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    created = json.loads(urlopen(create).read().decode())
    spec_id = created["edit_spec"]["id"]
    assert created["edit_spec"]["door"] == "editor"
    brief = json.loads(urlopen(f"{live_server}/api/v2/edit-specs/{spec_id}/brief").read().decode())
    assert "will not attach footage" in brief["text"]
    assert brief["door"] == "editor"
    status = json.loads(urlopen(f"{live_server}/api/v2/handoff").read().decode())
    assert status["source_owner"] == "bot"
    assert "editor" in status["doors"]
    assert "collector" in status["doors"]
    assert status["doors"]["editor"]["inbox_dir"].endswith("/editor")
    assert status["doors"]["collector"]["inbox_dir"].endswith("/collector")
    assert status["outbox"]["doors"]["editor"]["outbox_dir"].endswith("/editor")
    assert status["outbox"]["doors"]["collector"]["outbox_dir"].endswith("/collector")
    assert created["edit_spec"]["outbox"]["git"]["skipped"] is True
    outbox = json.loads(urlopen(f"{live_server}/api/v2/handoff/outbox").read().decode())
    assert spec_id in {item["id"] for item in outbox["doors"]["editor"]["pending"]}


def test_unnamed_spec_uses_role_defaults_not_grok_or_claude(studio):
    record = create_spec({"title": "Unnamed crew", "goal": "No brand defaults", "language": "en", "crew": True})
    assert record["collector"]["agent"] == "Collector Agent"
    assert record["editor"]["agent"] == "Editor Agent"
    assert record["agent"] == "Editor Agent"


def test_crew_roster_suggests_names_from_checkin_purpose(studio):
    from config import utc_now
    from db import db
    from edit_spec import crew_roster

    now = utc_now()
    with db() as conn:
        conn.execute(
            """INSERT INTO bot_sessions (bot_id, display_name, last_action, last_detail_json, last_seen, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            ("bot-collect", "Nova", "heartbeat", json.dumps({"purpose": "collect"}), now, now),
        )
        conn.execute(
            """INSERT INTO bot_sessions (bot_id, display_name, last_action, last_detail_json, last_seen, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            ("bot-edit", "Orion", "heartbeat", json.dumps({"purpose": "edit_video"}), now, now),
        )
        conn.execute(
            """INSERT INTO bot_entries (id, bot_id, display_name, purpose, task, joined_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            ("e1", "bot-collect", "Nova", "collect", "", now),
        )
        conn.execute(
            """INSERT INTO bot_entries (id, bot_id, display_name, purpose, task, joined_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            ("e2", "bot-edit", "Orion", "edit_video", "", now),
        )
    roster = crew_roster()
    assert roster["suggested_collector"] == "Collector Agent"
    assert roster["suggested_editor"] == "Editor Agent"
    names = {item["display_name"] for item in roster["bots"]}
    assert names == {"Nova", "Orion"}
    record = create_spec({
        "title": "Connected names",
        "goal": "Use whoever checked in",
        "language": "en",
        "crew": True,
        "collector": "Nova",
        "editor": "Orion",
    })
    assert record["collector"]["agent"] == "Collector Agent"
    assert record["editor"]["agent"] == "Editor Agent"
    swapped = create_spec({
        "title": "Swapped brands",
        "goal": "Claude may edit",
        "language": "en",
        "crew": True,
        "collector": "Grok",
        "editor": "Claude",
    })
    assert swapped["collector"]["agent"] == "Collector Agent"
    assert swapped["editor"]["agent"] == "Editor Agent"


def test_simple_path_spec_is_one_bot(studio):
    record = create_spec({
        "title": "One bot reel",
        "goal": "Source and cut",
        "language": "en",
        "source_mode": "bot",
    })
    assert record["source_mode"] == "bot"
    assert record["crew"] is False
    assert record["status"] == "waiting_for_bot"
    assert record["door"] == "editor"
    assert not (config.WORKSPACE_DIR / "handoff-outbox" / "collector" / record["id"]).exists()
    assert (config.WORKSPACE_DIR / "handoff-outbox" / "editor" / record["id"] / "spec.json").is_file()
    invite = spec_invite(record["id"], "en")
    assert "One bot reel" in invite["text"]
    assert "handoff-inbox" in invite["text"]
    assert "127.0.0.1:7214/downloads/grok-crew.py" in invite["text"]
    assert "local_studio/grok_crew.py" not in invite["text"]
    assert "git clone" not in invite["text"]
    korean = spec_invite(record["id"], "ko")
    assert "제목: One bot reel" in korean["text"]
    assert "git clone" not in korean["text"]
    assert "local_studio/grok_crew.py" not in korean["text"]


def test_http_invite_and_bot_pack(live_server):
    created = json.loads(urlopen(Request(
        f"{live_server}/api/v2/edit-specs",
        data=json.dumps({"title": "HTTP invite", "goal": "One paste", "language": "en", "source_mode": "bot"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )).read().decode())
    spec_id = created["edit_spec"]["id"]
    invite = json.loads(urlopen(f"{live_server}/api/v2/edit-specs/{spec_id}/invite?lang=en").read().decode())
    assert "HTTP invite" in invite["text"]
    assert invite["inbox_dir"].endswith("/editor")
    packed = urlopen(f"{live_server}/downloads/grok-crew-bot.zip").read()
    assert packed[:2] == b"PK"
    names = zipfile.ZipFile(io.BytesIO(packed)).namelist()
    assert "지금_이렇게_하세요.txt" in names
    assert "grok_crew.py" in names

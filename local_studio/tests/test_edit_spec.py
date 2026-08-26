import json
from urllib.request import Request, urlopen

import pytest

from edit_spec import create_spec, spec_brief
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
    assert record["spec"]["source"]["owner"] == "bot"
    brief = spec_brief(record["id"])
    assert record["id"] in brief["text"]
    assert "will not attach footage" in brief["text"]


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
    pulled = pull_handoff({})
    assert any(item.get("ok") for item in pulled["processed"])
    assert written["folder"] in {item.get("folder") for item in pulled["imported"]}


def test_http_spec_brief_and_handoff_status(live_server):
    create = Request(
        f"{live_server}/api/v2/edit-specs",
        data=json.dumps({"title": "HTTP spec", "goal": "Bot brings the file", "language": "en"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    created = json.loads(urlopen(create).read().decode())
    spec_id = created["edit_spec"]["id"]
    brief = json.loads(urlopen(f"{live_server}/api/v2/edit-specs/{spec_id}/brief").read().decode())
    assert "will not attach footage" in brief["text"]
    status = json.loads(urlopen(f"{live_server}/api/v2/handoff").read().decode())
    assert status["source_owner"] == "bot"

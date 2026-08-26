"""Door-scoped outbox: save writes spec.json; receive archives it."""
import json
from pathlib import Path
from urllib.request import Request, urlopen

import config
from edit_spec import attach_spec_project, create_spec
from handoff_inbox import apply_package_local
from handoff_outbox import OUTBOX_SCHEMA, outbox_status, push_outbox


def _outbox_path(door_folder: str, spec_id: str) -> Path:
    return config.WORKSPACE_DIR / "handoff-outbox" / door_folder / spec_id


def test_create_spec_writes_only_that_door_outbox(studio):
    grok = create_spec({"title": "Grok reel", "goal": "Keep the hook", "language": "en"})
    agent = create_spec({
        "title": "Claude reel",
        "goal": "Keep the ask",
        "language": "en",
        "door": "agent",
        "agent": "Claude",
    })

    grok_folder = _outbox_path("grok", grok["id"])
    agent_folder = _outbox_path("agents", agent["id"])
    payload = json.loads((grok_folder / "spec.json").read_text(encoding="utf-8"))
    brief = (grok_folder / "brief.txt").read_text(encoding="utf-8")

    assert grok["outbox"]["path"] == str(grok_folder)
    assert grok["outbox"]["git"]["skipped"] is True
    assert payload["schema"] == OUTBOX_SCHEMA
    assert payload["id"] == grok["id"]
    assert payload["door"] == "grok"
    assert payload["agent"] == "editor"
    assert payload["return"]["inbox"].endswith("handoff-inbox/grok/")
    assert payload["return"]["git_prefix"] == "grok/"
    assert "will not attach footage" in brief
    assert agent_folder.is_dir()
    assert not (config.WORKSPACE_DIR / "handoff-outbox" / "grok" / agent["id"]).exists()
    assert not (config.WORKSPACE_DIR / "handoff-outbox" / "agents" / grok["id"]).exists()

    status = outbox_status()
    grok_ids = {item["id"] for item in status["doors"]["grok"]["pending"]}
    agent_ids = {item["id"] for item in status["doors"]["agent"]["pending"]}
    assert grok["id"] in grok_ids
    assert agent["id"] not in grok_ids
    assert agent["id"] in agent_ids
    assert grok["id"] not in agent_ids
    assert status["doors"]["agent"]["pending"][0]["agent"] == "Claude"


def test_attach_spec_project_archives_outbox(studio, tmp_path):
    record = create_spec({"title": "Archive me", "goal": "Move after receive", "language": "en"})
    folder = _outbox_path("grok", record["id"])
    assert folder.is_dir()

    inbound = tmp_path / "2026-08-26T08-00-00Z-cut"
    inbound.mkdir()
    (inbound / "source.mp4").write_bytes(b"x" * 32)
    (inbound / "bundle.json").write_text(json.dumps({
        "schema": "local-video-workspace.project-bundle/v1",
        "project": {
            "title": "Archive me",
            "source_path": "inputs/handoff/pkg/source.mp4",
            "output_path": "outputs/handoff/pkg.mp4",
            "edit_spec_id": record["id"],
            "door": "grok",
            "created_by": "grok",
            "timeline": {"clips": [{"in": 0, "out": 2, "keep": True, "caption": ""}]},
        },
        "jobs": [{"kind": "render", "approved": True, "payload": {}}],
    }), encoding="utf-8")
    result = apply_package_local(inbound)
    assert result["ok"] is True
    assert not folder.exists()
    processed = config.WORKSPACE_DIR / "handoff-outbox" / "grok" / ".processed" / record["id"]
    assert processed.is_dir()
    assert (processed / "spec.json").is_file()
    status = outbox_status()
    assert record["id"] not in {item["id"] for item in status["doors"]["grok"]["pending"]}


def test_attach_without_project_media_still_archives(studio):
    record = create_spec({"title": "Direct archive", "goal": "No inbound folder", "language": "en"})
    folder = _outbox_path("grok", record["id"])
    attach_spec_project(record["id"], "proj-placeholder")
    assert not folder.exists()
    assert (config.WORKSPACE_DIR / "handoff-outbox" / "grok" / ".processed" / record["id"] / "spec.json").is_file()


def test_push_outbox_skips_without_remote(studio, monkeypatch):
    monkeypatch.delenv("HANDOFF_REPO_REMOTE", raising=False)
    record = create_spec({"title": "Local only", "goal": "Stay on this PC", "language": "en"})
    result = push_outbox(record["outbox"], door="grok")
    assert result["ok"] is False
    assert result["skipped"] is True
    assert "HANDOFF_REPO_REMOTE" in result["reason"]
    assert _outbox_path("grok", record["id"]).is_dir()


def test_http_outbox_push_skips_without_remote(live_server):
    created = json.loads(urlopen(Request(
        f"{live_server}/api/v2/edit-specs",
        data=json.dumps({"title": "HTTP outbox", "goal": "Skip git", "language": "en", "door": "grok"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )).read().decode())
    spec_id = created["edit_spec"]["id"]
    pushed = json.loads(urlopen(Request(
        f"{live_server}/api/v2/handoff/outbox/push",
        data=json.dumps({"edit_spec_id": spec_id, "door": "grok"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )).read().decode())
    assert pushed["git"]["skipped"] is True
    assert spec_id in {item["id"] for item in pushed["outbox"]["doors"]["grok"]["pending"]}

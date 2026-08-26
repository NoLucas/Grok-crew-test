"""Two-bot crew: collector drops materials, editor returns the cut."""
import json
from pathlib import Path

import config
from edit_spec import create_spec, spec_brief
from handoff_inbox import apply_package_local, pull_handoff
from handoff_materials import MATERIALS_SCHEMA, materials_status, pull_materials
from handoff_outbox import outbox_status
import first_run
import handoff_watcher as hw


def test_crew_spec_writes_both_outboxes(studio):
    record = create_spec({
        "title": "Crew reel",
        "goal": "Hook first",
        "language": "en",
        "crew": True,
        "collector": "Claude",
        "editor": "Grok",
    })
    assert record["crew"] is True
    assert record["status"] == "waiting_for_collector"
    assert record["collector"]["agent"] == "Collector Agent"
    assert record["editor"]["agent"] == "Editor Agent"
    collect = Path(record["outbox"]["collect"]["path"])
    edit = Path(record["outbox"]["edit"]["path"])
    assert collect.as_posix().endswith(f"handoff-outbox/collector/{record['id']}")
    assert edit.as_posix().endswith(f"handoff-outbox/editor/{record['id']}")
    collect_payload = json.loads((collect / "spec.json").read_text(encoding="utf-8"))
    edit_payload = json.loads((edit / "spec.json").read_text(encoding="utf-8"))
    assert collect_payload["role"] == "collect"
    assert collect_payload["return"]["kind"] == "materials"
    assert edit_payload["role"] == "edit"
    assert edit_payload["return"]["kind"] == "cut"
    status = outbox_status()
    assert record["id"] in {item["id"] for item in status["doors"]["collector"]["pending"]}
    assert record["id"] in {item["id"] for item in status["doors"]["editor"]["pending"]}


def test_crew_briefs_split_roles(studio):
    record = create_spec({
        "title": "Split briefs",
        "goal": "Keep the ask",
        "language": "en",
        "crew": True,
        "collector": "Codex",
    })
    collect = spec_brief(record["id"], role="collect")
    edit = spec_brief(record["id"], role="edit")
    assert collect["role"] == "collect"
    assert "collector role" in collect["text"]
    assert "handoff-materials" in collect["text"]
    assert "will not attach footage" in collect["text"]
    assert "Do not put a finished cut" in collect["text"]
    assert "Collector Agent" in collect["text"]
    assert "Codex" not in collect["text"]
    assert edit["role"] == "edit"
    assert "editor role" in edit["text"]
    assert "handoff-materials" in edit["text"]
    assert "handoff-inbox/editor" in edit["text"]
    assert "Do not use the collector/ folder" in edit["text"]


def test_materials_then_editor_cut(studio, tmp_path, monkeypatch):
    source = tmp_path / "sample.mp4"
    source.write_bytes(b"collected-bytes")
    monkeypatch.setattr(first_run, "bundled_sample_candidates", lambda: [source])
    record = create_spec({
        "title": "Pipeline",
        "goal": "Collect then cut",
        "language": "en",
        "crew": True,
        "collector": "Claude",
    })
    materials = pull_materials({"demo": True, "edit_spec_id": record["id"]})
    imported = materials["imported"][0]
    assert imported["ok"] is True
    folder = Path(imported["path"])
    assert (folder / "manifest.json").is_file()
    payload = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    assert payload["schema"] == MATERIALS_SCHEMA
    assert payload["role"] == "collect"
    assert (folder / "source.mp4").read_bytes() == b"collected-bytes"
    from edit_spec import get_spec
    assert get_spec(record["id"])["status"] == "waiting_for_editor"
    assert not (config.WORKSPACE_DIR / "handoff-outbox" / "collector" / record["id"]).exists()
    assert record["id"] not in {item["id"] for item in outbox_status()["doors"]["collector"]["pending"]}

    pulled = pull_handoff({"demo": True, "door": "grok", "edit_spec_id": record["id"]})
    assert any(item.get("ok") for item in pulled["imported"])
    assert get_spec(record["id"])["status"] == "received"
    assert not (config.WORKSPACE_DIR / "handoff-outbox" / "editor" / record["id"]).exists()
    assert materials_status()["pending_count"] == 0


def test_collector_cut_in_inbox_is_rejected(studio, tmp_path):
    record = create_spec({
        "title": "No cut from collector",
        "goal": "Materials only",
        "language": "en",
        "crew": True,
        "collector": "Claude",
    })
    folder = tmp_path / "agents" / "wrong-cut"
    folder.mkdir(parents=True)
    (folder / "source.mp4").write_bytes(b"x" * 32)
    (folder / "bundle.json").write_text(json.dumps({
        "schema": "local-video-workspace.project-bundle/v1",
        "project": {
            "title": "Wrong",
            "source_path": "inputs/handoff/pkg/source.mp4",
            "output_path": "outputs/handoff/pkg.mp4",
            "edit_spec_id": record["id"],
            "door": "agent",
            "created_by": "Claude",
            "timeline": {"clips": [{"in": 0, "out": 2, "keep": True, "caption": ""}]},
        },
        "jobs": [{"kind": "render", "approved": True, "payload": {}}],
    }), encoding="utf-8")
    result = apply_package_local(folder, expected_door="agent")
    assert result["ok"] is False
    assert "materials" in result["reason"]


def test_watcher_skips_materials_tree(tmp_path):
    (tmp_path / "materials" / "spec-id").mkdir(parents=True)
    (tmp_path / "materials" / "spec-id" / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / "grok" / "cut-pkg").mkdir(parents=True)
    names = [
        f"{p.parent.name}/{p.name}" if p.parent.name in {"editor", "collector", "grok", "agents", "agent"} else p.name
        for p in hw.pending_folders(tmp_path, processed=set())
    ]
    assert names == ["grok/cut-pkg"]
    assert all("materials" not in name for name in names)

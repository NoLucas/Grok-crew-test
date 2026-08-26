"""Workspace-safe listing of saved bot folders."""

import json
from pathlib import Path

import pytest

import config
from handoff_folders import (
    SCHEMA,
    describe_materials_folder,
    describe_package_folder,
    workspace_handoff_folders,
)
from handoff_materials import MATERIALS_SCHEMA, apply_materials_folder
from edit_spec import create_spec


def test_package_folder_lists_only_media_under_inputs_handoff(studio):
    folder = config.WORKSPACE_DIR / "inputs" / "handoff" / "pkg-one"
    folder.mkdir(parents=True)
    (folder / "source.mp4").write_bytes(b"src")
    (folder / "broll.mp4").write_bytes(b"brl")
    (folder / "notes.txt").write_text("ignore me", encoding="utf-8")
    (folder / ".hidden.mp4").write_bytes(b"no")
    secret = config.WORKSPACE_DIR / "secret.mp4"
    secret.write_bytes(b"outside")
    inbox = config.WORKSPACE_DIR / "handoff-inbox" / "editor" / "pkg-one"
    inbox.mkdir(parents=True)
    (inbox / "source.mp4").write_bytes(b"inbox-only")

    project = studio.new_project({
        "title": "Bot cut",
        "source_path": "inputs/handoff/pkg-one/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {"clips": [{"in": 0, "out": 2, "keep": True, "caption": ""}]},
        "handoff_door": "editor",
        "handoff_agent": "Editor Agent",
    })
    listed = workspace_handoff_folders()
    assert listed["schema"] == SCHEMA
    packages = [item for item in listed["folders"] if item["kind"] == "package"]
    assert len(packages) == 1
    package = packages[0]
    assert package["id"] == "pkg-one"
    assert package["relative_dir"] == "inputs/handoff/pkg-one"
    assert package["project_id"] == project["id"]
    names = {item["name"] for item in package["files"]}
    assert names == {"source.mp4", "broll.mp4"}
    assert "secret.mp4" not in names
    roles = {item["name"]: item["role"] for item in package["files"]}
    assert roles["source.mp4"] == "source"
    assert roles["broll.mp4"] == "broll"
    assert all("/" not in Path(item["path"]).anchor for item in package["files"])
    assert all(item["path"].startswith("inputs/handoff/pkg-one/") for item in package["files"])


def test_materials_folder_stays_separate_from_packages(studio, tmp_path):
    record = create_spec({
        "title": "Crew reel",
        "goal": "Collect then cut",
        "language": "en",
        "crew": True,
    })
    incoming = tmp_path / "drop"
    incoming.mkdir()
    (incoming / "clip.mp4").write_bytes(b"clip-bytes")
    (incoming / "manifest.json").write_text(
        '{"schema":"%s","edit_spec_id":"%s","agent":"Collector Agent","notes":"Allowed stock.","clips":[{"file":"clip.mp4","note":"Hook","origin":"collected","license":"stock"}]}'
        % (MATERIALS_SCHEMA, record["id"]),
        encoding="utf-8",
    )
    result = apply_materials_folder(incoming, record["id"])
    assert result["ok"] is True

    listed = workspace_handoff_folders()
    materials = [item for item in listed["folders"] if item["kind"] == "materials"]
    packages = [item for item in listed["folders"] if item["kind"] == "package"]
    assert packages == []
    assert len(materials) == 1
    folder = materials[0]
    assert folder["id"] == record["id"]
    assert folder["relative_dir"] == f"handoff-materials/{record['id']}"
    assert folder["spec_id"] == record["id"]
    assert folder["notes"] == "Allowed stock."
    assert folder["files"][0]["name"] == "clip.mp4"
    assert folder["files"][0]["role"] == "clip"
    assert folder["files"][0]["note"] == "Hook"
    assert folder["files"][0]["license"] == "stock"

    filtered = workspace_handoff_folders(kind="package")
    assert filtered["folders"] == []


def test_folder_name_rejects_traversal(studio):
    with pytest.raises(ValueError, match="not allowed|leaves"):
        describe_package_folder("../secret")
    with pytest.raises(ValueError, match="not allowed|leaves"):
        describe_package_folder("a/b")
    with pytest.raises(ValueError, match="not allowed|leaves"):
        describe_package_folder(".processed")
    with pytest.raises(ValueError, match="not allowed|leaves"):
        describe_materials_folder("..")


def test_http_workspace_and_folders_endpoint(live_server):
    from tests.test_p3_launch import get_json
    from tests.test_api import get_status

    folder = config.WORKSPACE_DIR / "inputs" / "handoff" / "http-pkg"
    folder.mkdir(parents=True)
    (folder / "source.mp4").write_bytes(b"http-src")
    workspace = get_json(live_server, "/api/v2/workspace")
    assert any(item["id"] == "http-pkg" for item in workspace.get("handoff_folders") or [])
    listed = get_json(live_server, "/api/v2/handoff/folders")
    assert listed["schema"] == SCHEMA
    assert listed["folders"][0]["files"][0]["path"] == "inputs/handoff/http-pkg/source.mp4"
    packages_only = get_json(live_server, "/api/v2/handoff/folders?kind=package")
    assert packages_only["folders"][0]["kind"] == "package"
    status, body = get_status(live_server, "/api/v2/handoff/folders?kind=inbox")
    assert status == 400
    assert "kind" in body["error"]


def test_delete_rejects_source_and_escape(studio):
    from handoff_folders import delete_handoff_file, reveal_handoff_file

    folder = config.WORKSPACE_DIR / "inputs" / "handoff" / "pkg-del"
    folder.mkdir(parents=True)
    (folder / "source.mp4").write_bytes(b"src")
    (folder / "broll.mp4").write_bytes(b"brl")
    studio.new_project({
        "title": "Keep source",
        "source_path": "inputs/handoff/pkg-del/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {"clips": [{"in": 0, "out": 2, "keep": True, "caption": ""}]},
    })
    with pytest.raises(ValueError, match="source"):
        delete_handoff_file("inputs/handoff/pkg-del/source.mp4")
    with pytest.raises(ValueError, match="not allowed|only files"):
        delete_handoff_file("../secret.mp4")
    with pytest.raises(ValueError, match="not allowed|only files"):
        delete_handoff_file("outputs/final-video.mp4")
    revealed = reveal_handoff_file("inputs/handoff/pkg-del/broll.mp4")
    assert revealed["ok"] is True
    assert revealed["path"] == "inputs/handoff/pkg-del/broll.mp4"
    assert revealed["absolute_path"].endswith("broll.mp4")
    deleted = delete_handoff_file("inputs/handoff/pkg-del/broll.mp4")
    assert deleted["deleted"] == "inputs/handoff/pkg-del/broll.mp4"
    assert not (folder / "broll.mp4").exists()
    assert (folder / "source.mp4").exists()


def test_delete_materials_updates_manifest(studio, tmp_path):
    from handoff_folders import delete_handoff_file

    record = create_spec({
        "title": "Crew reel",
        "goal": "Collect then cut",
        "language": "en",
        "crew": True,
    })
    incoming = tmp_path / "drop"
    incoming.mkdir()
    (incoming / "keep.mp4").write_bytes(b"keep")
    (incoming / "drop.mp4").write_bytes(b"drop")
    (incoming / "manifest.json").write_text(
        '{"schema":"%s","edit_spec_id":"%s","agent":"Collector Agent","notes":"Two clips.","clips":[{"file":"keep.mp4","note":"Keep"},{"file":"drop.mp4","note":"Drop"}]}'
        % (MATERIALS_SCHEMA, record["id"]),
        encoding="utf-8",
    )
    assert apply_materials_folder(incoming, record["id"])["ok"] is True
    with pytest.raises(ValueError, match="reserved"):
        delete_handoff_file(f"handoff-materials/{record['id']}/manifest.json")
    deleted = delete_handoff_file(f"handoff-materials/{record['id']}/drop.mp4")
    assert deleted["ok"] is True
    leftover = describe_materials_folder(record["id"])
    names = {item["name"] for item in leftover["files"]}
    assert names == {"keep.mp4"}
    manifest = json.loads(
        (config.WORKSPACE_DIR / "handoff-materials" / record["id"] / "manifest.json").read_text(encoding="utf-8")
    )
    assert [item["file"] for item in manifest["clips"]] == ["keep.mp4"]


def test_http_delete_and_reveal(live_server):
    from tests.test_p3_launch import get_json, post
    from tests.test_timeline_edit_api import post_status

    folder = config.WORKSPACE_DIR / "inputs" / "handoff" / "http-del"
    folder.mkdir(parents=True)
    (folder / "clip.mp4").write_bytes(b"http-clip")
    revealed = post(live_server, "/api/v2/handoff/files/reveal", {"path": "inputs/handoff/http-del/clip.mp4"})
    assert revealed["ok"] is True
    assert revealed["path"] == "inputs/handoff/http-del/clip.mp4"
    deleted = post(live_server, "/api/v2/handoff/files/delete", {"path": "inputs/handoff/http-del/clip.mp4"})
    assert deleted["deleted"] == "inputs/handoff/http-del/clip.mp4"
    assert not (folder / "clip.mp4").exists()
    listed = get_json(live_server, "/api/v2/handoff/folders")
    assert all(item["id"] != "http-del" for item in listed["folders"])
    bad_status, bad = post_status(live_server, "/api/v2/handoff/files/delete", {"path": "outputs/secret.mp4"})
    assert bad_status == 400
    assert "only files" in bad["error"] or "not allowed" in bad["error"]

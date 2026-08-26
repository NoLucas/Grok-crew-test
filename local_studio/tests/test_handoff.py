"""Unit tests for handoff_watcher.py's package-safety guards (plan item 1.3)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import handoff_watcher as hw  # noqa: E402


class _NeverCalledClient:
    """Stand-in for LocalStudioClient that fails the test if the network is touched."""

    def request(self, *args, **kwargs):  # noqa: D401
        raise AssertionError("client.request() should not be called once a package is rejected locally")


# -- copy_media(): extension whitelist + size cap -----------------------------

def test_copy_media_rejects_disallowed_extension(tmp_path):
    folder = tmp_path / "pkg"
    workspace = tmp_path / "workspace"
    folder.mkdir()
    (folder / "payload.exe").write_bytes(b"not a video")
    with pytest.raises(RuntimeError, match="unsupported extension"):
        hw.copy_media(folder, workspace, "payload.exe")


def test_copy_media_rejects_file_over_size_cap(tmp_path, monkeypatch):
    import handoff_inbox

    monkeypatch.setattr(handoff_inbox, "MAX_MEDIA_BYTES", 10)
    folder = tmp_path / "pkg"
    workspace = tmp_path / "workspace"
    folder.mkdir()
    (folder / "source.mp4").write_bytes(b"x" * 100)
    with pytest.raises(RuntimeError, match="handoff limit"):
        hw.copy_media(folder, workspace, "source.mp4")


def test_process_folder_copies_broll_named_in_timeline(tmp_path):
    folder = tmp_path / "20260826-pkg"
    workspace = tmp_path / "workspace"
    folder.mkdir()
    (folder / "source.mp4").write_bytes(b"src")
    (folder / "broll.mp4").write_bytes(b"brl")
    (folder / "bundle.json").write_text(
        '{"schema":"local-video-workspace.project-bundle/v1","project":{"title":"Bot","source_path":"inputs/handoff/pkg/source.mp4","timeline":{"clips":[{"in":0,"out":1,"keep":true}],"assets":[{"path":"inputs/handoff/pkg/broll.mp4"}]}}}',
        encoding="utf-8",
    )

    class _ImportClient:
        def request(self, path, body=None):
            if path == "/api/projects/import":
                return {"project": {"id": "imported"}, "jobs": []}
            raise AssertionError(path)

    hw.process_folder(_ImportClient(), folder, workspace, allow_auto_upload=False)
    assert (workspace / "inputs/handoff/pkg/source.mp4").read_bytes() == b"src"
    assert (workspace / "inputs/handoff/pkg/broll.mp4").read_bytes() == b"brl"


def test_copy_media_accepts_file_within_limits(tmp_path):
    folder = tmp_path / "pkg"
    workspace = tmp_path / "workspace"
    folder.mkdir()
    (folder / "source.mp4").write_bytes(b"x" * 100)
    hw.copy_media(folder, workspace, "inputs/handoff/pkg/source.mp4")
    assert (workspace / "inputs" / "handoff" / "pkg" / "source.mp4").read_bytes() == b"x" * 100


def test_copy_media_rejects_path_traversal(tmp_path):
    folder = tmp_path / "pkg"
    workspace = tmp_path / "workspace"
    folder.mkdir()
    # copy_media() looks the source file up by basename only, so the traversal
    # has to target the *destination* (inside workspace) to matter here.
    (folder / "source.mp4").write_bytes(b"x")
    with pytest.raises(RuntimeError, match="outside the workspace"):
        hw.copy_media(folder, workspace, "../../source.mp4")


def test_copy_media_rejects_workspace_clobber(tmp_path):
    folder = tmp_path / "pkg"
    workspace = tmp_path / "workspace"
    folder.mkdir()
    (folder / "grok-crew-sample.mp4").write_bytes(b"x")
    (workspace / "inputs").mkdir(parents=True)
    (workspace / "inputs" / "grok-crew-sample.mp4").write_bytes(b"keep")
    with pytest.raises(RuntimeError, match="inputs/handoff"):
        hw.copy_media(folder, workspace, "inputs/grok-crew-sample.mp4")
    assert (workspace / "inputs" / "grok-crew-sample.mp4").read_bytes() == b"keep"


# -- process_folder(): bundle.json size cap, checked before any network call -

def test_process_folder_skips_oversized_bundle_without_touching_network(tmp_path, monkeypatch):
    monkeypatch.setattr(hw, "MAX_BUNDLE_BYTES", 10)
    folder = tmp_path / "20260824-pkg"
    folder.mkdir()
    (folder / "bundle.json").write_text('{"schema": "x", "padding": "' + ("a" * 100) + '"}', encoding="utf-8")
    # Should return quietly (logged, not raised) without ever calling the client.
    assert hw.process_folder(_NeverCalledClient(), folder, tmp_path / "workspace", allow_auto_upload=False) is False


# -- pending_folders(): excludes .git and already-processed packages ---------

def test_pending_folders_excludes_git_dir_and_processed(tmp_path):
    (tmp_path / ".git").mkdir()
    (tmp_path / "pkg-a").mkdir()
    (tmp_path / "pkg-b").mkdir()
    result = [p.name for p in hw.pending_folders(tmp_path, processed={"pkg-a"})]
    assert result == ["pkg-b"]


def test_pending_folders_lists_door_inboxes(tmp_path):
    (tmp_path / ".git").mkdir()
    (tmp_path / "editor" / "e-pkg").mkdir(parents=True)
    (tmp_path / "collector" / "c-pkg").mkdir(parents=True)
    (tmp_path / "grok" / "g-pkg").mkdir(parents=True)
    (tmp_path / "agents" / "a-pkg").mkdir(parents=True)
    (tmp_path / "editor" / ".processed").mkdir()
    (tmp_path / "grok" / ".processed").mkdir()
    names = [p.name for p in hw.pending_folders(tmp_path, processed=set())]
    assert names == ["e-pkg", "c-pkg", "g-pkg", "a-pkg"]


def test_pending_folders_skips_outbox_tree(tmp_path):
    (tmp_path / "outbox" / "grok" / "spec-id").mkdir(parents=True)
    (tmp_path / "outbox" / "grok" / "spec-id" / "spec.json").write_text("{}", encoding="utf-8")
    (tmp_path / "grok" / "cut-pkg").mkdir(parents=True)
    names = [f"{p.parent.name}/{p.name}" if p.parent.name in {"editor", "collector", "grok", "agents", "agent"} else p.name for p in hw.pending_folders(tmp_path, processed=set())]
    assert names == ["grok/cut-pkg"]
    assert all("outbox" not in name for name in names)


def test_process_folder_skips_agent_package_in_grok_inbox(tmp_path):
    folder = tmp_path / "grok" / "20260826-agent"
    folder.mkdir(parents=True)
    (folder / "source.mp4").write_bytes(b"src")
    (folder / "bundle.json").write_text(
        '{"schema":"local-video-workspace.project-bundle/v1","project":{"title":"X","source_path":"inputs/handoff/pkg/source.mp4","door":"agent"}}',
        encoding="utf-8",
    )
    assert hw.process_folder(_NeverCalledClient(), folder, tmp_path / "workspace", allow_auto_upload=False) is False


def test_process_folder_returns_false_without_marking_skip(tmp_path):
    folder = tmp_path / "20260824-pkg"
    folder.mkdir()
    (folder / "bundle.json").write_text('{"schema": "x"}', encoding="utf-8")
    assert hw.process_folder(_NeverCalledClient(), folder, tmp_path / "workspace", allow_auto_upload=False) is False


# -- folders_for_cycle(): caps packages processed per poll (frequency limit) -

def test_folders_for_cycle_caps_to_max_per_cycle(tmp_path):
    folders = [tmp_path / f"pkg-{i}" for i in range(7)]
    result = hw.folders_for_cycle(folders, 5)
    assert result == folders[:5]


def test_folders_for_cycle_keeps_oldest_first_when_capping(tmp_path):
    folders = [tmp_path / "20260101-pkg", tmp_path / "20260102-pkg", tmp_path / "20260103-pkg"]
    result = hw.folders_for_cycle(folders, 2)
    assert [f.name for f in result] == ["20260101-pkg", "20260102-pkg"]


def test_folders_for_cycle_returns_all_when_under_limit(tmp_path):
    folders = [tmp_path / f"pkg-{i}" for i in range(3)]
    result = hw.folders_for_cycle(folders, 5)
    assert result == folders


def test_folders_for_cycle_returns_all_when_exactly_at_limit(tmp_path):
    folders = [tmp_path / f"pkg-{i}" for i in range(5)]
    result = hw.folders_for_cycle(folders, 5)
    assert result == folders

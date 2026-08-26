"""Unit tests for studio_server's pure/DB-backed logic (no HTTP, no MoviePy/ffmpeg)."""
import os
from pathlib import Path

import pytest

import config


def make_project(studio, clips):
    return studio.new_project({
        "title": "Test project",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {"clips": clips},
    })


# -- workspace_path: the path-traversal guard --------------------------------

def test_workspace_path_accepts_relative_path_inside_workspace(studio):
    resolved = studio.workspace_path("inputs/source.mp4")
    assert resolved == (config.WORKSPACE_DIR / "inputs" / "source.mp4").resolve()


def test_workspace_path_rejects_traversal_outside_workspace(studio):
    with pytest.raises(ValueError):
        studio.workspace_path("../../../../Windows/win.ini")


def test_workspace_path_rejects_absolute_path_outside_workspace(studio):
    with pytest.raises(ValueError):
        studio.workspace_path("C:/Windows/win.ini" if os.name == "nt" else "/etc/passwd")


def test_original_asset_path_rejects_absolute_path_outside_workspace(studio):
    from render import original_asset_path

    with pytest.raises(ValueError):
        original_asset_path({"path": "C:/Windows/win.ini" if os.name == "nt" else "/etc/passwd"})


def test_validate_timeline_rejects_asset_path_outside_workspace(studio):
    from desktop_domain import validate_timeline

    timeline = {
        "schema": "grok-crew.timeline/v2",
        "revision": 1,
        "settings": {"width": 1080, "height": 1920, "fps": 30, "quality": "balanced"},
        "assets": [{
            "id": "leak",
            "kind": "video",
            "name": "Outside",
            "path": "C:/Windows/win.ini" if os.name == "nt" else "/etc/passwd",
        }],
        "tracks": [],
        "markers": [],
    }
    with pytest.raises(ValueError, match="workspace"):
        validate_timeline(timeline)


# -- validated_edit_method ----------------------------------------------------

def test_validated_edit_method_rejects_unknown_field(studio):
    with pytest.raises(ValueError):
        studio.validated_edit_method({"not_a_real_field": 1})


def test_validated_edit_method_rejects_out_of_range_speed(studio):
    with pytest.raises(ValueError):
        studio.validated_edit_method({"speed": 5.0})


def test_validated_edit_method_accepts_valid_overrides(studio):
    method = studio.validated_edit_method({"speed": 1.5, "fps": 60})
    assert method["speed"] == 1.5
    assert method["fps"] == 60


def test_default_edit_method_captions_are_on(studio):
    # Plan item 3.3: captions were force-disabled (item 0.2) only until a
    # CJK-capable font was bundled; they default back to burn_in now that
    # caption_font() always finds one (see test_caption_font_prefers_bundle).
    assert studio.DEFAULT_EDIT_METHOD["caption_mode"] == "burn_in"


def test_caption_font_prefers_bundled_cjk_font(studio, monkeypatch):
    monkeypatch.delenv("LOCAL_STUDIO_FONT", raising=False)
    font_path = config.caption_font()
    assert font_path is not None
    assert Path(font_path) == config.BUNDLED_CAPTION_FONT
    assert Path(font_path).is_file()


# -- parse_allowed_origins: CORS allow-list is configurable via env, not hardcoded --

def test_parse_allowed_origins_defaults_to_localhost_3000_when_blank():
    assert config.parse_allowed_origins("") == frozenset({"http://localhost:3000", "http://127.0.0.1:3000"})


def test_parse_allowed_origins_accepts_comma_separated_override():
    origins = config.parse_allowed_origins("https://studio.example.com, http://localhost:5173")
    assert origins == frozenset({"https://studio.example.com", "http://localhost:5173"})


def test_loopback_preview_ports_are_allowed_without_env_override():
    defaults = config.parse_allowed_origins("")
    assert config.origin_is_allowed("http://127.0.0.1:43123", defaults) is True
    assert config.origin_is_allowed("http://localhost:43127", defaults) is True
    assert config.origin_is_allowed("http://evil.example", defaults) is False
    assert config.origin_is_allowed("https://127.0.0.1.evil.example", defaults) is False
    assert config.origin_is_allowed(None, defaults) is True
    assert config.origin_is_allowed("", defaults) is False
    assert config.origin_is_allowed("   ", defaults) is False
    assert config.origin_is_allowed("null", defaults) is False


# -- render._smooth_gain_targets: the music-ducking envelope follower (pure Python,
# -- no MoviePy/numpy needed, so it stays covered even though the rest of render.py
# -- requires ffmpeg and isn't unit tested here) -------------------------------------

def test_smooth_gain_targets_ducks_quickly_then_releases_slowly():
    import render

    targets = [0.35] * 5 + [1.0] * 5
    smoothed = render._smooth_gain_targets(targets, attack=0.35, release=0.12)
    assert smoothed[0] < 1.0, "should start ducking on the very first dialogue step"
    assert smoothed[4] < smoothed[0], "should keep easing toward the floor while dialogue holds"
    assert all(0.35 <= value <= 1.0 for value in smoothed)
    assert smoothed[-1] < 1.0, "release is slower than attack, so 5 steps should not fully recover"


def test_smooth_gain_targets_stays_at_full_volume_without_dialogue():
    import render

    assert render._smooth_gain_targets([1.0] * 4, attack=0.35, release=0.12) == [1.0, 1.0, 1.0, 1.0]


# -- quality_report: regression test for the in/out vs start/end EDL bug -----

def test_quality_report_reads_in_out_keys_not_start_end(studio):
    project = make_project(studio, [
        {"in": 0.0, "out": 4.0, "keep": True},
        {"in": 4.0, "out": 9.0, "keep": True},
    ])
    report = studio.quality_report(project["id"], "pre_render", {})
    checks = {check["rule"]: check for check in report["payload"]["checks"]}
    assert checks["clip_ranges"]["level"] == "pass"
    assert report["payload"]["estimated_duration_seconds"] == 9.0


def test_quality_report_flags_zero_length_clip(studio):
    project = make_project(studio, [{"in": 2.0, "out": 2.0, "keep": True}])
    report = studio.quality_report(project["id"], "pre_render", {})
    checks = {check["rule"]: check for check in report["payload"]["checks"]}
    assert checks["clip_ranges"]["level"] == "error"


# -- job lifecycle -------------------------------------------------------------

def test_create_job_requires_an_existing_project(studio):
    with pytest.raises(ValueError):
        studio.create_job("does-not-exist", "render", {}, True)


def test_job_lifecycle_queued_to_succeeded(studio):
    project = make_project(studio, [{"in": 0.0, "out": 4.0, "keep": True}])
    job = studio.create_job(project["id"], "render", {}, True)
    assert job["status"] == "queued"
    finished = studio.update_job(job["id"], status="succeeded", result={"output_path": "x.mp4"})
    assert finished["status"] == "succeeded"
    assert finished["result_json"] == {"output_path": "x.mp4"}


def test_render_job_without_approval_cannot_run(studio):
    project = make_project(studio, [{"in": 0.0, "out": 4.0, "keep": True}])
    job = studio.create_job(project["id"], "render", {}, False)
    with pytest.raises(ValueError):
        studio._validate_runnable(job)


# -- bot execution policy: regression coverage for plan item 0.3 -------------

def test_bot_auto_executes_defaults_to_false_for_unknown_bot(studio):
    auto_local, policy = studio.bot_auto_executes({"bot_id": "brand-new-bot"})
    assert auto_local is False
    assert policy["mode"] == "approval_required"


def test_bot_auto_executes_true_once_policy_is_auto_local(studio):
    studio.set_execution_policy({"bot_id": "editor-01", "mode": "auto_local"})
    auto_local, policy = studio.bot_auto_executes({"bot_id": "editor-01"})
    assert auto_local is True
    assert policy["mode"] == "auto_local"


# -- project bundle export/import roundtrip -----------------------------------

def test_bundle_export_import_roundtrip(studio):
    project = make_project(studio, [{"in": 0.0, "out": 4.0, "keep": True, "caption": "HI"}])
    studio.save_artifact(project["id"], "project_memory", "note", {"summary": "hello"})
    bundle = studio.export_project_bundle(project["id"])
    assert bundle["schema"] == studio.PROJECT_BUNDLE_SCHEMA

    imported = studio.import_project_bundle({"bundle": bundle})
    assert imported["project"]["title"].endswith("(imported)")
    assert imported["project"]["timeline_json"]["clips"] == bundle["project"]["timeline"]["clips"]
    assert len(imported["artifacts"]) == 1

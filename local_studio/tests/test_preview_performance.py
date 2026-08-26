"""Draft program-monitor preview stays cheaper than the full-quality path."""

from __future__ import annotations

import math
from pathlib import Path

import pytest

import config
from desktop_domain import ensure_timeline_version, get_timeline
from preview import preview_at
from proxy import ready_proxy_paths, update_proxy
from render import draft_preview_size, encoder_settings, original_asset_path, preview_asset_path


def test_encoder_settings_prefer_faster_presets():
    assert encoder_settings("compact") == ("3500k", "veryfast")
    assert encoder_settings("balanced") == ("6000k", "faster")
    assert encoder_settings("high") == ("9000k", "medium")
    assert encoder_settings("unknown") == ("6000k", "faster")


def test_draft_preview_size_caps_vertical_1080():
    assert draft_preview_size(1080, 1920) == (540, 960)
    assert draft_preview_size(1920, 1080) == (540, 304)
    assert draft_preview_size(160, 90) == (160, 90)


def test_preview_asset_path_uses_ready_proxy_then_falls_back(studio):
    original = config.WORKSPACE_DIR / "inputs" / "path-original.mp4"
    proxy = config.WORKSPACE_DIR / "proxies" / "path-proxy.mp4"
    original.parent.mkdir(parents=True, exist_ok=True)
    proxy.parent.mkdir(parents=True, exist_ok=True)
    original.write_bytes(b"orig")
    proxy.write_bytes(b"proxy")
    asset = {"id": "clip", "path": str(original)}

    assert preview_asset_path(asset, {"clip": proxy}) == proxy
    assert preview_asset_path(asset, {"clip": proxy.parent / "missing.mp4"}) == original
    assert original_asset_path({**asset, "proxy_path": str(proxy)}) == original


def _color_source(path: Path, color: tuple[int, int, int], duration: float = 1.0) -> Path:
    from moviepy import AudioClip, VideoClip
    import numpy as np

    path.parent.mkdir(parents=True, exist_ok=True)

    def frame(_at):
        return np.tile(np.array(color, dtype=np.uint8), (90, 160, 1))

    audio = AudioClip(lambda at: 0.2 * np.sin(2 * math.pi * 440 * np.asarray(at)), duration=duration, fps=8_000)
    clip = VideoClip(frame_function=frame, duration=duration).with_audio(audio)
    clip.write_videofile(str(path), fps=24, codec="libx264", audio_codec="aac", logger=None, ffmpeg_params=["-preset", "ultrafast"])
    clip.close()
    audio.close()
    return path


def _timeline(source: Path, *, width: int = 160, height: int = 90) -> dict:
    return {
        "schema": "grok-crew.timeline/v2",
        "revision": 1,
        "settings": {"width": width, "height": height, "fps": 24, "quality": "compact", "background": "#000000"},
        "assets": [{"id": "source", "kind": "video", "name": "Source", "path": str(source), "duration": 1}],
        "tracks": [{
            "id": "video", "type": "video", "name": "Video", "order": 0,
            "locked": False, "muted": False, "solo": False, "volume": 1, "role": "dialogue",
            "clips": [{
                "id": "video-clip", "asset_id": "source", "timeline_start": 0, "duration": 1,
                "source_in": 0, "source_out": 1, "locked": False, "transform": {},
                "audio": {"volume": 1, "muted": False}, "keyframes": {},
            }],
        }],
        "markers": [],
    }


def test_full_preview_stays_png_at_timeline_size(studio):
    pytest.importorskip("moviepy")
    source = _color_source(config.WORKSPACE_DIR / "inputs" / "perf-full.mp4", (220, 20, 20))
    preview = preview_at(_timeline(source), 0.2)
    assert preview["preview_quality"] == "full"
    assert preview["width"] == 160
    assert preview["height"] == 90
    assert preview["mime"] == "image/png"
    assert preview["image"].startswith("data:image/png;base64,")
    assert preview["used_proxy"] is False


def test_draft_preview_is_jpeg_and_capped(studio):
    pytest.importorskip("moviepy")
    source = _color_source(config.WORKSPACE_DIR / "inputs" / "perf-draft.mp4", (20, 40, 220))
    preview = preview_at(_timeline(source, width=1080, height=1920), 0.2, quality="draft")
    assert preview["preview_quality"] == "draft"
    assert preview["width"] == 540
    assert preview["height"] == 960
    assert preview["mime"] == "image/jpeg"
    assert preview["image"].startswith("data:image/jpeg;base64,")
    assert preview["audio_rms"] > 0


def test_draft_preview_uses_ready_proxy_file(studio):
    pytest.importorskip("moviepy")
    original = _color_source(config.WORKSPACE_DIR / "inputs" / "perf-original.mp4", (220, 20, 20))
    proxy = _color_source(config.WORKSPACE_DIR / "proxies" / "perf-proxy.mp4", (20, 40, 220))
    preview = preview_at(_timeline(original, width=1080, height=1920), 0.2, quality="draft", proxy_paths={"source": proxy})
    assert preview["used_proxy"] is True
    frame = preview["frame"]
    assert frame[..., 2].mean() > frame[..., 0].mean()


def test_full_preview_ignores_proxy_paths(studio):
    pytest.importorskip("moviepy")
    original = _color_source(config.WORKSPACE_DIR / "inputs" / "perf-full-original.mp4", (220, 20, 20))
    proxy = _color_source(config.WORKSPACE_DIR / "proxies" / "perf-full-proxy.mp4", (20, 40, 220))
    preview = preview_at(_timeline(original), 0.2, quality="full", proxy_paths={"source": proxy})
    assert preview["used_proxy"] is False
    frame = preview["frame"]
    assert frame[..., 0].mean() > frame[..., 2].mean()


def test_http_preview_defaults_to_draft_and_can_request_full(studio):
    pytest.importorskip("moviepy")
    source = _color_source(config.WORKSPACE_DIR / "inputs" / "perf-http.mp4", (220, 20, 20))
    project = studio.new_project({
        "title": "Draft preview",
        "source_path": str(source.relative_to(config.WORKSPACE_DIR)),
        "output_path": "outputs/perf-http.mp4",
        "timeline": {
            "clips": [{"in": 0, "out": 1, "keep": True, "caption": ""}],
            "render_settings": {"fps": 24, "quality": "compact", "platform": "reels_tiktok_shorts"},
        },
    })
    ensure_timeline_version(project["id"])
    draft = studio.project_preview(project["id"], 0.2)
    full = studio.project_preview(project["id"], 0.2, quality="full")
    assert draft["preview_quality"] == "draft"
    assert draft["image"].startswith("data:image/jpeg")
    assert draft["width"] == 540
    assert full["preview_quality"] == "full"
    assert full["image"].startswith("data:image/png")
    assert full["width"] == 1080
    assert full["used_proxy"] is False


def test_http_preview_reuses_revision_composite(studio, monkeypatch):
    pytest.importorskip("moviepy")
    source = _color_source(config.WORKSPACE_DIR / "inputs" / "perf-cache.mp4", (220, 20, 20))
    project = studio.new_project({
        "title": "Cached preview",
        "source_path": str(source.relative_to(config.WORKSPACE_DIR)),
        "output_path": "outputs/perf-cache.mp4",
        "timeline": {
            "clips": [{"in": 0, "out": 1, "keep": True, "caption": ""}],
            "render_settings": {"fps": 24, "quality": "compact", "platform": "reels_tiktok_shorts"},
        },
    })
    ensure_timeline_version(project["id"])

    import render
    calls = {"n": 0}
    original = render._compose_timeline_v2

    def counted(*args, **kwargs):
        calls["n"] += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(render, "_compose_timeline_v2", counted)
    first = studio.project_preview(project["id"], 0.15)
    second = studio.project_preview(project["id"], 0.45)
    assert calls["n"] == 1
    assert first["preview_quality"] == "draft"
    assert second["preview_quality"] == "draft"
    assert abs(first["at"] - second["at"]) > 0.1

    from desktop_domain import PATCH_SCHEMA, apply_timeline_patch, get_timeline
    timeline = get_timeline(project["id"])["timeline"]
    apply_timeline_patch(project["id"], {
        "schema": PATCH_SCHEMA,
        "base_revision": timeline["revision"],
        "origin": "human",
        "created_by": "cache-test",
        "operations": [{"op": "set_settings", "changes": {"quality": "compact"}}],
    })
    studio.project_preview(project["id"], 0.15)
    assert calls["n"] == 2


def test_ready_proxy_paths_require_current_file(studio):
    source = config.WORKSPACE_DIR / "inputs" / "source.mp4"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"original-video")
    project = studio.new_project({
        "title": "Proxy map",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {
            "clips": [{"in": 0, "out": 8, "keep": True, "caption": ""}],
            "render_settings": {"fps": 30, "quality": "balanced"},
        },
    })
    ensure_timeline_version(project["id"])
    timeline = get_timeline(project["id"])["timeline"]
    relative = f"proxies/{project['id']}/source-main.mp4"
    destination = config.workspace_path(relative)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(b"proxy")
    update_proxy(
        project["id"], "source-main", source,
        status="ready", proxy_path=relative, progress=100, width=640, height=360,
    )
    paths = ready_proxy_paths(project["id"], timeline)
    assert paths["source-main"] == destination
    source.write_bytes(b"changed-original")
    assert ready_proxy_paths(project["id"], timeline) == {}

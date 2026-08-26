"""P2-01..P2-06 focused contract tests."""

from __future__ import annotations

import pytest

np = pytest.importorskip("numpy")

from audio_fx import apply_compressor, apply_eq, normalize_audio_fx
from color import apply_color_grade, normalize_color, parse_cube_lut, waveform_scope
from compositing import blend_pixels, chroma_alpha, mask_alpha, normalize_compositing
from exchange import export_edl, export_otio, import_edl, import_otio
from motion import ease_ratio, normalize_motion, tracker_offset
from sequence import apply_multicam, flatten_sequence_timeline


def test_compositing_normalizes_and_keys_green():
    value = normalize_compositing({
        "blend_mode": "multiply",
        "mask": {"shape": "ellipse", "feather": 0.4},
        "chroma_key": {"enabled": True, "color": "#00FF00", "similarity": 0.2, "spill": 0.1},
    })
    assert value["blend_mode"] == "multiply"
    frame = np.zeros((8, 8, 3), dtype=np.uint8)
    frame[:, :] = (0, 255, 0)
    frame[3:5, 3:5] = (40, 40, 200)
    _cleaned, alpha = chroma_alpha(frame, "#00FF00", 0.2, 0.1)
    assert float(alpha.mean()) < 0.5
    mask = mask_alpha(16, 16, "ellipse", 0.3, False)
    assert mask[8, 8] > mask[0, 0]
    mixed = blend_pixels(np.full((2, 2, 3), 100, np.uint8), np.full((2, 2, 3), 50, np.uint8), "multiply")
    assert mixed[0, 0, 0] < 100


def test_color_lut_path_must_stay_in_workspace():
    from color import apply_color_grade, normalize_color
    import numpy as np

    frame = np.zeros((4, 4, 3), dtype=np.uint8)
    with pytest.raises(ValueError):
        normalize_color({"lut": "/etc/passwd"})
    with pytest.raises(ValueError):
        apply_color_grade(frame, {"lut": "/etc/passwd", "lift": [0, 0, 0], "gamma": [1, 1, 1], "gain": [1, 1, 1], "saturation": 1})


def test_color_grade_and_lut_and_scopes(tmp_path):
    cube = tmp_path / "one.cube"
    cube.write_text("LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n")
    lut = parse_cube_lut(cube)
    assert lut["size"] == 2
    frame = np.full((12, 16, 3), (80, 90, 100), dtype=np.uint8)
    graded = apply_color_grade(frame, normalize_color({"saturation": 0, "gain": [1.2, 1.2, 1.2]}))
    assert graded[..., 0].mean() == pytest.approx(graded[..., 1].mean(), abs=2)
    scopes = waveform_scope(frame, bins=8)
    assert len(scopes["luma"]) == 8
    assert scopes["parade"]["r"][0] > 0


def test_eq_and_compressor_shape_audio():
    fx = normalize_audio_fx({"eq": {"low": 6, "mid": 0, "high": -6}, "compressor": {"enabled": True, "threshold": -12, "ratio": 4}})
    tone = np.sin(np.linspace(0, 40 * np.pi, 2048)).astype(np.float32)
    shaped = apply_eq(tone, 44100, fx["eq"])
    assert shaped.shape == tone.shape
    compressed = apply_compressor(tone * 2, 44100, fx["compressor"])
    assert float(np.abs(compressed).max()) <= float(np.abs(tone * 2).max()) + 1e-5


def test_motion_ease_and_tracker_offset():
    assert ease_ratio(0.5, "linear") == 0.5
    assert ease_ratio(0.5, "ease_in") < 0.5
    assert ease_ratio(0.5, "ease_out") > 0.5
    motion = normalize_motion({
        "stabilize": True,
        "tracker": {"attach": "position", "points": [{"id": "p1", "at": 0, "x": 0.2, "y": 0.8}]},
        "speed_ramp": {"enabled": True, "ease": "ease_in_out"},
    }, 4)
    dx, dy = tracker_offset(motion["tracker"]["points"], 0, 100, 50)
    assert dx == pytest.approx(-30)
    assert dy == pytest.approx(15)


def test_nested_sequence_and_multicam():
    nested = {
        "schema": "grok-crew.timeline/v2",
        "revision": 1,
        "settings": {"width": 160, "height": 90, "fps": 24, "quality": "compact"},
        "assets": [{"id": "inner", "kind": "video", "name": "Inner", "path": "inputs/a.mp4"}],
        "tracks": [{"id": "v", "type": "video", "name": "V", "order": 0, "locked": False, "muted": False, "clips": [
            {"id": "c", "asset_id": "inner", "timeline_start": 0.2, "duration": 1, "locked": False},
        ]}],
        "markers": [],
    }
    timeline = {
        "schema": "grok-crew.timeline/v2",
        "revision": 1,
        "settings": {"width": 160, "height": 90, "fps": 24, "quality": "compact", "multicam_active": "cam_b"},
        "assets": [{"id": "seq", "kind": "sequence", "name": "Nest", "timeline": nested}],
        "tracks": [
            {"id": "main", "type": "video", "name": "Main", "order": 0, "locked": False, "muted": False, "clips": [
                {"id": "nest", "asset_id": "seq", "timeline_start": 1, "duration": 2, "locked": False},
            ]},
            {"id": "multi", "type": "video", "name": "Cams", "order": 1, "locked": False, "muted": False, "multicam_group": "a", "clips": [
                {"id": "a", "asset_id": None, "timeline_start": 0, "duration": 1, "locked": False, "camera": "cam_a"},
                {"id": "b", "asset_id": None, "timeline_start": 0, "duration": 1, "locked": False, "camera": "cam_b"},
            ]},
        ],
        "markers": [],
    }
    flat = flatten_sequence_timeline(timeline)
    assert any(asset["id"].startswith("nest__") for asset in flat["assets"])
    switched = apply_multicam(timeline)
    cameras = [clip["camera"] for clip in switched["tracks"][1]["clips"]]
    assert cameras == ["cam_b"]


def test_edl_and_otio_round_trip():
    timeline = {
        "schema": "grok-crew.timeline/v2",
        "revision": 2,
        "settings": {"width": 1080, "height": 1920, "fps": 30, "quality": "balanced"},
        "assets": [{"id": "source", "kind": "video", "name": "Talk", "path": "inputs/talk.mp4"}],
        "tracks": [{"id": "video", "type": "video", "name": "Video", "order": 0, "locked": False, "muted": False, "clips": [
            {"id": "hook", "asset_id": "source", "timeline_start": 0, "duration": 2, "source_in": 1, "source_out": 3, "locked": False},
        ]}],
        "markers": [],
    }
    edl = export_edl(timeline, "Talk")
    assert "TITLE: Talk" in edl
    assert "FROM CLIP NAME: hook" in edl
    imported = import_edl(edl, 30)
    assert imported["tracks"][0]["clips"][0]["duration"] == pytest.approx(2)
    otio = export_otio(timeline, "Talk")
    assert otio["OTIO_SCHEMA"] == "Timeline.1"
    back = import_otio(otio)
    assert back["tracks"][0]["clips"][0]["duration"] == pytest.approx(2)

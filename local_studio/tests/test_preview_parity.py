"""P1-08: program-monitor snapshot matches the rendered MoviePy output."""

from __future__ import annotations

import math

import pytest

import config
from preview import preview_at
from render import render_moviepy
from render_contract import snapshot_at

moviepy = pytest.importorskip("moviepy")
np = pytest.importorskip("numpy")


def _golden_source():
    from moviepy import AudioClip, VideoClip

    source = config.WORKSPACE_DIR / "inputs" / "preview-parity-source.mp4"
    source.parent.mkdir(parents=True, exist_ok=True)

    def frame(at):
        color = np.array([220, 20, 20] if at < 1 else [20, 40, 220], dtype=np.uint8)
        return np.tile(color, (90, 160, 1))

    audio = AudioClip(lambda at: 0.2 * np.sin(2 * math.pi * 440 * np.asarray(at)), duration=2, fps=44_100)
    clip = VideoClip(frame_function=frame, duration=2).with_audio(audio)
    clip.write_videofile(str(source), fps=24, codec="libx264", audio_codec="aac", logger=None, ffmpeg_params=["-preset", "ultrafast"])
    clip.close()
    audio.close()
    return source


def _timeline(source):
    return {
        "schema": "grok-crew.timeline/v2",
        "revision": 3,
        "settings": {"width": 160, "height": 90, "fps": 24, "quality": "compact", "background": "#000000"},
        "assets": [{"id": "source", "kind": "video", "name": "Source", "path": str(source), "duration": 2}],
        "tracks": [
            {
                "id": "video", "type": "video", "name": "Video", "order": 0,
                "locked": False, "muted": False, "solo": False, "volume": 1, "role": "dialogue",
                "clips": [{
                    "id": "video-clip", "asset_id": "source", "timeline_start": 0, "duration": 2,
                    "source_in": 0, "source_out": 2, "locked": False, "transform": {},
                    "audio": {"volume": 1, "muted": False}, "keyframes": {},
                }],
            },
            {
                "id": "captions", "type": "caption", "name": "Captions", "order": 10,
                "locked": False, "muted": False, "solo": False,
                "clips": [{
                    "id": "caption", "asset_id": None, "timeline_start": 0.5, "duration": 0.5,
                    "locked": False, "text": "GOLDEN", "style": {"position_y": 50, "size": 20}, "keyframes": {},
                }],
            },
        ],
        "markers": [],
    }


def test_snapshot_at_matches_caption_and_active_clips():
    timeline = _timeline("/tmp/unused.mp4")
    before = snapshot_at(timeline, 0.25)
    during = snapshot_at(timeline, 0.75)
    after = snapshot_at(timeline, 1.25)
    assert before["caption"] == ""
    assert during["caption"] == "GOLDEN"
    assert after["caption"] == ""
    assert "caption" in during["active_clip_ids"]
    assert before["frame_index"] == 6
    assert during["visual_clip_ids"] == ["video-clip", "caption"]


def test_preview_frames_match_rendered_output(studio):
    from moviepy import VideoFileClip

    source = _golden_source()
    output = config.WORKSPACE_DIR / "outputs" / "preview-parity.mp4"
    timeline = _timeline(source)
    render_moviepy({"id": "parity", "source_path": str(source), "output_path": str(output), "timeline_json": timeline})
    rendered = VideoFileClip(str(output))
    try:
        for at in (0.25, 0.75, 1.25):
            preview = preview_at(timeline, at)
            frame = rendered.get_frame(min(at, rendered.duration - 0.01))
            assert preview["caption"] == snapshot_at(timeline, at)["caption"]
            assert preview["width"] == 160
            assert preview["height"] == 90
            assert preview["audio_rms"] > 0.001
            delta = np.abs(preview["frame"].astype(np.int16) - frame.astype(np.int16)).mean()
            assert delta < 18
    finally:
        rendered.close()

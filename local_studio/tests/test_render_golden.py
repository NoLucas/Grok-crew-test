"""P1-08 representative frame, timing, caption, and audio golden render."""

from __future__ import annotations

import math

import pytest

import config
from render import render_moviepy
from render_contract import timeline_render_contract

moviepy = pytest.importorskip("moviepy")
np = pytest.importorskip("numpy")


def test_timeline_render_matches_frame_timing_caption_and_audio_contract(studio):
    from moviepy import AudioClip, VideoClip, VideoFileClip

    source = config.WORKSPACE_DIR / "inputs" / "golden-source.mp4"
    output = config.WORKSPACE_DIR / "outputs" / "golden-output.mp4"
    source.parent.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)

    def frame(at):
        color = np.array([220, 20, 20] if at < 1 else [20, 40, 220], dtype=np.uint8)
        return np.tile(color, (90, 160, 1))

    audio = AudioClip(
        lambda at: 0.2 * np.sin(2 * math.pi * 440 * np.asarray(at)),
        duration=2,
        fps=44_100,
    )
    source_clip = VideoClip(frame_function=frame, duration=2).with_audio(audio)
    source_clip.write_videofile(
        str(source),
        fps=24,
        codec="libx264",
        audio_codec="aac",
        logger=None,
        ffmpeg_params=["-preset", "ultrafast"],
    )
    source_clip.close()
    audio.close()

    timeline = {
        "schema": "grok-crew.timeline/v2",
        "revision": 3,
        "settings": {
            "width": 160,
            "height": 90,
            "fps": 24,
            "quality": "compact",
            "background": "#000000",
            "snapping_enabled": True,
            "snap_tolerance_frames": 6,
        },
        "assets": [{
            "id": "source",
            "kind": "video",
            "name": "Golden source",
            "path": str(source),
            "duration": 2,
            "proxy_path": "proxies/should-never-render.mp4",
        }],
        "tracks": [
            {
                "id": "video",
                "type": "video",
                "name": "Video",
                "order": 0,
                "locked": False,
                "muted": False,
                "solo": False,
                "volume": 1,
                "role": "dialogue",
                "ducking": False,
                "duck_level": .35,
                "clips": [{
                    "id": "video-clip",
                    "asset_id": "source",
                    "timeline_start": 0,
                    "duration": 2,
                    "source_in": 0,
                    "source_out": 2,
                    "locked": False,
                    "transform": {},
                    "audio": {"volume": 1, "muted": False},
                    "keyframes": {},
                }],
            },
            {
                "id": "captions",
                "type": "caption",
                "name": "Captions",
                "order": 10,
                "locked": False,
                "muted": False,
                "solo": False,
                "clips": [{
                    "id": "caption",
                    "asset_id": None,
                    "timeline_start": .5,
                    "duration": .5,
                    "locked": False,
                    "text": "GOLDEN",
                    "style": {"position_y": 50, "size": 20},
                    "keyframes": {},
                }],
            },
        ],
        "markers": [],
    }
    contract = timeline_render_contract(timeline)
    result = render_moviepy({
        "id": "golden",
        "source_path": str(source),
        "output_path": str(output),
        "timeline_json": timeline,
    })

    assert result["duration"] == 2
    assert result["frame_count"] == 48
    assert result["render_contract"] == contract
    assert result["audio"] == "AAC"

    rendered = VideoFileClip(str(output))
    assert rendered.duration == pytest.approx(2, abs=.05)
    red_frame = rendered.get_frame(.25)
    caption_frame = rendered.get_frame(.75)
    blue_frame = rendered.get_frame(1.25)
    assert red_frame[..., 0].mean() > red_frame[..., 2].mean() * 2
    assert blue_frame[..., 2].mean() > blue_frame[..., 0].mean() * 2
    assert np.count_nonzero(caption_frame.mean(axis=2) > 180) > np.count_nonzero(red_frame.mean(axis=2) > 180)
    assert rendered.audio is not None
    samples = rendered.audio.to_soundarray(tt=np.array([.201, .253, .307]), fps=44_100)
    assert float(np.abs(samples).mean()) > .001
    rendered.close()

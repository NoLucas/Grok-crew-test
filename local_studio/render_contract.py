"""Pure preview/render expectations used by UI and golden output tests."""

from __future__ import annotations

from typing import Any


def timeline_render_contract(timeline: dict[str, Any]) -> dict[str, Any]:
    settings = timeline.get("settings") if isinstance(timeline.get("settings"), dict) else {}
    fps = int(settings.get("fps", 30))
    fps = fps if fps in {24, 30, 60} else 30
    tracks = [track for track in timeline.get("tracks", []) if isinstance(track, dict)]
    any_solo = any(bool(track.get("solo")) for track in tracks)
    active_tracks = [
        track for track in tracks
        if not track.get("muted") and (not any_solo or track.get("solo"))
    ]
    clips = [
        (track, clip)
        for track in active_tracks
        for clip in track.get("clips", [])
        if isinstance(clip, dict)
    ]
    duration = max(
        (
            float(clip.get("timeline_start", 0)) + float(clip.get("duration", 0))
            for _track, clip in clips
        ),
        default=0,
    )
    return {
        "revision": int(timeline.get("revision", 1)),
        "fps": fps,
        "duration": duration,
        "frame_count": int(round(duration * fps)),
        "active_track_ids": [str(track.get("id")) for track in active_tracks],
        "visual_clip_ids": [
            str(clip.get("id"))
            for track, clip in clips
            if track.get("type") in {"video", "overlay", "caption"}
        ],
        "audio_clip_ids": [
            str(clip.get("id"))
            for track, clip in clips
            if track.get("type") in {"video", "audio"}
            and not (isinstance(clip.get("audio"), dict) and clip["audio"].get("muted"))
        ],
        "caption_cues": [
            {
                "id": str(clip.get("id")),
                "start": float(clip.get("timeline_start", 0)),
                "end": float(clip.get("timeline_start", 0)) + float(clip.get("duration", 0)),
                "text": str(clip.get("text", "")),
            }
            for track, clip in clips
            if track.get("type") == "caption" and str(clip.get("text", "")).strip()
        ],
    }

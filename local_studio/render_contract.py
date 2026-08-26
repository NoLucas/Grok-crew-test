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


def _clip_window(clip: dict[str, Any]) -> tuple[float, float]:
    start = float(clip.get("timeline_start", 0))
    return start, start + float(clip.get("duration", 0))


def snapshot_at(timeline: dict[str, Any], at: float) -> dict[str, Any]:
    """Pure time-sliced preview contract used by the program monitor and goldens."""
    contract = timeline_render_contract(timeline)
    time = max(0.0, float(at))
    tracks = [track for track in timeline.get("tracks", []) if isinstance(track, dict)]
    active_ids = set(contract["active_track_ids"])
    visible: list[dict[str, Any]] = []
    for track in tracks:
        if str(track.get("id")) not in active_ids:
            continue
        for clip in track.get("clips", []):
            if not isinstance(clip, dict):
                continue
            start, end = _clip_window(clip)
            if time < start or time >= end - 1e-9:
                continue
            visible.append({
                "id": str(clip.get("id")),
                "track_id": str(track.get("id")),
                "track_type": str(track.get("type")),
                "start": start,
                "end": end,
                "text": str(clip.get("text", "")),
            })
    captions = [
        cue["text"]
        for cue in contract["caption_cues"]
        if cue["start"] <= time < cue["end"]
    ]
    return {
        **contract,
        "at": time,
        "frame_index": min(contract["frame_count"] - 1, int(round(time * contract["fps"]))) if contract["frame_count"] else 0,
        "active_clip_ids": [item["id"] for item in visible],
        "caption": captions[-1] if captions else "",
        "visible_clips": visible,
    }

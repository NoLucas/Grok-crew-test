"""P2-06 CMX EDL / OTIO-shaped exchange and render-queue helpers."""

from __future__ import annotations

from typing import Any

from config import workspace_path
from render_contract import timeline_render_contract


def _workspace_media_path(value: str) -> str:
    path = value.strip()
    if path.startswith("file://"):
        path = path[7:]
    if not path:
        return ""
    workspace_path(path)
    return path


def _timecode(seconds: float, fps: int) -> str:
    total = max(0, int(round(float(seconds) * fps)))
    frames = total % fps
    total //= fps
    secs = total % 60
    total //= 60
    minutes = total % 60
    hours = total // 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}:{frames:02d}"


def export_edl(timeline: dict[str, Any], title: str = "Grok Crew") -> str:
    fps = int(timeline_render_contract(timeline)["fps"])
    lines = [f"TITLE: {title}", "FCM: NON-DROP FRAME", ""]
    event = 1
    for track in timeline.get("tracks", []):
        if not isinstance(track, dict) or track.get("type") not in {"video", "audio"}:
            continue
        reel = "AX" if track.get("type") == "video" else "A1"
        kind = "V" if track.get("type") == "video" else "A"
        for clip in track.get("clips", []):
            if not isinstance(clip, dict):
                continue
            src_in = float(clip.get("source_in", 0))
            src_out = float(clip.get("source_out", src_in + float(clip.get("duration", 0))))
            rec_in = float(clip.get("timeline_start", 0))
            rec_out = rec_in + float(clip.get("duration", 0))
            lines.append(
                f"{event:03d}  {reel:<4} {kind}     C        "
                f"{_timecode(src_in, fps)} {_timecode(src_out, fps)} "
                f"{_timecode(rec_in, fps)} {_timecode(rec_out, fps)}"
            )
            label = str(clip.get("id") or "")
            if label:
                lines.append(f"* FROM CLIP NAME: {label}")
            event += 1
    return "\n".join(lines).rstrip() + "\n"


def export_otio(timeline: dict[str, Any], name: str = "Grok Crew") -> dict[str, Any]:
    fps = int(timeline_render_contract(timeline)["fps"])
    tracks = []
    assets = {str(item.get("id")): item for item in timeline.get("assets", []) if isinstance(item, dict)}
    for track in timeline.get("tracks", []):
        if not isinstance(track, dict):
            continue
        children = []
        cursor = 0.0
        for clip in sorted(track.get("clips", []), key=lambda item: float(item.get("timeline_start", 0))):
            if not isinstance(clip, dict):
                continue
            start = float(clip.get("timeline_start", 0))
            duration = float(clip.get("duration", 0))
            if start > cursor:
                children.append({
                    "OTIO_SCHEMA": "Gap.1",
                    "name": "gap",
                    "source_range": {
                        "OTIO_SCHEMA": "TimeRange.1",
                        "duration": {"OTIO_SCHEMA": "RationalTime.1", "rate": fps, "value": (start - cursor) * fps},
                    },
                })
            asset = assets.get(str(clip.get("asset_id")))
            children.append({
                "OTIO_SCHEMA": "Clip.1",
                "name": clip.get("id"),
                "media_reference": {
                    "OTIO_SCHEMA": "ExternalReference.1",
                    "target_url": (asset or {}).get("path", ""),
                    "available_range": {
                        "OTIO_SCHEMA": "TimeRange.1",
                        "start_time": {"OTIO_SCHEMA": "RationalTime.1", "rate": fps, "value": float(clip.get("source_in", 0)) * fps},
                        "duration": {"OTIO_SCHEMA": "RationalTime.1", "rate": fps, "value": duration * fps},
                    },
                },
                "source_range": {
                    "OTIO_SCHEMA": "TimeRange.1",
                    "start_time": {"OTIO_SCHEMA": "RationalTime.1", "rate": fps, "value": float(clip.get("source_in", 0)) * fps},
                    "duration": {"OTIO_SCHEMA": "RationalTime.1", "rate": fps, "value": duration * fps},
                },
            })
            cursor = start + duration
        tracks.append({
            "OTIO_SCHEMA": "Track.1",
            "name": track.get("name") or track.get("id"),
            "kind": "Video" if track.get("type") in {"video", "overlay", "caption"} else "Audio",
            "children": children,
        })
    return {
        "OTIO_SCHEMA": "Timeline.1",
        "name": name,
        "global_start_time": {"OTIO_SCHEMA": "RationalTime.1", "rate": fps, "value": 0},
        "tracks": {"OTIO_SCHEMA": "Stack.1", "children": tracks},
        "metadata": {"grok_crew": {"schema": timeline.get("schema"), "revision": timeline.get("revision")}},
    }


def import_edl(text: str, fps: int = 30) -> dict[str, Any]:
    clips: list[dict[str, Any]] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 8 or not parts[0].isdigit():
            continue
        rec_in = _parse_timecode(parts[-2], fps)
        rec_out = _parse_timecode(parts[-1], fps)
        src_in = _parse_timecode(parts[-4], fps)
        src_out = _parse_timecode(parts[-3], fps)
        duration = max(rec_out - rec_in, 1 / max(fps, 1))
        clips.append({
            "id": f"edl-{parts[0]}",
            "asset_id": "source",
            "timeline_start": rec_in,
            "duration": duration,
            "source_in": src_in,
            "source_out": src_out,
            "locked": False,
        })
    return {
        "schema": "grok-crew.timeline/v2",
        "revision": 1,
        "settings": {"width": 1080, "height": 1920, "fps": fps, "quality": "balanced"},
        "assets": [{"id": "source", "kind": "video", "name": "EDL source"}],
        "tracks": [{
            "id": "video",
            "type": "video",
            "name": "Video",
            "order": 0,
            "locked": False,
            "muted": False,
            "clips": clips,
        }],
        "markers": [],
    }


def import_otio(payload: dict[str, Any]) -> dict[str, Any]:
    fps = int(((payload.get("global_start_time") or {}).get("rate")) or 30)
    tracks = []
    assets: list[dict[str, Any]] = []
    stack = payload.get("tracks") if isinstance(payload.get("tracks"), dict) else {}
    for index, track in enumerate(stack.get("children") or []):
        if not isinstance(track, dict):
            continue
        kind = "video" if str(track.get("kind", "Video")).lower().startswith("v") else "audio"
        clips = []
        cursor = 0.0
        for child in track.get("children") or []:
            if not isinstance(child, dict):
                continue
            duration = _otio_seconds(child.get("source_range"), fps)
            if str(child.get("OTIO_SCHEMA", "")).startswith("Gap"):
                cursor += duration
                continue
            reference = child.get("media_reference") if isinstance(child.get("media_reference"), dict) else {}
            asset_id = f"otio-{index}-{len(assets)}"
            media_path = _workspace_media_path(str(reference.get("target_url") or ""))
            assets.append({
                "id": asset_id,
                "kind": "video" if kind == "video" else "audio",
                "name": str(child.get("name") or asset_id),
                "path": media_path,
            })
            source_in = _otio_start(child.get("source_range"), fps)
            clips.append({
                "id": f"clip-{index}-{len(clips)}",
                "asset_id": asset_id,
                "timeline_start": cursor,
                "duration": max(duration, 1 / max(fps, 1)),
                "source_in": source_in,
                "source_out": source_in + duration,
                "locked": False,
            })
            cursor += duration
        tracks.append({
            "id": f"track-{index}",
            "type": kind,
            "name": str(track.get("name") or f"Track {index + 1}"),
            "order": index,
            "locked": False,
            "muted": False,
            "clips": clips,
        })
    return {
        "schema": "grok-crew.timeline/v2",
        "revision": 1,
        "settings": {"width": 1080, "height": 1920, "fps": fps, "quality": "balanced"},
        "assets": assets,
        "tracks": tracks,
        "markers": [],
    }


def _otio_seconds(range_obj: Any, fps: int) -> float:
    if not isinstance(range_obj, dict):
        return 0.0
    duration = range_obj.get("duration") if isinstance(range_obj.get("duration"), dict) else {}
    return float(duration.get("value") or 0) / max(float(duration.get("rate") or fps), 1)


def _otio_start(range_obj: Any, fps: int) -> float:
    if not isinstance(range_obj, dict):
        return 0.0
    start = range_obj.get("start_time") if isinstance(range_obj.get("start_time"), dict) else {}
    return float(start.get("value") or 0) / max(float(start.get("rate") or fps), 1)


def _parse_timecode(value: str, fps: int) -> float:
    parts = value.split(":")
    if len(parts) != 4:
        return 0.0
    hours, minutes, seconds, frames = (int(part) for part in parts)
    return hours * 3600 + minutes * 60 + seconds + frames / max(fps, 1)

"""P2-03 nested sequences and multicam switching."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def normalize_sequence_asset(asset: dict[str, Any]) -> dict[str, Any]:
    if asset.get("kind") != "sequence":
        return asset
    nested = asset.get("timeline")
    if not isinstance(nested, dict):
        raise ValueError("sequence assets must include a nested timeline object.")
    asset["timeline"] = nested
    return asset


def flatten_sequence_timeline(timeline: dict[str, Any], *, depth: int = 0) -> dict[str, Any]:
    """Inline nested sequence assets so the existing renderer can compose them."""
    if depth > 3:
        raise ValueError("Nested sequences may only be three levels deep.")
    expanded = deepcopy(timeline)
    assets = {str(item.get("id")): item for item in expanded.get("assets", []) if isinstance(item, dict)}
    extra_assets: list[dict[str, Any]] = []
    extra_tracks: list[dict[str, Any]] = []
    kept_tracks: list[dict[str, Any]] = []
    for track in expanded.get("tracks", []):
        if not isinstance(track, dict):
            continue
        remaining = []
        for clip in track.get("clips", []):
            if not isinstance(clip, dict):
                continue
            asset = assets.get(str(clip.get("asset_id")))
            if not asset or asset.get("kind") != "sequence":
                remaining.append(clip)
                continue
            nested = flatten_sequence_timeline(asset.get("timeline") or {}, depth=depth + 1)
            offset = float(clip.get("timeline_start", 0))
            clip_duration = float(clip.get("duration", 0))
            for nested_asset in nested.get("assets", []):
                if not isinstance(nested_asset, dict):
                    continue
                cloned = deepcopy(nested_asset)
                cloned["id"] = f"{clip['id']}__{cloned['id']}"
                extra_assets.append(cloned)
            for nested_track in nested.get("tracks", []):
                if not isinstance(nested_track, dict):
                    continue
                cloned_track = deepcopy(nested_track)
                cloned_track["id"] = f"{track['id']}__{clip['id']}__{cloned_track['id']}"
                cloned_track["order"] = int(track.get("order", 0)) + int(cloned_track.get("order", 0)) * 0.01
                cloned_clips = []
                for nested_clip in cloned_track.get("clips", []):
                    if not isinstance(nested_clip, dict):
                        continue
                    start = offset + float(nested_clip.get("timeline_start", 0))
                    if start >= offset + clip_duration:
                        continue
                    nested_clip["id"] = f"{clip['id']}__{nested_clip['id']}"
                    nested_clip["timeline_start"] = start
                    if nested_clip.get("asset_id"):
                        nested_clip["asset_id"] = f"{clip['id']}__{nested_clip['asset_id']}"
                    nested_clip["duration"] = min(float(nested_clip.get("duration", 0)), offset + clip_duration - start)
                    if nested_clip["duration"] > 0:
                        cloned_clips.append(nested_clip)
                cloned_track["clips"] = cloned_clips
                extra_tracks.append(cloned_track)
        track["clips"] = remaining
        kept_tracks.append(track)
    expanded["assets"] = [item for item in expanded.get("assets", []) if item.get("kind") != "sequence"] + extra_assets
    expanded["tracks"] = kept_tracks + extra_tracks
    return expanded


def apply_multicam(timeline: dict[str, Any]) -> dict[str, Any]:
    """Keep only the active camera clip inside each multicam group."""
    settings = timeline.get("settings") if isinstance(timeline.get("settings"), dict) else {}
    active = str(settings.get("multicam_active") or "").strip()
    if not active:
        return timeline
    switched = deepcopy(timeline)
    for track in switched.get("tracks", []):
        if not isinstance(track, dict):
            continue
        group = str(track.get("multicam_group") or "").strip()
        if not group:
            continue
        kept = []
        for clip in track.get("clips", []):
            if not isinstance(clip, dict):
                continue
            camera = str(clip.get("camera") or "").strip()
            if not camera or camera == active:
                kept.append(clip)
        track["clips"] = kept
    return switched


def prepare_timeline(timeline: dict[str, Any]) -> dict[str, Any]:
    return apply_multicam(flatten_sequence_timeline(timeline))

"""P1-08 program-monitor snapshot: same composition as the final MoviePy render."""

from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any

from render import sample_timeline_frame
from render_contract import snapshot_at


def encode_png(frame: Any) -> str:
    from PIL import Image

    image = Image.fromarray(frame)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def encode_jpeg(frame: Any, *, quality: int = 82) -> str:
    from PIL import Image

    image = Image.fromarray(frame)
    if image.mode != "RGB":
        image = image.convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def preview_at(
    timeline: dict[str, Any],
    at: float,
    *,
    include_image: bool = True,
    quality: str = "full",
    proxy_paths: dict[str, Path] | None = None,
) -> dict[str, Any]:
    """Sample the timeline at `at`.

    Python callers default to `quality="full"` so parity goldens stay 1:1 with
    the final MP4. The HTTP program monitor defaults to draft instead.
    """
    logical = snapshot_at(timeline, at)
    preview_quality = "draft" if quality == "draft" else "full"
    payload = {
        "at": logical["at"],
        "revision": logical["revision"],
        "fps": logical["fps"],
        "duration": logical["duration"],
        "frame_count": logical["frame_count"],
        "frame_index": logical["frame_index"],
        "caption": logical["caption"],
        "active_track_ids": logical["active_track_ids"],
        "active_clip_ids": logical["active_clip_ids"],
        "visual_clip_ids": logical["visual_clip_ids"],
        "audio_clip_ids": logical["audio_clip_ids"],
        "visible_clips": logical["visible_clips"],
        "preview_quality": preview_quality,
        "used_proxy": False,
        "render_contract": {
            key: logical[key]
            for key in ("revision", "fps", "duration", "frame_count", "active_track_ids", "visual_clip_ids", "audio_clip_ids", "caption_cues")
        },
    }
    if not include_image:
        return payload
    sampled = sample_timeline_frame(
        timeline,
        logical["at"],
        preview={"quality": preview_quality, "proxy_paths": proxy_paths or {}},
    )
    if preview_quality == "draft":
        payload["image"] = f"data:image/jpeg;base64,{encode_jpeg(sampled['frame'])}"
        payload["mime"] = "image/jpeg"
    else:
        payload["image"] = f"data:image/png;base64,{encode_png(sampled['frame'])}"
        payload["mime"] = "image/png"
    payload.update({
        "width": sampled["width"],
        "height": sampled["height"],
        "audio_rms": sampled["audio_rms"],
        "frame": sampled["frame"],
        "used_proxy": bool(sampled.get("used_proxy")),
    })
    return payload

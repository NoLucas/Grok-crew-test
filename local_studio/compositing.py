"""P2-01 clip compositing: blend modes, geometric masks, chroma key."""

from __future__ import annotations

from typing import Any

BLEND_MODES = ("normal", "multiply", "screen", "overlay", "add")
MASK_SHAPES = ("none", "rectangle", "ellipse")


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normalize_compositing(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    blend = str(raw.get("blend_mode", "normal"))
    if blend not in BLEND_MODES:
        raise ValueError("clip.compositing.blend_mode must be normal, multiply, screen, overlay, or add.")
    mask_raw = raw.get("mask") if isinstance(raw.get("mask"), dict) else {}
    shape = str(mask_raw.get("shape", "none"))
    if shape not in MASK_SHAPES:
        raise ValueError("clip.compositing.mask.shape must be none, rectangle, or ellipse.")
    try:
        feather = float(mask_raw.get("feather", 0))
    except (TypeError, ValueError) as exc:
        raise ValueError("clip.compositing.mask.feather must be numeric.") from exc
    chroma_raw = raw.get("chroma_key") if isinstance(raw.get("chroma_key"), dict) else {}
    color = str(chroma_raw.get("color", "#00FF00"))
    if not color.startswith("#") or len(color) not in {4, 7}:
        raise ValueError("clip.compositing.chroma_key.color must be a hex color.")
    try:
        similarity = float(chroma_raw.get("similarity", 0.28))
        spill = float(chroma_raw.get("spill", 0.12))
    except (TypeError, ValueError) as exc:
        raise ValueError("chroma key similarity and spill must be numeric.") from exc
    return {
        "blend_mode": blend,
        "mask": {
            "shape": shape,
            "feather": _clamp(feather, 0, 1),
            "invert": bool(mask_raw.get("invert", False)),
        },
        "chroma_key": {
            "enabled": bool(chroma_raw.get("enabled", False)),
            "color": color.upper() if len(color) == 7 else color,
            "similarity": _clamp(similarity, 0, 1),
            "spill": _clamp(spill, 0, 1),
        },
    }


def parse_hex_color(value: str) -> tuple[int, int, int]:
    color = value.lstrip("#")
    if len(color) == 3:
        color = "".join(channel * 2 for channel in color)
    return tuple(int(color[index:index + 2], 16) for index in (0, 2, 4))  # type: ignore[return-value]


def blend_pixels(base: Any, overlay: Any, mode: str) -> Any:
    import numpy as np

    bottom = base.astype(np.float32)
    top = overlay.astype(np.float32)
    if mode == "multiply":
        mixed = (bottom / 255.0) * (top / 255.0) * 255.0
    elif mode == "screen":
        mixed = 255.0 - ((255.0 - bottom) * (255.0 - top) / 255.0)
    elif mode == "add":
        mixed = np.clip(bottom + top, 0, 255)
    elif mode == "overlay":
        low = (2.0 * bottom * top) / 255.0
        high = 255.0 - (2.0 * (255.0 - bottom) * (255.0 - top) / 255.0)
        mixed = np.where(bottom < 128.0, low, high)
    else:
        mixed = top
    return np.clip(mixed, 0, 255).astype(np.uint8)


def mask_alpha(height: int, width: int, shape: str, feather: float, invert: bool) -> Any:
    import numpy as np

    if shape == "none":
        alpha = np.ones((height, width), dtype=np.float32)
    else:
        ys, xs = np.ogrid[:height, :width]
        cy, cx = (height - 1) / 2.0, (width - 1) / 2.0
        ny = np.abs((ys - cy) / max(cy, 1e-6))
        nx = np.abs((xs - cx) / max(cx, 1e-6))
        if shape == "ellipse":
            distance = np.sqrt(nx * nx + ny * ny)
        else:
            distance = np.maximum(nx, ny)
        edge = max(0.02, 1.0 - feather)
        alpha = np.clip((1.0 - distance) / max(1.0 - edge, 1e-6), 0, 1).astype(np.float32)
    return 1.0 - alpha if invert else alpha


def chroma_alpha(frame: Any, color: str, similarity: float, spill: float) -> tuple[Any, Any]:
    import numpy as np

    target = np.array(parse_hex_color(color), dtype=np.float32)
    pixels = frame.astype(np.float32)
    distance = np.linalg.norm(pixels - target, axis=2) / 441.67295593
    alpha = np.clip((distance - similarity) / max(1.0 - similarity, 1e-6), 0, 1)
    cleaned = pixels.copy()
    if spill > 0:
        green_excess = np.clip(pixels[..., 1] - np.maximum(pixels[..., 0], pixels[..., 2]), 0, 255)
        cleaned[..., 1] = np.clip(cleaned[..., 1] - green_excess * spill, 0, 255)
    return np.clip(cleaned, 0, 255).astype(np.uint8), alpha.astype(np.float32)


def apply_compositing(layer: Any, compositing: dict[str, Any]) -> Any:
    """Attach mask / chroma / blend metadata to a MoviePy layer without changing duration."""
    mask = compositing.get("mask") if isinstance(compositing.get("mask"), dict) else {}
    chroma = compositing.get("chroma_key") if isinstance(compositing.get("chroma_key"), dict) else {}
    needs_mask = mask.get("shape", "none") != "none" or chroma.get("enabled")
    layer.blend_mode = compositing.get("blend_mode", "normal")
    if not needs_mask:
        return layer

    source = layer

    def rgb_frame(get_frame, at):
        frame = get_frame(at)
        if chroma.get("enabled"):
            frame, _alpha = chroma_alpha(
                frame,
                str(chroma.get("color", "#00FF00")),
                float(chroma.get("similarity", 0.28)),
                float(chroma.get("spill", 0.12)),
            )
        return frame

    def mask_values(at):
        frame = source.get_frame(at)
        height, width = frame.shape[:2]
        alpha = mask_alpha(
            height,
            width,
            str(mask.get("shape", "none")),
            float(mask.get("feather", 0)),
            bool(mask.get("invert")),
        )
        if chroma.get("enabled"):
            _cleaned, chroma_mask = chroma_alpha(
                frame,
                str(chroma.get("color", "#00FF00")),
                float(chroma.get("similarity", 0.28)),
                float(chroma.get("spill", 0.12)),
            )
            alpha = alpha * chroma_mask
        return alpha

    transformed = layer.transform(rgb_frame, keep_duration=True)
    from moviepy import VideoClip

    mask_clip = VideoClip(frame_function=mask_values, is_mask=True, duration=layer.duration)
    if layer.mask is not None:
        existing = layer.mask

        def combined(get_frame, at):
            base = get_frame(at)
            if getattr(base, "ndim", 2) == 3:
                base = base.mean(axis=2)
            return base * mask_values(at)

        mask_clip = existing.transform(combined, keep_duration=True)
    transformed = transformed.with_mask(mask_clip)
    transformed.blend_mode = compositing.get("blend_mode", "normal")
    return transformed

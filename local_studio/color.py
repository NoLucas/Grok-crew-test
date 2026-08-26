"""P2-04 color grade, LUT application, and waveform/parade scopes."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def normalize_color(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    lut = str(raw.get("lut", "") or "").strip()
    try:
        lift = [float(channel) for channel in (raw.get("lift") or [0, 0, 0])]
        gamma = [float(channel) for channel in (raw.get("gamma") or [1, 1, 1])]
        gain = [float(channel) for channel in (raw.get("gain") or [1, 1, 1])]
        saturation = float(raw.get("saturation", 1))
    except (TypeError, ValueError) as exc:
        raise ValueError("clip.color lift/gamma/gain/saturation must be numeric.") from exc
    if len(lift) != 3 or len(gamma) != 3 or len(gain) != 3:
        raise ValueError("clip.color lift, gamma, and gain must each have 3 channels.")
    return {
        "lut": lut,
        "lift": [_clamp(channel, -0.5, 0.5) for channel in lift],
        "gamma": [_clamp(channel, 0.2, 4) for channel in gamma],
        "gain": [_clamp(channel, 0, 4) for channel in gain],
        "saturation": _clamp(saturation, 0, 4),
    }


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def parse_cube_lut(path: Path) -> dict[str, Any]:
    size = 2
    table: list[tuple[float, float, float]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.upper().startswith("LUT_3D_SIZE"):
            size = max(2, int(stripped.split()[-1]))
            continue
        if stripped[0].isalpha():
            continue
        parts = stripped.split()
        if len(parts) >= 3:
            table.append((float(parts[0]), float(parts[1]), float(parts[2])))
    expected = size ** 3
    if len(table) < expected:
        table.extend([(0.0, 0.0, 0.0)] * (expected - len(table)))
    return {"size": size, "table": table[:expected]}


def apply_cube_lut(frame: Any, lut: dict[str, Any]) -> Any:
    import numpy as np

    size = int(lut["size"])
    table = np.array(lut["table"], dtype=np.float32).reshape((size, size, size, 3))
    pixels = np.clip(frame.astype(np.float32) / 255.0, 0, 1)
    scaled = pixels * (size - 1)
    i0 = np.floor(scaled).astype(np.int32)
    i1 = np.clip(i0 + 1, 0, size - 1)
    i0 = np.clip(i0, 0, size - 1)
    frac = scaled - i0
    # Trilinear sample: r=x, g=y, b=z in .cube order.
    r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]
    r1, g1, b1 = i1[..., 0], i1[..., 1], i1[..., 2]
    fr, fg, fb = frac[..., 0], frac[..., 1], frac[..., 2]
    c000 = table[b0, g0, r0]
    c001 = table[b0, g0, r1]
    c010 = table[b0, g1, r0]
    c011 = table[b0, g1, r1]
    c100 = table[b1, g0, r0]
    c101 = table[b1, g0, r1]
    c110 = table[b1, g1, r0]
    c111 = table[b1, g1, r1]
    c00 = c000 * (1 - fr)[..., None] + c001 * fr[..., None]
    c01 = c010 * (1 - fr)[..., None] + c011 * fr[..., None]
    c10 = c100 * (1 - fr)[..., None] + c101 * fr[..., None]
    c11 = c110 * (1 - fr)[..., None] + c111 * fr[..., None]
    c0 = c00 * (1 - fg)[..., None] + c01 * fg[..., None]
    c1 = c10 * (1 - fg)[..., None] + c11 * fg[..., None]
    graded = c0 * (1 - fb)[..., None] + c1 * fb[..., None]
    return np.clip(graded * 255.0, 0, 255).astype(np.uint8)


def apply_color_grade(frame: Any, color: dict[str, Any], lut_cache: dict[str, Any] | None = None) -> Any:
    import numpy as np

    pixels = frame.astype(np.float32) / 255.0
    lift = np.array(color.get("lift") or [0, 0, 0], dtype=np.float32)
    gamma = np.array(color.get("gamma") or [1, 1, 1], dtype=np.float32)
    gain = np.array(color.get("gain") or [1, 1, 1], dtype=np.float32)
    pixels = np.clip((pixels + lift) * gain, 0, 1)
    pixels = np.power(np.clip(pixels, 1e-6, 1), 1.0 / np.clip(gamma, 0.2, 4))
    saturation = float(color.get("saturation", 1))
    if abs(saturation - 1) > 1e-6:
        luma = pixels[..., 0] * 0.2126 + pixels[..., 1] * 0.7152 + pixels[..., 2] * 0.0722
        pixels = luma[..., None] + (pixels - luma[..., None]) * saturation
    graded = np.clip(pixels * 255.0, 0, 255).astype(np.uint8)
    lut_path = str(color.get("lut") or "")
    if lut_path:
        cache = lut_cache if lut_cache is not None else {}
        if lut_path not in cache:
            path = Path(lut_path)
            cache[lut_path] = parse_cube_lut(path) if path.is_file() else None
        if cache[lut_path]:
            graded = apply_cube_lut(graded, cache[lut_path])
    return graded


def waveform_scope(frame: Any, bins: int = 64) -> dict[str, Any]:
    import numpy as np

    pixels = frame.astype(np.float32)
    height = pixels.shape[0]
    columns = np.array_split(pixels, min(bins, pixels.shape[1]), axis=1)
    luma = []
    parade = {"r": [], "g": [], "b": []}
    for column in columns:
        channel_means = column.reshape(-1, 3).mean(axis=0)
        parade["r"].append(round(float(channel_means[0]), 2))
        parade["g"].append(round(float(channel_means[1]), 2))
        parade["b"].append(round(float(channel_means[2]), 2))
        luma.append(round(float(channel_means[0] * 0.2126 + channel_means[1] * 0.7152 + channel_means[2] * 0.0722), 2))
    return {
        "width": int(frame.shape[1]),
        "height": int(height),
        "luma": luma,
        "parade": parade,
    }


def apply_color(layer: Any, color: dict[str, Any]) -> Any:
    default = normalize_color({})
    if color == default or not color:
        return layer
    cache: dict[str, Any] = {}

    def grade(get_frame, at):
        return apply_color_grade(get_frame(at), color, cache)

    return layer.transform(grade, keep_duration=True)

"""Validated Timeline v2 keyframes and deterministic interpolation."""

from __future__ import annotations

import bisect
import math
from typing import Any, Callable

KEYFRAME_LIMITS: dict[str, tuple[float, float]] = {
    "x": (-10000, 10000),
    "y": (-10000, 10000),
    "scale": (0.05, 8),
    "rotation": (-3600, 3600),
    "crop_left": (0, 0.45),
    "crop_right": (0, 0.45),
    "crop_top": (0, 0.45),
    "crop_bottom": (0, 0.45),
    "opacity": (0, 1),
    "volume": (0, 4),
    "speed": (0.1, 8),
}
KEYFRAME_INTERPOLATIONS = {"linear", "hold"}


def _safe_id(value: Any) -> str:
    identifier = str(value or "").strip()[:120]
    if not identifier or not all(character.isalnum() or character in "-_." for character in identifier):
        raise ValueError("keyframe.id must use letters, numbers, hyphen, underscore, or period.")
    return identifier


def normalize_keyframes(value: Any, duration: float) -> dict[str, list[dict[str, Any]]]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("clip.keyframes must be an object.")
    normalized: dict[str, list[dict[str, Any]]] = {}
    for property_name, raw_points in value.items():
        if property_name not in KEYFRAME_LIMITS:
            raise ValueError(f"Unsupported keyframe property: {property_name}")
        if not isinstance(raw_points, list):
            raise ValueError(f"clip.keyframes.{property_name} must be an array.")
        if len(raw_points) > 250:
            raise ValueError(f"clip.keyframes.{property_name} may contain at most 250 points.")
        minimum, maximum = KEYFRAME_LIMITS[property_name]
        points: list[dict[str, Any]] = []
        ids: set[str] = set()
        times: set[float] = set()
        for raw in raw_points:
            if not isinstance(raw, dict):
                raise ValueError("Every keyframe must be an object.")
            point_id = _safe_id(raw.get("id"))
            if point_id in ids:
                raise ValueError(f"Duplicate keyframe id: {point_id}")
            try:
                at, point_value = float(raw.get("at")), float(raw.get("value"))
            except (TypeError, ValueError) as exc:
                raise ValueError("keyframe.at and keyframe.value must be numeric.") from exc
            if not math.isfinite(at) or not math.isfinite(point_value):
                raise ValueError("Keyframe time and value must be finite.")
            if at < 0 or at > duration:
                raise ValueError("keyframe.at must stay inside the clip duration.")
            rounded_at = round(at, 3)
            if rounded_at in times:
                raise ValueError(f"Only one {property_name} keyframe is allowed at each time.")
            if point_value < minimum or point_value > maximum:
                raise ValueError(
                    f"{property_name} keyframe value must be between {minimum} and {maximum}.",
                )
            interpolation = str(raw.get("interpolation", "linear"))
            if interpolation not in KEYFRAME_INTERPOLATIONS:
                raise ValueError("keyframe.interpolation must be linear or hold.")
            ids.add(point_id)
            times.add(rounded_at)
            points.append({
                "id": point_id,
                "at": rounded_at,
                "value": point_value,
                "interpolation": interpolation,
            })
        normalized[property_name] = sorted(points, key=lambda point: point["at"])
    return normalized


def keyframe_value(
    keyframes: dict[str, list[dict[str, Any]]] | None,
    property_name: str,
    at: float,
    default: float,
) -> float:
    points = (keyframes or {}).get(property_name) or []
    if not points:
        return float(default)
    if at <= float(points[0]["at"]):
        return float(points[0]["value"])
    if at >= float(points[-1]["at"]):
        return float(points[-1]["value"])
    times = [float(point["at"]) for point in points]
    right_index = bisect.bisect_right(times, at)
    left, right = points[right_index - 1], points[right_index]
    if left.get("interpolation") == "hold":
        return float(left["value"])
    span = float(right["at"]) - float(left["at"])
    ratio = 0 if span <= 0 else (at - float(left["at"])) / span
    return float(left["value"]) + (float(right["value"]) - float(left["value"])) * ratio


def has_keyframes(keyframes: dict[str, list[dict[str, Any]]] | None, *properties: str) -> bool:
    return any(bool((keyframes or {}).get(property_name)) for property_name in properties)


def speed_time_mapper(
    duration: float,
    source_span: float,
    keyframes: dict[str, list[dict[str, Any]]] | None,
    *,
    samples: int = 400,
) -> Callable[[float], float]:
    """Map output time to source time while preserving both exact endpoints."""
    safe_duration = max(float(duration), 0.001)
    safe_span = max(float(source_span), 0.001)
    sample_count = max(20, int(samples))
    times = [safe_duration * index / sample_count for index in range(sample_count + 1)]
    weights = [keyframe_value(keyframes, "speed", at, 1) for at in times]
    cumulative = [0.0]
    for index in range(sample_count):
        step = times[index + 1] - times[index]
        cumulative.append(cumulative[-1] + (weights[index] + weights[index + 1]) * 0.5 * step)
    total = max(cumulative[-1], 0.001)

    def map_scalar(at: float) -> float:
        clamped = min(max(float(at), 0), safe_duration)
        index = min(sample_count - 1, int(clamped / safe_duration * sample_count))
        left_time, right_time = times[index], times[index + 1]
        ratio = 0 if right_time <= left_time else (clamped - left_time) / (right_time - left_time)
        weighted = cumulative[index] + (cumulative[index + 1] - cumulative[index]) * ratio
        return min(safe_span, max(0, safe_span * weighted / total))

    def map_time(at: float) -> float:
        if isinstance(at, (int, float)):
            return map_scalar(float(at))
        import numpy as np
        values = np.asarray(at)
        return np.array([map_scalar(float(value)) for value in values.flat]).reshape(values.shape)

    return map_time

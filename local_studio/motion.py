"""P2-02 motion: speed-ramp easing, stabilizer flag, attach-to-tracker points."""

from __future__ import annotations

from typing import Any

RAMP_EASES = ("linear", "ease_in", "ease_out", "ease_in_out")


def normalize_motion(value: Any, duration: float) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    tracker_raw = raw.get("tracker") if isinstance(raw.get("tracker"), dict) else {}
    points_raw = tracker_raw.get("points") if isinstance(tracker_raw.get("points"), list) else []
    points: list[dict[str, Any]] = []
    for item in points_raw[:32]:
        if not isinstance(item, dict):
            continue
        try:
            at = float(item.get("at", 0))
            x = float(item.get("x", 0.5))
            y = float(item.get("y", 0.5))
        except (TypeError, ValueError) as exc:
            raise ValueError("motion.tracker.points must be numeric.") from exc
        if at < 0 or at > duration:
            raise ValueError("motion.tracker point time must stay inside the clip.")
        points.append({
            "id": str(item.get("id") or f"p{len(points) + 1}"),
            "at": round(at, 3),
            "x": max(0, min(1, x)),
            "y": max(0, min(1, y)),
        })
    attach = str(tracker_raw.get("attach", "none"))
    if attach not in {"none", "position"}:
        raise ValueError("motion.tracker.attach must be none or position.")
    ramp = raw.get("speed_ramp") if isinstance(raw.get("speed_ramp"), dict) else {}
    ease = str(ramp.get("ease", "linear"))
    if ease not in RAMP_EASES:
        raise ValueError("motion.speed_ramp.ease must be linear, ease_in, ease_out, or ease_in_out.")
    return {
        "stabilize": bool(raw.get("stabilize", False)),
        "tracker": {"attach": attach, "points": points},
        "speed_ramp": {"enabled": bool(ramp.get("enabled", False)), "ease": ease},
    }


def ease_ratio(ratio: float, ease: str) -> float:
    t = max(0.0, min(1.0, float(ratio)))
    if ease == "ease_in":
        return t * t
    if ease == "ease_out":
        return 1 - (1 - t) * (1 - t)
    if ease == "ease_in_out":
        return 2 * t * t if t < 0.5 else 1 - ((-2 * t + 2) ** 2) / 2
    return t


def tracker_offset(points: list[dict[str, Any]], at: float, width: int, height: int) -> tuple[float, float]:
    if not points:
        return 0.0, 0.0
    ordered = sorted(points, key=lambda item: item["at"])
    if at <= ordered[0]["at"]:
        current = ordered[0]
    elif at >= ordered[-1]["at"]:
        current = ordered[-1]
    else:
        right = next(item for item in ordered if item["at"] > at)
        left = ordered[ordered.index(right) - 1]
        span = max(right["at"] - left["at"], 1e-6)
        mix = (at - left["at"]) / span
        current = {
            "x": left["x"] + (right["x"] - left["x"]) * mix,
            "y": left["y"] + (right["y"] - left["y"]) * mix,
        }
    return (current["x"] - 0.5) * width, (current["y"] - 0.5) * height


def apply_tracker_position(layer: Any, motion: dict[str, Any], fallback: Any) -> Any:
    tracker = motion.get("tracker") if isinstance(motion.get("tracker"), dict) else {}
    if tracker.get("attach") != "position" or not tracker.get("points"):
        return layer.with_position(fallback)
    width, height = int(layer.w), int(layer.h)

    def position(at: float):
        dx, dy = tracker_offset(list(tracker.get("points") or []), float(at), width, height)
        if callable(fallback):
            base = fallback(at)
        elif isinstance(fallback, tuple):
            base = fallback
        else:
            base = (0, 0)
        x, y = base
        if not isinstance(x, (int, float)):
            x = 0
        if not isinstance(y, (int, float)):
            y = 0
        return x + dx, y + dy

    return layer.with_position(position)


def stabilize_layer(layer: Any, enabled: bool) -> Any:
    """Lightweight high-pass recentering. Full optical-flow stabilize is out of 1.0 scope."""
    if not enabled:
        return layer

    def recenter(get_frame, at):
        import numpy as np
        from PIL import Image

        frame = get_frame(at)
        gray = frame.mean(axis=2)
        mass = gray.sum() or 1.0
        ys, xs = np.indices(gray.shape)
        cx = float((xs * gray).sum() / mass)
        cy = float((ys * gray).sum() / mass)
        shift_x = int(frame.shape[1] / 2 - cx)
        shift_y = int(frame.shape[0] / 2 - cy)
        image = Image.fromarray(frame)
        shifted = Image.new("RGB", image.size, (0, 0, 0))
        shifted.paste(image, (shift_x, shift_y))
        return np.asarray(shifted)

    return layer.transform(recenter, keep_duration=True)

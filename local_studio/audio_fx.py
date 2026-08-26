"""P2-05 track EQ and compressor applied to MoviePy audio clips."""

from __future__ import annotations

from typing import Any


def normalize_audio_fx(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    eq_raw = raw.get("eq") if isinstance(raw.get("eq"), dict) else {}
    comp_raw = raw.get("compressor") if isinstance(raw.get("compressor"), dict) else {}
    try:
        eq = {
            "low": _clamp(float(eq_raw.get("low", 0)), -12, 12),
            "mid": _clamp(float(eq_raw.get("mid", 0)), -12, 12),
            "high": _clamp(float(eq_raw.get("high", 0)), -12, 12),
        }
        compressor = {
            "enabled": bool(comp_raw.get("enabled", False)),
            "threshold": _clamp(float(comp_raw.get("threshold", -18)), -60, 0),
            "ratio": _clamp(float(comp_raw.get("ratio", 3)), 1, 20),
            "attack": _clamp(float(comp_raw.get("attack", 12)), 1, 200),
            "release": _clamp(float(comp_raw.get("release", 80)), 10, 1000),
        }
    except (TypeError, ValueError) as exc:
        raise ValueError("track.audio_fx EQ and compressor values must be numeric.") from exc
    return {"eq": eq, "compressor": compressor}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _db_to_gain(db: float) -> float:
    return 10 ** (db / 20.0)


def apply_eq(samples: Any, fps: int, eq: dict[str, float]) -> Any:
    import numpy as np

    if all(abs(eq.get(band, 0)) < 1e-6 for band in ("low", "mid", "high")):
        return samples
    values = np.asarray(samples, dtype=np.float32)
    mono = values if values.ndim == 1 else values.mean(axis=1)
    spectrum = np.fft.rfft(mono)
    freqs = np.fft.rfftfreq(mono.size, d=1.0 / max(fps, 1))
    gains = np.ones_like(spectrum, dtype=np.float32)
    gains[freqs < 250] *= _db_to_gain(eq.get("low", 0))
    gains[(freqs >= 250) & (freqs < 4000)] *= _db_to_gain(eq.get("mid", 0))
    gains[freqs >= 4000] *= _db_to_gain(eq.get("high", 0))
    shaped = np.fft.irfft(spectrum * gains, n=mono.size)
    if values.ndim == 1:
        return shaped.astype(np.float32)
    scale = shaped / np.clip(np.abs(mono), 1e-6, None)
    return (values * scale[:, None]).astype(np.float32)


def apply_compressor(samples: Any, fps: int, compressor: dict[str, Any]) -> Any:
    import numpy as np

    if not compressor.get("enabled"):
        return samples
    values = np.asarray(samples, dtype=np.float32)
    mono = values if values.ndim == 1 else values.mean(axis=1)
    envelope = 0.0
    attack = 1.0 - np.exp(-1.0 / max(fps * (compressor["attack"] / 1000.0), 1e-3))
    release = 1.0 - np.exp(-1.0 / max(fps * (compressor["release"] / 1000.0), 1e-3))
    threshold = _db_to_gain(compressor["threshold"])
    ratio = float(compressor["ratio"])
    gains = np.empty_like(mono)
    for index, sample in enumerate(np.abs(mono)):
        envelope += (sample - envelope) * (attack if sample > envelope else release)
        if envelope <= threshold:
            gains[index] = 1.0
            continue
        over = envelope / max(threshold, 1e-6)
        compressed = over ** (1.0 - 1.0 / ratio)
        gains[index] = compressed / max(over, 1e-6)
    if values.ndim == 1:
        return values * gains
    return values * gains[:, None]


def apply_audio_fx(audio: Any, fx: dict[str, Any]) -> Any:
    if audio is None:
        return None
    default = normalize_audio_fx({})
    if fx == default:
        return audio

    def process(get_frame, at):
        import numpy as np

        frame = get_frame(at)
        fps = int(getattr(audio, "fps", 44100) or 44100)
        if isinstance(at, (int, float)):
            return apply_compressor(apply_eq(frame, fps, fx["eq"]), fps, fx["compressor"])
        values = np.asarray(frame)
        return apply_compressor(apply_eq(values, fps, fx["eq"]), fps, fx["compressor"])

    return audio.transform(process, keep_duration=True)

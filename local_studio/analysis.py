"""Local-only media analysis for encrypted Runner editing packages."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import config
from config import require_path, utc_now
from db import db, row_dict


def _run(args: list[str], timeout: int = 300) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)


def _ffmpeg_binary() -> str:
    value = shutil.which("ffmpeg")
    if value:
        return value
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return ""


def _probe(source: Path) -> dict[str, Any]:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        try:
            from moviepy import VideoFileClip
            with VideoFileClip(str(source)) as clip:
                return {"status": "ready", "duration": float(clip.duration), "format": {"size": source.stat().st_size}, "streams": [{"codec_type": "video", "width": int(clip.w), "height": int(clip.h), "r_frame_rate": str(clip.fps)}, *([{"codec_type": "audio"}] if clip.audio else [])]}
        except Exception as exc:
            return {"status": "unavailable", "reason": f"ffprobe_not_found: {exc}"}
    result = _run([ffprobe, "-v", "error", "-show_entries", "format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels", "-of", "json", str(source)], 60)
    if result.returncode:
        return {"status": "failed", "reason": result.stderr.strip()[:800]}
    value = json.loads(result.stdout)
    duration = float((value.get("format") or {}).get("duration") or 0)
    return {"status": "ready", "duration": duration, "format": value.get("format", {}), "streams": value.get("streams", [])}


def _thumbnails(project_id: str, source: Path, duration: float, count: int = 6) -> list[dict[str, Any]]:
    ffmpeg = _ffmpeg_binary()
    if not ffmpeg or duration <= 0:
        return []
    root = config.DATA_DIR / "analysis" / project_id / "thumbnails"
    root.mkdir(parents=True, exist_ok=True)
    values: list[dict[str, Any]] = []
    for index in range(count):
        at = duration * (index + 1) / (count + 1)
        destination = root / f"scene-{index + 1:02d}.jpg"
        result = _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{at:.3f}", "-i", str(source), "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", str(destination)], 90)
        if result.returncode == 0 and destination.exists():
            values.append({"id": f"scene-{index + 1:02d}", "at": round(at, 3), "path": str(destination), "size_bytes": destination.stat().st_size})
    return values


def _parse_whisper_json(value: dict[str, Any]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    source = value.get("transcription") or value.get("segments") or []
    for segment in source if isinstance(source, list) else []:
        if not isinstance(segment, dict):
            continue
        timestamps = segment.get("timestamps") if isinstance(segment.get("timestamps"), dict) else {}
        try:
            start = float(timestamps.get("from", segment.get("start", 0)))
            end = float(timestamps.get("to", segment.get("end", start)))
            if start > 1000 or end > 1000:
                start, end = start / 1000, end / 1000
        except (TypeError, ValueError):
            continue
        text = str(segment.get("text", "")).strip()
        if text and end > start:
            words.append({"start": round(start, 3), "end": round(end, 3), "text": text})
    return words


def _transcript(source: Path) -> dict[str, Any]:
    whisper = os.getenv("WHISPER_CPP_BINARY", "").strip() or shutil.which("whisper-cli") or ""
    model = os.getenv("WHISPER_CPP_MODEL", "").strip()
    ffmpeg = _ffmpeg_binary()
    if not whisper or not Path(whisper).exists() or not model or not Path(model).exists() or not ffmpeg:
        return {"status": "unavailable", "engine": "whisper.cpp", "words": [], "reason": "Set WHISPER_CPP_BINARY and WHISPER_CPP_MODEL; ffmpeg is also required."}
    with tempfile.TemporaryDirectory(prefix="grok-crew-whisper-") as folder:
        wav, prefix = Path(folder) / "audio.wav", Path(folder) / "transcript"
        extracted = _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", str(wav)], 600)
        if extracted.returncode:
            return {"status": "failed", "engine": "whisper.cpp", "words": [], "reason": extracted.stderr.strip()[:800]}
        transcribed = _run([whisper, "-m", model, "-f", str(wav), "-oj", "-ojf", "-of", str(prefix)], 3600)
        json_path = prefix.with_suffix(".json")
        if transcribed.returncode or not json_path.exists():
            return {"status": "failed", "engine": "whisper.cpp", "words": [], "reason": transcribed.stderr.strip()[:800]}
        words = _parse_whisper_json(json.loads(json_path.read_text(encoding="utf-8")))
        return {"status": "ready", "engine": "whisper.cpp", "words": words, "text": " ".join(item["text"] for item in words)}


def get_analysis(project_id: str) -> dict[str, Any] | None:
    with db() as conn:
        return row_dict(conn.execute("SELECT * FROM project_analysis WHERE project_id = ?", (project_id,)).fetchone())


def analyze_project(project: dict[str, Any]) -> dict[str, Any]:
    source = require_path(project["source_path"], "source_path")
    if not source.exists():
        raise ValueError("Project source does not exist.")
    media = _probe(source)
    thumbnails = _thumbnails(project["id"], source, float(media.get("duration", 0)))
    transcript = _transcript(source)
    status = "ready" if media.get("status") == "ready" and thumbnails else "partial"
    now = utc_now()
    with db() as conn:
        conn.execute("""INSERT INTO project_analysis
            (project_id, status, media_json, transcript_json, thumbnails_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET status = excluded.status, media_json = excluded.media_json,
            transcript_json = excluded.transcript_json, thumbnails_json = excluded.thumbnails_json,
            error_text = NULL, updated_at = excluded.updated_at""",
            (project["id"], status, json.dumps(media), json.dumps(transcript), json.dumps(thumbnails), now, now))
    return get_analysis(project["id"]) or {}

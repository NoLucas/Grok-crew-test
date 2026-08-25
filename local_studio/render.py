"""Local Video Studio: MoviePy-based EDL rendering."""

from __future__ import annotations

from contextlib import ExitStack
from pathlib import Path
from typing import Any, Callable

from config import PLATFORM_PRESETS, caption_font, workspace_path


def _asset_path(value: str) -> Path:
    """Resolve a v2 asset without allowing a renderer to silently leave workspace."""
    candidate = Path(value)
    return candidate if candidate.is_absolute() else workspace_path(value)


def original_asset_path(asset: dict[str, Any]) -> Path:
    """Final output always resolves the immutable original, never its proxy."""
    return _asset_path(str(asset.get("path", "")))


def _render_timeline_v2(
    project: dict[str, Any],
    progress_cb: Callable[[int], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Render the immutable multi-track timeline used by the desktop editor.

    The first desktop milestone intentionally implements the effects represented
    by the public v2 data model (track ordering, trims, static transforms, audio
    levels and captions) without flattening it back into the legacy cut list.
    More advanced effects can therefore be added without another persistence
    migration.
    """
    try:
        from moviepy import (
            AudioFileClip,
            ColorClip,
            CompositeAudioClip,
            CompositeVideoClip,
            ImageClip,
            TextClip,
            VideoFileClip,
            afx,
            vfx,
        )
    except ImportError as exc:
        raise RuntimeError("MoviePy is not installed. Install local_studio/requirements.txt first.") from exc

    timeline = project["timeline_json"]
    settings = timeline.get("settings") if isinstance(timeline.get("settings"), dict) else {}
    assets = {str(item.get("id")): item for item in timeline.get("assets", []) if isinstance(item, dict)}
    tracks = sorted(
        (item for item in timeline.get("tracks", []) if isinstance(item, dict)),
        key=lambda item: int(item.get("order", 0)),
    )

    platform = str(settings.get("platform", "reels_tiktok_shorts"))
    preset = PLATFORM_PRESETS.get(platform, PLATFORM_PRESETS["reels_tiktok_shorts"])
    target_w = max(2, int(settings.get("width", preset["width"])))
    target_h = max(2, int(settings.get("height", preset["height"])))
    target_w -= target_w % 2
    target_h -= target_h % 2
    fps = int(settings.get("fps", 30))
    fps = fps if fps in {24, 30, 60} else 30
    quality = str(settings.get("quality", "balanced"))
    bitrate = {"compact": "3500k", "balanced": "6000k", "high": "9000k"}.get(quality, "6000k")
    encoder_preset = {"compact": "veryfast", "balanced": "medium", "high": "slow"}.get(quality, "medium")
    background = str(settings.get("background", "#000000"))
    try:
        bg_rgb = tuple(int(background.lstrip("#")[index:index + 2], 16) for index in (0, 2, 4))
    except (TypeError, ValueError):
        bg_rgb = (0, 0, 0)

    any_solo = any(bool(track.get("solo")) for track in tracks)
    active_clips = [
        (track, clip)
        for track in tracks
        if not track.get("muted") and (not any_solo or track.get("solo"))
        for clip in track.get("clips", [])
        if isinstance(clip, dict)
    ]
    if not active_clips:
        raise RuntimeError("No active clips are available to render.")
    duration = max(float(clip.get("timeline_start", 0)) + float(clip.get("duration", 0)) for _, clip in active_clips)
    if duration <= 0:
        raise RuntimeError("Timeline duration must be positive.")

    output = Path(project["output_path"])
    output.parent.mkdir(parents=True, exist_ok=True)
    font_path = caption_font()
    visual_layers: list[Any] = [ColorClip(size=(target_w, target_h), color=bg_rgb).with_duration(duration)]
    audio_layers: list[Any] = []
    owned_clips: list[Any] = []
    total = max(len(active_clips), 1)

    def close_owned() -> None:
        for item in reversed(owned_clips):
            try:
                item.close()
            except Exception:
                pass

    try:
        for index, (track, clip_data) in enumerate(active_clips):
            if should_cancel and should_cancel():
                raise RuntimeError("Render cancelled.")
            kind = str(track.get("type", "video"))
            start = float(clip_data.get("timeline_start", 0))
            clip_duration = float(clip_data.get("duration", 0))
            asset = assets.get(str(clip_data.get("asset_id")))
            layer = None

            if kind == "caption":
                text = str(clip_data.get("text", "")).strip()
                if not text:
                    continue
                if not font_path:
                    raise RuntimeError("No usable local font was found for captions. Set LOCAL_STUDIO_FONT or install a system font.")
                style = clip_data.get("style") if isinstance(clip_data.get("style"), dict) else {}
                size = max(18, min(int(style.get("size", settings.get("caption_size", 78))), 180))
                color = str(style.get("color", settings.get("caption_color", "#FFFFFF")))
                stroke = max(0, min(int(style.get("stroke", settings.get("caption_stroke", 3))), 12))
                layer = TextClip(
                    font=font_path,
                    text=text,
                    font_size=size,
                    color=color,
                    stroke_color="black",
                    stroke_width=stroke,
                    size=(max(240, int(target_w * .86)), max(size * 2, int(target_h * .08))),
                    method="caption",
                    vertical_align="center",
                )
                y_percent = max(0, min(float(style.get("position_y", settings.get("caption_y", 74))), 100))
                y = max(0, min(int(target_h * y_percent / 100 - layer.h / 2), target_h - int(layer.h)))
                layer = layer.with_start(start).with_duration(clip_duration).with_position(("center", y))
                visual_layers.append(layer)
                owned_clips.append(layer)
            elif kind == "audio":
                if not asset or asset.get("kind") not in {"audio", "video"}:
                    continue
                source_path = original_asset_path(asset)
                if not source_path.exists():
                    raise RuntimeError(f"Timeline asset does not exist: {source_path}")
                source_audio = AudioFileClip(str(source_path))
                owned_clips.append(source_audio)
                source_in = max(0, float(clip_data.get("source_in", 0)))
                source_out = min(float(clip_data.get("source_out", source_in + clip_duration)), float(source_audio.duration))
                layer = source_audio.subclipped(source_in, source_out)
                audio_config = clip_data.get("audio") if isinstance(clip_data.get("audio"), dict) else {}
                if audio_config.get("muted"):
                    continue
                volume = max(0, min(float(audio_config.get("volume", 1)), 4))
                if volume != 1:
                    layer = layer.with_effects([afx.MultiplyVolume(volume)])
                layer = layer.with_start(start).with_duration(clip_duration)
                audio_layers.append(layer)
                owned_clips.append(layer)
            elif kind in {"video", "overlay"}:
                if not asset or asset.get("kind") not in {"video", "image"}:
                    continue
                source_path = original_asset_path(asset)
                if not source_path.exists():
                    raise RuntimeError(f"Timeline asset does not exist: {source_path}")
                if asset.get("kind") == "image":
                    layer = ImageClip(str(source_path)).with_duration(clip_duration)
                else:
                    source_video = VideoFileClip(str(source_path))
                    owned_clips.append(source_video)
                    source_in = max(0, float(clip_data.get("source_in", 0)))
                    source_out = min(float(clip_data.get("source_out", source_in + clip_duration)), float(source_video.duration))
                    if source_out <= source_in:
                        continue
                    layer = source_video.subclipped(source_in, source_out)
                    source_span = source_out - source_in
                    if abs(source_span - clip_duration) > .001:
                        layer = layer.with_effects([vfx.MultiplySpeed(source_span / clip_duration)])
                transform = clip_data.get("transform") if isinstance(clip_data.get("transform"), dict) else {}
                scale = max(.05, min(float(transform.get("scale", 1)), 8))
                fit = min(target_w / float(layer.w), target_h / float(layer.h)) * scale
                layer = layer.resized(fit)
                rotation = float(transform.get("rotation", 0))
                if rotation:
                    layer = layer.rotated(rotation, expand=True)
                opacity = max(0, min(float(transform.get("opacity", 1)), 1))
                if opacity != 1:
                    layer = layer.with_opacity(opacity)
                x_value, y_value = transform.get("x", "center"), transform.get("y", "center")
                position = (x_value, y_value)
                layer = layer.with_start(start).with_duration(clip_duration).with_position(position)
                audio_config = clip_data.get("audio") if isinstance(clip_data.get("audio"), dict) else {}
                if layer.audio and (audio_config.get("muted") or track.get("muted")):
                    layer = layer.without_audio()
                elif layer.audio:
                    volume = max(0, min(float(audio_config.get("volume", 1)), 4))
                    if volume != 1:
                        layer = layer.with_audio(layer.audio.with_effects([afx.MultiplyVolume(volume)]))
                visual_layers.append(layer)
                owned_clips.append(layer)

            if progress_cb:
                progress_cb(min(88, int(88 * (index + 1) / total)))

        if len(visual_layers) == 1 and not audio_layers:
            raise RuntimeError("No renderable video, image, caption, or audio clips were found.")
        final = CompositeVideoClip(visual_layers, size=(target_w, target_h)).with_duration(duration)
        owned_clips.append(final)
        if audio_layers:
            combined = CompositeAudioClip(([final.audio] if final.audio else []) + audio_layers)
            owned_clips.append(combined)
            final = final.with_audio(combined)
        has_audio = bool(final.audio)
        if progress_cb:
            progress_cb(92)
        final.write_videofile(
            str(output), fps=fps, codec="libx264", audio_codec="aac", bitrate=bitrate,
            threads=4, logger=None, ffmpeg_params=["-preset", encoder_preset, "-movflags", "+faststart"],
        )
    finally:
        close_owned()
    if progress_cb:
        progress_cb(100)
    return {
        "output_path": str(output), "format": "mp4", "video": "H.264",
        "audio": "AAC" if has_audio else "none", "width": target_w, "height": target_h,
        "platform": platform, "fps": fps, "bitrate": bitrate,
        "timeline_schema": timeline["schema"], "revision": timeline.get("revision"),
    }


def _smooth_gain_targets(targets: list[float], attack: float, release: float) -> list[float]:
    """Exponential envelope follower: eases the gain toward each step's target,
    using the faster `attack` rate while dropping (dialogue just started -- duck
    quickly) and the slower `release` rate while climbing back toward 1.0
    (dialogue just ended), so the music bed doesn't audibly pump on every word
    gap. Pure Python (no numpy) so it stays importable/testable without MoviePy
    installed, matching the rest of this module's deferred-import convention."""
    smoothed: list[float] = []
    level = 1.0
    for target in targets:
        rate = attack if target < level else release
        level += (target - level) * rate
        smoothed.append(level)
    return smoothed


def _dialogue_duck_gain(dialogue_audio, duration: float, floor: float):
    """Sample dialogue loudness at a coarse rate and return a vectorized gain(t)
    function for the music bed: near `floor` while dialogue plays, eased back to
    1.0 in the gaps. Requires MoviePy/numpy, so the import stays inside this
    function rather than at module level."""
    import numpy as np

    sample_rate = 25  # Hz: coarse enough to be cheap, fine enough to track speech gaps
    if duration <= 0:
        return lambda t: np.ones_like(np.atleast_1d(t), dtype=float)
    samples = dialogue_audio.to_soundarray(fps=sample_rate, quantize=False)
    if samples.ndim == 2:
        samples = samples.mean(axis=1)
    loudness = np.abs(samples)
    gate = max(float(loudness.max()) * 0.08, 1e-4) if loudness.size else 0.0
    targets = np.where(loudness > gate, floor, 1.0)
    envelope = np.array(_smooth_gain_targets(targets.tolist(), attack=0.35, release=0.12))

    def gain_at(t):
        t_arr = np.atleast_1d(t)
        idx = np.clip((t_arr * sample_rate).astype(int), 0, len(envelope) - 1)
        return envelope[idx]

    return gain_at


def _apply_music_ducking(music, gain_at):
    import numpy as np

    nchannels = music.nchannels

    def duck(get_frame, t):
        frame = get_frame(t)
        gain = gain_at(t)
        return frame * gain if nchannels == 1 else frame * np.array([gain for _ in range(nchannels)]).T

    return music.transform(duck, keep_duration=True)


def render_moviepy(project: dict[str, Any], progress_cb: Callable[[int], None] | None = None, should_cancel: Callable[[], bool] | None = None) -> dict[str, Any]:
    if project.get("timeline_json", {}).get("schema") == "grok-crew.timeline/v2":
        return _render_timeline_v2(project, progress_cb=progress_cb, should_cancel=should_cancel)
    try:
        from moviepy import AudioFileClip, ColorClip, CompositeAudioClip, CompositeVideoClip, TextClip, VideoFileClip, afx, concatenate_videoclips, vfx
    except ImportError as exc:
        raise RuntimeError("MoviePy is not installed. Install local_studio/requirements.txt first.") from exc
    timeline = project["timeline_json"]
    raw_settings = timeline.get("render_settings", {})
    settings = raw_settings if isinstance(raw_settings, dict) else {}

    def bounded(name: str, default: float, minimum: float, maximum: float) -> float:
        try:
            return min(max(float(settings.get(name, default)), minimum), maximum)
        except (TypeError, ValueError):
            return default

    def enabled(name: str, default: bool = False) -> bool:
        value = settings.get(name, default)
        return value if isinstance(value, bool) else default

    fps = int(bounded("fps", 30, 24, 60))
    if fps not in {24, 30, 60}:
        fps = 30
    quality = str(settings.get("quality", "balanced"))
    bitrate = {"compact": "3500k", "balanced": "6000k", "high": "9000k"}.get(quality, "6000k")
    # libx264 encoder preset: trades file-size efficiency for encode speed. "compact" is
    # meant for quick review/draft renders, so it uses the fastest preset rather than the
    # ffmpeg default ("medium"), which is a large, low-risk win for iteration speed.
    encoder_preset = {"compact": "veryfast", "balanced": "medium", "high": "slow"}.get(quality, "medium")
    crop_anchor = str(settings.get("crop_anchor", "center"))
    if crop_anchor not in {"left", "center", "right"}:
        crop_anchor = "center"
    speed = bounded("speed", 1, .5, 2)
    volume = bounded("volume", 100, 0, 200) / 100
    fade_in, fade_out = bounded("fade_in", .08, 0, 2), bounded("fade_out", .08, 0, 2)
    look = str(settings.get("look", "natural"))
    if look not in {"natural", "punchy", "mono", "night"}:
        look = "natural"
    brightness, contrast, gamma = bounded("brightness", 0, -40, 40), bounded("contrast", 0, -40, 55), bounded("gamma", 1, .65, 1.55)
    platform = str(settings.get("platform", "reels_tiktok_shorts"))
    dims = PLATFORM_PRESETS.get(platform, PLATFORM_PRESETS["reels_tiktok_shorts"])
    target_w, target_h = int(dims["width"]), int(dims["height"])
    captions_enabled = enabled("captions_enabled", True)
    caption_color = str(settings.get("caption_color", "#FFFFFF"))
    if not (caption_color.startswith("#") and len(caption_color) in {4, 7, 9}):
        caption_color = "#FFFFFF"
    caption_size = int(bounded("caption_size", 78, 38, 110))
    caption_center_y = int(bounded("caption_y", 74, 48, 84) * target_h / 100)
    caption_stroke = int(bounded("caption_stroke", 3, 0, 8))
    caption_bg = enabled("caption_bg", False)
    caption_bg_color = str(settings.get("caption_bg_color", "#000000"))
    if not (caption_bg_color.startswith("#") and len(caption_bg_color) in {4, 7, 9}):
        caption_bg_color = "#000000"
    font_path = caption_font()
    if captions_enabled and not font_path:
        raise RuntimeError("No usable local font was found for captions. Set LOCAL_STUDIO_FONT to a .ttf/.otf file path, install a system font, or disable captions for this render.")
    source = Path(project["source_path"])
    output = Path(project["output_path"])
    if not source.exists():
        raise RuntimeError(f"Source file does not exist: {source}")
    output.parent.mkdir(parents=True, exist_ok=True)
    clips_data = timeline.get("clips", [])
    cuts = []
    total_entries = max(len(clips_data), 1)
    with VideoFileClip(str(source)) as source_clip, ExitStack() as audio_stack:
        for position, entry in enumerate(clips_data):
            if should_cancel and should_cancel():
                raise RuntimeError("Render cancelled.")
            if not entry.get("keep", True):
                continue
            start, end = float(entry["in"]), float(entry["out"])
            if end <= start or start < 0 or end > source_clip.duration + .05:
                continue
            cut = source_clip.subclipped(start, end)
            effects = []
            if speed != 1:
                effects.append(vfx.MultiplySpeed(speed))
            if look == "punchy":
                effects.append(vfx.LumContrast(lum=4, contrast=24))
            elif look == "night":
                effects.append(vfx.LumContrast(lum=11, contrast=-8))
            elif look == "mono":
                effects.append(vfx.BlackAndWhite())
            if brightness or contrast:
                effects.append(vfx.LumContrast(lum=brightness, contrast=contrast))
            if gamma != 1:
                effects.append(vfx.GammaCorrection(gamma))
            if enabled("mirror"):
                effects.append(vfx.MirrorX())
            if fade_in:
                effects.append(vfx.FadeIn(fade_in))
            if fade_out:
                effects.append(vfx.FadeOut(fade_out))
            if effects:
                cut = cut.with_effects(effects)
            if (int(cut.w), int(cut.h)) != (target_w, target_h):
                scale = min(target_w / float(cut.w), target_h / float(cut.h))
                new_w = max(2, int(cut.w * scale) // 2 * 2)
                new_h = max(2, int(cut.h * scale) // 2 * 2)
                cut = cut.resized(new_size=(new_w, new_h))
                if (new_w, new_h) != (target_w, target_h):
                    x = 0 if crop_anchor == "left" else (target_w - new_w) if crop_anchor == "right" else (target_w - new_w) // 2
                    y = (target_h - new_h) // 2
                    bg = ColorClip(size=(target_w, target_h), color=(0, 0, 0)).with_duration(cut.duration)
                    cut = CompositeVideoClip([bg, cut.with_position((x, y))], size=(target_w, target_h))
            if cut.audio:
                if enabled("mute_audio"):
                    cut = cut.without_audio()
                else:
                    audio_effects = [afx.AudioFadeIn(fade_in), afx.AudioFadeOut(fade_out)]
                    if enabled("normalize_audio"):
                        audio_effects.insert(0, afx.AudioNormalize())
                    if volume != 1:
                        audio_effects.append(afx.MultiplyVolume(volume))
                    cut = cut.with_audio(cut.audio.with_effects(audio_effects))
            caption = str(entry.get("caption", "")).strip()
            word_timings = entry.get("word_timings")
            caption_layers = []

            def caption_layer(text: str, duration: float, start: float = 0) -> TextClip:
                horizontal_margin = max(8, int(caption_size * .18))
                vertical_margin = max(6, int(caption_size * .14))
                text_width = max(200, int(target_w * .85) - horizontal_margin * 2)
                text_height = max(int(caption_size * 1.45), int(target_h * .055))
                layer = TextClip(
                    font=font_path,
                    text=text,
                    font_size=caption_size,
                    color=caption_color,
                    bg_color=caption_bg_color if caption_bg else None,
                    stroke_color="black",
                    stroke_width=caption_stroke,
                    size=(text_width, text_height),
                    margin=(horizontal_margin, vertical_margin),
                    method="caption",
                    vertical_align="center",
                )
                top = max(0, min(int(caption_center_y - layer.h / 2), target_h - int(layer.h)))
                return layer.with_start(start).with_duration(duration).with_position(("center", top))

            if captions_enabled and isinstance(word_timings, list) and word_timings:
                for word_entry in word_timings[:200]:
                    if not isinstance(word_entry, dict):
                        continue
                    word_text = str(word_entry.get("text", "")).strip()
                    try:
                        word_start, word_end = float(word_entry.get("start")), float(word_entry.get("end"))
                    except (TypeError, ValueError):
                        continue
                    if not word_text or word_end <= word_start or word_start < 0 or word_start > cut.duration:
                        continue
                    word_duration = min(word_end, cut.duration) - word_start
                    if word_duration <= 0:
                        continue
                    caption_layers.append(caption_layer(word_text, word_duration, word_start))
            elif caption and captions_enabled:
                caption_layers.append(caption_layer(caption, cut.duration))
            if caption_layers:
                cut = CompositeVideoClip([cut, *caption_layers], size=(target_w, target_h))
            cuts.append(cut)
            if progress_cb:
                progress_cb(min(90, int(90 * (position + 1) / total_entries)))
        if not cuts:
            raise RuntimeError("No valid kept clips are available to render.")
        if should_cancel and should_cancel():
            raise RuntimeError("Render cancelled.")
        final = concatenate_videoclips(cuts, method="compose")
        music_value = str(settings.get("music_track", "")).strip()
        if music_value:
            music_path = workspace_path(music_value)
            if not music_path.exists():
                raise RuntimeError(f"Music track does not exist: {music_path}")
            music_gain = bounded("music_volume", 30, 0, 100) / 100
            # Kept open via audio_stack (not a plain `with`) because write_videofile()
            # below still needs to pull frames through this reader; a `with` here would
            # close it as soon as this block ends, well before the frames are read.
            music_clip = audio_stack.enter_context(AudioFileClip(str(music_path)))
            music = music_clip.with_effects([afx.MultiplyVolume(music_gain)])
            music = music.with_effects([afx.AudioLoop(duration=final.duration)]) if enabled("music_loop", True) else music.subclipped(0, min(music.duration, final.duration))
            if final.audio and enabled("music_ducking", True):
                duck_floor = bounded("music_duck_floor", 35, 5, 100) / 100
                music = _apply_music_ducking(music, _dialogue_duck_gain(final.audio, final.duration, duck_floor))
            final = final.with_audio(CompositeAudioClip([final.audio, music]) if final.audio else music)
        has_audio = bool(final.audio)
        if progress_cb:
            progress_cb(92)
        final.write_videofile(str(output), fps=fps, codec="libx264", audio_codec="aac", bitrate=bitrate, threads=4, logger=None, ffmpeg_params=["-preset", encoder_preset, "-movflags", "+faststart"])
        final.close()
    if progress_cb:
        progress_cb(100)
    return {"output_path": str(output), "format": "mp4", "video": "H.264", "audio": "AAC" if has_audio else "none", "width": target_w, "height": target_h, "platform": platform, "fps": fps, "bitrate": bitrate, "render_settings": {"crop_anchor": crop_anchor, "speed": speed, "look": look, "captions_enabled": captions_enabled, "quality": quality}}

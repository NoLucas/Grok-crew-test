#!/usr/bin/env python3
"""Build a short, shareable Grok Crew workflow demo from local UI screenshots."""

from __future__ import annotations

import subprocess
from pathlib import Path

import imageio_ffmpeg
from moviepy import ImageClip, concatenate_videoclips
from numpy import asarray
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
SCREEN_DIR = ROOT / "public" / "readme" / "demo"
OUTPUT = ROOT / "public" / "demo" / "grok-crew-workflow.mp4"
PREVIEW = ROOT / "public" / "demo" / "grok-crew-workflow.gif"
SIZE = (1280, 720)
FPS = 24
YELLOW = "#f4c400"
LIME = "#b8f85a"
BACKGROUND = "#090909"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for name in names:
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


def cover(image: Image.Image) -> Image.Image:
    source = image.convert("RGB")
    width, height = source.size
    scale = max(SIZE[0] / width, SIZE[1] / height)
    resized = source.resize((round(width * scale), round(height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - SIZE[0]) // 2
    top = (resized.height - SIZE[1]) // 2
    return resized.crop((left, top, left + SIZE[0], top + SIZE[1]))


def title_card(kicker: str, headline: str, body: str, accent: str = YELLOW) -> Image.Image:
    image = Image.new("RGB", SIZE, BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, SIZE[0], 7), fill=accent)
    draw.text((78, 128), kicker.upper(), font=font(22, True), fill=accent)
    draw.multiline_text((78, 184), headline, font=font(67, True), fill="#f2f2ec", spacing=2)
    draw.multiline_text((82, 420), body, font=font(28), fill="#b9b9b0", spacing=8)
    draw.rounded_rectangle((82, 580, 640, 632), radius=12, outline="#46463e", width=2)
    draw.text((103, 594), "LOCAL-FIRST · SAME-PC BOTS · NO CLOUD BACKEND", font=font(15, True), fill=LIME)
    return image


def screenshot_card(filename: str, step: str, headline: str, body: str) -> Image.Image:
    path = SCREEN_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Missing demo screenshot: {path}")
    image = cover(Image.open(path))
    overlay = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, SIZE[0], 94), fill=(5, 5, 5, 224))
    draw.text((42, 19), step.upper(), font=font(17, True), fill=YELLOW)
    draw.text((42, 44), headline, font=font(30, True), fill="#f5f5f0")
    draw.rounded_rectangle((35, 606, 1245, 686), radius=12, fill=(5, 5, 5, 232), outline=(81, 81, 72, 220), width=1)
    draw.text((57, 628), body, font=font(20), fill="#d3d3cb")
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def clip(image: Image.Image, duration: float) -> ImageClip:
    return ImageClip(asarray(image)).with_duration(duration)


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    frames = [
        (title_card("GROK CREW", "A local workflow\nfor bot-assisted edits", "Rough footage, cut decisions, render jobs, and delivery status stay visible on one computer."), 2.0),
        (screenshot_card("01-production.png", "01 · PRODUCTION", "Create the project and set the edit method", "Choose source/output paths, captions, frame, sound, quality, and the bot's creative method."), 4.0),
        (screenshot_card("02-guide.png", "02 · BOT GUIDE", "Give the bot a structured operating manual", "The bot reads the same local guide, tools, boundaries, and workflow that people see in the workspace."), 4.0),
        (screenshot_card("03-bots.png", "03 · BOT CHECK", "Verify entry, activity, and progress", "A bot must check in. The workspace records its entry, heartbeats, editing activity, and render/upload state."), 4.0),
        (screenshot_card("04-terminal.png", "04 · TERMINAL", "Use the same tools from a local bot terminal", "The included CLI opens workspace pages and controls projects, inspection, cut maps, operations, jobs, and delivery."), 4.0),
        (title_card("THE RESULT", "Rough footage → cut map\n→ local MP4 → delivery", "Keep Instagram delivery queued, or enable auto-upload when local Meta credentials are available.", LIME), 2.0),
    ]
    video = concatenate_videoclips([clip(frame, duration) for frame, duration in frames], method="compose")
    video.write_videofile(str(OUTPUT), fps=FPS, codec="libx264", audio=False, logger=None, ffmpeg_params=["-movflags", "+faststart"])
    video.close()
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-y",
            "-i",
            str(OUTPUT),
            "-vf",
            "fps=10,scale=720:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
            "-loop",
            "0",
            str(PREVIEW),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(OUTPUT)
    print(PREVIEW)


if __name__ == "__main__":
    main()

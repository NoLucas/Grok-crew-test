#!/usr/bin/env python3
"""Build language-specific README videos for the plain-language bot example.

Each video preserves the full eight-second local render at the end.  The
surrounding cards translate the same prompt → guide → result story for the
matching README language.
"""

from __future__ import annotations

import argparse
import subprocess
from dataclasses import dataclass
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from moviepy import CompositeVideoClip, ImageClip, VideoFileClip, concatenate_videoclips
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
DEMO_DIR = ROOT / "public" / "demo"
SOURCE = DEMO_DIR / "bot-edit-result-source.mp4"
SIZE = (1080, 1920)
FPS = 30
BG = "#090909"
PANEL = "#151515"
PANEL_2 = "#1c1c1c"
WHITE = "#f4f4ef"
MUTED = "#b9b9b0"
YELLOW = "#f4c400"
LIME = "#b8f85a"
LINE = "#3d3d38"


@dataclass(frozen=True)
class Copy:
    code: str
    intro_title: str
    intro_subtitle: str
    terminal_title: str
    terminal_subtitle: str
    prompt_title: str
    prompt: str
    prompt_subtitle: str
    workflow_title: str
    workflow_1: str
    workflow_2: str
    workflow_3: str
    workflow_4: str
    result_title: str
    result_body: str
    closing_title: str
    closing_subtitle: str

    @property
    def workflow(self) -> tuple[str, str, str, str]:
        return (self.workflow_1, self.workflow_2, self.workflow_3, self.workflow_4)


COPY = {
    "en": Copy(
        "en",
        "Tell your bot\nin one sentence.",
        "How to direct a local Grok bot",
        "Start Grok Crew",
        "Run this once on the same PC",
        "Tell the bot the outcome",
        "Use the site to do a quick edit\nand give me the finished clip.",
        "The Bot Guide turns plain language into local work.",
        "What the bot does",
        "Read the Bot Guide",
        "Inspect the source",
        "Plan the keep segments",
        "Render the local file",
        "The local edit result",
        "8 seconds · two clips\n1080×1920\nMuted · captions on",
        "Delivered locally.",
        "Ask for the file and a change summary.",
    ),
    "ko": Copy(
        "ko",
        "한 문장으로\n명령하세요.",
        "로컬 Grok bot에게 작업을 맡기는 방법",
        "Grok Crew 실행",
        "같은 PC에서 한 번만 실행하세요",
        "원하는 결과를 말하세요",
        "사이트에서 빠르게 편집하고\n완성된 클립을 보내줘.",
        "Bot Guide가 자연어 요청을 로컬 작업으로 바꿉니다.",
        "봇이 하는 일",
        "Bot Guide 읽기",
        "소스 파일 확인",
        "남길 구간 계획",
        "로컬 파일 렌더",
        "로컬 편집 결과",
        "8초 · 두 클립\n1080×1920\n무음 · 자막 켬",
        "로컬에서 전달 완료.",
        "결과 파일과 변경 요약을 요청하세요.",
    ),
    "zh": Copy(
        "zh",
        "用一句话\n告诉机器人。",
        "如何指挥本地 Grok bot",
        "启动 Grok Crew",
        "在同一台电脑上运行一次",
        "告诉机器人结果目标",
        "用网站快速剪辑，\n把完成的视频发给我。",
        "Bot Guide 会把自然语言变成本地操作。",
        "机器人会做什么",
        "阅读 Bot Guide",
        "检查源文件",
        "规划保留片段",
        "渲染本地文件",
        "本地剪辑结果",
        "8 秒 · 两个片段\n1080×1920\n静音 · 已开启字幕",
        "已在本地交付。",
        "索要文件和修改摘要。",
    ),
    "ja": Copy(
        "ja",
        "一言で\nボットに頼む。",
        "ローカルの Grok bot への頼み方",
        "Grok Crew を起動",
        "同じPCで一度だけ実行します",
        "欲しい結果を伝える",
        "サイトで素早く編集し、\n完成したクリップを渡して。",
        "Bot Guide が自然言語をローカル作業に変えます。",
        "ボットがすること",
        "Bot Guide を読む",
        "素材を確認",
        "残す区間を計画",
        "ローカルファイルをレンダー",
        "ローカル編集の結果",
        "8秒 · 2クリップ\n1080×1920\nミュート · 字幕あり",
        "ローカルで納品完了。",
        "ファイルと変更概要を依頼します。",
    ),
}


def font(language: str, size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    language_fonts = {
        "ko": [
            "C:/Windows/Fonts/malgunbd.ttf" if bold else "C:/Windows/Fonts/malgun.ttf",
            "C:/Windows/Fonts/gulim.ttc",
        ],
        "zh": [
            "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simhei.ttf",
        ],
        "ja": [
            "C:/Windows/Fonts/meiryob.ttc" if bold else "C:/Windows/Fonts/meiryo.ttc",
            "C:/Windows/Fonts/yugothib.ttf" if bold else "C:/Windows/Fonts/yugothic.ttf",
        ],
    }
    candidates = language_fonts.get(language, []) + [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def base(language: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", SIZE, BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, SIZE[0], 10), fill=YELLOW)
    draw.text((76, 72), "GROK CREW", font=font(language, 20, True), fill=YELLOW)
    draw.line((76, 116, SIZE[0] - 76, 116), fill=LINE, width=1)
    return image, draw


def rounded_panel(draw: ImageDraw.ImageDraw, bounds: tuple[int, int, int, int], fill: str = PANEL) -> None:
    draw.rounded_rectangle(bounds, radius=24, fill=fill, outline=LINE, width=2)


def image_clip(image: Image.Image, duration: float) -> ImageClip:
    return ImageClip(np.asarray(image)).with_duration(duration)


def clean_result_card(kicker: str, title: str, background: str, accent: str) -> Image.Image:
    """Render the eight-second result visual with generous safe margins."""
    image = Image.new("RGB", SIZE, background)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, SIZE[0], 10), fill=accent)
    draw.text((80, 82), "GROK CREW · LOCAL EDIT", font=font("en", 19, True), fill=accent)
    draw.line((80, 126, SIZE[0] - 80, 126), fill="#3d3d38", width=1)
    centered(draw, kicker, 680, font("en", 31, True), MUTED)
    centered(draw, title, 800, font("en", 96, True), WHITE)
    draw.rounded_rectangle((110, 1215, 970, 1355), radius=24, fill="#050505")
    centered(draw, title, 1242, font("en", 57, True), WHITE)
    centered(draw, "BOT-INSTRUCTED · LOCAL MP4", 1514, font("en", 20, True), accent)
    return image


def create_clean_result_source() -> None:
    """Replace the cropped legacy result card with a safe, full-frame source clip."""
    first = clean_result_card("SETUP", "ONE ASK", "#101017", YELLOW)
    second = clean_result_card("PUNCH", "SIX LINES", "#2a080d", LIME)
    result = concatenate_videoclips([image_clip(first, 4), image_clip(second, 4)], method="compose")
    result.write_videofile(
        str(SOURCE),
        fps=FPS,
        codec="libx264",
        audio=False,
        logger=None,
        ffmpeg_params=["-movflags", "+faststart"],
    )
    result.close()


def centered(draw: ImageDraw.ImageDraw, text: str, y: int, typography: ImageFont.ImageFont, fill: str = WHITE, spacing: int = 6) -> None:
    box = draw.multiline_textbbox((0, 0), text, font=typography, spacing=spacing, align="center")
    draw.multiline_text(((SIZE[0] - (box[2] - box[0])) / 2, y), text, font=typography, fill=fill, spacing=spacing, align="center")


def intro(copy: Copy) -> Image.Image:
    image, draw = base(copy.code)
    centered(draw, copy.intro_title, 650, font(copy.code, 76, True), spacing=10)
    centered(draw, copy.intro_subtitle, 900, font(copy.code, 28), MUTED)
    rounded_panel(draw, (80, 1500, 1000, 1600), PANEL_2)
    centered(draw, "SAME PC  ·  LOCAL WORKSPACE", 1530, font(copy.code, 20, True), LIME)
    return image


def terminal(copy: Copy) -> Image.Image:
    image, draw = base(copy.code)
    draw.text((80, 222), copy.terminal_title, font=font(copy.code, 54, True), fill=WHITE)
    draw.text((84, 302), copy.terminal_subtitle, font=font(copy.code, 25), fill=MUTED)
    rounded_panel(draw, (80, 450, 1000, 1220), "#101010")
    draw.text((116, 494), "●  ●  ●", font=font(copy.code, 18), fill="#73736b")
    terminal = "git clone https://github.com/NoLucas/Grok-Crew.git\n\ncd grok-crew\n\nnpm run local"
    draw.multiline_text((116, 606), terminal, font=font("en", 27), fill=WHITE, spacing=38)
    draw.text((116, 1112), "LOCALHOST:3000", font=font("en", 18, True), fill=LIME)
    return image


def prompt(copy: Copy) -> Image.Image:
    image, draw = base(copy.code)
    draw.text((80, 224), copy.prompt_title, font=font(copy.code, 52, True), fill=WHITE)
    rounded_panel(draw, (80, 490, 1000, 1130), PANEL_2)
    draw.rounded_rectangle((120, 542, 260, 604), radius=31, fill="#2d2d29")
    draw.text((153, 560), "YOU", font=font("en", 18, True), fill=YELLOW)
    draw.multiline_text((120, 670), copy.prompt, font=font(copy.code, 46, True), fill=WHITE, spacing=14)
    centered(draw, copy.prompt_subtitle, 1260, font(copy.code, 27), MUTED)
    return image


def workflow(copy: Copy) -> Image.Image:
    image, draw = base(copy.code)
    centered(draw, copy.workflow_title, 210, font(copy.code, 46, True))
    for index, item in enumerate(copy.workflow):
        y = 450 + index * 220
        rounded_panel(draw, (80, y, 1000, y + 148))
        accent = YELLOW if index % 2 == 0 else LIME
        draw.text((120, y + 46), f"0{index + 1}", font=font("en", 21, True), fill=accent)
        draw.text((260, y + 39), item, font=font(copy.code, 31, True), fill=WHITE)
    return image


def result_background(copy: Copy) -> Image.Image:
    image, draw = base(copy.code)
    centered(draw, copy.result_title, 184, font(copy.code, 45, True))
    rounded_panel(draw, (644, 694, 1000, 1138), PANEL)
    draw.text((684, 748), "LOCAL MP4", font=font("en", 17, True), fill=LIME)
    draw.multiline_text((684, 814), copy.result_body, font=font(copy.code, 23), fill=WHITE, spacing=12)
    centered(draw, "LOCAL EDIT RESULT", 1740, font("en", 18, True), MUTED)
    return image


def closing(copy: Copy) -> Image.Image:
    image, draw = base(copy.code)
    centered(draw, copy.closing_title, 760, font(copy.code, 67, True))
    centered(draw, copy.closing_subtitle, 965, font(copy.code, 30), MUTED)
    rounded_panel(draw, (80, 1450, 1000, 1550), PANEL_2)
    centered(draw, "GROK CREW · LOCAL-FIRST", 1480, font("en", 20, True), YELLOW)
    return image


def build_language(code: str) -> None:
    copy = COPY[code]
    output = DEMO_DIR / f"bot-plain-language-{code}-v2.mp4"
    preview = DEMO_DIR / f"bot-plain-language-{code}-v2.gif"
    source = VideoFileClip(str(SOURCE), audio=False)
    render = source.resized(height=900).with_position((80, 526))
    rendered_segment = CompositeVideoClip(
        [image_clip(result_background(copy), source.duration), render],
        size=SIZE,
    ).with_duration(source.duration)
    video = concatenate_videoclips(
        [
            image_clip(intro(copy), 2.2),
            image_clip(terminal(copy), 3.2),
            image_clip(prompt(copy), 3.4),
            image_clip(workflow(copy), 3.6),
            rendered_segment,
            image_clip(closing(copy), 2.2),
        ],
        method="compose",
    )
    video.write_videofile(
        str(output),
        fps=FPS,
        codec="libx264",
        audio=False,
        logger=None,
        ffmpeg_params=["-movflags", "+faststart"],
    )
    video.close()
    source.close()
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-y",
            "-i",
            str(output),
            "-vf",
            "fps=10,scale=380:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
            "-loop",
            "0",
            str(preview),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(output)
    print(preview)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", choices=[*COPY, "all"], default="all")
    args = parser.parse_args()
    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    create_clean_result_source()
    languages = COPY if args.language == "all" else {args.language: COPY[args.language]}
    for code in languages:
        build_language(code)


if __name__ == "__main__":
    main()

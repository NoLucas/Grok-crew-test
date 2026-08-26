"""Zip a same-PC bot can read. It is not an installer and does not start a server."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Any

from config import TERMINAL_CLI_PATH

INSTRUCTIONS_NAME = "지금_이렇게_하세요.txt"
INSTRUCTIONS = """이 묶음은 설치 파일이 아닙니다. 책상 창이 이미 켜져 있어야 합니다.

1. 이 글을 이 컴퓨터의 봇에게 붙여 넣으세요.
2. 봇 이름은 자기 이름을 씁니다.
3. 한 봇이 원본과 첫 컷을 같이 합니다.

같은 컴퓨터에서 명령할 수 있으면:

  python grok_crew.py entry --bot-id desk-bot --display-name "당신의 이름" --purpose edit_video

스크립트는 이 zip 안의 grok_crew.py 이거나
http://127.0.0.1:7214/downloads/grok-crew.py 입니다.

끝난 패키지는 책상이 알려 주는 받을함 폴더에 둡니다.
다른 주소로는 붙지 마세요. 관리자로 실행하지 마세요.
"""


def bot_pack_bytes() -> bytes:
    if not Path(TERMINAL_CLI_PATH).is_file():
        raise RuntimeError("The bot CLI is missing from this install.")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(INSTRUCTIONS_NAME, INSTRUCTIONS)
        archive.write(TERMINAL_CLI_PATH, "grok_crew.py")
    return buffer.getvalue()


def write_bot_pack(destination: Path) -> dict[str, Any]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = bot_pack_bytes()
    destination.write_bytes(payload)
    return {"path": str(destination), "bytes": len(payload), "files": [INSTRUCTIONS_NAME, "grok_crew.py"]}

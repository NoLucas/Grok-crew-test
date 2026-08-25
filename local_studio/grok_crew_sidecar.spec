# Build from local_studio/: python -m PyInstaller --clean grok_crew_sidecar.spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules, copy_metadata

root = Path(SPECPATH).resolve()

a = Analysis(
    [str(root / "studio_server.py")],
    pathex=[str(root)],
    binaries=[],
    datas=[
        (str(root / "assets"), "assets"),
        (str(root / "schemas"), "schemas"),
        (str(root / "bot-guide.json"), "."),
        (str(root / "bot-guide.ko.json"), "."),
        (str(root / "bot-guide.zh.json"), "."),
        (str(root / "bot-guide.ja.json"), "."),
    ] + copy_metadata("imageio") + copy_metadata("imageio-ffmpeg") + copy_metadata("moviepy"),
    hiddenimports=collect_submodules("moviepy") + ["requests"],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, name="grok-crew-studio", console=True)

# Bundled caption font

`NotoSansKR-Bold.ttf` is a static Bold instance generated from Google's
[Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR) variable
font (`fonttools varLib.instancer`, `wght=700`), so `caption_font()` in
`local_studio/studio_server.py` always has a Korean-capable (and Latin/number)
bold sans face to burn captions with, on any OS, without depending on
whatever system fonts happen to be installed.

Licensed under the SIL Open Font License, Version 1.1 — see `OFL.txt` in
this folder (copied verbatim from the upstream font's own license file).
Copyright 2014-2021 Adobe, with Reserved Font Name 'Source'.

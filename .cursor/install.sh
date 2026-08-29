#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Grok Crew.
# Installs Node deps and the Python sidecar (Local Studio) venv so that
# `npm run local`, `npm run dev`, and the studio_server.py sidecar all run.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- System dependencies (base image may lack these) ---
missing_pkgs=()
if ! python3 -c "import ensurepip" >/dev/null 2>&1; then
  missing_pkgs+=("python3-venv")
fi
# MoviePy / imageio-ffmpeg use ffmpeg for render + preview.
if ! command -v ffmpeg >/dev/null 2>&1; then
  missing_pkgs+=("ffmpeg")
fi
if [ "${#missing_pkgs[@]}" -gt 0 ]; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends "${missing_pkgs[@]}"
fi

# --- Node dependencies ---
npm ci

# --- Python sidecar (Local Studio) venv ---
# Mirrors scripts/local-runtime.mjs so `npm run local` reuses this venv and
# skips pip on subsequent boots.
cd local_studio
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python - <<'PY'
import hashlib, pathlib
stamp = pathlib.Path(".venv/.requirements.sha256")
stamp.write_text(hashlib.sha256(pathlib.Path("requirements.txt").read_bytes()).hexdigest() + "\n")
PY

echo "Grok Crew environment ready: Node deps + Local Studio venv installed."

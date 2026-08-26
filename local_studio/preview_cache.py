"""Revision-scoped MoviePy preview composite cache.

ThreadingHTTPServer is multi-threaded; MoviePy clips are not thread-safe.
This module keeps at most one live composite and serializes access with a lock.
The write_videofile / final-render path never stores clips here.
"""

from __future__ import annotations

import atexit
import threading
from pathlib import Path
from typing import Any


def proxy_fingerprint(proxy_paths: dict[str, Path] | None) -> tuple[tuple[str, str, int], ...]:
    """Sorted (asset_id, path, mtime_ns) so a newly ready proxy rebuilds."""
    if not proxy_paths:
        return ()
    items: list[tuple[str, str, int]] = []
    for asset_id in sorted(str(key) for key in proxy_paths):
        raw = proxy_paths[asset_id]
        path = raw if isinstance(raw, Path) else Path(str(raw))
        try:
            mtime_ns = int(path.stat().st_mtime_ns)
        except OSError:
            mtime_ns = 0
        items.append((str(asset_id), str(path), mtime_ns))
    return tuple(items)


def cache_key(
    project_id: str,
    revision: int,
    quality: str,
    proxy_paths: dict[str, Path] | None,
) -> tuple[str, int, str, tuple[tuple[str, str, int], ...]]:
    preview_quality = "draft" if quality == "draft" else "full"
    return (str(project_id), int(revision), preview_quality, proxy_fingerprint(proxy_paths))


class PreviewCompositeCache:
    """One live CompositeVideoClip keyed by project revision and ready proxies."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entry: dict[str, Any] | None = None
        self.compose_count = 0

    def close(self) -> None:
        with self._lock:
            self._evict_unlocked()

    def reset(self) -> None:
        with self._lock:
            self._evict_unlocked()
            self.compose_count = 0

    def current_key(self) -> tuple[Any, ...] | None:
        with self._lock:
            if self._entry is None:
                return None
            return self._entry.get("key")

    def current_final(self) -> Any:
        with self._lock:
            if self._entry is None:
                return None
            return self._entry.get("final")

    def _evict_unlocked(self) -> None:
        entry = self._entry
        self._entry = None
        if not entry:
            return
        import render

        render.close_owned(entry.get("owned_clips") or [])

    def sample(
        self,
        project_id: str,
        timeline: dict[str, Any],
        at: float,
        preview: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        import render

        preview_options = preview if isinstance(preview, dict) else {}
        quality = "draft" if preview_options.get("quality") == "draft" else "full"
        proxy_paths = preview_options.get("proxy_paths") if quality == "draft" else {}
        if not isinstance(proxy_paths, dict):
            proxy_paths = {}
        key = cache_key(project_id, int(timeline.get("revision", 1)), quality, proxy_paths)
        with self._lock:
            if self._entry is not None and self._entry.get("key") != key:
                self._evict_unlocked()
            if self._entry is None:
                composed = render._compose_timeline_v2(
                    {"timeline_json": timeline, "output_path": "outputs/preview.mp4"},
                    preview=preview_options,
                    for_sample=True,
                )
                self.compose_count += 1
                self._entry = {"key": key, **composed}
            return render.sample_composed_frame(self._entry, at)


preview_composite_cache = PreviewCompositeCache()
atexit.register(preview_composite_cache.close)


def sample_cached_timeline_frame(
    project_id: str,
    timeline: dict[str, Any],
    at: float,
    preview: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return preview_composite_cache.sample(project_id, timeline, at, preview)

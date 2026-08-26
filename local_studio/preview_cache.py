"""Revision-scoped MoviePy preview composite cache.

ThreadingHTTPServer is multi-threaded; MoviePy clips are not thread-safe.
This module keeps a small LRU of live composites and serializes access with a lock.
The write_videofile / final-render path never stores clips here.
"""

from __future__ import annotations

import atexit
import os
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

DEFAULT_MAX_ENTRIES = 4


def max_cache_entries() -> int:
    raw = os.getenv("LOCAL_STUDIO_PREVIEW_CACHE_SLOTS", "").strip()
    if not raw:
        return DEFAULT_MAX_ENTRIES
    try:
        return max(1, min(int(raw), 8))
    except ValueError:
        return DEFAULT_MAX_ENTRIES


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
    """LRU of CompositeVideoClips keyed by project revision and ready proxies."""

    def __init__(self, max_entries: int | None = None) -> None:
        self._lock = threading.Lock()
        self._entries: OrderedDict[tuple[Any, ...], dict[str, Any]] = OrderedDict()
        self.max_entries = max(1, int(max_entries or max_cache_entries()))
        self.compose_count = 0

    def close(self) -> None:
        with self._lock:
            self._evict_all_unlocked()

    def reset(self) -> None:
        with self._lock:
            self._evict_all_unlocked()
            self.compose_count = 0

    def current_key(self) -> tuple[Any, ...] | None:
        with self._lock:
            if not self._entries:
                return None
            return next(reversed(self._entries))

    def current_final(self) -> Any:
        with self._lock:
            if not self._entries:
                return None
            return next(reversed(self._entries.values())).get("final")

    def size(self) -> int:
        with self._lock:
            return len(self._entries)

    def _close_entry(self, entry: dict[str, Any] | None) -> None:
        if not entry:
            return
        import render

        render.close_owned(entry.get("owned_clips") or [])

    def _evict_all_unlocked(self) -> None:
        while self._entries:
            _key, entry = self._entries.popitem(last=False)
            self._close_entry(entry)

    def _evict_lru_unlocked(self) -> None:
        if not self._entries:
            return
        _key, entry = self._entries.popitem(last=False)
        self._close_entry(entry)

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
            entry = self._entries.get(key)
            if entry is None:
                while len(self._entries) >= self.max_entries:
                    self._evict_lru_unlocked()
                composed = render._compose_timeline_v2(
                    {"timeline_json": timeline, "output_path": "outputs/preview.mp4"},
                    preview=preview_options,
                    for_sample=True,
                )
                self.compose_count += 1
                entry = {"key": key, **composed}
                self._entries[key] = entry
            self._entries.move_to_end(key)
            return render.sample_composed_frame(entry, at)


preview_composite_cache = PreviewCompositeCache()
atexit.register(preview_composite_cache.close)


def sample_cached_timeline_frame(
    project_id: str,
    timeline: dict[str, Any],
    at: float,
    preview: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return preview_composite_cache.sample(project_id, timeline, at, preview)

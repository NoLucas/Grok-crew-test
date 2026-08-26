"""Revision-scoped MoviePy preview composite cache."""

from __future__ import annotations

import numpy as np

import preview_cache
import render
from preview import preview_at
from preview_cache import PreviewCompositeCache, cache_key, proxy_fingerprint


def _empty_timeline(revision: int = 1) -> dict:
    return {
        "schema": "grok-crew.timeline/v2",
        "revision": revision,
        "settings": {"width": 10, "height": 10, "fps": 24},
        "assets": [],
        "tracks": [],
        "markers": [],
    }


class DummyFinal:
    def __init__(self, label: str, closed: list[str]):
        self.label = label
        self.audio = None
        self.closed = closed

    def get_frame(self, _at):
        return np.zeros((10, 10, 3), dtype="uint8")

    def close(self):
        self.closed.append(self.label)


def _fake_compose(closed: list[str], label: str = "final"):
    def compose(*_args, **_kwargs):
        final = DummyFinal(label, closed)
        extra = DummyFinal(f"{label}-owned", closed)
        return {
            "final": final,
            "owned_clips": [extra, final],
            "width": 10,
            "height": 10,
            "fps": 24,
            "duration": 2.0,
            "contract": {"fps": 24, "duration": 2, "revision": 1},
            "used_proxy": False,
            "is_draft": True,
            "timeline": _empty_timeline(),
        }

    return compose


def test_cache_hit_does_not_rebuild(monkeypatch):
    cache = PreviewCompositeCache()
    closed: list[str] = []
    builds = {"n": 0}

    def compose(*args, **kwargs):
        builds["n"] += 1
        return _fake_compose(closed, f"build-{builds['n']}")(*args, **kwargs)

    monkeypatch.setattr(render, "_compose_timeline_v2", compose)
    first = cache.sample("proj", _empty_timeline(1), 0.1, {"quality": "draft"})
    second = cache.sample("proj", _empty_timeline(1), 0.8, {"quality": "draft"})
    assert builds["n"] == 1
    assert cache.compose_count == 1
    assert first["at"] != second["at"]
    assert first["width"] == 10
    assert cache.current_final() is not None
    cache.close()
    assert "build-1" in closed
    assert "build-1-owned" in closed


def test_revision_change_keeps_previous_until_lru_evicts(monkeypatch):
    cache = PreviewCompositeCache(max_entries=2)
    closed: list[str] = []
    builds = {"n": 0}

    def compose(*args, **kwargs):
        builds["n"] += 1
        return _fake_compose(closed, f"rev-{builds['n']}")(*args, **kwargs)

    monkeypatch.setattr(render, "_compose_timeline_v2", compose)
    cache.sample("proj", _empty_timeline(1), 0.1, {"quality": "draft"})
    cache.sample("proj", _empty_timeline(2), 0.1, {"quality": "draft"})
    assert builds["n"] == 2
    assert cache.size() == 2
    assert "rev-1" not in closed
    cache.sample("proj", _empty_timeline(1), 0.4, {"quality": "draft"})
    assert builds["n"] == 2
    cache.close()


def test_lru_evicts_oldest_project(monkeypatch):
    cache = PreviewCompositeCache(max_entries=2)
    closed: list[str] = []
    builds = {"n": 0}

    def compose(*args, **kwargs):
        builds["n"] += 1
        return _fake_compose(closed, f"slot-{builds['n']}")(*args, **kwargs)

    monkeypatch.setattr(render, "_compose_timeline_v2", compose)
    cache.sample("alpha", _empty_timeline(1), 0.1, {"quality": "draft"})
    cache.sample("beta", _empty_timeline(1), 0.1, {"quality": "draft"})
    cache.sample("gamma", _empty_timeline(1), 0.1, {"quality": "draft"})
    assert builds["n"] == 3
    assert cache.size() == 2
    assert "slot-1" in closed
    cache.sample("beta", _empty_timeline(1), 0.2, {"quality": "draft"})
    assert builds["n"] == 3
    cache.close()


def test_proxy_fingerprint_change_rebuilds(monkeypatch, tmp_path):
    cache = PreviewCompositeCache()
    builds = {"n": 0}

    def compose(*args, **kwargs):
        builds["n"] += 1
        return _fake_compose([], f"proxy-{builds['n']}")(*args, **kwargs)

    monkeypatch.setattr(render, "_compose_timeline_v2", compose)
    proxy = tmp_path / "broll.mp4"
    proxy.write_bytes(b"one")
    cache.sample("proj", _empty_timeline(1), 0.1, {"quality": "draft"})
    cache.sample(
        "proj",
        _empty_timeline(1),
        0.2,
        {"quality": "draft", "proxy_paths": {"broll": proxy}},
    )
    assert builds["n"] == 2
    cache.close()


def test_close_swallows_errors_and_is_idempotent():
    cache = PreviewCompositeCache()
    flags: list[str] = []

    class Boom:
        def close(self):
            flags.append("boom")
            raise RuntimeError("close failed")

    class Fine:
        def close(self):
            flags.append("fine")

    cache._entries[("p", 1, "draft", ())] = {
        "key": ("p", 1, "draft", ()),
        "owned_clips": [Fine(), Boom()],
        "final": Boom(),
    }
    cache.close()
    assert flags == ["boom", "fine"]
    cache.close()
    assert flags == ["boom", "fine"]


def test_preview_at_without_project_id_does_not_use_cache(monkeypatch):
    builds = {"n": 0}

    def compose(*args, **kwargs):
        builds["n"] += 1
        return _fake_compose([], f"one-shot-{builds['n']}")(*args, **kwargs)

    monkeypatch.setattr(render, "_compose_timeline_v2", compose)
    preview_cache.preview_composite_cache.reset()
    timeline = _empty_timeline(1)
    first = preview_at(timeline, 0.1, quality="full")
    second = preview_at(timeline, 0.5, quality="full")
    assert builds["n"] == 2
    assert preview_cache.preview_composite_cache.compose_count == 0
    assert first["mime"] == "image/png"
    assert first["width"] == 10
    assert second["image"].startswith("data:image/png;base64,")


def test_preview_at_with_project_id_reuses_composite(monkeypatch):
    builds = {"n": 0}

    def compose(*args, **kwargs):
        builds["n"] += 1
        return _fake_compose([], f"cached-{builds['n']}")(*args, **kwargs)

    monkeypatch.setattr(render, "_compose_timeline_v2", compose)
    preview_cache.preview_composite_cache.reset()
    timeline = _empty_timeline(1)
    try:
        preview_at(timeline, 0.1, quality="draft", project_id="cached-project")
        preview_at(timeline, 0.7, quality="draft", project_id="cached-project")
        assert builds["n"] == 1
        assert preview_cache.preview_composite_cache.compose_count == 1
    finally:
        preview_cache.preview_composite_cache.reset()


def test_cache_key_includes_proxy_mtime(tmp_path):
    import os

    proxy = tmp_path / "ready.mp4"
    proxy.write_bytes(b"proxy")
    first = cache_key("p", 1, "draft", {"a": proxy})
    os.utime(proxy, ns=(0, first[3][0][2] + 1_000_000))
    second = cache_key("p", 1, "draft", {"a": proxy})
    assert first[0] == "p"
    assert first[2] == "draft"
    assert first != second
    assert proxy_fingerprint({}) == ()

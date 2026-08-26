import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config  # noqa: E402
import db  # noqa: E402
import studio_server  # noqa: E402


@pytest.fixture()
def studio(tmp_path, monkeypatch):
    """config/db wired to an isolated, per-test data/workspace dir. Returns the
    studio_server module (domain logic) for convenience; tests needing config.py's
    own names (workspace_path, caption_font, DEFAULT_EDIT_METHOD, ...) should
    `import config` directly rather than reaching through this fixture."""
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(config, "WORKSPACE_DIR", tmp_path / "workspace")
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "data" / "studio.db")
    monkeypatch.delenv("HANDOFF_REPO_REMOTE", raising=False)
    db.init_db()
    import preview_cache  # noqa: E402
    preview_cache.preview_composite_cache.reset()
    try:
        yield studio_server
    finally:
        preview_cache.preview_composite_cache.reset()


@pytest.fixture()
def live_server(studio):
    """A real StudioHandler bound to an ephemeral loopback port, for HTTP-level tests."""
    from handlers import StudioHandler  # deferred: mirrors studio_server.main()'s own import

    server = ThreadingHTTPServer(("127.0.0.1", 0), StudioHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

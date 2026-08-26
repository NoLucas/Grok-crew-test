"""SSRF, secret redaction, and retry-payload allowlist coverage."""

from __future__ import annotations

import socket

import pytest

import config
import publishers
from upload_urls import require_https_upload_url


def _public_resolver(_host, _port, **_kwargs):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443))]


def _private_resolver(_host, _port, **_kwargs):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]


def test_require_https_upload_url_allows_platform_hosts():
    url = require_https_upload_url(
        "https://upload.googleapis.com/resumable",
        resolver=_public_resolver,
    )
    assert url.startswith("https://upload.googleapis.com/")


def test_require_https_upload_url_rejects_http_and_credentials():
    with pytest.raises(RuntimeError, match="https"):
        require_https_upload_url("http://upload.googleapis.com/x", resolver=_public_resolver)
    with pytest.raises(RuntimeError, match="credentials"):
        require_https_upload_url("https://user:pass@upload.googleapis.com/x", resolver=_public_resolver)


def test_require_https_upload_url_rejects_offlist_and_ip_hosts():
    with pytest.raises(RuntimeError, match="not allowed"):
        require_https_upload_url("https://evil.example/steal", resolver=_public_resolver)
    with pytest.raises(RuntimeError, match="not allowed"):
        require_https_upload_url("https://127.0.0.1/upload", resolver=_public_resolver)
    with pytest.raises(RuntimeError, match="not allowed"):
        require_https_upload_url("https://upload.googleapis.com.evil.example/x", resolver=_public_resolver)


def test_require_https_upload_url_rejects_private_resolution():
    with pytest.raises(RuntimeError, match="blocked address"):
        require_https_upload_url("https://graph.instagram.com/upload", resolver=_private_resolver)


def test_sanitize_publish_error_covers_oauth_and_bare_tokens():
    text = publishers.sanitize_publish_error(
        "oauth secret-oauth authorization: hidden refresh_token=abc access_token=def "
        "client_secret=shh api_key=zzz token=plain ya29.live ghp_not_a_real_token sk-openai"
    )
    assert "secret-oauth" not in text
    assert "hidden" not in text
    assert "abc" not in text
    assert "def" not in text
    assert "shh" not in text
    assert "zzz" not in text
    assert "plain" not in text
    assert "ya29.live" not in text
    assert "ghp_not_a_real_token" not in text
    assert "sk-openai" not in text
    assert "[redacted]" in text


def test_retry_publish_keeps_only_allowlisted_fields(studio, monkeypatch):
    project = studio.new_project({
        "title": "retry allowlist",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {"clips": [{"in": 0.0, "out": 4.0, "keep": True}]},
    })
    captured = []

    class FakePublisher:
        def publish(self, _project, payload):
            captured.append(payload)
            if len(captured) == 1:
                raise RuntimeError("temporary outage")
            return {"remote_id": "ok"}

    monkeypatch.setitem(publishers.PUBLISHERS, "youtube", FakePublisher())
    try:
        publishers.publish("youtube", project, {"idempotency_key": "allow-1"})
    except RuntimeError:
        pass
    receipt = publishers.list_publish_receipts(project["id"])[0]
    publishers.retry_publish(project, receipt["id"], {
        "approved": True,
        "receipt_id": receipt["id"],
        "caption": "safe caption",
        "idempotency_key": "attacker-key",
        "evil": True,
        "auto_upload": True,
    })
    assert captured[1]["idempotency_key"] == "allow-1"
    assert captured[1]["caption"] == "safe caption"
    assert "evil" not in captured[1]
    assert "approved" not in captured[1]
    assert "receipt_id" not in captured[1]
    assert "auto_upload" not in captured[1]


def test_workspace_relative_hides_outside_paths(studio):
    inside = config.WORKSPACE_DIR / "outputs" / "final-video.mp4"
    inside.parent.mkdir(parents=True, exist_ok=True)
    inside.write_bytes(b"x")
    assert config.workspace_relative(inside) == "outputs/final-video.mp4"
    assert config.workspace_relative("/etc/passwd") == "passwd"

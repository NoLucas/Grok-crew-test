"""SSRF, secret redaction, and retry-payload allowlist coverage."""

from __future__ import annotations

import socket
import threading
import time

import pytest

import config
import publishers
from publishers.base import request_with_backoff
from upload_urls import require_https_upload_url, validated_request


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
    assert "\\" not in config.workspace_relative(inside)
    assert config.workspace_relative("/etc/passwd") == "passwd"


def test_cgnat_and_mapped_loopback_are_blocked():
    def cgnat(_host, _port, **_kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("100.64.1.8", 443))]

    def mapped(_host, _port, **_kwargs):
        return [(socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::ffff:127.0.0.1", 443, 0, 0))]

    with pytest.raises(RuntimeError, match="blocked address"):
        require_https_upload_url("https://graph.instagram.com/x", resolver=cgnat)
    with pytest.raises(RuntimeError, match="blocked address"):
        require_https_upload_url("https://graph.instagram.com/x", resolver=mapped)


def test_sanitize_publish_error_redacts_json_secrets():
    text = publishers.sanitize_publish_error('Graph said {"access_token": "secret-json-token", "client_secret": "shh-json"}')
    assert "secret-json-token" not in text
    assert "shh-json" not in text
    assert "[redacted]" in text


def test_request_with_backoff_refuses_redirects():
    captured: dict[str, object] = {}

    class Response:
        status_code = 307
        text = "moved"
        headers = {"Location": "http://127.0.0.1/steal"}

    class Session:
        def __init__(self):
            self.trust_env = True

        def mount(self, *_args, **_kwargs):
            return None

        def close(self):
            return None

        def request(self, _method, _url, **kwargs):
            captured.update(kwargs)
            return Response()

    class Module:
        RequestException = Exception

        @staticmethod
        def Session():
            return Session()

    with pytest.raises(RuntimeError, match="redirect"):
        request_with_backoff(Module(), "PUT", "https://upload.googleapis.com/x", resolver=_public_resolver)
    assert captured.get("allow_redirects") is False


def test_validated_request_connects_to_pinned_ip(monkeypatch):
    seen: list[str] = []

    def fake_create(address, timeout=None, source_address=None, socket_options=None):
        seen.append(address[0])
        raise OSError("stop after pin")

    monkeypatch.setattr("upload_urls.create_connection", fake_create)
    import requests

    with pytest.raises((RuntimeError, requests.RequestException, OSError)):
        validated_request(
            requests,
            "GET",
            "https://graph.instagram.com/probe",
            resolver=_public_resolver,
            timeout=1,
        )
    assert seen and seen[0] == "1.1.1.1"


def test_concurrent_retry_publishes_once(studio, monkeypatch):
    project = studio.new_project({
        "title": "retry race",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {"clips": [{"in": 0.0, "out": 4.0, "keep": True}]},
    })
    started = threading.Event()
    release = threading.Event()
    calls: list[int] = []

    class FakePublisher:
        def publish(self, _project, _payload):
            if not calls:
                calls.append(1)
                raise RuntimeError("first fail")
            calls.append(1)
            started.set()
            release.wait(3)
            return {"remote_id": "once"}

    monkeypatch.setitem(publishers.PUBLISHERS, "youtube", FakePublisher())
    with pytest.raises(RuntimeError):
        publishers.publish("youtube", project, {"idempotency_key": "race-1"})
    receipt = publishers.list_publish_receipts(project["id"])[0]
    errors: list[str] = []

    def worker():
        try:
            publishers.retry_publish(project, receipt["id"])
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    first = threading.Thread(target=worker)
    second = threading.Thread(target=worker)
    first.start()
    assert started.wait(2)
    second.start()
    time.sleep(0.15)
    release.set()
    first.join(3)
    second.join(3)
    assert calls[1:] == [1]
    assert any("already running" in item for item in errors)


def test_interrupted_retry_marks_possible_duplicate(studio, monkeypatch):
    project = studio.new_project({
        "title": "interrupted retry",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {"clips": [{"in": 0.0, "out": 4.0, "keep": True}]},
    })

    class FakePublisher:
        def publish(self, _project, _payload):
            return {"remote_id": "after-crash"}

    monkeypatch.setitem(publishers.PUBLISHERS, "tiktok", FakePublisher())
    from config import utc_now
    from db import db

    now = utc_now()
    with db() as conn:
        conn.execute(
            """INSERT INTO publish_receipts
            (id, platform, idempotency_key, project_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'running', ?, ?)""",
            ("receipt-int", "tiktok", "int-key", project["id"], now, now),
        )
    assert publishers.reconcile_publish_receipts() == 1
    result = publishers.retry_publish(project, "receipt-int")
    assert result["remote_id"] == "after-crash"
    assert result["possible_duplicate"] is True

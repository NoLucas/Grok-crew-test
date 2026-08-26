"""P3 launch status, publish receipts, retry, and error sanitization."""

from __future__ import annotations

import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import publishers
from config import utc_now
from db import db
from launch import launch_status


def post(base_url, path, body):
    request = Request(
        f"{base_url}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(base_url, path):
    with urlopen(Request(f"{base_url}{path}"), timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def make_project(studio):
    return studio.new_project({
        "title": "P3 project",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {"clips": [{"in": 0.0, "out": 4.0, "keep": True, "caption": "Hook"}]},
    })


def test_launch_status_marks_signing_and_oauth_external(studio):
    status = launch_status()
    json.dumps(status)
    assert status["schema"] == "grok-crew.launch-status/v1"
    assert status["local_gates"]["publish_receipts"] is True
    assert status["external_gates"]["oauth_apps"]["ready"] is False
    assert status["external_gates"]["code_signing"]["ready"] is False
    assert status["external_gates"]["auto_update_install"]["ready"] is False
    assert "external" in status["external_gates"]["oauth_apps"]["status"]


def test_http_launch_status_is_available(live_server):
    payload = get_json(live_server, "/api/v2/launch")
    assert payload["schema"] == "grok-crew.launch-status/v1"
    assert payload["sidecar"]["bind"] == "127.0.0.1"


def test_failed_publish_sanitizes_token_and_can_retry(studio, monkeypatch):
    project = make_project(studio)
    calls = []

    class FakePublisher:
        def publish(self, _project, payload):
            calls.append(payload["idempotency_key"])
            if len(calls) == 1:
                raise RuntimeError("upload failed bearer secret-token-xyz")
            return {"remote_id": "yt-2"}

    monkeypatch.setitem(publishers.PUBLISHERS, "youtube", FakePublisher())
    try:
        publishers.publish("youtube", project, {"idempotency_key": "p3-retry"})
        raise AssertionError("first publish should fail")
    except RuntimeError as exc:
        assert "secret-token-xyz" not in str(exc)
        assert "[redacted]" in str(exc)

    receipts = publishers.list_publish_receipts(project["id"])
    assert receipts[0]["status"] == "failed"
    assert "secret-token-xyz" not in (receipts[0]["error_text"] or "")

    result = publishers.retry_publish(project, receipts[0]["id"])
    assert result["remote_id"] == "yt-2"
    assert result["deduplicated"] is False
    assert calls == ["p3-retry", "p3-retry"]
    assert publishers.list_publish_receipts(project["id"])[0]["status"] == "succeeded"


def test_reconcile_marks_running_receipts_failed(studio):
    project = make_project(studio)
    now = utc_now()
    with db() as conn:
        conn.execute(
            """INSERT INTO publish_receipts
            (id, platform, idempotency_key, project_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'running', ?, ?)""",
            ("receipt-running", "tiktok", "stuck-key", project["id"], now, now),
        )
    assert publishers.reconcile_publish_receipts() == 1
    receipts = publishers.list_publish_receipts(project["id"])
    assert receipts[0]["status"] == "interrupted"
    assert "unclean" in (receipts[0]["error_text"] or "").lower()
    assert "second copy" in (receipts[0]["error_text"] or "").lower()


def test_http_receipts_and_retry_require_approval(live_server, studio, monkeypatch):
    project = make_project(studio)

    class FakePublisher:
        def publish(self, _project, _payload):
            raise RuntimeError("temporary platform outage")

    monkeypatch.setitem(publishers.PUBLISHERS, "instagram", FakePublisher())
    try:
        publishers.publish("instagram", project, {"idempotency_key": "ig-1"})
    except RuntimeError:
        pass
    listed = get_json(live_server, f"/api/v2/projects/{project['id']}/publish-receipts")
    assert listed["receipts"][0]["status"] == "failed"
    receipt_id = listed["receipts"][0]["id"]
    try:
        post(live_server, f"/api/v2/projects/{project['id']}/publish-receipts/retry", {"receipt_id": receipt_id})
        raise AssertionError("retry without approval must fail")
    except HTTPError as exc:
        assert exc.code == 400

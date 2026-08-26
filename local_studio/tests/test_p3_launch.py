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


_OAUTH_APP_ENV = (
    "GROK_CREW_GITHUB_CLIENT_ID",
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID",
)
_SIGNING_ENV = (
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
)
_PUBLISH_TOKEN_ENV = (
    "INSTAGRAM_ACCESS_TOKEN",
    "TIKTOK_ACCESS_TOKEN",
    "YOUTUBE_ACCESS_TOKEN",
)


def _clear_external_env(monkeypatch):
    for name in (*_OAUTH_APP_ENV, *_SIGNING_ENV, *_PUBLISH_TOKEN_ENV):
        monkeypatch.delenv(name, raising=False)


def test_launch_status_marks_signing_and_oauth_external(studio, monkeypatch):
    _clear_external_env(monkeypatch)
    status = launch_status()
    json.dumps(status)
    assert status["schema"] == "grok-crew.launch-status/v1"
    assert status["local_gates"]["publish_receipts"] is True
    oauth = status["external_gates"]["oauth_apps"]
    signing = status["external_gates"]["code_signing"]
    assert oauth["ready"] is False
    assert signing["ready"] is False
    assert status["external_gates"]["auto_update_install"]["ready"] is False
    assert "external" in oauth["status"]
    apps = oauth["apps"]
    assert apps["github"]["configured"] is False
    assert apps["github"]["status"] == "external"
    assert apps["instagram"]["configured"] is False
    assert apps["instagram"]["oauth_app"] is False
    assert apps["instagram"]["publish_token"] is False
    assert apps["tiktok"]["configured"] is False
    assert apps["tiktok"]["oauth_app"] is False
    assert apps["youtube"]["configured"] is False
    assert apps["youtube"]["oauth_app"] is False
    assert signing["builder_notarize"] is False
    assert signing["env_present"]["CSC_LINK"] is False
    assert signing["env_present"]["APPLE_TEAM_ID"] is False
    assert "CSC_LINK" in signing["missing_env"]
    assert "flips the builder flag" in signing["detail"]
    assert "GROK_CREW_GITHUB_CLIENT_ID" in oauth["missing_env"]
    assert all(isinstance(flag, bool) for flag in oauth["env_present"].values())
    assert all(isinstance(flag, bool) for flag in signing["env_present"].values())


def test_github_env_client_id_does_not_mark_oauth_apps_ready(studio, monkeypatch):
    _clear_external_env(monkeypatch)
    monkeypatch.setenv("GROK_CREW_GITHUB_CLIENT_ID", "operator-env-present")
    status = launch_status()
    oauth = status["external_gates"]["oauth_apps"]
    assert oauth["apps"]["github"]["configured"] is True
    assert oauth["apps"]["github"]["status"] == "env_client_id"
    assert oauth["ready"] is False
    assert status["external_gates"]["code_signing"]["ready"] is False
    assert status["external_gates"]["auto_update_install"]["ready"] is False
    assert "operator-env-present" not in json.dumps(status)


def test_oauth_and_signing_env_never_mark_external_gates_ready(studio, monkeypatch):
    _clear_external_env(monkeypatch)
    for name in (*_OAUTH_APP_ENV, *_SIGNING_ENV, *_PUBLISH_TOKEN_ENV):
        monkeypatch.setenv(name, "operator-env-present")
    status = launch_status()
    oauth = status["external_gates"]["oauth_apps"]
    signing = status["external_gates"]["code_signing"]
    assert oauth["apps"]["github"]["configured"] is True
    assert oauth["apps"]["instagram"]["configured"] is True
    assert oauth["apps"]["instagram"]["oauth_app"] is True
    assert oauth["apps"]["tiktok"]["oauth_app"] is True
    assert oauth["apps"]["youtube"]["oauth_app"] is True
    assert oauth["ready"] is False
    assert signing["ready"] is False
    assert signing["env_present"]["CSC_LINK"] is True
    assert signing["env_present"]["APPLE_ID"] is True
    assert signing["builder_notarize"] is False
    assert "operator-env-present" not in json.dumps(status)


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

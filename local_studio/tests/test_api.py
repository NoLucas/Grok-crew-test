"""HTTP-level tests against a real StudioHandler on an ephemeral loopback port."""
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import config
from db import db


def post(base_url, path, body):
    request = Request(
        f"{base_url}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def create_project(base_url):
    return post(base_url, "/api/projects", {
        "title": "api test",
        "source_path": "inputs/source.mp4",
        "timeline": {"clips": [{"in": 0.0, "out": 4.0, "keep": True}]},
    })["project"]


def get_status(base_url, path):
    """Return (status_code, parsed_json) without raising on non-2xx responses."""
    try:
        with urlopen(Request(f"{base_url}{path}"), timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def test_analysis_thumbnail_is_available_to_the_desktop_preview(live_server):
    project = create_project(live_server)
    thumbnail = config.DATA_DIR / "analysis" / project["id"] / "thumbnails" / "scene-01.jpg"
    thumbnail.parent.mkdir(parents=True, exist_ok=True)
    thumbnail.write_bytes(b"preview-jpeg")
    now = "2026-08-25T00:00:00+00:00"
    with db() as connection:
        connection.execute(
            """INSERT INTO project_analysis
            (project_id, status, media_json, transcript_json, thumbnails_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                project["id"], "ready", json.dumps({"status": "ready", "duration": 4}),
                json.dumps({"status": "unavailable", "words": []}),
                json.dumps([{"id": "scene-01", "at": 2, "path": str(thumbnail), "size_bytes": 12}]),
                now, now,
            ),
        )
    with urlopen(Request(f"{live_server}/analysis-media/{project['id']}/scene-01"), timeout=10) as response:
        assert response.status == 200
        assert response.headers["Content-Type"] == "image/jpeg"
        assert response.read() == b"preview-jpeg"


# -- regression coverage for plan item 0.3: Instagram auto_upload gate -------

def test_instagram_auto_upload_without_policy_or_approval_stays_queued(live_server):
    project = create_project(live_server)
    response = post(live_server, f"/api/projects/{project['id']}/instagram", {
        "render_path": "outputs/final-video.mp4",
        "auto_upload": True,
    })
    assert response["auto_upload"] is False
    assert response["job"]["status"] == "queued"


def test_instagram_auto_upload_with_human_approval_runs_immediately(live_server):
    project = create_project(live_server)
    response = post(live_server, f"/api/projects/{project['id']}/instagram", {
        "render_path": "outputs/final-video.mp4",
        "auto_upload": True,
        "approved": True,
        "wait": True,  # block until the background job finishes, so the assertion below is deterministic
    })
    assert response["auto_upload"] is True
    # No Instagram credentials are configured in the test environment, so the
    # job is expected to fail fast rather than stay queued -- the point of
    # this test is that it *attempted* to run, not that it succeeded.
    assert response["job"]["status"] in {"failed", "succeeded"}


def test_instagram_auto_upload_with_auto_local_bot_policy_runs_immediately(live_server):
    project = create_project(live_server)
    post(live_server, "/api/bots/execution-policy", {"bot_id": "editor-01", "mode": "auto_local"})
    response = post(live_server, f"/api/projects/{project['id']}/instagram", {
        "render_path": "outputs/final-video.mp4",
        "auto_upload": True,
        "bot_id": "editor-01",
    })
    assert response["auto_upload"] is True


# -- regression coverage for plan item 1.2: honest HTTP status codes ---------

def test_get_unknown_job_returns_404_not_200(live_server):
    status, body = get_status(live_server, "/api/jobs/does-not-exist")
    assert status == 404
    assert body["error"] == "Job not found"


def test_get_unknown_project_returns_404_not_200(live_server):
    status, body = get_status(live_server, "/api/projects/does-not-exist")
    assert status == 404
    assert body["error"] == "Project not found"


def test_get_existing_job_still_returns_200(live_server):
    project = create_project(live_server)
    job = post(live_server, f"/api/projects/{project['id']}/render", {"approved": True, "run_immediately": False})["job"]
    status, body = get_status(live_server, f"/api/jobs/{job['id']}")
    assert status == 200
    assert body["job"]["id"] == job["id"]


def test_get_with_invalid_bot_id_returns_400_not_500(live_server):
    # '!' is outside valid_bot_id()'s allowed charset, so this should surface
    # as a client-input error, not an unhandled-exception 500.
    status, body = get_status(live_server, "/api/bots/bad%21id/execution-policy")
    assert status == 400
    assert "error" in body


# -- regression coverage for plan item 2.3: token check -----------------------

def test_token_check_rejects_wrong_bearer_token(live_server, monkeypatch):
    monkeypatch.setenv("LOCAL_STUDIO_TOKEN", "correct-token")
    request = Request(f"{live_server}/api/projects", headers={"Authorization": "Bearer wrong-token"})
    try:
        urlopen(request, timeout=10)
        assert False, "expected a 401 for a wrong token"
    except HTTPError as exc:
        assert exc.code == 401


def test_token_check_accepts_correct_bearer_token(live_server, monkeypatch):
    monkeypatch.setenv("LOCAL_STUDIO_TOKEN", "correct-token")
    request = Request(f"{live_server}/api/projects", headers={"Authorization": "Bearer correct-token"})
    with urlopen(request, timeout=10) as response:
        assert response.status == 200


def test_health_hides_paths_without_token(live_server, monkeypatch):
    monkeypatch.setenv("LOCAL_STUDIO_TOKEN", "correct-token")
    status, body = get_status(live_server, "/health")
    assert status == 200
    assert body["status"] == "ready"
    assert "workspace" not in body
    assert "database" not in body
    request = Request(f"{live_server}/health", headers={"Authorization": "Bearer correct-token"})
    with urlopen(request, timeout=10) as response:
        full = json.loads(response.read().decode("utf-8"))
    assert "workspace" in full


def test_malformed_media_range_returns_416(live_server, studio):
    media = config.WORKSPACE_DIR / "inputs" / "range-source.mp4"
    media.parent.mkdir(parents=True, exist_ok=True)
    media.write_bytes(b"0123456789")
    request = Request(f"{live_server}/media/inputs/range-source.mp4", headers={"Range": "bytes=not-a-range"})
    try:
        urlopen(request, timeout=10)
        assert False, "expected 416 for a malformed Range header"
    except HTTPError as exc:
        assert exc.code == 416


def test_render_queue_requires_approval_or_auto_local(live_server):
    project = create_project(live_server)
    try:
        post(live_server, f"/api/v2/projects/{project['id']}/render-queue", {"run_immediately": False})
        assert False, "expected render-queue without approval to be rejected"
    except HTTPError as exc:
        assert exc.code == 400
    queued = post(live_server, f"/api/v2/projects/{project['id']}/render-queue", {
        "approved": True,
        "run_immediately": False,
    })
    assert queued["job"]["status"] == "queued"


# -- CORS / cross-origin guard ------------------------------------------------

def test_disallowed_origin_is_rejected(live_server):
    request = Request(f"{live_server}/health", headers={"Origin": "http://evil.example"})
    try:
        urlopen(request, timeout=10)
        assert False, "expected a 403 for a disallowed Origin"
    except HTTPError as exc:
        assert exc.code == 403
        assert "error" in json.loads(exc.read().decode("utf-8"))


def test_v2_publish_requires_approval_and_idempotency_key(live_server):
    project = create_project(live_server)
    try:
        post(live_server, f"/api/v2/projects/{project['id']}/publish/youtube", {"approved": False})
        assert False, "expected publishing without approval to be rejected"
    except HTTPError as exc:
        assert exc.code == 400
    try:
        post(live_server, f"/api/v2/projects/{project['id']}/publish/youtube", {"approved": True})
        assert False, "expected a missing idempotency key to be rejected"
    except HTTPError as exc:
        assert exc.code == 400


def test_v2_control_job_pause_and_resume_are_durable(live_server):
    project = create_project(live_server)
    created = post(live_server, f"/api/v2/projects/{project['id']}/control-jobs", {
        "execution_policy": "review_before_render",
        "publish_policy": {
            "schema": "grok-crew.publish-policy/v1",
            "instagram": "ask", "tiktok": "ask", "youtube": "ask",
        },
    })["control_job"]
    paused = post(live_server, f"/api/v2/control-jobs/{created['id']}/control", {"command": "pause"})["control_job"]
    assert paused["status"] == "pause_requested"
    assert paused["attempt"] == 1
    assert paused["control_sequence"] == 1
    resumed = post(live_server, f"/api/v2/control-jobs/{created['id']}/control", {"command": "resume"})["control_job"]
    assert resumed["status"] == "queued"
    assert resumed["attempt"] == 2
    assert resumed["control_sequence"] == 2

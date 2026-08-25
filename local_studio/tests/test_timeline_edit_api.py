"""HTTP contract coverage for P1-01 Timeline v2 editing errors."""

import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def post_status(base_url, path, body):
    request = Request(
        f"{base_url}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def create_project(base_url):
    status, body = post_status(base_url, "/api/projects", {
        "title": "P1 API",
        "source_path": "inputs/source.mp4",
        "timeline": {"clips": [
            {"in": 0.0, "out": 4.0, "keep": True},
            {"in": 4.0, "out": 8.0, "keep": True},
        ]},
    })
    assert status == 201
    return body["project"]


def timeline_patch(base_revision, operation):
    return {
        "schema": "grok-crew.timeline-patch/v1",
        "base_revision": base_revision,
        "origin": "human",
        "created_by": "api-test",
        "operations": [operation],
    }


def test_stale_patch_returns_409_structured_conflict(live_server):
    project = create_project(live_server)
    path = f"/api/v2/projects/{project['id']}/timeline/patch"
    first_status, _ = post_status(live_server, path, timeline_patch(1, {
        "op": "move_clip", "clip_id": "clip-1", "timeline_start": 1,
    }))
    stale_status, error = post_status(live_server, path, timeline_patch(1, {
        "op": "move_clip", "clip_id": "clip-2", "timeline_start": 5,
    }))

    assert first_status == 201
    assert stale_status == 409
    assert error["code"] == "stale_timeline_revision"
    assert error["details"] == {"expected_revision": 2, "received_revision": 1}


def test_invalid_operation_returns_structured_validation_error(live_server):
    project = create_project(live_server)
    status, error = post_status(
        live_server,
        f"/api/v2/projects/{project['id']}/timeline/patch",
        timeline_patch(1, {
            "op": "move_clip", "clip_id": "clip-1", "timeline_start": -1,
        }),
    )

    assert status == 400
    assert error["code"] == "invalid_time_range"
    assert error["details"]["operation_index"] == 0
    assert error["details"]["field"] == "timeline_start"

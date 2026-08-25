"""P1-03 persistent undo/redo command-stack tests."""

import json
import urllib.request

import pytest

from desktop_domain import (
    HISTORY_SCHEMA,
    PATCH_SCHEMA,
    TimelinePatchError,
    apply_timeline_history_action,
    apply_timeline_patch,
    get_timeline,
    get_timeline_history,
    list_timeline_versions,
    restore_timeline_version,
)


def make_project(studio):
    return studio.new_project({
        "title": "P1 edit history",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {
            "clips": [{"in": 0, "out": 8, "keep": True, "caption": ""}],
            "render_settings": {"fps": 30, "quality": "balanced"},
        },
    })


def patch(project_id, revision, timeline_start):
    return apply_timeline_patch(project_id, {
        "schema": PATCH_SCHEMA,
        "base_revision": revision,
        "origin": "human",
        "created_by": "history-test",
        "operations": [{
            "op": "move_clip", "clip_id": "clip-1", "timeline_start": timeline_start,
        }],
    })


def history_action(project_id, revision, action):
    return apply_timeline_history_action(project_id, {
        "schema": HISTORY_SCHEMA,
        "base_revision": revision,
        "action": action,
        "created_by": "history-test",
    })


def clip_start(result):
    timeline = result["timeline"] if "timeline" in result else result
    return next(track["clips"][0]["timeline_start"] for track in timeline["tracks"] if track["type"] == "video")


def test_undo_and_redo_create_new_immutable_revisions(studio):
    project = make_project(studio)
    edited = patch(project["id"], 1, 2)
    undone = history_action(project["id"], 2, "undo")
    redone = history_action(project["id"], 3, "redo")

    assert (edited["timeline"]["revision"], clip_start(edited)) == (2, 2)
    assert (undone["timeline"]["revision"], clip_start(undone)) == (3, 0)
    assert (redone["timeline"]["revision"], clip_start(redone)) == (4, 2)
    assert undone["history"]["can_redo"] is True
    assert redone["history"]["can_redo"] is False

    versions = {item["revision"]: item for item in list_timeline_versions(project["id"])}
    assert clip_start(versions[1]["timeline_json"]) == 0
    assert clip_start(versions[2]["timeline_json"]) == 2
    assert versions[3]["action_kind"] == "undo"
    assert versions[3]["restored_from_revision"] == 1
    assert versions[4]["action_kind"] == "redo"
    assert versions[4]["restored_from_revision"] == 2


def test_multiple_undo_redo_actions_keep_stack_order(studio):
    project = make_project(studio)
    patch(project["id"], 1, 1)
    patch(project["id"], 2, 2)
    patch(project["id"], 3, 3)

    first_undo = history_action(project["id"], 4, "undo")
    second_undo = history_action(project["id"], 5, "undo")
    first_redo = history_action(project["id"], 6, "redo")
    second_redo = history_action(project["id"], 7, "redo")

    assert [clip_start(value) for value in [first_undo, second_undo, first_redo, second_redo]] == [2, 1, 2, 3]
    assert second_undo["history"]["undo_count"] == 1
    assert second_undo["history"]["redo_count"] == 2
    assert second_redo["history"]["redo_count"] == 0


def test_new_edit_after_undo_clears_redo_branch(studio):
    project = make_project(studio)
    patch(project["id"], 1, 1)
    patch(project["id"], 2, 2)
    undone = history_action(project["id"], 3, "undo")
    divergent = patch(project["id"], undone["timeline"]["revision"], 4)

    history = get_timeline_history(project["id"])
    assert divergent["timeline"]["revision"] == 5
    assert clip_start(divergent) == 4
    assert history["can_redo"] is False
    assert history["redo_count"] == 0

    with pytest.raises(TimelinePatchError) as captured:
        history_action(project["id"], 5, "redo")
    assert captured.value.code == "history_action_unavailable"
    assert get_timeline(project["id"])["timeline"]["revision"] == 5


def test_stale_history_action_never_changes_head(studio):
    project = make_project(studio)
    patch(project["id"], 1, 1)
    patch(project["id"], 2, 2)

    with pytest.raises(TimelinePatchError) as captured:
        history_action(project["id"], 2, "undo")

    assert captured.value.code == "stale_timeline_revision"
    assert captured.value.status == 409
    assert captured.value.details == {"expected_revision": 3, "received_revision": 2}
    assert get_timeline(project["id"])["timeline"]["revision"] == 3


def test_history_state_survives_new_database_connections(studio):
    project = make_project(studio)
    patch(project["id"], 1, 1)
    patch(project["id"], 2, 2)
    history_action(project["id"], 3, "undo")

    first = get_timeline_history(project["id"])
    second = get_timeline_history(project["id"])

    assert first == second
    assert first["head_revision"] == 4
    assert first["can_undo"] is True
    assert first["can_redo"] is True


def test_manual_restore_is_a_new_command_and_clears_redo(studio):
    project = make_project(studio)
    patch(project["id"], 1, 1)
    patch(project["id"], 2, 2)
    history_action(project["id"], 3, "undo")
    restored = restore_timeline_version(project["id"], 1)

    assert restored["timeline"]["revision"] == 5
    assert get_timeline_history(project["id"])["can_redo"] is False
    version = list_timeline_versions(project["id"])[0]
    assert version["action_kind"] == "restore"
    assert version["restored_from_revision"] == 1


def test_history_http_contract(live_server, studio):
    project = make_project(studio)
    patch(project["id"], 1, 1)
    request = urllib.request.Request(
        f"{live_server}/api/v2/projects/{project['id']}/timeline/history",
        data=json.dumps({
            "schema": HISTORY_SCHEMA,
            "base_revision": 2,
            "action": "undo",
            "created_by": "http-test",
        }).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:  # noqa: S310 - loopback fixture
        payload = json.loads(response.read())
    assert response.status == 201
    assert payload["timeline"]["revision"] == 3
    assert payload["history"]["can_redo"] is True

    with urllib.request.urlopen(  # noqa: S310 - loopback fixture
        f"{live_server}/api/v2/projects/{project['id']}/history",
    ) as response:
        history_payload = json.loads(response.read())
    assert history_payload["history"]["head_revision"] == 3


def test_empty_or_invalid_history_action_is_rejected(studio):
    project = make_project(studio)
    with pytest.raises(TimelinePatchError) as captured:
        history_action(project["id"], 1, "undo")
    assert captured.value.code == "history_action_unavailable"

    with pytest.raises(TimelinePatchError) as captured:
        apply_timeline_history_action(project["id"], {
            "schema": HISTORY_SCHEMA,
            "base_revision": 1,
            "action": "rewind",
        })
    assert captured.value.code == "invalid_history_action"

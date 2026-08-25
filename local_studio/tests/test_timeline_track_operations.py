"""P1-02 track, grouping, snapping, and marker persistence tests."""

import pytest

from desktop_domain import (
    DEFAULT_SNAP_TOLERANCE_FRAMES,
    PATCH_SCHEMA,
    TimelinePatchError,
    apply_timeline_patch,
    get_timeline,
    list_timeline_versions,
)


def make_project(studio):
    return studio.new_project({
        "title": "P1 track editing",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {
            "clips": [
                {"in": 0, "out": 4, "keep": True, "caption": "First"},
                {"in": 4, "out": 8, "keep": True, "caption": "Second"},
            ],
            "render_settings": {"fps": 30, "quality": "balanced"},
        },
    })


def patch(project_id, revision, operations, origin="human"):
    return apply_timeline_patch(project_id, {
        "schema": PATCH_SCHEMA,
        "base_revision": revision,
        "origin": origin,
        "created_by": "p1-track-test",
        "operations": operations,
    })


def expect_error(project_id, revision, operation, origin="human"):
    with pytest.raises(TimelinePatchError) as captured:
        patch(project_id, revision, [operation], origin=origin)
    return captured.value


def video_track(result):
    timeline = result["timeline"] if "timeline" in result else result
    return next(track for track in timeline["tracks"] if track["type"] == "video")


def test_migrated_timeline_has_track_and_snapping_defaults(studio):
    project = make_project(studio)
    timeline = get_timeline(project["id"])["timeline"]

    assert timeline["settings"]["snapping_enabled"] is True
    assert timeline["settings"]["snap_tolerance_frames"] == DEFAULT_SNAP_TOLERANCE_FRAMES
    assert all(track["solo"] is False for track in timeline["tracks"])


def test_track_lock_mute_and_solo_persist_as_immutable_revisions(studio):
    project = make_project(studio)
    locked = patch(project["id"], 1, [{
        "op": "update_track",
        "track_id": "video-main",
        "changes": {"locked": True},
    }])
    controlled = patch(project["id"], 2, [{
        "op": "update_track",
        "track_id": "video-main",
        "changes": {"muted": True, "solo": True},
    }])

    track = video_track(controlled)
    assert (track["locked"], track["muted"], track["solo"]) == (True, True, True)
    assert video_track(locked)["solo"] is False
    parent = next(item for item in list_timeline_versions(project["id"]) if item["revision"] == 1)
    assert video_track(parent["timeline_json"])["locked"] is False


def test_remote_bot_cannot_unlock_a_track(studio):
    project = make_project(studio)
    patch(project["id"], 1, [{
        "op": "update_track", "track_id": "video-main", "changes": {"locked": True},
    }])

    error = expect_error(
        project["id"],
        2,
        {"op": "update_track", "track_id": "video-main", "changes": {"locked": False}},
        origin="remote_bot",
    )

    assert error.code == "timeline_item_locked"
    assert video_track(get_timeline(project["id"]))["locked"] is True


def test_grouping_multiple_clips_is_atomic_and_persistent(studio):
    project = make_project(studio)
    grouped = patch(project["id"], 1, [
        {"op": "update_clip", "clip_id": "clip-1", "changes": {"group_id": "dialogue-pair"}},
        {"op": "update_clip", "clip_id": "clip-2", "changes": {"group_id": "dialogue-pair"}},
    ])

    assert [clip["group_id"] for clip in video_track(grouped)["clips"]] == [
        "dialogue-pair",
        "dialogue-pair",
    ]
    assert all("group_id" not in clip for clip in video_track(get_timeline_version(project["id"], 1))["clips"])

    locked = patch(project["id"], 2, [{
        "op": "update_clip", "clip_id": "clip-2", "changes": {"locked": True},
    }])
    error = expect_error(project["id"], locked["timeline"]["revision"], {
        "op": "update_clip", "clip_id": "clip-2", "changes": {"group_id": None},
    })
    assert error.code == "timeline_item_locked"
    assert get_timeline(project["id"])["timeline"]["revision"] == 3


def get_timeline_version(project_id, revision):
    return next(
        item["timeline_json"]
        for item in list_timeline_versions(project_id)
        if item["revision"] == revision
    )


def test_snapping_preferences_persist_and_validate(studio):
    project = make_project(studio)
    updated = patch(project["id"], 1, [{
        "op": "set_settings",
        "changes": {"snapping_enabled": False, "snap_tolerance_frames": 12},
    }])

    assert updated["timeline"]["settings"]["snapping_enabled"] is False
    assert updated["timeline"]["settings"]["snap_tolerance_frames"] == 12
    assert get_timeline(project["id"])["timeline"]["settings"]["snap_tolerance_frames"] == 12

    error = expect_error(project["id"], 2, {
        "op": "set_settings", "changes": {"snap_tolerance_frames": 0},
    })
    assert error.code == "invalid_operation"
    assert error.details["field"] == "snap_tolerance_frames"


def test_markers_add_remove_and_survive_reload(studio):
    project = make_project(studio)
    added = patch(project["id"], 1, [{
        "op": "add_marker",
        "marker": {"id": "marker-r2", "at": 2.5, "label": "  Hook  "},
    }])

    assert added["timeline"]["markers"] == [{"id": "marker-r2", "at": 2.5, "label": "Hook"}]
    assert get_timeline(project["id"])["timeline"]["markers"][0]["at"] == 2.5

    removed = patch(project["id"], 2, [{"op": "remove_marker", "marker_id": "marker-r2"}])
    assert removed["timeline"]["markers"] == []
    assert get_timeline_version(project["id"], 2)["markers"][0]["id"] == "marker-r2"


@pytest.mark.parametrize(
    ("marker", "expected_code"),
    [
        ({"id": "bad marker", "at": 1}, "invalid_operation"),
        ({"id": "negative", "at": -1}, "invalid_time_range"),
        ({"id": "missing-time"}, "invalid_operation"),
    ],
)
def test_invalid_marker_never_creates_a_revision(studio, marker, expected_code):
    project = make_project(studio)
    error = expect_error(project["id"], 1, {"op": "add_marker", "marker": marker})
    assert error.code == expected_code
    assert get_timeline(project["id"])["timeline"]["revision"] == 1


def test_duplicate_marker_id_is_rejected(studio):
    project = make_project(studio)
    patch(project["id"], 1, [{
        "op": "add_marker", "marker": {"id": "review", "at": 1, "label": "Review"},
    }])
    error = expect_error(project["id"], 2, {
        "op": "add_marker", "marker": {"id": "review", "at": 3, "label": "Again"},
    })
    assert error.code == "timeline_item_exists"
    assert get_timeline(project["id"])["timeline"]["revision"] == 2

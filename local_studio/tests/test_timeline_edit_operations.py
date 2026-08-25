"""P1-01 direct-edit contract tests for immutable Timeline v2 patches."""

import pytest

from desktop_domain import (
    PATCH_SCHEMA,
    TimelinePatchError,
    apply_timeline_patch,
    get_timeline,
    list_timeline_versions,
)


def make_project(studio, clip_count=2):
    clips = [
        {
            "in": float(index * 4),
            "out": float((index + 1) * 4),
            "keep": True,
            "caption": f"Clip {index + 1}",
        }
        for index in range(clip_count)
    ]
    return studio.new_project({
        "title": "P1 direct edits",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {
            "clips": clips,
            "render_settings": {"fps": 30, "quality": "balanced"},
        },
    })


def patch(project_id, revision, operations, origin="human"):
    return apply_timeline_patch(project_id, {
        "schema": PATCH_SCHEMA,
        "base_revision": revision,
        "origin": origin,
        "created_by": "p1-test",
        "operations": operations,
    })


def video_clips(result):
    timeline = result["timeline"] if "timeline" in result else result
    return next(track["clips"] for track in timeline["tracks"] if track["type"] == "video")


def error_code(project_id, revision, operation):
    with pytest.raises(TimelinePatchError) as captured:
        patch(project_id, revision, [operation])
    return captured.value


def test_move_clip_creates_revision_without_mutating_parent(studio):
    project = make_project(studio)
    moved = patch(project["id"], 1, [{
        "op": "move_clip", "clip_id": "clip-1", "timeline_start": 1.5,
    }])

    assert moved["timeline"]["revision"] == 2
    assert video_clips(moved)[0]["timeline_start"] == 1.5
    versions = list_timeline_versions(project["id"])
    parent = next(item for item in versions if item["revision"] == 1)
    assert video_clips(parent["timeline_json"])[0]["timeline_start"] == 0


def test_move_clip_rejects_negative_timeline_start(studio):
    project = make_project(studio)
    error = error_code(project["id"], 1, {
        "op": "move_clip", "clip_id": "clip-1", "timeline_start": -0.1,
    })
    assert error.code == "invalid_time_range"
    assert error.details["operation_index"] == 0
    assert get_timeline(project["id"])["timeline"]["revision"] == 1


@pytest.mark.parametrize(
    ("edge", "at", "expected_start", "expected_duration", "expected_source_in", "expected_source_out"),
    [
        ("start", 1.0, 1.0, 3.0, 1.0, 4.0),
        ("end", 3.0, 0.0, 3.0, 0.0, 3.0),
    ],
)
def test_trim_clip_updates_timeline_and_source_edges(
    studio, edge, at, expected_start, expected_duration, expected_source_in, expected_source_out,
):
    project = make_project(studio)
    trimmed = patch(project["id"], 1, [{
        "op": "trim_clip", "clip_id": "clip-1", "edge": edge, "at": at,
    }])
    clip = video_clips(trimmed)[0]
    assert clip["timeline_start"] == expected_start
    assert clip["duration"] == expected_duration
    assert clip["source_in"] == expected_source_in
    assert clip["source_out"] == expected_source_out


def test_trim_clip_rejects_zero_length_result(studio):
    project = make_project(studio)
    error = error_code(project["id"], 1, {
        "op": "trim_clip", "clip_id": "clip-1", "edge": "end", "at": 0,
    })
    assert error.code == "invalid_time_range"


def test_split_clip_success_and_outside_range_failure(studio):
    project = make_project(studio)
    split = patch(project["id"], 1, [{
        "op": "split_clip", "clip_id": "clip-1", "at": 2,
        "left_id": "clip-left", "right_id": "clip-right",
    }])
    assert [(clip["id"], clip["duration"]) for clip in video_clips(split)[:2]] == [
        ("clip-left", 2.0), ("clip-right", 2.0),
    ]
    error = error_code(project["id"], 2, {
        "op": "split_clip", "clip_id": "clip-left", "at": 3,
    })
    assert error.code == "invalid_time_range"


def test_ripple_trim_shifts_following_clips(studio):
    project = make_project(studio)
    rippled = patch(project["id"], 1, [{
        "op": "ripple_trim", "clip_id": "clip-1", "edge": "end", "at": 3,
    }])
    first, second = video_clips(rippled)
    assert first["duration"] == 3
    assert second["timeline_start"] == 3


def test_ripple_trim_rejects_locked_follower(studio):
    project = make_project(studio)
    locked = patch(project["id"], 1, [{
        "op": "update_clip", "clip_id": "clip-2", "changes": {"locked": True},
    }])
    error = error_code(project["id"], locked["timeline"]["revision"], {
        "op": "ripple_trim", "clip_id": "clip-1", "edge": "end", "at": 3,
    })
    assert error.code == "timeline_item_locked"


def test_roll_edit_moves_shared_boundary_without_changing_outer_range(studio):
    project = make_project(studio)
    rolled = patch(project["id"], 1, [{
        "op": "roll_edit", "left_clip_id": "clip-1", "right_clip_id": "clip-2", "at": 5,
    }])
    left, right = video_clips(rolled)
    assert (left["timeline_start"], left["duration"], left["source_out"]) == (0, 5, 5)
    assert (right["timeline_start"], right["duration"], right["source_in"], right["source_out"]) == (5, 3, 5, 8)
    assert right["timeline_start"] + right["duration"] == 8


def test_roll_edit_rejects_non_adjacent_clips(studio):
    project = make_project(studio)
    moved = patch(project["id"], 1, [{
        "op": "move_clip", "clip_id": "clip-2", "timeline_start": 5,
    }])
    error = error_code(project["id"], moved["timeline"]["revision"], {
        "op": "roll_edit", "left_clip_id": "clip-1", "right_clip_id": "clip-2", "at": 4.5,
    })
    assert error.code == "clips_not_adjacent"


def test_slip_clip_changes_source_only(studio):
    project = make_project(studio)
    slipped = patch(project["id"], 1, [{
        "op": "slip_clip", "clip_id": "clip-1", "source_in": 1,
    }])
    clip = video_clips(slipped)[0]
    assert (clip["timeline_start"], clip["duration"]) == (0, 4)
    assert (clip["source_in"], clip["source_out"]) == (1, 5)


def test_slip_clip_rejects_negative_source_range(studio):
    project = make_project(studio)
    error = error_code(project["id"], 1, {
        "op": "slip_clip", "clip_id": "clip-1", "source_in": -1,
    })
    assert error.code == "invalid_time_range"


def test_slide_clip_adjusts_both_neighbors_and_preserves_outer_range(studio):
    project = make_project(studio, clip_count=3)
    slid = patch(project["id"], 1, [{
        "op": "slide_clip", "previous_clip_id": "clip-1", "clip_id": "clip-2",
        "next_clip_id": "clip-3", "timeline_start": 5,
    }])
    previous, selected, following = video_clips(slid)
    assert (previous["timeline_start"], previous["duration"], previous["source_out"]) == (0, 5, 5)
    assert (selected["timeline_start"], selected["duration"], selected["source_in"]) == (5, 4, 4)
    assert (following["timeline_start"], following["duration"], following["source_in"]) == (9, 3, 9)
    assert following["timeline_start"] + following["duration"] == 12


def test_slide_clip_rejects_neighbor_collapse(studio):
    project = make_project(studio, clip_count=3)
    error = error_code(project["id"], 1, {
        "op": "slide_clip", "previous_clip_id": "clip-1", "clip_id": "clip-2",
        "next_clip_id": "clip-3", "timeline_start": 9,
    })
    assert error.code == "invalid_time_range"


@pytest.mark.parametrize("lock_target", ["clip", "track"])
def test_human_direct_edit_rejects_locked_clip_or_track(studio, lock_target):
    project = make_project(studio)
    lock_operation = (
        {"op": "update_clip", "clip_id": "clip-1", "changes": {"locked": True}}
        if lock_target == "clip"
        else {"op": "update_track", "track_id": "video-main", "changes": {"locked": True}}
    )
    locked = patch(project["id"], 1, [lock_operation])
    error = error_code(project["id"], locked["timeline"]["revision"], {
        "op": "move_clip", "clip_id": "clip-1", "timeline_start": 1,
    })
    assert error.code == "timeline_item_locked"


def test_human_can_explicitly_unlock_then_edit_in_later_revision(studio):
    project = make_project(studio)
    locked = patch(project["id"], 1, [{
        "op": "update_clip", "clip_id": "clip-1", "changes": {"locked": True},
    }])
    unlocked = patch(project["id"], 2, [{
        "op": "update_clip", "clip_id": "clip-1", "changes": {"locked": False},
    }])
    moved = patch(project["id"], 3, [{
        "op": "move_clip", "clip_id": "clip-1", "timeline_start": 1,
    }])
    assert locked["timeline"]["revision"] == 2
    assert unlocked["timeline"]["revision"] == 3
    assert moved["timeline"]["revision"] == 4


def test_stale_revision_has_structured_conflict_and_no_auto_merge(studio):
    project = make_project(studio)
    patch(project["id"], 1, [{
        "op": "move_clip", "clip_id": "clip-1", "timeline_start": 1,
    }])
    error = error_code(project["id"], 1, {
        "op": "move_clip", "clip_id": "clip-2", "timeline_start": 5,
    })
    assert error.code == "stale_timeline_revision"
    assert error.status == 409
    assert error.details == {"expected_revision": 2, "received_revision": 1}
    assert get_timeline(project["id"])["timeline"]["revision"] == 2


def test_negative_duration_is_rejected_without_new_revision(studio):
    project = make_project(studio)
    error = error_code(project["id"], 1, {
        "op": "update_clip", "clip_id": "clip-1", "changes": {"duration": -1},
    })
    assert error.code == "invalid_time_range"
    assert get_timeline(project["id"])["timeline"]["revision"] == 1


def test_missing_operation_input_has_stable_error_code(studio):
    project = make_project(studio)
    error = error_code(project["id"], 1, {
        "op": "move_clip", "clip_id": "clip-1",
    })
    assert error.code == "invalid_operation"
    assert error.details["field"] == "timeline_start"

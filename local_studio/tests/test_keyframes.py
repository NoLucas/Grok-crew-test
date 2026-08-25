"""P1-05 Timeline v2 keyframe validation and interpolation tests."""

import pytest

from desktop_domain import PATCH_SCHEMA, TimelinePatchError, apply_timeline_patch, list_timeline_versions
from keyframes import keyframe_value, normalize_keyframes, speed_time_mapper


def make_project(studio):
    return studio.new_project({
        "title": "P1 keyframes",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {
            "clips": [{"in": 0, "out": 8, "keep": True, "caption": ""}],
            "render_settings": {"fps": 30, "quality": "balanced"},
        },
    })


def patch_keyframes(project_id, revision, keyframes):
    return apply_timeline_patch(project_id, {
        "schema": PATCH_SCHEMA,
        "base_revision": revision,
        "origin": "human",
        "created_by": "keyframe-test",
        "operations": [{
            "op": "update_clip",
            "clip_id": "clip-1",
            "changes": {"keyframes": keyframes},
        }],
    })


def video_clip(result):
    timeline = result["timeline"] if "timeline" in result else result
    return next(track["clips"][0] for track in timeline["tracks"] if track["type"] == "video")


def test_normalize_keyframes_sorts_and_rounds_points():
    normalized = normalize_keyframes({
        "scale": [
            {"id": "end", "at": 4, "value": 2, "interpolation": "hold"},
            {"id": "start", "at": 0.0004, "value": 1, "interpolation": "linear"},
        ],
    }, 5)

    assert [point["id"] for point in normalized["scale"]] == ["start", "end"]
    assert normalized["scale"][0]["at"] == 0
    assert normalized["scale"][1]["interpolation"] == "hold"


@pytest.mark.parametrize(
    "keyframes",
    [
        {"unknown": []},
        {"opacity": [{"id": "bad", "at": 0, "value": 2, "interpolation": "linear"}]},
        {"speed": [{"id": "late", "at": 9, "value": 1, "interpolation": "linear"}]},
        {"scale": [{"id": "same", "at": 1, "value": 1}, {"id": "same-2", "at": 1, "value": 2}]},
    ],
)
def test_invalid_keyframes_are_rejected(keyframes):
    with pytest.raises(ValueError):
        normalize_keyframes(keyframes, 8)


def test_linear_and_hold_interpolation():
    linear = normalize_keyframes({
        "x": [
            {"id": "a", "at": 0, "value": 0, "interpolation": "linear"},
            {"id": "b", "at": 4, "value": 100, "interpolation": "linear"},
        ],
    }, 4)
    hold = normalize_keyframes({
        "opacity": [
            {"id": "a", "at": 0, "value": 0.2, "interpolation": "hold"},
            {"id": "b", "at": 4, "value": 1, "interpolation": "linear"},
        ],
    }, 4)

    assert keyframe_value(linear, "x", 2, 0) == 50
    assert keyframe_value(hold, "opacity", 2, 1) == 0.2
    assert keyframe_value(linear, "rotation", 2, 15) == 15


def test_speed_mapper_preserves_endpoints_and_changes_middle_timing():
    keyframes = normalize_keyframes({
        "speed": [
            {"id": "slow", "at": 0, "value": 0.5, "interpolation": "linear"},
            {"id": "fast", "at": 8, "value": 2, "interpolation": "linear"},
        ],
    }, 8)
    mapper = speed_time_mapper(8, 12, keyframes)

    assert mapper(0) == 0
    assert mapper(8) == pytest.approx(12)
    assert mapper(4) < 6  # slow first half consumes less of the source


def test_keyframe_patch_creates_immutable_revision(studio):
    project = make_project(studio)
    keyframes = {
        "scale": [
            {"id": "scale-a", "at": 0, "value": 1, "interpolation": "linear"},
            {"id": "scale-b", "at": 8, "value": 1.5, "interpolation": "linear"},
        ],
        "volume": [
            {"id": "volume-a", "at": 0, "value": 1, "interpolation": "linear"},
            {"id": "volume-b", "at": 8, "value": 0.5, "interpolation": "linear"},
        ],
    }
    updated = patch_keyframes(project["id"], 1, keyframes)

    assert updated["timeline"]["revision"] == 2
    assert video_clip(updated)["keyframes"]["scale"][1]["value"] == 1.5
    versions = {item["revision"]: item for item in list_timeline_versions(project["id"])}
    assert video_clip(versions[1]["timeline_json"])["keyframes"] == {}


def test_invalid_keyframe_patch_does_not_create_revision(studio):
    project = make_project(studio)
    with pytest.raises(TimelinePatchError) as captured:
        patch_keyframes(project["id"], 1, {
            "crop_left": [{"id": "too-far", "at": 0, "value": 0.9, "interpolation": "linear"}],
        })

    assert captured.value.code == "invalid_timeline_result"
    assert len(list_timeline_versions(project["id"])) == 1

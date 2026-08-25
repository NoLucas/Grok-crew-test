"""P1-06 transitions, B-roll, captions, and title overlay tests."""

import pytest

from desktop_domain import PATCH_SCHEMA, TimelinePatchError, apply_timeline_patch, get_timeline
from render import _apply_transitions


def make_project(studio):
    return studio.new_project({
        "title": "P1 edit elements",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {
            "clips": [{"in": 0, "out": 8, "keep": True, "caption": ""}],
            "render_settings": {"fps": 30, "quality": "balanced"},
        },
    })


def patch(project_id, revision, operations):
    return apply_timeline_patch(project_id, {
        "schema": PATCH_SCHEMA,
        "base_revision": revision,
        "origin": "human",
        "created_by": "elements-test",
        "operations": operations,
    })


def test_add_broll_title_and_caption_in_one_immutable_patch(studio):
    project = make_project(studio)
    result = patch(project["id"], 1, [
        {"op": "add_asset", "asset": {"id": "broll-asset", "kind": "video", "name": "B-roll", "path": "inputs/broll.mp4"}},
        {"op": "add_asset", "asset": {"id": "title-asset", "kind": "title", "name": "Opening", "text": "Opening title"}},
        {"op": "add_track", "track": {"id": "broll-track", "type": "video", "name": "B-roll", "order": 20, "locked": False, "muted": False, "solo": False, "clips": []}},
        {"op": "add_track", "track": {"id": "title-track", "type": "overlay", "name": "Titles", "order": 30, "locked": False, "muted": False, "solo": False, "clips": []}},
        {"op": "add_clip", "track_id": "broll-track", "clip": {"id": "broll-clip", "asset_id": "broll-asset", "timeline_start": 1, "duration": 3, "source_in": 0, "source_out": 3, "locked": False, "keyframes": {}}},
        {"op": "add_clip", "track_id": "title-track", "clip": {"id": "title-clip", "asset_id": "title-asset", "timeline_start": 0, "duration": 2, "locked": False, "text": "Opening title", "keyframes": {}}},
        {"op": "add_clip", "track_id": "captions-main", "clip": {"id": "caption-new", "asset_id": None, "timeline_start": 1, "duration": 2, "locked": False, "text": "Editable caption", "keyframes": {}}},
    ])

    assert result["timeline"]["revision"] == 2
    assert {asset["kind"] for asset in result["timeline"]["assets"]} >= {"video", "title"}
    tracks = {track["id"]: track for track in result["timeline"]["tracks"]}
    assert tracks["broll-track"]["clips"][0]["asset_id"] == "broll-asset"
    assert tracks["title-track"]["clips"][0]["text"] == "Opening title"
    assert next(clip for clip in tracks["captions-main"]["clips"] if clip["id"] == "caption-new")["text"] == "Editable caption"


def test_transition_contract_persists_and_can_be_removed(studio):
    project = make_project(studio)
    transitioned = patch(project["id"], 1, [{
        "op": "update_clip",
        "clip_id": "clip-1",
        "changes": {
            "transition_in": {"type": "crossfade", "duration": 0.4},
            "transition_out": {"type": "dip_black", "duration": 0.6},
        },
    }])
    clip = next(track["clips"][0] for track in transitioned["timeline"]["tracks"] if track["type"] == "video")
    assert clip["transition_in"] == {"type": "crossfade", "duration": 0.4}
    assert clip["transition_out"] == {"type": "dip_black", "duration": 0.6}

    removed = patch(project["id"], 2, [{
        "op": "update_clip",
        "clip_id": "clip-1",
        "changes": {"transition_in": None, "transition_out": None},
    }])
    clip = next(track["clips"][0] for track in removed["timeline"]["tracks"] if track["type"] == "video")
    assert "transition_in" not in clip
    assert "transition_out" not in clip


@pytest.mark.parametrize(
    "transition",
    [
        {"type": "spin", "duration": 0.5},
        {"type": "fade", "duration": 0},
        {"type": "fade", "duration": 9},
    ],
)
def test_invalid_transition_rolls_back_patch(studio, transition):
    project = make_project(studio)
    with pytest.raises(TimelinePatchError) as captured:
        patch(project["id"], 1, [{
            "op": "update_clip", "clip_id": "clip-1", "changes": {"transition_in": transition},
        }])
    assert captured.value.code == "invalid_timeline_result"
    assert get_timeline(project["id"])["timeline"]["revision"] == 1


def test_asset_in_use_cannot_be_removed(studio):
    project = make_project(studio)
    with pytest.raises(TimelinePatchError) as captured:
        patch(project["id"], 1, [{"op": "remove_asset", "asset_id": "source-main"}])
    assert captured.value.code == "asset_in_use"


def test_render_transition_mapping_uses_crossfade_and_fade_effects():
    class Layer:
        def __init__(self):
            self.effects = []

        def with_effects(self, effects):
            self.effects = effects
            return self

    class Effects:
        FadeIn = staticmethod(lambda duration: ("fade-in", duration))
        FadeOut = staticmethod(lambda duration: ("fade-out", duration))
        CrossFadeIn = staticmethod(lambda duration: ("cross-in", duration))
        CrossFadeOut = staticmethod(lambda duration: ("cross-out", duration))

    layer = _apply_transitions(Layer(), {
        "transition_in": {"type": "crossfade", "duration": 0.25},
        "transition_out": {"type": "dip_black", "duration": 0.5},
    }, Effects)
    assert layer.effects == [("cross-in", 0.25), ("fade-out", 0.5)]

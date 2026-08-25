"""P1-07 track mixer and ducking contract tests."""

import pytest

from desktop_domain import PATCH_SCHEMA, TimelinePatchError, apply_timeline_patch, get_timeline
from render import _apply_dynamic_volume, _smooth_gain_targets


def make_project(studio):
    return studio.new_project({
        "title": "P1 audio mixer",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {
            "clips": [{"in": 0, "out": 8, "keep": True, "caption": ""}],
            "render_settings": {"fps": 30, "quality": "balanced"},
        },
    })


def patch_track(project_id, revision, changes):
    return apply_timeline_patch(project_id, {
        "schema": PATCH_SCHEMA,
        "base_revision": revision,
        "origin": "human",
        "created_by": "mixer-test",
        "operations": [{
            "op": "update_track", "track_id": "video-main", "changes": changes,
        }],
    })


def video_track(result):
    timeline = result["timeline"] if "timeline" in result else result
    return next(track for track in timeline["tracks"] if track["type"] == "video")


def test_track_mixer_state_persists_in_new_revision(studio):
    project = make_project(studio)
    updated = patch_track(project["id"], 1, {
        "volume": 0.7,
        "role": "music",
        "ducking": True,
        "duck_level": 0.25,
    })

    track = video_track(updated)
    assert track["volume"] == 0.7
    assert track["role"] == "music"
    assert track["ducking"] is True
    assert track["duck_level"] == 0.25
    assert video_track(get_timeline(project["id"]))["volume"] == 0.7


@pytest.mark.parametrize(
    "changes",
    [
        {"volume": -1},
        {"volume": 5},
        {"role": "podcast"},
        {"ducking": "yes"},
        {"duck_level": 2},
    ],
)
def test_invalid_mixer_state_is_rejected_without_revision(studio, changes):
    project = make_project(studio)
    with pytest.raises(TimelinePatchError) as captured:
        patch_track(project["id"], 1, changes)
    assert captured.value.code in {"invalid_operation", "invalid_timeline_result"}
    assert get_timeline(project["id"])["timeline"]["revision"] == 1


def test_ducking_envelope_attacks_faster_than_it_releases():
    targets = [1, 1, .25, .25, 1, 1]
    values = _smooth_gain_targets(targets, attack=.5, release=.1)
    assert values[2] < values[1]
    assert values[3] < values[2]
    assert values[4] > values[3]
    assert values[4] < 1


def test_dynamic_clip_volume_uses_keyframes():
    class Audio:
        def __init__(self):
            self.transformer = None

        def transform(self, transformer, keep_duration=False):
            self.transformer = transformer
            return self

    audio = Audio()
    result = _apply_dynamic_volume(audio, {
        "volume": [
            {"id": "a", "at": 0, "value": 0.5, "interpolation": "linear"},
            {"id": "b", "at": 2, "value": 1, "interpolation": "linear"},
        ],
    }, 1)
    assert result is audio
    assert result.transformer(lambda _at: 2.0, 0) == 1.0
    assert result.transformer(lambda _at: 2.0, 2) == 2.0

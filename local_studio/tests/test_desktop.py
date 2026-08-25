"""Desktop v2 domain regression tests (immutable revisions and runner state)."""

import sqlite3

import pytest

from db import db
import config
import db as database_module
import publishers
import analysis
from desktop_domain import (
    CONTROL_JOB_SCHEMA,
    PATCH_SCHEMA,
    RUNNER_EVENT_SCHEMA,
    answer_control_job,
    apply_timeline_patch,
    control_control_job,
    create_control_job,
    ensure_timeline_version,
    get_timeline,
    list_runner_events,
    pair_runner,
    record_runner_event,
    resolve_control_conflict,
    restore_timeline_version,
    update_control_job,
)


def make_project(studio):
    return studio.new_project({
        "title": "Desktop project",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {
            "clips": [
                {"in": 0.0, "out": 4.0, "keep": True, "caption": "First"},
                {"in": 4.0, "out": 8.0, "keep": True, "caption": "Second"},
            ],
            "render_settings": {"fps": 30, "quality": "balanced"},
        },
    })


def patch(project_id, revision, operations, origin="human"):
    return apply_timeline_patch(project_id, {
        "schema": PATCH_SCHEMA,
        "base_revision": revision,
        "origin": origin,
        "created_by": "test-user",
        "operations": operations,
    })


def test_legacy_project_migrates_to_versioned_multitrack_timeline(studio):
    project = make_project(studio)
    version = ensure_timeline_version(project["id"])
    timeline = version["timeline_json"]
    assert version["revision"] == 1
    assert timeline["schema"] == "grok-crew.timeline/v2"
    assert [track["type"] for track in timeline["tracks"]] == ["video", "caption"]
    assert len(timeline["tracks"][0]["clips"]) == 2
    assert timeline["tracks"][1]["clips"][0]["text"] == "First"


def test_patch_creates_immutable_revision_and_rejects_stale_base(studio):
    project = make_project(studio)
    current = get_timeline(project["id"])["timeline"]
    changed = patch(project["id"], current["revision"], [{
        "op": "update_clip", "clip_id": "clip-1", "changes": {"duration": 3.5},
    }])
    assert changed["timeline"]["revision"] == 2
    assert changed["version"]["parent_revision"] == 1
    with pytest.raises(ValueError, match="stale_timeline_revision"):
        patch(project["id"], 1, [{"op": "set_settings", "changes": {"fps": 60}}])


def test_remote_runner_cannot_change_locked_clip(studio):
    project = make_project(studio)
    current = get_timeline(project["id"])["timeline"]
    locked = patch(project["id"], current["revision"], [{
        "op": "update_clip", "clip_id": "clip-1", "changes": {"locked": True},
    }])
    with pytest.raises(ValueError, match="locked"):
        patch(project["id"], locked["timeline"]["revision"], [{
            "op": "remove_clip", "clip_id": "clip-1",
        }], origin="remote_bot")


def test_split_and_restore_always_create_new_revisions(studio):
    project = make_project(studio)
    split = patch(project["id"], 1, [{
        "op": "split_clip", "clip_id": "clip-1", "at": 2,
        "left_id": "clip-left", "right_id": "clip-right",
    }])
    video = next(track for track in split["timeline"]["tracks"] if track["type"] == "video")
    assert [clip["id"] for clip in video["clips"][:2]] == ["clip-left", "clip-right"]
    restored = restore_timeline_version(project["id"], 1)
    assert restored["timeline"]["revision"] == 3
    assert restored["version"]["parent_revision"] == 2


def test_human_edit_settings_do_not_create_fake_bot_presence(studio):
    saved = studio.set_edit_method({"origin": "human", "updated_by": "operator", "method": {"fps": 60}})
    assert saved["origin"] == "human"
    with db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM bot_sessions").fetchone()[0] == 0


def test_control_job_pairing_and_verified_event_progression(studio):
    project = make_project(studio)
    ensure_timeline_version(project["id"])
    runner = pair_runner({
        "runner_id": "runner-01", "display_name": "Editing runner",
        "public_key": "signing-public-key-material", "encryption_key": "encryption-public-key-material",
    })
    assert runner["status"] == "paired"
    job = create_control_job(project["id"], {
        "schema": CONTROL_JOB_SCHEMA,
        "execution_policy": "auto_edit_render",
        "publish_policy": {
            "schema": "grok-crew.publish-policy/v1",
            "instagram": "ask", "tiktok": "export_only", "youtube": "auto",
        },
    })
    recorded = record_runner_event({
        "schema": RUNNER_EVENT_SCHEMA, "control_job_id": job["id"], "runner_id": "runner-01",
        "sequence": 1, "stage": "analyzing", "status": "active",
        "detail": {"message": "Transcript loaded"}, "verified_at": "2026-08-25T02:00:00+00:00",
    })
    assert recorded["sequence"] == 1
    assert list_runner_events(job["id"])[0]["verified_at"] == "2026-08-25T02:00:00+00:00"
    with db() as conn:
        status = conn.execute("SELECT status FROM control_jobs WHERE id = ?", (job["id"],)).fetchone()[0]
    assert status == "analyzing"


def test_human_answer_resumes_control_job_without_bot_heartbeat(studio):
    project = make_project(studio)
    ensure_timeline_version(project["id"])
    job = create_control_job(project["id"], {
        "execution_policy": "review_before_render",
        "publish_policy": {"schema": "grok-crew.publish-policy/v1", "instagram": "ask", "tiktok": "ask", "youtube": "ask"},
    })
    answered = answer_control_job(job["id"], {"question_id": "hook", "value": "Lead with the payoff"})
    assert answered["status"] == "queued"
    assert answered["settings_json"]["runner_input"]["origin"] == "human"
    assert answered["settings_json"]["runner_input"]["value"] == "Lead with the payoff"
    with db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM bot_sessions").fetchone()[0] == 0


def test_signed_control_state_attempts_and_event_replay_protection(studio):
    project = make_project(studio)
    ensure_timeline_version(project["id"])
    pair_runner({
        "runner_id": "runner-control", "display_name": "Control runner",
        "public_key": "signing-public-key-material", "encryption_key": "encryption-public-key-material",
    })
    job = create_control_job(project["id"], {"execution_policy": "review_before_render"})
    paused = control_control_job(job["id"], "pause")
    assert paused["status"] == "pause_requested"
    assert paused["attempt"] == 1
    assert paused["control_sequence"] == 1
    update_control_job(job["id"], "paused", runner_id="runner-control")
    resumed = control_control_job(job["id"], "resume")
    assert resumed["status"] == "queued"
    assert resumed["attempt"] == 2
    assert resumed["control_sequence"] == 2

    stale = {
        "schema": RUNNER_EVENT_SCHEMA, "control_job_id": job["id"], "runner_id": "runner-control",
        "sequence": 1, "stage": "failed", "status": "failed",
        "detail": {"attempt": 1, "error": "old attempt"}, "verified_at": "2026-08-25T02:00:00+00:00",
    }
    first = record_runner_event(stale)
    assert first["sequence"] == 1
    assert record_runner_event(stale)["id"] == first["id"]
    with pytest.raises(ValueError, match="replayed"):
        record_runner_event({**stale, "detail": {"attempt": 1, "error": "tampered replay"}})
    with db() as conn:
        assert conn.execute("SELECT status FROM control_jobs WHERE id = ?", (job["id"],)).fetchone()[0] == "queued"

    claimed = record_runner_event({
        "schema": RUNNER_EVENT_SCHEMA, "control_job_id": job["id"], "runner_id": "runner-control",
        "sequence": 2, "stage": "claimed", "status": "active",
        "detail": {"attempt": 2}, "verified_at": "2026-08-25T02:01:00+00:00",
    })
    assert claimed["sequence"] == 2
    with db() as conn:
        assert conn.execute("SELECT status FROM control_jobs WHERE id = ?", (job["id"],)).fetchone()[0] == "claimed"


def test_conflict_review_retries_against_current_revision(studio):
    project = make_project(studio)
    ensure_timeline_version(project["id"])
    job = create_control_job(project["id"], {"execution_policy": "review_before_render"})
    changed = patch(project["id"], 1, [{"op": "set_settings", "changes": {"look": "punchy"}}])
    update_control_job(job["id"], "conflict", error="stale", conflict={
        "schema": "grok-crew.timeline-conflict/v1", "expected_revision": 1,
        "current_revision": changed["timeline"]["revision"], "reason": "stale",
    })
    retried = resolve_control_conflict(job["id"], "retry_current")
    assert retried["status"] == "queued"
    assert retried["base_revision"] == 2
    assert retried["attempt"] == 2
    assert retried["control_sequence"] == 1
    assert retried["conflict_json"] is None


def test_legacy_database_is_backed_up_before_v2_schema(tmp_path, monkeypatch):
    data = tmp_path / "legacy-data"
    workspace = tmp_path / "legacy-workspace"
    data.mkdir()
    legacy_db = data / "studio.db"
    with sqlite3.connect(legacy_db) as connection:
        connection.execute("CREATE TABLE projects (id TEXT PRIMARY KEY)")
    monkeypatch.setattr(config, "DATA_DIR", data)
    monkeypatch.setattr(config, "WORKSPACE_DIR", workspace)
    monkeypatch.setattr(config, "DB_PATH", legacy_db)
    database_module.init_db()
    backups = list((data / "backups").glob("studio-pre-v2-*.db"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as connection:
        assert connection.execute("SELECT name FROM sqlite_master WHERE name = 'projects'").fetchone()


def test_publish_idempotency_returns_existing_success(studio, monkeypatch):
    project = make_project(studio)
    calls = []

    class FakePublisher:
        def publish(self, _project, payload):
            calls.append(payload["idempotency_key"])
            return {"remote_id": "published-once"}

    monkeypatch.setitem(publishers.PUBLISHERS, "youtube", FakePublisher())
    first = publishers.publish("youtube", project, {"idempotency_key": "project-youtube-v1"})
    second = publishers.publish("youtube", project, {"idempotency_key": "project-youtube-v1"})
    assert first["deduplicated"] is False
    assert second["deduplicated"] is True
    assert second["remote_id"] == "published-once"
    assert calls == ["project-youtube-v1"]


def test_local_analysis_persists_transcript_and_scene_metadata(studio, monkeypatch):
    project = make_project(studio)
    source = config.WORKSPACE_DIR / "inputs" / "source.mp4"
    source.write_bytes(b"fixture")
    thumbnail = config.DATA_DIR / "analysis" / "thumb.jpg"
    thumbnail.parent.mkdir(parents=True, exist_ok=True)
    thumbnail.write_bytes(b"jpeg")
    monkeypatch.setattr(analysis, "_probe", lambda _source: {"status": "ready", "duration": 8.0})
    monkeypatch.setattr(analysis, "_thumbnails", lambda *_args: [{"id": "scene-01", "at": 2.0, "path": str(thumbnail), "size_bytes": 4}])
    monkeypatch.setattr(analysis, "_transcript", lambda _source: {"status": "ready", "engine": "whisper.cpp", "words": [{"start": 0, "end": 1, "text": "hello"}]})
    result = analysis.analyze_project(project)
    assert result["status"] == "ready"
    assert result["transcript_json"]["words"][0]["text"] == "hello"
    assert result["thumbnails_json"][0]["path"] == str(thumbnail)

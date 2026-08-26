"""Bundled sample media and one-click first project."""

import config
import first_run
from first_run import first_run_status, open_sample_project, provision_sample_media


def test_status_without_media(studio):
    status = first_run_status()
    assert status["schema"] == "grok-crew.first-run/v1"
    assert status["sample_available"] is False
    assert status["sample_open"] is False
    assert status["has_projects"] is False


def test_missing_sample_raises(studio, monkeypatch):
    monkeypatch.setattr(first_run, "bundled_sample_candidates", lambda: [])
    try:
        open_sample_project()
    except ValueError as exc:
        assert "missing" in str(exc).lower()
    else:
        raise AssertionError("expected missing sample to fail")


def test_provision_and_open_sample_are_idempotent(studio, tmp_path, monkeypatch):
    source = tmp_path / "bundled.mp4"
    source.write_bytes(b"grok-crew-sample")
    monkeypatch.setattr(first_run, "bundled_sample_candidates", lambda: [source])
    assert provision_sample_media() is True
    destination = config.WORKSPACE_DIR / "inputs" / "grok-crew-sample.mp4"
    assert destination.is_file()
    first = open_sample_project()
    second = open_sample_project()
    assert first["reused"] is False
    assert second["reused"] is True
    assert first["project"]["id"] == second["project"]["id"]
    assert str(first["project"]["source_path"]).replace("\\", "/").endswith("inputs/grok-crew-sample.mp4")
    status = first_run_status()
    assert status["sample_available"] is True
    assert status["sample_open"] is True
    assert status["has_projects"] is True


def test_http_first_run_opens_sample(live_server, tmp_path, monkeypatch):
    from tests.test_api import get_status, post

    source = tmp_path / "bundled.mp4"
    source.write_bytes(b"grok-crew-sample")
    monkeypatch.setattr(first_run, "bundled_sample_candidates", lambda: [source])
    provision_sample_media()
    status_code, status = get_status(live_server, "/api/v2/first-run")
    assert status_code == 200
    assert status["sample_available"] is True
    created = post(live_server, "/api/v2/first-run/sample", {})
    assert created["reused"] is False
    assert created["project"]["id"]
    assert created["timeline"]["revision"] == 1
    again = post(live_server, "/api/v2/first-run/sample", {})
    assert again["reused"] is True
    assert again["project"]["id"] == created["project"]["id"]
    from tests.test_p3_launch import get_json
    listed = get_json(live_server, "/api/v2/workspace")
    assert listed["first_run"]["sample_open"] is True
    assert any(project["id"] == created["project"]["id"] for project in listed["projects"])

"""P1-04 proxy persistence, job, and original-render safety tests."""

import config
from desktop_domain import ensure_timeline_version
from proxy import (
    get_proxy,
    list_proxies,
    proxy_is_current,
    proxy_relative_path,
    source_asset,
    update_proxy,
)
from render import original_asset_path


def make_project(studio):
    source = config.WORKSPACE_DIR / "inputs" / "source.mp4"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"original-video")
    project = studio.new_project({
        "title": "P1 proxy editing",
        "source_path": "inputs/source.mp4",
        "output_path": "outputs/final-video.mp4",
        "timeline": {
            "clips": [{"in": 0, "out": 8, "keep": True, "caption": ""}],
            "render_settings": {"fps": 30, "quality": "balanced"},
        },
    })
    ensure_timeline_version(project["id"])
    return studio.get_project(project["id"]), source


def test_proxy_path_is_project_asset_and_source_version_scoped(studio):
    project, source = make_project(studio)
    asset, resolved = source_asset(project, "source-main")
    relative = proxy_relative_path(project["id"], asset["id"], resolved)

    assert resolved == source
    assert relative.startswith(f"proxies/{project['id']}/source-main-")
    assert relative.endswith(".mp4")
    assert config.workspace_path(relative).is_relative_to(config.WORKSPACE_DIR)


def test_proxy_record_is_current_only_for_matching_original(studio):
    project, source = make_project(studio)
    relative = proxy_relative_path(project["id"], "source-main", source)
    destination = config.workspace_path(relative)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(b"proxy")
    ready = update_proxy(
        project["id"], "source-main", source,
        status="ready", proxy_path=relative, progress=100, width=640, height=360,
    )

    assert proxy_is_current(ready, source) is True
    source.write_bytes(b"changed-original")
    assert proxy_is_current(ready, source) is False


def test_proxy_request_queues_once_and_reports_status(studio):
    project, source = make_project(studio)
    first = studio.request_proxy(project["id"], {
        "asset_id": "source-main", "run_immediately": False,
    })
    second = studio.request_proxy(project["id"], {
        "asset_id": "source-main", "run_immediately": False,
    })

    assert first["job"]["kind"] == "proxy"
    assert first["proxy"]["status"] == "queued"
    assert second["reused"] is True
    assert second["job"]["id"] == first["job"]["id"]
    assert get_proxy(project["id"], "source-main")["source_size"] == source.stat().st_size
    assert len(list_proxies(project["id"])) == 1


def test_proxy_job_completion_persists_ready_file_metadata(studio, monkeypatch):
    project, source = make_project(studio)
    queued = studio.request_proxy(project["id"], {
        "asset_id": "source-main", "run_immediately": False,
    })
    relative = proxy_relative_path(project["id"], "source-main", source)
    destination = config.workspace_path(relative)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(b"proxy")

    monkeypatch.setattr(studio, "generate_proxy", lambda *_args, **_kwargs: {
        "asset_id": "source-main",
        "proxy_path": relative,
        "original_path": str(source),
        "width": 640,
        "height": 360,
        "duration": 8,
        "reused": False,
    })
    finished = studio.execute_job(queued["job"]["id"])
    proxy = get_proxy(project["id"], "source-main")

    assert finished["status"] == "succeeded"
    assert proxy["status"] == "ready"
    assert proxy["proxy_path"] == relative
    assert (proxy["width"], proxy["height"], proxy["progress"]) == (640, 360, 100)


def test_final_render_path_ignores_proxy_metadata(studio):
    project, source = make_project(studio)
    asset, _resolved = source_asset(project, "source-main")
    asset_with_proxy = {
        **asset,
        "proxy_path": "proxies/project/source-main.mp4",
        "proxy_status": "ready",
    }

    assert original_asset_path(asset_with_proxy) == source
    assert "proxies" not in str(original_asset_path(asset_with_proxy))

"""Local Video Studio: the loopback-only HTTP API surface (routing only -- see
studio_server.py for the actual domain logic each route calls into)."""

from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import config
from analysis import analyze_project, get_analysis
from config import (
    origin_is_allowed,
    BROWSER_PAGE_PATHS,
    CAPTION_LAYOUT_PRESETS,
    PLATFORM_PRESETS,
    PUBLIC_GET_PATHS,
    QUALITY_PRESETS,
    SITE_BASE_URL,
    TERMINAL_CLI_PATH,
    utc_now,
)
from studio_server import (
    bot_auto_executes,
    bot_entry_manifest,
    bot_guide,
    build_cut_map,
    create_job,
    current_edit_method,
    enter_bot_workspace,
    execution_policy,
    export_project_bundle,
    get_job,
    get_project,
    import_project_bundle,
    inspect_project_media,
    launch_status,
    list_artifacts,
    list_bot_activity,
    list_bot_entries,
    list_bots,
    list_jobs,
    list_projects,
    new_project,
    project_operations,
    enqueue_render,
    import_exchange,
    project_exchange,
    project_preview,
    project_proxies,
    project_publish_receipts,
    project_scopes,
    quality_report,
    render_queue,
    record_bot_heartbeat,
    request_job_cancel,
    request_proxy,
    retry_project_publish,
    save_artifact,
    set_edit_method,
    set_execution_policy,
    start_job,
    terminal_contract,
    update_artifact,
)
from first_run import first_run_status, open_sample_project
from bot_pack import bot_pack_bytes
from edit_spec import create_spec, get_spec, list_specs, spec_brief, spec_invite
from handoff_inbox import handoff_status, pull_handoff
from handoff_materials import materials_status, pull_materials, write_owned_materials
from style_recipes import list_recipes
from handoff_outbox import outbox_status, push_handoff_outbox
from desktop_domain import (
    TimelinePatchError,
    answer_control_job,
    apply_timeline_history_action,
    apply_timeline_patch,
    cancel_unclaimed_control_jobs,
    control_control_job,
    create_control_job,
    ensure_timeline_version,
    get_timeline,
    get_timeline_history,
    list_control_jobs,
    list_runner_events,
    list_runners,
    list_timeline_versions,
    media_catalog,
    pair_runner,
    record_runner_event,
    resolve_control_conflict,
    restore_timeline_version,
    update_control_job,
    workspace_v2,
)

class StudioHandler(BaseHTTPRequestHandler):
    server_version = "LocalVideoStudio/1.0"

    def _json(self, status: int, payload: Any) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(raw)))
        origin = self.headers.get("Origin")
        if origin and origin_is_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin); self.send_header("Vary", "Origin")
        self.end_headers(); self.wfile.write(raw)

    def _download(self, path: Path, filename: str) -> None:
        if not path.is_file():
            raise RuntimeError("Local terminal CLI download is unavailable.")
        raw = path.read_bytes()
        self.send_response(HTTPStatus.OK); self.send_header("Content-Type", "text/x-python; charset=utf-8"); self.send_header("Content-Length", str(len(raw)))
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        origin = self.headers.get("Origin")
        if origin and origin_is_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin); self.send_header("Vary", "Origin")
        self.end_headers(); self.wfile.write(raw)

    def _media(self, requested: str) -> None:
        relative = unquote(requested).replace("\\", "/").lstrip("/")
        root = config.WORKSPACE_DIR.resolve()
        path = (root / relative).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Media path leaves the local workspace.") from exc
        if not path.is_file():
            self._json(404, {"error": "Media file not found"}); return
        size = path.stat().st_size
        start, end, status = 0, size - 1, HTTPStatus.OK
        byte_range = self.headers.get("Range", "")
        if byte_range.startswith("bytes="):
            raw_start, _, raw_end = byte_range[6:].partition("-")
            try:
                start = int(raw_start or 0)
                end = min(int(raw_end) if raw_end else size - 1, size - 1)
            except ValueError:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            if start < 0 or end < start or start >= size:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return
            status = HTTPStatus.PARTIAL_CONTENT
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        origin = self.headers.get("Origin")
        if origin and origin_is_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin); self.send_header("Vary", "Origin")
        self.end_headers()
        with path.open("rb") as media:
            media.seek(start)
            remaining = length
            while remaining:
                chunk = media.read(min(1024 * 256, remaining))
                if not chunk: break
                self.wfile.write(chunk); remaining -= len(chunk)

    def _analysis_media(self, project_id: str, scene_id: str) -> None:
        analysis = get_analysis(unquote(project_id))
        if not analysis:
            self._json(404, {"error": "Analysis not found"}); return
        scene = next((item for item in analysis.get("thumbnails_json", []) if item.get("id") == unquote(scene_id)), None)
        if not scene:
            self._json(404, {"error": "Analysis scene not found"}); return
        root = (config.DATA_DIR / "analysis" / unquote(project_id) / "thumbnails").resolve()
        path = Path(str(scene.get("path", ""))).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Analysis thumbnail leaves its project directory.") from exc
        if not path.is_file():
            self._json(404, {"error": "Analysis thumbnail not found"}); return
        raw = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "image/jpeg")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "private, max-age=300")
        origin = self.headers.get("Origin")
        if origin and origin_is_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin); self.send_header("Vary", "Origin")
        self.end_headers(); self.wfile.write(raw)

    def _redirect_to_browser_page(self, path: str) -> None:
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", f"{SITE_BASE_URL}{path}")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 8_000_000:
            raise ValueError("Request body is too large.")
        value = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        if not isinstance(value, dict):
            raise ValueError("JSON object required.")
        return value

    def _origin_allowed(self) -> bool:
        return origin_is_allowed(self.headers.get("Origin"))

    def _token_ok(self) -> bool:
        expected = os.getenv("LOCAL_STUDIO_TOKEN", "").strip()
        if not expected:
            return True
        provided = self.headers.get("Authorization", "")
        expected_header = f"Bearer {expected}"
        provided_digest = hashlib.sha256(provided.encode("utf-8")).digest()
        expected_digest = hashlib.sha256(expected_header.encode("utf-8")).digest()
        return hmac.compare_digest(provided_digest, expected_digest)

    def _internal_error(self, exc: Exception) -> None:
        print(f"[{utc_now()}] local studio error: {exc}")
        self._json(500, {"error": "The local studio could not complete that request."})

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._origin_allowed():
            self._json(403, {"error": "Cross-origin requests are not allowed."}); return
        self.send_response(HTTPStatus.NO_CONTENT)
        origin = self.headers.get("Origin")
        if origin and origin_is_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if not self._origin_allowed():
            self._json(403, {"error": "Cross-origin requests are not allowed."}); return
        try:
            path = urlparse(self.path).path.rstrip("/") or "/"
            # /media and /analysis-media stay tokenless so <video>/<img> can load loopback previews.
            # Paths are still confined to the workspace / analysis thumbnail roots.
            if path not in PUBLIC_GET_PATHS and path not in BROWSER_PAGE_PATHS and not path.startswith(("/media/", "/analysis-media/")) and not self._token_ok():
                self._json(401, {"error": "Invalid local studio token."}); return
            if path in BROWSER_PAGE_PATHS:
                self._redirect_to_browser_page(path)
            elif path.startswith("/media/"):
                self._media(path.removeprefix("/media/"))
            elif path.startswith("/analysis-media/"):
                parts = path.split("/")
                if len(parts) != 4 or not parts[2] or not parts[3]:
                    self._json(404, {"error": "Analysis thumbnail not found"})
                else:
                    self._analysis_media(parts[2], parts[3])
            elif path == "/health":
                payload = {"service": "Local Video Studio", "status": "ready", "bind": "127.0.0.1"}
                if self._token_ok():
                    instagram_ready = bool(os.getenv("INSTAGRAM_ACCESS_TOKEN") and os.getenv("INSTAGRAM_USER_ID") and os.getenv("INSTAGRAM_API_VERSION"))
                    payload.update({
                        "workspace": str(config.WORKSPACE_DIR),
                        "database": str(config.DB_PATH),
                        "moviepy_installed": self._moviepy_ready(),
                        "instagram_publish_enabled": instagram_ready,
                        "credentials_configured": instagram_ready,
                        "bots": list_bots()["summary"],
                    })
                self._json(200, payload)
            elif path == "/api/projects":
                self._json(200, {"projects": list_projects()})
            elif path == "/api/v2/workspace":
                self._json(200, workspace_v2())
            elif path == "/api/v2/launch":
                self._json(200, launch_status())
            elif path == "/api/v2/first-run":
                self._json(200, first_run_status())
            elif path == "/api/v2/edit-specs":
                self._json(200, {"edit_specs": list_specs()})
            elif path == "/api/v2/style-recipes":
                self._json(200, {"recipes": list_recipes()})
            elif path == "/api/v2/handoff":
                self._json(200, handoff_status())
            elif path == "/api/v2/handoff/outbox":
                self._json(200, outbox_status())
            elif path == "/api/v2/handoff/materials":
                self._json(200, materials_status())
            elif path.startswith("/api/v2/edit-specs/") and path.endswith("/invite"):
                query = parse_qs(urlparse(self.path).query)
                language = (query.get("lang") or query.get("language") or ["ko"])[0]
                self._json(200, spec_invite(path.split("/")[4], language=str(language or "ko")))
            elif path.startswith("/api/v2/edit-specs/") and path.endswith("/brief"):
                query = parse_qs(urlparse(self.path).query)
                role = (query.get("role") or [None])[0]
                self._json(200, spec_brief(path.split("/")[4], role=role))
            elif path.startswith("/api/v2/edit-specs/"):
                record = get_spec(path.split("/")[4])
                self._json(200, {"edit_spec": record}) if record else self._json(404, {"error": "Edit spec not found"})
            elif path == "/api/v2/media":
                self._json(200, {"media": media_catalog()})
            elif path == "/api/v2/runners":
                self._json(200, {"runners": list_runners()})
            elif path == "/api/v2/control-jobs":
                self._json(200, {"control_jobs": list_control_jobs()})
            elif path.startswith("/api/v2/control-jobs/") and path.endswith("/events"):
                self._json(200, {"events": list_runner_events(path.split("/")[4])})
            elif path.startswith("/api/v2/projects/") and path.endswith("/versions"):
                self._json(200, {"versions": list_timeline_versions(path.split("/")[4])})
            elif path.startswith("/api/v2/projects/") and path.endswith("/history"):
                self._json(200, {"history": get_timeline_history(path.split("/")[4])})
            elif path.startswith("/api/v2/projects/") and path.endswith("/publish-receipts"):
                self._json(200, project_publish_receipts(path.split("/")[4]))
            elif path.startswith("/api/v2/projects/") and path.endswith("/proxies"):
                self._json(200, {"proxies": project_proxies(path.split("/")[4])})
            elif path.startswith("/api/v2/projects/") and path.endswith("/analysis"):
                value = get_analysis(path.split("/")[4]); self._json(200, {"analysis": value})
            elif path.startswith("/api/v2/projects/") and path.endswith("/preview"):
                query = urlparse(self.path).query
                at = 0.0
                include_image = True
                quality = "draft"
                for part in query.split("&"):
                    if part.startswith("at="):
                        at = float(part.split("=", 1)[1] or 0)
                    if part == "image=0":
                        include_image = False
                    if part.startswith("quality="):
                        value = part.split("=", 1)[1]
                        if value in {"draft", "full"}:
                            quality = value
                self._json(200, {"preview": project_preview(path.split("/")[4], at, include_image=include_image, quality=quality)})
            elif path.startswith("/api/v2/projects/") and path.endswith("/scopes"):
                query = urlparse(self.path).query
                at = 0.0
                for part in query.split("&"):
                    if part.startswith("at="):
                        at = float(part.split("=", 1)[1] or 0)
                self._json(200, project_scopes(path.split("/")[4], at))
            elif path.startswith("/api/v2/projects/") and path.endswith("/exchange"):
                query = urlparse(self.path).query
                fmt = "edl"
                for part in query.split("&"):
                    if part.startswith("format="):
                        fmt = part.split("=", 1)[1] or "edl"
                self._json(200, project_exchange(path.split("/")[4], fmt))
            elif path.startswith("/api/v2/projects/") and path.endswith("/render-queue"):
                self._json(200, {"jobs": render_queue(path.split("/")[4])})
            elif path.startswith("/api/v2/projects/") and path.endswith("/timeline"):
                self._json(200, get_timeline(path.split("/")[4]))
            elif path == "/api/jobs":
                self._json(200, {"jobs": list_jobs()})
            elif path.startswith("/api/jobs/"):
                job = get_job(path.rsplit("/", 1)[-1])
                self._json(200, {"job": job}) if job else self._json(404, {"error": "Job not found"})
            elif path.startswith("/api/bots/") and path.endswith("/execution-policy"):
                self._json(200, {"execution_policy": execution_policy(path.split("/")[3])})
            elif path == "/api/bots":
                self._json(200, list_bots())
            elif path == "/api/bot-activity":
                self._json(200, {"activity": list_bot_activity()})
            elif path == "/api/bot-guide":
                query = urlparse(self.path).query
                language = next((lang for lang in ("ko", "zh", "ja") if f"lang={lang}" in query), "en")
                self._json(200, bot_guide(language))
            elif path == "/api/bot-entry":
                self._json(200, bot_entry_manifest())
            elif path == "/api/terminal-contract":
                self._json(200, terminal_contract())
            elif path == "/downloads/grok-crew.py":
                self._download(TERMINAL_CLI_PATH, "grok-crew.py")
            elif path == "/downloads/grok-crew-bot.zip":
                raw = bot_pack_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Content-Disposition", 'attachment; filename="GrokCrew-bot-pack.zip"')
                origin = self.headers.get("Origin")
                if origin and origin_is_allowed(origin):
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
                self.end_headers()
                self.wfile.write(raw)
            elif path == "/api/bot-entries":
                self._json(200, {"entries": list_bot_entries()})
            elif path == "/api/edit-method":
                self._json(200, current_edit_method())
            elif path == "/api/presets":
                self._json(200, {"quality_presets": QUALITY_PRESETS, "caption_layout_presets": CAPTION_LAYOUT_PRESETS, "platform_presets": PLATFORM_PRESETS})
            elif path == "/api/brand-kits":
                self._json(200, {"brand_kits": list_artifacts(None, "brand_kit")})
            elif path.startswith("/api/projects/") and path.endswith("/operations"):
                self._json(200, project_operations(path.split("/")[3]))
            elif path.startswith("/api/projects/") and path.endswith("/export"):
                self._json(200, {"bundle": export_project_bundle(path.split("/")[3])})
            elif path.startswith("/api/projects/"):
                project = get_project(path.rsplit("/", 1)[-1])
                self._json(200, {"project": project, "jobs": list_jobs(project["id"])}) if project else self._json(404, {"error": "Project not found"})
            else:
                self._json(404, {"error": "Not found"})
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._internal_error(exc)

    def do_POST(self) -> None:  # noqa: N802
        if not self._origin_allowed():
            self._json(403, {"error": "Cross-origin requests are not allowed."}); return
        if not self._token_ok():
            self._json(401, {"error": "Invalid local studio token."}); return
        try:
            path = urlparse(self.path).path.rstrip("/"); body = self._body()
            if path == "/api/projects":
                self._json(201, {"project": new_project(body)})
            elif path == "/api/v2/projects":
                project = new_project(body); self._json(201, {"project": project, **get_timeline(project["id"])})
            elif path == "/api/v2/first-run/sample":
                opened = open_sample_project()
                self._json(201, {**opened, **get_timeline(opened["project"]["id"])})
            elif path == "/api/v2/edit-specs":
                self._json(201, {"edit_spec": create_spec(body)})
            elif path == "/api/v2/handoff/pull":
                self._json(200, pull_handoff(body))
            elif path == "/api/v2/handoff/outbox/push":
                self._json(200, push_handoff_outbox(body))
            elif path == "/api/v2/handoff/materials/pull":
                self._json(200, pull_materials(body))
            elif path == "/api/v2/handoff/materials/own":
                self._json(200, write_owned_materials(str(body.get("edit_spec_id") or ""), body.get("paths") or body.get("owned_paths") or []))
            elif path == "/api/v2/runners/pair":
                self._json(201, {"runner": pair_runner(body)})
            elif path == "/api/v2/runner-events":
                self._json(201, {"event": record_runner_event(body)})
            elif path.startswith("/api/v2/projects/") and path.endswith("/timeline/patch"):
                self._json(201, apply_timeline_patch(path.split("/")[4], body))
            elif path.startswith("/api/v2/projects/") and path.endswith("/timeline/history"):
                self._json(201, apply_timeline_history_action(path.split("/")[4], body))
            elif path.startswith("/api/v2/projects/") and path.endswith("/proxies"):
                self._json(201, request_proxy(path.split("/")[4], body))
            elif path.startswith("/api/v2/projects/") and path.endswith("/exchange"):
                self._json(201, import_exchange(path.split("/")[4], body))
            elif path.startswith("/api/v2/projects/") and path.endswith("/render-queue"):
                self._json(201, enqueue_render(path.split("/")[4], body))
            elif path.startswith("/api/v2/projects/") and path.endswith("/timeline/restore"):
                self._json(201, restore_timeline_version(path.split("/")[4], int(body.get("revision", 0)), str(body.get("created_by", "operator"))))
            elif path.startswith("/api/v2/projects/") and path.endswith("/control-jobs"):
                self._json(201, {"control_job": create_control_job(path.split("/")[4], body)})
            elif path.startswith("/api/v2/projects/") and path.endswith("/analysis"):
                project = get_project(path.split("/")[4])
                if not project: raise ValueError("Project not found.")
                self._json(201, {"analysis": analyze_project(project)})
            elif path.startswith("/api/v2/projects/") and "/publish/" in path:
                parts = path.split("/"); project_id, platform = parts[4], parts[6]
                if platform not in {"instagram", "tiktok", "youtube"}:
                    raise ValueError("Unsupported publishing platform.")
                if not body.get("approved"):
                    raise ValueError("Publishing requires a recorded human approval or an approved project auto-publish policy.")
                payload = {**body, "idempotency_key": str(body.get("idempotency_key", "")).strip()}
                if not payload["idempotency_key"]:
                    raise ValueError("idempotency_key is required for publishing.")
                job = create_job(project_id, f"{platform}_publish", payload, True)
                if body.get("run_immediately", True):
                    job = start_job(job["id"], wait=bool(body.get("wait", False)))
                self._json(201, {"job": job, "platform": platform})
            elif path.startswith("/api/v2/projects/") and path.endswith("/publish-receipts/retry"):
                self._json(200, retry_project_publish(path.split("/")[4], body))
            elif path == "/api/v2/control-jobs/cancel-unclaimed":
                self._json(200, cancel_unclaimed_control_jobs(str(body.get("project_id") or "").strip() or None))
            elif path.startswith("/api/v2/control-jobs/") and path.endswith("/control"):
                self._json(200, {"control_job": control_control_job(path.split("/")[4], str(body.get("command", "")), body.get("reason"))})
            elif path.startswith("/api/v2/control-jobs/") and path.endswith("/cancel"):
                self._json(200, {"control_job": control_control_job(path.split("/")[4], "cancel", body.get("reason"))})
            elif path.startswith("/api/v2/control-jobs/") and path.endswith("/pause"):
                self._json(200, {"control_job": control_control_job(path.split("/")[4], "pause", body.get("reason"))})
            elif path.startswith("/api/v2/control-jobs/") and path.endswith("/resume"):
                self._json(200, {"control_job": control_control_job(path.split("/")[4], "resume", body.get("reason"))})
            elif path.startswith("/api/v2/control-jobs/") and path.endswith("/retry"):
                self._json(200, {"control_job": control_control_job(path.split("/")[4], "retry", body.get("reason"))})
            elif path.startswith("/api/v2/control-jobs/") and path.endswith("/resolve-conflict"):
                self._json(200, {"control_job": resolve_control_conflict(path.split("/")[4], str(body.get("action", "")))})
            elif path.startswith("/api/v2/control-jobs/") and path.endswith("/answer"):
                self._json(200, {"control_job": answer_control_job(path.split("/")[4], body)})
            elif path == "/api/projects/import":
                self._json(201, import_project_bundle(body))
            elif path == "/api/bots/heartbeat":
                self._json(201, {"bot": record_bot_heartbeat(body)})
            elif path == "/api/bots/execution-policy":
                self._json(200, {"execution_policy": set_execution_policy(body)})
            elif path == "/api/bot-entry":
                self._json(201, enter_bot_workspace(body))
            elif path == "/api/edit-method":
                self._json(200, {"edit_method": set_edit_method(body)})
            elif path == "/api/brand-kits":
                self._json(201, {"brand_kit": save_artifact(None, "brand_kit", body.get("title", body.get("name", "Brand kit")), body.get("payload", body), body.get("created_by", "local_user"))})
            elif path.startswith("/api/artifacts/") and path.endswith("/update"):
                self._json(200, {"artifact": update_artifact(path.split("/")[3], body)})
            elif path.startswith("/api/projects/") and path.endswith("/cut-map"):
                self._json(201, {"cut_map": build_cut_map(path.split("/")[3], body)})
            elif path.startswith("/api/projects/") and path.endswith("/inspect"):
                self._json(201, {"inspection": inspect_project_media(path.split("/")[3], body)})
            elif path.startswith("/api/projects/") and path.endswith("/quality-check"):
                self._json(201, {"quality_report": quality_report(path.split("/")[3], str(body.get("stage", "pre_render")), body)})
            elif path.startswith("/api/projects/") and path.endswith("/artifacts"):
                project_id, kind = path.split("/")[3], str(body.get("type", ""))
                if kind not in {"audio_plan", "bot_task", "edit_variant", "overlay_slots", "performance_note", "project_memory"}:
                    raise ValueError("Use the dedicated endpoint for this project artifact type.")
                self._json(201, {"artifact": save_artifact(project_id, kind, body.get("title"), body.get("payload", {}), body.get("created_by", "local_user"))})
            elif path.startswith("/api/projects/") and path.endswith("/render"):
                project_id = path.split("/")[3]
                auto_local, policy = bot_auto_executes(body)
                human_approved = bool(body.get("approved"))
                if not human_approved and not auto_local:
                    raise ValueError("This bot requires human approval before a local render. Set its execution policy to auto_local or send approved: true.")
                authorization = "bot_auto_local" if auto_local and not human_approved else "human_approved"
                job = create_job(project_id, "render", {
                    "requested_by": body.get("requested_by", "local_user"),
                    "bot_id": body.get("bot_id"),
                    "execution_authorization": authorization,
                }, human_approved or auto_local)
                auto_run = auto_local and bool(body.get("run_immediately", True))
                if auto_run:
                    job = start_job(job["id"], wait=bool(body.get("wait", False)))
                self._json(201, {"job": job, "execution_policy": policy, "auto_run": auto_run})
            elif path.startswith("/api/projects/") and path.endswith("/instagram"):
                project_id = path.split("/")[3]
                auto_local, policy = bot_auto_executes(body)
                human_approved = bool(body.get("approved"))
                # A bot without an auto_local policy (or without an explicit human approval)
                # can still queue the job, but cannot make it publish immediately.
                auto_upload = bool(body.get("auto_upload", False)) and (auto_local or human_approved)
                job = create_job(project_id, "instagram_publish", {"render_path": body.get("render_path"), "caption": body.get("caption", ""), "share_to_feed": bool(body.get("share_to_feed", False)), "requested_by": body.get("requested_by", "local_user"), "bot_id": body.get("bot_id"), "auto_upload": auto_upload}, True)
                if auto_upload:
                    job = start_job(job["id"], wait=bool(body.get("wait", False)))
                self._json(201, {"job": job, "auto_upload": auto_upload, "execution_policy": policy})
            elif path.startswith("/api/jobs/") and path.endswith("/cancel"):
                self._json(200, {"job": request_job_cancel(path.split("/")[3])})
            elif path.startswith("/api/jobs/") and path.endswith("/run"):
                job_id = path.split("/")[3]; self._json(200, {"job": start_job(job_id, wait=bool(body.get("wait", False)))})
            else:
                self._json(404, {"error": "Not found"})
        except TimelinePatchError as exc:
            self._json(exc.status, exc.payload())
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._internal_error(exc)

    def do_PATCH(self) -> None:  # noqa: N802
        if not self._origin_allowed():
            self._json(403, {"error": "Cross-origin requests are not allowed."}); return
        if not self._token_ok():
            self._json(401, {"error": "Invalid local studio token."}); return
        try:
            path = urlparse(self.path).path.rstrip("/"); body = self._body()
            if path.startswith("/api/v2/control-jobs/"):
                self._json(200, {"control_job": update_control_job(
                    path.split("/")[4], str(body.get("status", "")), error=body.get("error"),
                    result_revision=body.get("result_revision"), runner_id=body.get("runner_id"),
                    render_job_id=body.get("render_job_id"), conflict=body.get("conflict"),
                )})
            else:
                self._json(404, {"error": "Not found"})
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._internal_error(exc)

    @staticmethod
    def _moviepy_ready() -> bool:
        try:
            import moviepy  # noqa: F401
            return True
        except ImportError as exc:
            print(f"MoviePy unavailable: {exc}")
            return False

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{utc_now()}] {self.address_string()} {fmt % args}")

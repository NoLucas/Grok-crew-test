#!/usr/bin/env python3
"""Grok Crew CLI — a dependency-free local client for Local Video Studio."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
BROWSER_PAGES = {
    "desktop": "http://localhost:3000/",
    "studio": "http://localhost:3000/",
    "edit": "http://localhost:3000/edit",
    "cut": "http://localhost:3000/cut",
    "production": "http://localhost:3000/production",
    "operations": "http://localhost:3000/operations",
    "bots": "http://localhost:3000/bots",
    "guide": "http://localhost:3000/bot-guide",
    "terminal": "http://localhost:3000/terminal",
    "library": "http://localhost:3000/library",
    "agent": "http://localhost:3000/agent",
    "connect": "http://localhost:3000/connect",
    "packet": "http://localhost:3000/packet",
    "gates": "http://localhost:3000/gates",
    "export": "http://localhost:3000/export",
    "privacy": "http://localhost:3000/privacy",
}

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except AttributeError:
        pass


class LocalStudioClient:
    def __init__(self, server: str, token: str) -> None:
        parsed = urlparse(server)
        if parsed.scheme != "http" or parsed.hostname not in LOCAL_HOSTS:
            raise ValueError("Grok Crew CLI only connects to http://127.0.0.1 or http://localhost.")
        self.server = server.rstrip("/")
        self.token = token

    def request(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(f"{self.server}{path}", data=data, headers=headers, method="POST" if body is not None else "GET")
        try:
            with urlopen(request, timeout=120) as response:  # noqa: S310 - host is restricted above.
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("error", str(exc))
            except (json.JSONDecodeError, UnicodeDecodeError):
                detail = str(exc)
            raise RuntimeError(f"Local Studio rejected the request: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Local Studio is unavailable at {self.server}: {exc.reason}") from exc


def print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def poll_job(client: LocalStudioClient, job_id: str, interval: float = 1.5) -> dict[str, Any]:
    """Poll a queued/running job until it reaches a terminal status."""
    while True:
        response = client.request(f"/api/jobs/{job_id}")
        job = response.get("job")
        if not isinstance(job, dict) or job.get("status") not in {"queued", "running"}:
            return response
        time.sleep(interval)


def read_json_file(value: str) -> dict[str, Any]:
    try:
        payload = json.loads(Path(value).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read JSON file: {value}") from exc
    if not isinstance(payload, dict):
        raise ValueError("JSON input must be an object.")
    return payload


def request_body(value: str, *, wrap_segments: bool = False) -> dict[str, Any]:
    try:
        payload = json.loads(Path(value).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read JSON file: {value}") from exc
    if wrap_segments and isinstance(payload, list):
        return {"segments": payload}
    if not isinstance(payload, dict):
        raise ValueError("JSON input must be an object, or a segment array for cut-map.")
    return payload


def require_human_approval(args: argparse.Namespace) -> None:
    if not args.human_approved:
        raise ValueError("This command requires --human-approved after a person has recorded approval.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Use every Local Video Studio capability from a same-PC terminal.")
    parser.add_argument("--server", default=os.getenv("GROK_CREW_SERVER", "http://127.0.0.1:7214"), help="Local Studio URL; loopback only.")
    parser.add_argument("--token", default=os.getenv("LOCAL_STUDIO_TOKEN", ""), help="Optional Local Studio token. Prefer the LOCAL_STUDIO_TOKEN environment variable.")
    commands = parser.add_subparsers(dest="group", required=True)

    for name, help_text in (("health", "Read local service status."), ("contract", "Read terminal capability contract."), ("guide", "Read bot editing guide."), ("presets", "Read quality, caption layout, and platform presets.")):
        commands.add_parser(name, help=help_text)

    site = commands.add_parser("site", help="Print the correct browser workspace URL; do not use port 7214 for browser pages.")
    site.add_argument("--page", choices=tuple(BROWSER_PAGES), default="desktop")

    entry = commands.add_parser("entry", help="Enter Local Studio and record the first bot heartbeat.")
    entry.add_argument("--bot-id", required=True); entry.add_argument("--display-name", required=True)
    entry.add_argument("--purpose", default="edit_video"); entry.add_argument("--task", default="Prepare a local edit plan.")
    entry.add_argument("--execution-mode", choices=("auto_local", "approval_required"), help="Optional first local-render policy. The default on entry is auto_local.")

    policy = commands.add_parser("policy", help="Read or choose a bot's local execution policy.")
    policy_sub = policy.add_subparsers(dest="command", required=True)
    policy_get = policy_sub.add_parser("get", help="Read the bot's current local execution policy.")
    policy_get.add_argument("--bot-id", required=True)
    policy_set = policy_sub.add_parser("set", help="Choose automatic local rendering or human approval for this bot.")
    policy_set.add_argument("--bot-id", required=True); policy_set.add_argument("--mode", choices=("auto_local", "approval_required"), required=True)
    policy_set.add_argument("--display-name", default="")

    heartbeat = commands.add_parser("heartbeat", help="Record an active bot state.")
    heartbeat.add_argument("--bot-id", required=True); heartbeat.add_argument("--display-name", required=True)
    heartbeat.add_argument("--action", required=True); heartbeat.add_argument("--detail-file")

    bots = commands.add_parser("bots", help="Read verified local bot presence and activity.")
    bots_sub = bots.add_subparsers(dest="command", required=True)
    bots_sub.add_parser("list", help="List bot presence.")
    bots_sub.add_parser("activity", help="List recent bot activity.")
    bots_sub.add_parser("entries", help="List local bot entry records.")

    projects = commands.add_parser("projects", help="Read or create local projects.")
    projects_sub = projects.add_subparsers(dest="command", required=True)
    projects_sub.add_parser("list", help="List projects.")
    project_get = projects_sub.add_parser("get", help="Read one project and its jobs."); project_get.add_argument("--project", required=True)
    project_create = projects_sub.add_parser("create", help="Create a project from a JSON payload."); project_create.add_argument("--file", required=True)

    jobs = commands.add_parser("jobs", help="Read and use local render and publish queues.")
    jobs_sub = jobs.add_subparsers(dest="command", required=True)
    jobs_list = jobs_sub.add_parser("list", help="List all jobs."); jobs_list.add_argument("--project")
    render = jobs_sub.add_parser("render", help="Queue a render; auto_local bots also run it immediately by default."); render.add_argument("--project", required=True); render.add_argument("--bot-id", required=True); render.add_argument("--human-approved", action="store_true"); render.add_argument("--requested-by", default=""); render.add_argument("--queue-only", action="store_true"); render.add_argument("--wait", action="store_true", help="Poll until the render finishes before printing the result.")
    instagram = jobs_sub.add_parser("instagram", help="Queue Instagram upload, or upload immediately when requested."); instagram.add_argument("--project", required=True); instagram.add_argument("--file", required=True); instagram.add_argument("--bot-id", default=""); instagram.add_argument("--human-approved", action="store_true"); instagram.add_argument("--auto-upload", action="store_true", help="Only takes effect immediately if the bot's execution policy is auto_local, or --human-approved is set; otherwise the job is queued."); instagram.add_argument("--wait", action="store_true", help="Poll until the upload finishes before printing the result.")
    run = jobs_sub.add_parser("run", help="Run a queued job."); run.add_argument("--job", required=True); run.add_argument("--wait", action="store_true", help="Poll until the job finishes before printing the result.")
    jobs_cancel = jobs_sub.add_parser("cancel", help="Request cancellation of a queued or running job."); jobs_cancel.add_argument("--job", required=True)

    method = commands.add_parser("method", help="Read or set the shared bot edit method.")
    method_sub = method.add_subparsers(dest="command", required=True)
    method_sub.add_parser("get", help="Read active edit method.")
    method_set = method_sub.add_parser("set", help="Set an edit method from JSON."); method_set.add_argument("--file", required=True)

    ops = commands.add_parser("ops", help="Use the P0–P2 local operations center.")
    ops_sub = ops.add_subparsers(dest="command", required=True)
    ops_show = ops_sub.add_parser("show", help="Read project operations."); ops_show.add_argument("--project", required=True)
    ops_inspect = ops_sub.add_parser("inspect", help="Run local media inspection."); ops_inspect.add_argument("--project", required=True); ops_inspect.add_argument("--file")
    ops_cut = ops_sub.add_parser("cut-map", help="Save a timestamped transcript cut map."); ops_cut.add_argument("--project", required=True); ops_cut.add_argument("--file", required=True)
    ops_quality = ops_sub.add_parser("quality", help="Run pre-render, post-render, or publish QA."); ops_quality.add_argument("--project", required=True); ops_quality.add_argument("--stage", choices=("pre_render", "post_render", "publish"), default="pre_render")
    ops_artifact = ops_sub.add_parser("artifact", help="Save project memory, bot task, audio plan, variant, overlay plan, or performance note."); ops_artifact.add_argument("--project", required=True); ops_artifact.add_argument("--file", required=True)
    ops_update = ops_sub.add_parser("update", help="Update a saved task or plan artifact."); ops_update.add_argument("--artifact", required=True); ops_update.add_argument("--file", required=True)

    brand = commands.add_parser("brand", help="Read or save reusable local brand kits.")
    brand_sub = brand.add_subparsers(dest="command", required=True)
    brand_sub.add_parser("list", help="List brand kits.")
    brand_save = brand_sub.add_parser("save", help="Save a brand kit from JSON."); brand_save.add_argument("--file", required=True)

    bundle = commands.add_parser("bundle", help="Export or import a portable project bundle (project, jobs, and artifacts; media files are not included).")
    bundle_sub = bundle.add_subparsers(dest="command", required=True)
    bundle_export = bundle_sub.add_parser("export", help="Export a project as a portable JSON bundle."); bundle_export.add_argument("--project", required=True); bundle_export.add_argument("--out", help="Write the bundle to this file instead of stdout.")
    bundle_import = bundle_sub.add_parser("import", help="Import a project bundle JSON file as a new local project."); bundle_import.add_argument("--file", required=True)

    spec = commands.add_parser("spec", help="Write an edit spec. The assigned door supplies the source video and the cut.")
    spec_sub = spec.add_subparsers(dest="command", required=True)
    spec_sub.add_parser("list", help="List saved edit specs.")
    spec_create = spec_sub.add_parser("create", help="Save an edit spec from JSON.")
    spec_create.add_argument("--file", required=True)
    spec_create.add_argument("--door", choices=("grok", "agent"), default="", help="Grok door or other-agent door. Overrides the JSON file.")
    spec_create.add_argument("--crew", action="store_true", help="One spec for a collector and an editor.")
    spec_brief = spec_sub.add_parser("brief", help="Print the text to give that door's bot on another computer.")
    spec_brief.add_argument("--id", required=True)
    spec_brief.add_argument("--role", choices=("collect", "edit"), default="")

    handoff = commands.add_parser("handoff", help="Send specs through the outbox or receive a returned package.")
    handoff_sub = handoff.add_subparsers(dest="command", required=True)
    handoff_sub.add_parser("status", help="Show both door inboxes, outboxes, and whether a git remote is set.")
    handoff_sub.add_parser("outbox", help="List specs waiting in each door's outbox.")
    handoff_sub.add_parser("materials", help="List clips the collector dropped for the editor.")
    materials_pull = handoff_sub.add_parser("pull-materials", help="Import collector clips, or write a demo materials pack.")
    materials_pull.add_argument("--demo", action="store_true")
    materials_pull.add_argument("--spec-id", default="")
    handoff_push = handoff_sub.add_parser("push-outbox", help="Copy pending outbox specs onto the git handoff remote.")
    handoff_push.add_argument("--door", choices=("grok", "agent"), default="")
    handoff_push.add_argument("--spec-id", default="")
    handoff_pull = handoff_sub.add_parser("pull", help="Import pending packages from one door only.")
    handoff_pull.add_argument("--demo", action="store_true", help="Write a sample package as if that door sent source and a cut.")
    handoff_pull.add_argument("--spec-id", default="")
    handoff_pull.add_argument("--door", choices=("grok", "agent"), default="", help="Pull only this door. Defaults to the spec's door, or grok.")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    client = LocalStudioClient(args.server, args.token)

    if args.group == "health":
        print_json(client.request("/health")); return
    if args.group == "contract":
        print_json(client.request("/api/terminal-contract")); return
    if args.group == "guide":
        print_json(client.request("/api/bot-guide")); return
    if args.group == "presets":
        print_json(client.request("/api/presets")); return
    if args.group == "site":
        print(BROWSER_PAGES[args.page]); return
    if args.group == "entry":
        payload = {"bot_id": args.bot_id, "display_name": args.display_name, "purpose": args.purpose, "task": args.task}
        if args.execution_mode:
            payload["execution_mode"] = args.execution_mode
        print_json(client.request("/api/bot-entry", payload)); return
    if args.group == "policy":
        if args.command == "get":
            print_json(client.request(f"/api/bots/{args.bot_id}/execution-policy"))
        else:
            print_json(client.request("/api/bots/execution-policy", {"bot_id": args.bot_id, "mode": args.mode, "display_name": args.display_name or args.bot_id, "updated_by": args.bot_id}))
        return
    if args.group == "heartbeat":
        detail = read_json_file(args.detail_file) if args.detail_file else {}
        print_json(client.request("/api/bots/heartbeat", {"bot_id": args.bot_id, "display_name": args.display_name, "action": args.action, "detail": detail})); return
    if args.group == "bots":
        paths = {"list": "/api/bots", "activity": "/api/bot-activity", "entries": "/api/bot-entries"}
        print_json(client.request(paths[args.command])); return

    if args.group == "projects":
        if args.command == "list": print_json(client.request("/api/projects"))
        elif args.command == "get": print_json(client.request(f"/api/projects/{args.project}"))
        else: print_json(client.request("/api/projects", read_json_file(args.file)))
        return

    if args.group == "jobs":
        if args.command == "list":
            print_json(client.request(f"/api/projects/{args.project}" if args.project else "/api/jobs"))
        elif args.command == "render":
            response = client.request(f"/api/projects/{args.project}/render", {"bot_id": args.bot_id, "approved": args.human_approved, "requested_by": args.requested_by or args.bot_id, "run_immediately": not args.queue_only})
            job = response.get("job") if isinstance(response, dict) else None
            if args.wait and isinstance(job, dict) and job.get("id"):
                response = poll_job(client, job["id"])
            print_json(response)
        elif args.command == "instagram":
            payload = read_json_file(args.file); payload["auto_upload"] = args.auto_upload
            if args.bot_id:
                payload["bot_id"] = args.bot_id
            if args.human_approved:
                payload["approved"] = True
            response = client.request(f"/api/projects/{args.project}/instagram", payload)
            job = response.get("job") if isinstance(response, dict) else None
            if args.wait and isinstance(job, dict) and job.get("id"):
                response = poll_job(client, job["id"])
            print_json(response)
        elif args.command == "cancel":
            print_json(client.request(f"/api/jobs/{args.job}/cancel", {}))
        else:
            response = client.request(f"/api/jobs/{args.job}/run", {})
            job = response.get("job") if isinstance(response, dict) else None
            if args.wait and isinstance(job, dict) and job.get("id"):
                response = poll_job(client, job["id"])
            print_json(response)
        return

    if args.group == "method":
        print_json(client.request("/api/edit-method" if args.command == "get" else "/api/edit-method", None if args.command == "get" else read_json_file(args.file))); return

    if args.group == "ops":
        if args.command == "show": print_json(client.request(f"/api/projects/{args.project}/operations"))
        elif args.command == "inspect": print_json(client.request(f"/api/projects/{args.project}/inspect", request_body(args.file) if args.file else {}))
        elif args.command == "cut-map": print_json(client.request(f"/api/projects/{args.project}/cut-map", request_body(args.file, wrap_segments=True)))
        elif args.command == "quality": print_json(client.request(f"/api/projects/{args.project}/quality-check", {"stage": args.stage}))
        elif args.command == "artifact": print_json(client.request(f"/api/projects/{args.project}/artifacts", request_body(args.file)))
        else: print_json(client.request(f"/api/artifacts/{args.artifact}/update", request_body(args.file)))
        return

    if args.group == "brand":
        print_json(client.request("/api/brand-kits" if args.command == "list" else "/api/brand-kits", None if args.command == "list" else read_json_file(args.file)))
        return

    if args.group == "bundle":
        if args.command == "export":
            response = client.request(f"/api/projects/{args.project}/export")
            text = json.dumps(response.get("bundle", response), ensure_ascii=False, indent=2)
            if args.out:
                Path(args.out).write_text(text, encoding="utf-8")
                print(f"Wrote bundle to {args.out}")
            else:
                print(text)
        else:
            print_json(client.request("/api/projects/import", {"bundle": read_json_file(args.file)}))
        return

    if args.group == "spec":
        if args.command == "list":
            print_json(client.request("/api/v2/edit-specs"))
        elif args.command == "create":
            body = read_json_file(args.file)
            if args.door:
                body["door"] = args.door
            if args.crew:
                body["crew"] = True
            print_json(client.request("/api/v2/edit-specs", body))
        else:
            path = f"/api/v2/edit-specs/{args.id}/brief"
            if args.role:
                path += f"?role={args.role}"
            print_json(client.request(path))
        return

    if args.group == "handoff":
        if args.command == "status":
            print_json(client.request("/api/v2/handoff"))
        elif args.command == "outbox":
            print_json(client.request("/api/v2/handoff/outbox"))
        elif args.command == "materials":
            print_json(client.request("/api/v2/handoff/materials"))
        elif args.command == "pull-materials":
            payload = {}
            if args.demo:
                payload["demo"] = True
            if args.spec_id:
                payload["edit_spec_id"] = args.spec_id
            print_json(client.request("/api/v2/handoff/materials/pull", payload))
        elif args.command == "push-outbox":
            payload: dict[str, Any] = {}
            if args.door:
                payload["door"] = args.door
            if args.spec_id:
                payload["edit_spec_id"] = args.spec_id
            print_json(client.request("/api/v2/handoff/outbox/push", payload))
        else:
            payload = {}
            if args.demo:
                payload["demo"] = True
            if args.spec_id:
                payload["edit_spec_id"] = args.spec_id
            if args.door:
                payload["door"] = args.door
            print_json(client.request("/api/v2/handoff/pull", payload))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)

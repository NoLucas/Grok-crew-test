"""Local Video Studio: SQLite schema, connection handling, and event logging."""

from __future__ import annotations

import json
import shutil
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

import config
from config import utc_now


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    except sqlite3.OperationalError as exc:
        if "duplicate column" not in str(exc).lower():
            raise


def init_db() -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    _backup_legacy_database()
    for folder in (config.WORKSPACE_DIR / "inputs", config.WORKSPACE_DIR / "outputs"):
        folder.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, source_path TEXT NOT NULL,
            output_path TEXT NOT NULL, timeline_json TEXT NOT NULL, caption TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL,
            status TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL, result_json TEXT, error_text TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )""")
        _ensure_column(conn, "jobs", "progress", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(conn, "jobs", "cancel_requested", "INTEGER NOT NULL DEFAULT 0")
        conn.execute("""CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, project_id TEXT, job_id TEXT, type TEXT NOT NULL,
            detail_json TEXT NOT NULL, created_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS bot_sessions (
            bot_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
            last_action TEXT NOT NULL, last_detail_json TEXT NOT NULL,
            last_seen TEXT NOT NULL, created_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS bot_activity (
            id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, action TEXT NOT NULL,
            detail_json TEXT NOT NULL, created_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS edit_method (
            id TEXT PRIMARY KEY, method_json TEXT NOT NULL, updated_by TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""")
        _ensure_column(conn, "edit_method", "origin", "TEXT NOT NULL DEFAULT 'bot'")
        conn.execute("""CREATE TABLE IF NOT EXISTS bot_entries (
            id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, display_name TEXT NOT NULL,
            purpose TEXT NOT NULL, task TEXT NOT NULL, joined_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS bot_execution_policies (
            bot_id TEXT PRIMARY KEY, mode TEXT NOT NULL, updated_by TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS project_artifacts (
            id TEXT PRIMARY KEY, project_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL,
            payload_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS timeline_versions (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
            parent_revision INTEGER, timeline_json TEXT NOT NULL, origin TEXT NOT NULL,
            created_by TEXT NOT NULL, created_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id), UNIQUE(project_id, revision)
        )""")
        _ensure_column(conn, "timeline_versions", "action_kind", "TEXT NOT NULL DEFAULT 'edit'")
        _ensure_column(conn, "timeline_versions", "restored_from_revision", "INTEGER")
        conn.execute("""CREATE TABLE IF NOT EXISTS timeline_history (
            project_id TEXT PRIMARY KEY, head_revision INTEGER NOT NULL,
            undo_json TEXT NOT NULL, redo_json TEXT NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS media_proxies (
            project_id TEXT NOT NULL, asset_id TEXT NOT NULL, source_path TEXT NOT NULL,
            proxy_path TEXT, status TEXT NOT NULL, job_id TEXT, progress INTEGER NOT NULL DEFAULT 0,
            width INTEGER, height INTEGER, error_text TEXT, source_size INTEGER,
            source_mtime_ns INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            PRIMARY KEY(project_id, asset_id),
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS control_jobs (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, base_revision INTEGER NOT NULL,
            status TEXT NOT NULL, settings_json TEXT NOT NULL, execution_policy TEXT NOT NULL,
            publish_policy_json TEXT NOT NULL, origin TEXT NOT NULL,
            result_revision INTEGER, error_text TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )""")
        _ensure_column(conn, "control_jobs", "attempt", "INTEGER NOT NULL DEFAULT 1")
        _ensure_column(conn, "control_jobs", "control_sequence", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(conn, "control_jobs", "runner_id", "TEXT")
        _ensure_column(conn, "control_jobs", "render_job_id", "TEXT")
        _ensure_column(conn, "control_jobs", "conflict_json", "TEXT")
        _ensure_column(conn, "control_jobs", "completed_at", "TEXT")
        conn.execute("""CREATE TABLE IF NOT EXISTS runner_events (
            id TEXT PRIMARY KEY, control_job_id TEXT NOT NULL, runner_id TEXT NOT NULL,
            sequence INTEGER NOT NULL, stage TEXT NOT NULL, status TEXT NOT NULL,
            detail_json TEXT NOT NULL, verified_at TEXT NOT NULL, created_at TEXT NOT NULL,
            FOREIGN KEY(control_job_id) REFERENCES control_jobs(id),
            UNIQUE(control_job_id, runner_id, sequence)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS runner_pairings (
            runner_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL,
            public_key TEXT NOT NULL, encryption_key TEXT NOT NULL,
            last_seen TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS publish_receipts (
            id TEXT PRIMARY KEY, platform TEXT NOT NULL, idempotency_key TEXT NOT NULL,
            project_id TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, error_text TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id), UNIQUE(platform, idempotency_key)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS project_analysis (
            project_id TEXT PRIMARY KEY, status TEXT NOT NULL, media_json TEXT NOT NULL,
            transcript_json TEXT NOT NULL, thumbnails_json TEXT NOT NULL,
            error_text TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_project_created ON jobs(project_id, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_open_status ON jobs(status, created_at DESC) WHERE status NOT IN ('succeeded', 'failed')")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_project_created ON events(project_id, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bot_sessions_last_seen ON bot_sessions(last_seen DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bot_activity_bot_created ON bot_activity(bot_id, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bot_entries_joined ON bot_entries(joined_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bot_execution_policies_updated ON bot_execution_policies(updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_project_artifacts_project_type_updated ON project_artifacts(project_id, type, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_project_artifacts_type_updated ON project_artifacts(type, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_timeline_versions_project_revision ON timeline_versions(project_id, revision DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_media_proxies_status ON media_proxies(status, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_control_jobs_project_updated ON control_jobs(project_id, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_runner_events_job_sequence ON runner_events(control_job_id, sequence DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_publish_receipts_project ON publish_receipts(project_id, updated_at DESC)")
        conn.execute("PRAGMA optimize")


def _backup_legacy_database() -> None:
    """Take one recoverable snapshot before the first Timeline v2 migration."""
    database = config.DB_PATH
    if not database.exists() or database.stat().st_size == 0:
        return
    try:
        with sqlite3.connect(database) as connection:
            already_v2 = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'timeline_versions'"
            ).fetchone()
    except sqlite3.DatabaseError:
        return
    if already_v2:
        return
    backup_dir = config.DATA_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = backup_dir / f"studio-pre-v2-{stamp}.db"
    suffix = 1
    while destination.exists():
        destination = backup_dir / f"studio-pre-v2-{stamp}-{suffix}.db"
        suffix += 1
    shutil.copy2(database, destination)


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    value = dict(row)
    for key in ("timeline_json", "payload_json", "result_json", "detail_json", "settings_json", "publish_policy_json", "media_json", "transcript_json", "thumbnails_json", "conflict_json", "undo_json", "redo_json"):
        if key in value and value[key]:
            value[key] = json.loads(value[key])
    return value


def event(project_id: str | None, job_id: str | None, kind: str, detail: dict[str, Any]) -> None:
    with db() as conn:
        conn.execute("INSERT INTO events (id, project_id, job_id, type, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), project_id, job_id, kind, json.dumps(detail), utc_now()))

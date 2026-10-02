"""Python runtime health check, served at /api/health.py.

Deliberately mirrors the TypeScript /api/health: if the two ever disagree
about the database, the difference is the bug. It is the Python equivalent of
the check that proved the Neon connection in the first place — something that
answers before any real workload depends on it.

Vercel's Python runtime invokes BaseHTTPRequestHandler subclasses directly, so
there is no framework here and nothing to boot.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from _lib.db import DatabaseNotConfiguredError, fetch_one


def _branch_fingerprint() -> str:
    """Same 12-character hash the TypeScript side reports.

    Identifies which Neon branch is in use without publishing the hostname on
    a public endpoint. If this differs from the TypeScript health check,
    Python and the web app are talking to different databases.
    """
    url = os.environ.get("DATABASE_URL", "")
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return "unknown"
    if not host:
        return "unknown"
    return hashlib.sha256(host.encode()).hexdigest()[:12]


def _check_database() -> dict[str, object]:
    started = time.monotonic()
    try:
        row = fetch_one(
            """
            select version() as version,
                   current_database() as database,
                   current_user as "user",
                   now() as server_time
            """
        )
        tables = fetch_one(
            """
            select count(*)::int as n
              from information_schema.tables
             where table_schema = 'public' and table_type = 'BASE TABLE'
            """
        )
        assert row is not None and tables is not None
        return {
            "ok": True,
            "version": str(row["version"]).split(" on ")[0],
            "database": row["database"],
            "user": row["user"],
            "serverTime": row["server_time"].isoformat(),
            "tables": tables["n"],
            "latencyMs": round((time.monotonic() - started) * 1000),
            "branchFingerprint": _branch_fingerprint(),
        }
    except DatabaseNotConfiguredError as exc:
        return {"ok": False, "error": str(exc), "hint": "See .env.example."}
    except Exception as exc:
        return {
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "hint": "Check DATABASE_URL is the pooled Neon string and the branch is awake.",
        }


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        database = _check_database()
        body = {
            "ok": bool(database["ok"]),
            "runtime": {
                "language": "python",
                "version": sys.version.split()[0],
                "onVercel": bool(os.environ.get("VERCEL")),
                "environment": os.environ.get("VERCEL_ENV", "local"),
                "region": os.environ.get("VERCEL_REGION"),
                "commit": (os.environ.get("VERCEL_GIT_COMMIT_SHA") or "")[:7] or None,
            },
            "database": database,
        }

        payload = json.dumps(body).encode()
        # 503 on failure so an uptime monitor treats it as down, matching the
        # TypeScript endpoint's behaviour.
        self.send_response(200 if body["ok"] else 503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args: object) -> None:
        """Vercel captures stdout already; the default handler duplicates it."""

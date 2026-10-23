"""The GetHomeApps API — every read and write of app data goes through here.

One FastAPI app, served by Vercel as a single Python function. vercel.json
rewrites /api/py/* to it; locally, `npm run dev:api` runs it with uvicorn on
port 8000 and next.config.ts forwards /api/py/* there.

Next.js renders screens; it never touches the database for app data.
"""

from __future__ import annotations

import os
import sys
import time

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from _lib import storage
from _lib.db import fetch_one
from _lib.web import install_error_handlers
from _routes import (
    alerts,
    analytics,
    audit,
    demo,
    exports,
    files,
    finance,
    handover,
    imports,
    location,
    maintenance,
    me,
    meetings,
    onboarding,
    people,
    profile,
    project_work,
    projects,
    settings,
    sites,
    solar,
    support,
    tariffs,
)

app = FastAPI(
    title="GetHomeApps API",
    # Interactive docs only on a laptop; nothing to browse in production.
    docs_url="/api/py/docs" if not os.environ.get("VERCEL") else None,
    redoc_url=None,
    openapi_url="/api/py/openapi.json" if not os.environ.get("VERCEL") else None,
)
install_error_handlers(app)

PREFIX = "/api/py"
app.include_router(me.router, prefix=PREFIX)
app.include_router(onboarding.router, prefix=PREFIX)
app.include_router(people.router, prefix=PREFIX)
app.include_router(audit.router, prefix=PREFIX)
app.include_router(projects.router, prefix=PREFIX)
app.include_router(project_work.router, prefix=PREFIX)
app.include_router(handover.router, prefix=PREFIX)
app.include_router(sites.router, prefix=PREFIX)
app.include_router(settings.router, prefix=PREFIX)
app.include_router(files.router, prefix=PREFIX)
app.include_router(alerts.router, prefix=PREFIX)
app.include_router(analytics.router, prefix=PREFIX)
app.include_router(maintenance.router, prefix=PREFIX)
app.include_router(meetings.router, prefix=PREFIX)
app.include_router(exports.router, prefix=PREFIX)
app.include_router(profile.router, prefix=PREFIX)
app.include_router(location.router, prefix=PREFIX)
app.include_router(support.router, prefix=PREFIX)
app.include_router(finance.router, prefix=PREFIX)
app.include_router(demo.router, prefix=PREFIX)
app.include_router(imports.router, prefix=PREFIX)
app.include_router(solar.router, prefix=PREFIX)
app.include_router(tariffs.router, prefix=PREFIX)


@app.get(f"{PREFIX}/ping")
def ping() -> dict[str, object]:
    """Unauthenticated liveness check for the rewrite itself."""
    return {"ok": True, "region": os.environ.get("VERCEL_REGION"), "storage": storage.mode()}


@app.get(f"{PREFIX}/health")
def health() -> JSONResponse:
    """For the uptime check (.github/workflows/uptime.yml): the app and its database answer. Says nothing else."""
    started = time.monotonic()
    try:
        fetch_one("select 1 as ok")
    except Exception as exc:  # the reason goes to the log, not to whoever asked
        print(f"[health] database unavailable: {type(exc).__name__}: {exc}")
        return JSONResponse({"ok": False, "database": "unavailable"}, status_code=503)
    return JSONResponse({"ok": True, "database": "ok", "ms": round((time.monotonic() - started) * 1000)})


@app.post(f"{PREFIX}/csp-report")
async def csp_report(request: Request) -> Response:
    """What the content security policy would have blocked (vercel.json, report-only for now), into the log:
    the directive and where from, without query strings (they can carry personal data)."""
    try:
        body = await request.json()
    except Exception:
        return Response(status_code=204)
    reports = body if isinstance(body, list) else [body]
    for r in reports[:20]:
        r = r.get("csp-report") or r.get("body") or r if isinstance(r, dict) else {}
        directive = str(r.get("violated-directive") or r.get("effectiveDirective") or "")[:80]
        blocked = str(r.get("blocked-uri") or r.get("blockedURL") or "").split("?")[0][:200]
        page = str(r.get("document-uri") or r.get("documentURL") or "").split("?")[0][:200]
        print(f"[csp] {directive} blocked {blocked} on {page}")
    return Response(status_code=204)

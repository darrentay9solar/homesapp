"""The GetHomeApps API — every read and write of app data goes through here.

One FastAPI app, served by Vercel as a single Python function. vercel.json
rewrites /api/py/* to it; locally, `npm run dev:api` runs it with uvicorn on
port 8000 and next.config.ts forwards /api/py/* there.

Next.js renders screens; it never touches the database for app data.
"""

from __future__ import annotations

import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI

from _lib.web import install_error_handlers
from _routes import me, onboarding

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


@app.get(f"{PREFIX}/ping")
def ping() -> dict[str, object]:
    """Unauthenticated liveness check for the rewrite itself."""
    return {"ok": True, "region": os.environ.get("VERCEL_REGION")}

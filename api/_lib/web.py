"""FastAPI plumbing shared by every route: who is asking, and errors as JSON."""

from __future__ import annotations

import os
from collections.abc import Callable

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from _lib import demo
from _lib.account import Account, resolve
from _lib.auth import AuthError, ClerkIdentity, env, verify_token
from _lib.db import fetch_one


def identity(request: Request) -> ClerkIdentity:
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    token = token or request.cookies.get("__session", "")
    try:
        return verify_token(token)
    except AuthError as exc:
        raise HTTPException(401, str(exc)) from exc


def act_as_allowed() -> bool:
    """ "Act as" exists only on a laptop, against a database that isn't production.

    It lets a project manager test the homeowner's and the crew's side of a
    project with one login. Never on Vercel; never when DATABASE_URL points
    at the production endpoint (or production isn't known to compare with).
    """
    if os.environ.get("VERCEL"):
        return False
    db, prod = env("DATABASE_URL"), env("PROD_DATABASE_URL") or env("PROD_MIGRATION_DATABASE_URL")
    if not db or not prod:
        return False
    host = lambda u: psycopg.conninfo.conninfo_to_dict(u).get("host")  # noqa: E731
    return host(db) != host(prod)


def demo_account(target: str) -> Account:
    """A visitor on the demo site, as the sample person they picked."""
    if not demo.enabled():
        raise HTTPException(401, "The demo isn't available here. Please sign in.")
    user = (
        fetch_one("select * from users where uid = %s and is_demo and active", (int(target),))
        if target.isdigit()
        else None
    )
    if not user:
        raise HTTPException(401, "That sample person isn't available any more. Pick another on the sign-in page.")
    return Account("active", ClerkIdentity(f"demo:{user['uid']}", None), user=user, demo=True)


def account(request: Request) -> Account:
    # On the demo site, the sample person a visitor picked wins over any sign-in
    # they also have there. Anywhere else the header means nothing to a signed-in
    # person, and gets a plain "sign in" to anyone else.
    target = request.headers.get("x-demo-as", "").strip()
    if target:
        has_session = request.headers.get("authorization", "").lower().startswith("bearer ") or request.cookies.get(
            "__session"
        )
        if demo.enabled() or not has_session:
            return demo_account(target)
    ident = identity(request)
    acct = resolve(ident)
    target = request.headers.get("x-act-as", "").strip()
    admin = acct.role in ("project_manager", "superadmin")
    if target.isdigit() and acct.state == "active" and admin and act_as_allowed():
        user = fetch_one("select * from users where uid = %s and active", (int(target),))
        if user and user["uid"] != acct.uid:
            return Account("active", ident, user=user, acting_pm=acct.user)
    return acct


def active(acct: Account = Depends(account)) -> Account:
    if acct.state != "active":
        raise HTTPException(403, "You don't have an active account.")
    return acct


def role(*roles: str) -> Callable[[Account], Account]:
    """Dependency: an active account with one of ``roles``. A superadmin can do whatever a project manager can."""
    allowed = set(roles) | ({"superadmin"} if "project_manager" in roles else set())

    def check(acct: Account = Depends(active)) -> Account:
        if acct.role not in allowed:
            raise HTTPException(403, "Your role can't do that.")
        return acct

    return check


def install_error_handlers(app: FastAPI) -> None:
    # Starlette's base class, so 404s for unknown paths are JSON {"error"} too.
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_req: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    @app.exception_handler(psycopg.Error)
    async def db_error(_req: Request, exc: psycopg.Error) -> JSONResponse:
        # The database's own guards raise messages written for people; pass
        # those through. Anything else is logged and kept vague.
        state = getattr(exc, "sqlstate", None) or ""
        message = (exc.diag.message_primary if exc.diag else None) or "Database error."
        if state == "42501":
            return JSONResponse({"error": message}, status_code=403)
        if state in ("P0001", "P0002", "23514"):
            return JSONResponse({"error": message}, status_code=400)
        if state == "23505":
            return JSONResponse({"error": "That already exists.", "detail": message}, status_code=409)
        print(f"[api] database error {state}: {exc}")
        return JSONResponse({"error": "Something went wrong. Please try again."}, status_code=500)

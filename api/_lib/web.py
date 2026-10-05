"""FastAPI plumbing shared by every route: who is asking, and errors as JSON."""

from __future__ import annotations

from collections.abc import Callable

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from _lib.account import Account, resolve
from _lib.auth import AuthError, ClerkIdentity, verify_token


def identity(request: Request) -> ClerkIdentity:
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    token = token or request.cookies.get("__session", "")
    try:
        return verify_token(token)
    except AuthError as exc:
        raise HTTPException(401, str(exc)) from exc


def account(ident: ClerkIdentity = Depends(identity)) -> Account:
    return resolve(ident)


def active(acct: Account = Depends(account)) -> Account:
    if acct.state != "active":
        raise HTTPException(403, "You don't have an active account.")
    return acct


def role(*roles: str) -> Callable[[Account], Account]:
    """Dependency: an active account with one of ``roles``."""

    def check(acct: Account = Depends(active)) -> Account:
        if acct.role not in roles:
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

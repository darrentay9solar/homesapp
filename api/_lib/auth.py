"""Who is calling: verifies the Clerk session token on every API request.

Clerk signs a short-lived (about 60 second) RS256 token for each signed-in
browser. The browser sends it as ``Authorization: Bearer <token>``; the
``__session`` cookie carries the same token and is accepted as a fallback.

Verification is local — signature against Clerk's published keys (cached),
expiry, and the origin the token was issued to — so no request to Clerk is
made per API call.
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from functools import lru_cache

import jwt
from jwt import PyJWKClient

__all__ = ["AuthError", "ClerkIdentity", "env", "verify_token"]


class AuthError(Exception):
    """The request carries no valid Clerk session."""


@dataclass(frozen=True)
class ClerkIdentity:
    clerk_user_id: str
    session_id: str | None


def env(key: str) -> str:
    value = os.environ.get(key, "").strip()
    if value:
        return value
    from _lib.db import _from_env_file  # local dev: read .env.local

    return _from_env_file(key)


def frontend_api() -> str:
    """The Clerk Frontend API host, decoded from the publishable key.

    ``pk_test_<base64("<host>$")>`` — the key is public by design, and this is
    exactly what Clerk's own SDKs do, so no extra configuration is needed.
    """
    pk = env("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
    if not pk.startswith(("pk_test_", "pk_live_")):
        raise AuthError("Clerk publishable key is not configured.")
    encoded = pk.split("_", 2)[2]
    encoded += "=" * (-len(encoded) % 4)
    host = base64.b64decode(encoded).decode().rstrip("$")
    return host


@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    # Keys are cached for an hour; a key rotation is picked up on the next
    # unknown "kid" automatically.
    return PyJWKClient(
        f"https://{frontend_api()}/.well-known/jwks.json",
        cache_keys=True,
        lifespan=3600,
    )


def _allowed_origins() -> set[str]:
    """Origins a token may have been issued to (Clerk's ``azp`` claim)."""
    origins = {"http://localhost:3000", "http://127.0.0.1:3000"}
    for key in ("APP_URL",):
        if v := env(key):
            origins.add(v.rstrip("/"))
    for key in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
        if v := os.environ.get(key, "").strip():
            origins.add(f"https://{v}")
    if extra := env("CLERK_AUTHORIZED_PARTIES"):
        origins.update(o.strip().rstrip("/") for o in extra.split(",") if o.strip())
    return origins


def verify_token(token: str, *, key: object | None = None) -> ClerkIdentity:
    """Returns who the token belongs to, or raises AuthError.

    ``key`` exists for tests, which sign tokens with their own key.
    """
    if not token:
        raise AuthError("Not signed in.")
    try:
        signing_key = key if key is not None else _jwks_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            options={"require": ["exp", "iat", "sub"], "verify_aud": False},
            leeway=5,
        )
    except jwt.PyJWTError as exc:
        raise AuthError(f"Invalid session: {exc}") from exc

    # A token minted for some other site that also uses this Clerk instance
    # must not work here.
    azp = claims.get("azp")
    if azp and azp.rstrip("/") not in _allowed_origins():
        raise AuthError(f"Session was issued to another origin ({azp}).")

    # Clerk marks a pending session (e.g. awaiting a second factor) with sts.
    if claims.get("sts") == "pending":
        raise AuthError("Sign-in is not complete.")

    return ClerkIdentity(clerk_user_id=str(claims["sub"]), session_id=claims.get("sid"))

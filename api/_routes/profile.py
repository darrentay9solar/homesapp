"""Your settings and profile pictures.

  PATCH  /me/settings                       {language?, notificationPrefs?}
  POST   /me/avatar/upload-link             a link to upload your picture
  POST   /me/avatar                         {key}: use what was uploaded
  DELETE /me/avatar                         remove your picture
  POST   /people/{uid}/avatar/upload-link   the same, for a project manager on anyone's
  POST   /people/{uid}/avatar
  DELETE /people/{uid}/avatar
  GET    /avatars/{uid}                     the picture (any signed-in person), via a short link

Pictures are stored as profiles/<uid>/images/<uuid>.jpg. Old ones are kept,
so a change can be reverted from the audit log like any other.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse, Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from _lib import prefs, storage
from _lib.account import Account
from _lib.db import fetch_one, transaction
from _lib.i18n import LANGS
from _lib.web import active

router = APIRouter()


# ------------------------------------------------------------------ settings


class SettingsIn(BaseModel):
    language: str | None = None
    notificationPrefs: dict[str, Any] | None = None


@router.patch("/me/settings")
def save_settings(body: SettingsIn, acct: Account = Depends(active)) -> dict[str, Any]:
    sets: dict[str, Any] = {}
    if body.language is not None:
        if body.language not in LANGS:
            raise HTTPException(400, "Choose English or Chinese.")
        sets["language"] = body.language
    if body.notificationPrefs is not None:
        try:
            sets["notification_prefs"] = prefs.normalise(body.notificationPrefs)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    if not sets:
        raise HTTPException(400, "Nothing to save.")
    vals = {k: (Jsonb(v) if k == "notification_prefs" else v) for k, v in sets.items()}
    cols = ", ".join(f"{k} = %({k})s" for k in vals)
    with transaction(acct.uid) as cur:
        cur.execute(f"update users set {cols}, updated_at = now() where uid = %(uid)s", {**vals, "uid": acct.uid})
    out: dict[str, Any] = {"message": "Settings saved."}
    if "notification_prefs" in sets:
        out["notificationPrefs"] = sets["notification_prefs"]
    if "language" in sets:
        out["language"] = sets["language"]
    return out


# -------------------------------------------------------------------- avatars


class LinkIn(BaseModel):
    contentType: str = ""
    size: int = 0


class KeyIn(BaseModel):
    key: str = ""


def _target(uid: int, acct: Account) -> dict[str, Any]:
    """Whose picture: your own, or anyone's if you're a project manager."""
    if uid != acct.uid and acct.role != "project_manager":
        raise HTTPException(403, "Only a project manager can change someone else's picture.")
    u = fetch_one("select uid, full_name, avatar_key from users where uid = %s", (uid,))
    if not u:
        raise HTTPException(404, "No such account.")
    return u


def _link(uid: int, body: LinkIn, acct: Account) -> dict[str, Any]:
    _target(uid, acct)
    if body.contentType not in storage.AVATAR_TYPES:
        raise HTTPException(400, "Use a JPEG, PNG or WebP picture.")
    if not 0 < body.size <= storage.AVATAR_MAX_BYTES:
        raise HTTPException(400, "Pictures must be under 5 MB.")
    key = storage.avatar_key(uid, body.contentType)
    try:
        url = storage.upload_link(key, body.contentType, body.size)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"key": key, "uploadUrl": url, "headers": {"Content-Type": body.contentType}}


def _use(uid: int, body: KeyIn, acct: Account) -> dict[str, Any]:
    u = _target(uid, acct)
    exts = "|".join(storage.AVATAR_TYPES.values())
    if not re.fullmatch(rf"profiles/{uid}/images/[0-9a-f-]{{36}}\.({exts})", body.key):
        raise HTTPException(400, "That picture doesn't belong to this account.")
    got = storage.head(body.key)
    if not got:
        raise HTTPException(400, "The picture never arrived. Please try again.")
    size, ctype = got
    if size > storage.AVATAR_MAX_BYTES or ctype not in storage.AVATAR_TYPES:
        storage.delete(body.key)
        raise HTTPException(400, "That picture is too large or not an allowed type.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "update users set avatar_key = %s, avatar_updated_at = now(), avatar_updated_by = %s, updated_at = now() "
            "where uid = %s returning avatar_updated_at",
            (body.key, acct.uid, uid),
        )
        at = cur.fetchone()["avatar_updated_at"]
    whose = "Your" if uid == acct.uid else f"{u['full_name'] or 'Their'}'s"
    return {"message": f"{whose} picture is updated.", "avatar": f"/api/py/avatars/{uid}?v={int(at.timestamp())}"}


def _remove(uid: int, acct: Account) -> dict[str, Any]:
    u = _target(uid, acct)
    if not u["avatar_key"]:
        raise HTTPException(404, "There's no picture to remove.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "update users set avatar_key = null, avatar_updated_at = now(), avatar_updated_by = %s, updated_at = now() "
            "where uid = %s",
            (acct.uid, uid),
        )
    whose = "Your" if uid == acct.uid else f"{u['full_name'] or 'Their'}'s"
    return {"message": f"{whose} picture is removed."}


@router.post("/me/avatar/upload-link")
def my_avatar_link(body: LinkIn, acct: Account = Depends(active)) -> dict[str, Any]:
    return _link(acct.uid, body, acct)


@router.post("/me/avatar")
def my_avatar(body: KeyIn, acct: Account = Depends(active)) -> dict[str, Any]:
    return _use(acct.uid, body, acct)


@router.delete("/me/avatar")
def my_avatar_remove(acct: Account = Depends(active)) -> dict[str, Any]:
    return _remove(acct.uid, acct)


@router.post("/people/{uid}/avatar/upload-link")
def avatar_link(uid: int, body: LinkIn, acct: Account = Depends(active)) -> dict[str, Any]:
    return _link(uid, body, acct)


@router.post("/people/{uid}/avatar")
def avatar_use(uid: int, body: KeyIn, acct: Account = Depends(active)) -> dict[str, Any]:
    return _use(uid, body, acct)


@router.delete("/people/{uid}/avatar")
def avatar_remove(uid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    return _remove(uid, acct)


@router.get("/avatars/{uid}")
def avatar(uid: int, _acct: Account = Depends(active)) -> Response:
    u = fetch_one("select avatar_key, full_name from users where uid = %s", (uid,))
    if not u or not u["avatar_key"]:
        raise HTTPException(404, "No picture.")
    try:
        return RedirectResponse(storage.view_link(u["avatar_key"], "picture.jpg"), status_code=302)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc

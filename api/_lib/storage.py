"""File storage: Cloudflare R2 in production, a local folder on a laptop.

The bucket is private: every upload and every view goes through a link the
server signs only after checking the person may touch that project, valid
for five minutes. project_files stores the object key, never a URL. Files go
straight from the browser to storage, never through Vercel (whose functions
accept only ~4.5 MB per request).

R2 speaks the S3 API, so signing is plain AWS Signature V4 — done here with
hashlib and hmac rather than pulling in the AWS SDK.

Without R2 settings, on a laptop (never on Vercel), files go to
web/.uploads/ through the API itself, behind the same signed, expiring
links, so the whole upload flow can be used and tested before R2 exists.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from _lib.auth import env

# Images and PDFs only; anything else in a solar project file is a mistake.
ALLOWED_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "application/pdf": "pdf",
}
# 25 MB: a phone photo is 2-8 MB; a scanned multi-page PDF fits too.
MAX_BYTES = 25 * 1024 * 1024
# Profile pictures are resized in the browser before upload; 5 MB is generous.
AVATAR_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
AVATAR_MAX_BYTES = 5 * 1024 * 1024


def kind_of(content_type: str | None) -> str:
    """'image' or 'document': the folder a file is stored in."""
    return "image" if (content_type or "").startswith("image/") else "document"


def folder(content_type: str | None) -> str:
    return "images" if kind_of(content_type) == "image" else "documents"


def project_key(pid: int, category: str, content_type: str) -> str:
    """Where a project file is stored: by project, then type, then slot.

    projects/12/images/panel_pictures/<uuid>.jpg, projects/12/documents/utility_bill/<uuid>.pdf
    """
    return f"projects/{pid}/{folder(content_type)}/{category}/{uuid.uuid4()}.{ALLOWED_TYPES[content_type]}"


def avatar_key(uid: int, content_type: str) -> str:
    return f"profiles/{uid}/images/{uuid.uuid4()}.{AVATAR_TYPES[content_type]}"


def handover_keys(pid: int) -> tuple[str, str]:
    """Where a signed handover certificate (PDF) and its signature (JPEG) are stored."""
    u = uuid.uuid4()
    return f"projects/{pid}/documents/handover_certificate/{u}.pdf", f"projects/{pid}/images/handover_signature/{u}.jpg"


LINK_SECONDS = 300

LOCAL_DIR = Path(__file__).resolve().parents[2] / ".uploads"


class StorageNotConfiguredError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(
            "File storage isn't set up yet. Add the Cloudflare R2 settings (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, "
            "R2_SECRET_ACCESS_KEY, R2_BUCKET); see docs/r2.md."
        )


@dataclass(frozen=True)
class R2:
    account: str
    key_id: str = field(repr=False)
    secret: str = field(repr=False)
    bucket: str

    @property
    def host(self) -> str:
        return f"{self.account}.r2.cloudflarestorage.com"


def _r2() -> R2 | None:
    vals = [env(k) for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")]
    return R2(*vals) if all(vals) else None


def mode() -> str | None:
    """ "r2", "local" (a laptop without R2), or None (nowhere to put files)."""
    if _r2():
        return "r2"
    if not os.environ.get("VERCEL"):
        return "local"
    return None


# ------------------------------------------------------------------ R2 signing


def _q(s: str) -> str:
    return urllib.parse.quote(s, safe="-_.~")


def presign(
    *,
    method: str,
    host: str,
    path: str,
    region: str,
    key_id: str,
    secret: str,
    seconds: int,
    headers: dict[str, str],
    query: dict[str, str],
    now: datetime,
) -> str:
    """An AWS Signature V4 query-string presigned URL (S3 and R2 alike).

    Kept free of R2 specifics so it can be checked against Amazon's own
    published example (tests_py/test_upload_cases.py).
    """
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    scope = f"{day}/{region}/s3/aws4_request"
    hdrs = {"host": host, **{k.lower(): v for k, v in headers.items()}}
    signed = ";".join(sorted(hdrs))
    params = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{key_id}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(seconds),
        "X-Amz-SignedHeaders": signed,
        **query,
    }
    canonical_query = "&".join(f"{_q(k)}={_q(v)}" for k, v in sorted(params.items()))
    canonical = "\n".join(
        [
            method,
            path,
            canonical_query,
            "".join(f"{k}:{hdrs[k].strip()}\n" for k in sorted(hdrs)),
            signed,
            "UNSIGNED-PAYLOAD",
        ]
    )
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = hmac.new(f"AWS4{secret}".encode(), day.encode(), hashlib.sha256).digest()
    for part in (region, "s3", "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    return f"https://{host}{path}?{canonical_query}&X-Amz-Signature={sig}"


def _sign(cfg: R2, method: str, key: str, seconds: int, headers: dict[str, str], query: dict[str, str]) -> str:
    # R2_KEY_PREFIX keeps automated test runs in their own folder of the dev
    # bucket ("pytest/"), apart from the demo and anyone trying the app. Unset in
    # real use. An empty key is the bucket itself (a listing), never prefixed.
    stored = ((env("R2_KEY_PREFIX") or "") + key) if key else key
    return presign(
        method=method,
        host=cfg.host,
        path=f"/{cfg.bucket}/" + urllib.parse.quote(stored, safe="/-_.~"),
        region="auto",
        key_id=cfg.key_id,
        secret=cfg.secret,
        seconds=seconds,
        headers=headers,
        query=query,
        now=datetime.now(UTC),
    )


# --------------------------------------------------------- local (laptop only)

_LOCAL_SECRET = env("DEV_STORAGE_SECRET") or secrets.token_hex(32)


def _token(payload: dict[str, object]) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_LOCAL_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{body}.{sig}"


def read_token(token: str) -> dict[str, object] | None:
    """The signed instruction in a local storage link, if genuine and unexpired."""
    try:
        body, sig = token.rsplit(".", 1)
        good = hmac.new(_LOCAL_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, good):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    return data if float(data.get("exp", 0)) > time.time() else None


def local_path(key: str) -> Path:
    p = (LOCAL_DIR / key).resolve()
    if LOCAL_DIR.resolve() not in p.parents:
        raise ValueError("Bad key.")
    return p


# ------------------------------------------------------------------ the API


def upload_link(key: str, content_type: str, size: int) -> str:
    """Where the browser PUTs one file. Type and size are part of the signature."""
    m = mode()
    if m == "r2":
        cfg = _r2()
        assert cfg
        return _sign(cfg, "PUT", key, LINK_SECONDS, {"content-type": content_type, "content-length": str(size)}, {})
    if m == "local":
        tok = _token({"op": "put", "key": key, "type": content_type, "size": size, "exp": time.time() + LINK_SECONDS})
        return f"/api/py/dev-storage/{tok}"
    raise StorageNotConfiguredError


def view_link(key: str, file_name: str) -> str:
    m = mode()
    disposition = f"inline; filename*=UTF-8''{urllib.parse.quote(file_name)}"
    if m == "r2":
        cfg = _r2()
        assert cfg
        return _sign(cfg, "GET", key, LINK_SECONDS, {}, {"response-content-disposition": disposition})
    if m == "local":
        tok = _token({"op": "get", "key": key, "name": file_name, "exp": time.time() + LINK_SECONDS})
        return f"/api/py/dev-storage/{tok}"
    raise StorageNotConfiguredError


def head(key: str) -> tuple[int, str | None] | None:
    """(size, content type) of what actually arrived at a key, or None."""
    m = mode()
    if m == "local":
        p = local_path(key)
        if not p.exists():
            return None
        meta = p.with_suffix(p.suffix + ".type")
        return p.stat().st_size, meta.read_text() if meta.exists() else None
    cfg = _r2()
    if not cfg:
        raise StorageNotConfiguredError
    req = urllib.request.Request(_sign(cfg, "HEAD", key, 60, {}, {}), method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return int(res.headers.get("content-length") or 0), res.headers.get("content-type")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def check() -> dict[str, object]:
    """Is storage usable here, and is it the right bucket for this environment?

    One read of a key that never exists: R2 answers "no such key" only if the
    access key is accepted and the bucket is there. Nothing is written.
    """
    # The demo site is its own Vercel project ("production" to Vercel) but uses the dev bucket.
    environment = os.environ.get("VERCEL_ENV") or ("vercel" if os.environ.get("VERCEL") else "laptop")
    if os.environ.get("DEMO_MODE", "").strip() == "1":
        environment = "demo"
    m = mode()
    out: dict[str, object] = {"mode": m, "environment": environment, "bucket": None, "ok": False, "problem": None}
    if m != "r2":
        out["ok"] = m == "local"
        out["problem"] = None if m == "local" else str(StorageNotConfiguredError())
        return out
    cfg = _r2()
    assert cfg
    out["bucket"] = cfg.bucket
    is_prod_bucket = cfg.bucket.endswith("-prod")
    if (environment == "production") != is_prod_bucket:
        out["problem"] = (
            f"Production is using the {cfg.bucket} bucket; it should use the -prod one."
            if environment == "production"
            else f"This {environment} environment is using the production bucket ({cfg.bucket}); use the -dev one."
        )
        return out
    req = urllib.request.Request(_sign(cfg, "GET", "healthcheck/never-exists", 60, {}, {}), method="GET")
    try:
        urllib.request.urlopen(req, timeout=15).close()
        out["ok"] = True  # unexpected, but the key and bucket clearly work
    except urllib.error.HTTPError as exc:
        body = exc.read(2000).decode("utf8", "replace")
        if exc.code == 404 and "NoSuchKey" in body:
            out["ok"] = True
        elif "NoSuchBucket" in body:
            out["problem"] = f"There's no bucket called {cfg.bucket} in this Cloudflare account."
        elif exc.code in (401, 403):
            out["problem"] = (
                "R2 refused the access key: check R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY "
                "and that the token covers this bucket."
            )
        else:
            out["problem"] = f"R2 answered {exc.code}."
    except (urllib.error.URLError, TimeoutError) as exc:
        out["problem"] = f"Couldn't reach R2 ({exc}). Check R2_ACCOUNT_ID."
    return out


def put(key: str, data: bytes, content_type: str) -> None:
    """Stores a file the server made itself (a signed certificate), not one a browser uploads."""
    m = mode()
    if m == "local":
        p = local_path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        p.with_suffix(p.suffix + ".type").write_text(content_type)
        return
    cfg = _r2()
    if not cfg:
        raise StorageNotConfiguredError
    url = _sign(cfg, "PUT", key, 60, {"content-type": content_type}, {})
    req = urllib.request.Request(url, method="PUT", data=data, headers={"Content-Type": content_type})
    urllib.request.urlopen(req, timeout=20).close()


def delete(key: str) -> None:
    m = mode()
    if m == "local":
        p = local_path(key)
        p.unlink(missing_ok=True)
        p.with_suffix(p.suffix + ".type").unlink(missing_ok=True)
        return
    cfg = _r2()
    if not cfg:
        raise StorageNotConfiguredError
    req = urllib.request.Request(_sign(cfg, "DELETE", key, 60, {}, {}), method="DELETE")
    try:
        urllib.request.urlopen(req, timeout=15).close()
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise

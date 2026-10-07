"""Cloudflare R2 setup, for development and production.

Almost every case here runs without contacting R2: it checks the settings, and
re-verifies every link the app signs with an independent Signature V4 check
built from the URL alone (the same way R2 checks it). Only the `live` group,
marked r2_live, talks to Cloudflare: about 30 requests with tiny files, all
deleted again, a rounding error against R2's free monthly allowance.

Groups:
  settings     the four R2 settings in .env.local are present and well formed
  mode         where uploads go for every combination of settings and host
  check        the PM's storage check: every answer R2 can give, every bucket/environment pairing
  links        upload links from the app, for every slot x project stage x type, and every size
  slots        upload links straight from storage for every file slot x type x size
  views        view links: every kind of file name comes back exactly, directly and via the app
  binding      a link only works for exactly what it was signed for
  docs         the CORS policy in docs/r2.md allows what the app does
  live         the real dev bucket, and the prod bucket's CORS (no prod key needed)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
import urllib.parse
import uuid
from datetime import UTC, datetime, timedelta
from itertools import product
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from test_upload_cases import M1_SLOTS, TYPES, H, World

from _lib import project_fields, storage
from _lib.auth import env

pytestmark = pytest.mark.real_r2

KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
CFG = storage._r2()
needs_r2 = pytest.mark.skipif(CFG is None, reason="R2 settings aren't in .env.local")
LIVE_ORIGIN = "https://homesapp-alpha.vercel.app"
LAPTOP_ORIGIN = "http://localhost:3000"
PROD_BUCKET = "gethomeapps-prod"
DEV_BUCKET = "gethomeapps-dev"
FILE_SLOTS = [f.key for f in project_fields.FIELDS if f.kind in project_fields.FILE_KINDS]
MB = 1024 * 1024
UUID_RE = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


# ---------------------------------------------------------- independent checker


def verify(url: str, method: str, headers: dict[str, str], secret: str, *, now: datetime | None = None) -> str | None:
    """Re-checks a presigned URL the way R2 does, from the URL alone. None if it would be accepted."""
    u = urllib.parse.urlsplit(url)
    pairs = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
    q = dict(pairs)
    if len(q) != len(pairs):
        return "a query parameter appears twice"
    for k in (
        "X-Amz-Algorithm",
        "X-Amz-Credential",
        "X-Amz-Date",
        "X-Amz-Expires",
        "X-Amz-SignedHeaders",
        "X-Amz-Signature",
    ):
        if k not in q:
            return f"{k} is missing"
    if q["X-Amz-Algorithm"] != "AWS4-HMAC-SHA256":
        return "wrong algorithm"
    key_id, day, region, service, term = q["X-Amz-Credential"].split("/")
    signed_at = datetime.strptime(q["X-Amz-Date"], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
    if day != q["X-Amz-Date"][:8] or (region, service, term) != ("auto", "s3", "aws4_request"):
        return "credential scope doesn't match"
    if (now or datetime.now(UTC)) > signed_at + timedelta(seconds=int(q["X-Amz-Expires"])):
        return "expired"
    sent = {"host": u.netloc, **{k.lower(): v for k, v in headers.items()}}
    names = q["X-Amz-SignedHeaders"].split(";")
    if any(n not in sent for n in names):
        return "a signed header wasn't sent"
    canonical_query = "&".join(
        f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
        for k, v in sorted((k, v) for k, v in pairs if k != "X-Amz-Signature")
    )
    canonical = "\n".join(
        [
            method,
            u.path,
            canonical_query,
            "".join(f"{n}:{sent[n].strip()}\n" for n in names),
            ";".join(names),
            "UNSIGNED-PAYLOAD",
        ]
    )
    scope = f"{day}/auto/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{q['X-Amz-Date']}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    k = hmac.new(f"AWS4{secret}".encode(), day.encode(), hashlib.sha256).digest()
    for part in ("auto", "s3", "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    good = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    return None if hmac.compare_digest(good, q["X-Amz-Signature"]) else "signature doesn't match"


def parts(url: str) -> tuple[urllib.parse.SplitResult, dict[str, str]]:
    u = urllib.parse.urlsplit(url)
    return u, dict(urllib.parse.parse_qsl(u.query))


def assert_upload_link(url: str, key: str, ctype: str, size: int) -> None:
    assert CFG
    u, q = parts(url)
    assert u.scheme == "https" and u.netloc == CFG.host
    assert urllib.parse.unquote(u.path) == f"/{CFG.bucket}/{key}"
    assert q["X-Amz-Expires"] == "300"
    assert q["X-Amz-SignedHeaders"] == "content-length;content-type;host"
    assert q["X-Amz-Credential"].split("/", 1)[0] == CFG.key_id
    assert (
        abs(
            (
                datetime.now(UTC) - datetime.strptime(q["X-Amz-Date"], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
            ).total_seconds()
        )
        < 30
    )
    assert re.fullmatch(r"[0-9a-f]{64}", q["X-Amz-Signature"])
    problem = verify(url, "PUT", {"content-type": ctype, "content-length": str(size)}, CFG.secret)
    assert problem is None, problem


# ------------------------------------------------------------------ fixtures


@pytest.fixture(scope="module")
def world():
    w = World()
    yield w
    w.close()


@pytest.fixture(scope="module")
def api():
    import index

    with TestClient(index.app) as c:
        yield c


def fake_env(monkeypatch: pytest.MonkeyPatch, values: dict[str, str], vercel_env: str | None) -> None:
    monkeypatch.setattr(storage, "env", lambda k: values.get(k, ""))
    for k in ("VERCEL", "VERCEL_ENV"):
        monkeypatch.delenv(k, raising=False)
    if vercel_env is not None:
        monkeypatch.setenv("VERCEL", "1")
        if vercel_env:
            monkeypatch.setenv("VERCEL_ENV", vercel_env)


# ------------------------------------------------------------------ settings


@needs_r2
@pytest.mark.parametrize("name", KEYS)
def test_setting_is_present(name) -> None:
    assert env(name), f"{name} is missing from .env.local"


@needs_r2
@pytest.mark.parametrize("name", KEYS)
def test_setting_has_no_stray_quotes_or_spaces(name) -> None:
    clean = not re.search(r"""^["' ]|["' ]$""", env(name))
    assert clean, f"{name} starts or ends with a quote or space"


@needs_r2
def test_account_id_is_32_hex_characters() -> None:
    ok = re.fullmatch(r"[0-9a-f]{32}", CFG.account) is not None
    assert ok, "R2_ACCOUNT_ID should be the 32-character id, not a URL"


@needs_r2
def test_access_key_id_is_32_hex_characters() -> None:
    ok = re.fullmatch(r"[0-9a-f]{32}", CFG.key_id) is not None
    assert ok, "R2_ACCESS_KEY_ID should be the 32-character Access Key ID"


@needs_r2
def test_secret_is_64_hex_characters() -> None:
    ok = re.fullmatch(r"[0-9a-f]{64}", CFG.secret) is not None
    assert ok, "R2_SECRET_ACCESS_KEY should be the 64-character Secret Access Key (not the token value)"


@needs_r2
def test_laptop_uses_the_dev_bucket() -> None:
    assert CFG.bucket == DEV_BUCKET


@needs_r2
def test_access_key_and_secret_differ() -> None:
    assert CFG.key_id != CFG.secret[:32]


@needs_r2
def test_settings_never_print_the_keys() -> None:
    shown = repr(CFG)
    assert CFG.secret not in shown and CFG.key_id not in shown


@needs_r2
def test_laptop_storage_mode_is_r2() -> None:
    assert storage.mode() == "r2"


# ------------------------------------------------------------------ mode

HOSTS = {
    "laptop": None,
    "vercel (no env)": "",
    "production": "production",
    "preview": "preview",
    "development": "development",
}


@pytest.mark.parametrize(("present", "host"), list(product(range(16), HOSTS)))
def test_storage_mode_for_every_setting_combination(monkeypatch, present, host) -> None:
    values = {k: f"v{i}" for i, k in enumerate(KEYS) if present >> i & 1}
    fake_env(monkeypatch, values, HOSTS[host])
    want = "r2" if present == 15 else ("local" if host == "laptop" else None)
    assert storage.mode() == want


# ------------------------------------------------------------------ check


class FakeHTTPError(storage.urllib.error.HTTPError):
    def __init__(self, code: int, body: str) -> None:
        super().__init__("u", code, "x", {}, None)  # type: ignore[arg-type]
        self._body = body.encode()

    def read(self, *_a) -> bytes:  # type: ignore[override]
        return self._body


ANSWERS = {
    "no such key (all good)": (FakeHTTPError(404, "<Code>NoSuchKey</Code>"), True, None),
    "no such bucket": (FakeHTTPError(404, "<Code>NoSuchBucket</Code>"), False, "no bucket called"),
    "key refused (403)": (FakeHTTPError(403, "<Code>AccessDenied</Code>"), False, "refused the access key"),
    "key refused (401)": (FakeHTTPError(401, "<Code>Unauthorized</Code>"), False, "refused the access key"),
    "bad signature": (FakeHTTPError(403, "<Code>SignatureDoesNotMatch</Code>"), False, "refused the access key"),
    "R2 error": (FakeHTTPError(500, "<Code>InternalError</Code>"), False, "answered 500"),
    "rate limited": (FakeHTTPError(429, ""), False, "answered 429"),
    "can't reach R2": (storage.urllib.error.URLError("name not resolved"), False, "Couldn't reach R2"),
    "timeout": (TimeoutError("timed out"), False, "Couldn't reach R2"),
}


@pytest.mark.parametrize("answer", ANSWERS)
@pytest.mark.parametrize("host", ["laptop", "production"])
def test_storage_check_explains_every_answer(monkeypatch, answer, host) -> None:
    exc, ok, problem = ANSWERS[answer]
    bucket = PROD_BUCKET if host == "production" else DEV_BUCKET
    fake_env(
        monkeypatch,
        {
            "R2_ACCOUNT_ID": "a" * 32,
            "R2_ACCESS_KEY_ID": "b" * 32,
            "R2_SECRET_ACCESS_KEY": "c" * 64,
            "R2_BUCKET": bucket,
        },
        None if host == "laptop" else "production",
    )

    def urlopen(req, timeout):
        assert req.get_method() == "GET" and "/healthcheck/never-exists?" in req.full_url
        raise exc

    monkeypatch.setattr(storage.urllib.request, "urlopen", urlopen)
    got = storage.check()
    assert got["ok"] is ok and got["bucket"] == bucket
    assert (got["problem"] is None) if problem is None else problem in got["problem"]
    assert "c" * 64 not in json.dumps(got) and "b" * 32 not in json.dumps(got)


PAIRINGS = list(
    product(["laptop", "production", "preview", "development"], [PROD_BUCKET, DEV_BUCKET, "gethomeapps-staging"])
)


@pytest.mark.parametrize(("host", "bucket"), PAIRINGS)
def test_storage_check_catches_the_wrong_bucket_for_the_environment(monkeypatch, host, bucket) -> None:
    fake_env(
        monkeypatch,
        {"R2_ACCOUNT_ID": "a" * 32, "R2_ACCESS_KEY_ID": "b", "R2_SECRET_ACCESS_KEY": "c", "R2_BUCKET": bucket},
        None if host == "laptop" else host,
    )
    calls = []

    def urlopen(req, timeout):
        calls.append(req)
        raise FakeHTTPError(404, "NoSuchKey")

    monkeypatch.setattr(storage.urllib.request, "urlopen", urlopen)
    got = storage.check()
    right = (host == "production") == bucket.endswith("-prod")
    assert got["ok"] is right
    assert len(calls) == (1 if right else 0), "a mismatched bucket is reported without contacting R2"


@pytest.mark.parametrize("host", ["laptop", "production", "preview"])
def test_storage_check_without_settings(monkeypatch, host) -> None:
    fake_env(monkeypatch, {}, None if host == "laptop" else host)
    got = storage.check()
    assert got["mode"] == ("local" if host == "laptop" else None)
    assert got["ok"] is (host == "laptop")
    assert host == "laptop" or "R2_ACCOUNT_ID" in got["problem"]


@pytest.mark.parametrize("who", ["admin", "epc", "own_ho", "outsider_c"])
def test_only_a_pm_can_run_the_storage_check(api, world, who) -> None:
    assert api.get("/api/py/storage/check", headers=H(world, who)).status_code == 403


def test_storage_check_needs_sign_in(api) -> None:
    assert api.get("/api/py/storage/check").status_code == 401


def test_ping_says_where_uploads_go(api) -> None:
    assert api.get("/api/py/ping").json()["storage"] == storage.mode()


# ------------------------------------------------------------------ links (through the app)

STAGES = ["work", "m1", "m2"]


@needs_r2
@pytest.mark.parametrize(("stage", "slot", "ctype"), list(product(STAGES, FILE_SLOTS, TYPES)))
def test_upload_link_for_every_slot_and_stage(api, world, monkeypatch, stage, slot, ctype) -> None:
    pid = world.p[stage]
    body = {"category": slot, "fileName": "f", "contentType": ctype, "size": 1234}
    r = api.post(f"/api/py/projects/{pid}/files/upload-link", headers=H(world, "admin"), json=body)
    # The same request with laptop storage: R2 must not change who may upload what, or when.
    with monkeypatch.context() as m:
        m.setattr(storage, "_r2", lambda: None)
        local = api.post(f"/api/py/projects/{pid}/files/upload-link", headers=H(world, "admin"), json=body)
    assert r.status_code == local.status_code
    if r.status_code != 200:
        assert "uploadUrl" not in r.json()
        return
    key = r.json()["key"]
    folder = "images" if ctype.startswith("image/") else "documents"
    assert re.fullmatch(rf"projects/{pid}/{folder}/{slot}/{UUID_RE}\.{storage.ALLOWED_TYPES[ctype]}", key)
    assert r.json()["headers"] == {"Content-Type": ctype}
    assert_upload_link(r.json()["uploadUrl"], key, ctype, 1234)


SIZES = [1, 2, 1023, 1024, MB - 1, MB, 5 * MB, 24 * MB, 25 * MB - 1, 25 * MB, 25 * MB + 1, 0, -1, 100 * MB]


@needs_r2
@pytest.mark.parametrize(("slot", "ctype", "size"), list(product(M1_SLOTS, TYPES, SIZES)))
def test_upload_link_for_every_size(api, world, slot, ctype, size) -> None:
    r = api.post(
        f"/api/py/projects/{world.p['work']}/files/upload-link",
        headers=H(world, "admin"),
        json={"category": slot, "fileName": "f", "contentType": ctype, "size": size},
    )
    if not 0 < size <= storage.MAX_BYTES:
        assert r.status_code == 400 and "uploadUrl" not in r.json()
        return
    assert r.status_code == 200
    assert_upload_link(r.json()["uploadUrl"], r.json()["key"], ctype, size)


BAD = [
    "text/html",
    "image/svg+xml",
    "application/zip",
    "text/plain",
    "image/gif",
    "application/octet-stream",
    "",
    "IMAGE/PNG",
]


@needs_r2
@pytest.mark.parametrize(("slot", "ctype"), list(product(M1_SLOTS, BAD)))
def test_no_link_for_a_disallowed_type(api, world, slot, ctype) -> None:
    r = api.post(
        f"/api/py/projects/{world.p['work']}/files/upload-link",
        headers=H(world, "admin"),
        json={"category": slot, "fileName": "f", "contentType": ctype, "size": 10},
    )
    assert r.status_code == 400 and "uploadUrl" not in r.json()


# ------------------------------------------------------------------ slots (straight from storage)


@needs_r2
@pytest.mark.parametrize(("slot", "ctype", "size"), list(product(FILE_SLOTS, TYPES, [1, 777_777, 25 * MB])))
def test_storage_signs_every_slot(slot, ctype, size) -> None:
    key = f"projects/{4242}/{slot}/{uuid.uuid4()}.{storage.ALLOWED_TYPES[ctype]}"
    assert_upload_link(storage.upload_link(key, ctype, size), key, ctype, size)


# ------------------------------------------------------------------ views

NAMES = [
    "photo.jpg",
    "GST proof.pdf",
    "Utility Bill (June 2026).pdf",
    "inverter_01.HEIC",
    "a",
    "x" * 200,
    "合同.pdf",
    "太阳能板照片.jpg",
    "Résumé façade.png",
    "Ünïcödé.webp",
    "சோலார்.pdf",
    "ソーラー.png",
    "태양광.jpg",
    "panel 🌞.jpg",
    "👍.png",
    "file with  two spaces.pdf",
    " leading space.pdf",
    "trailing space .pdf",
    "semi;colon.pdf",
    "com,ma.pdf",
    'quote"d.pdf',
    "it's.pdf",
    "back\\slash.pdf",
    "slash/name.pdf",
    "percent%20.pdf",
    "100%.pdf",
    "plus+plus.pdf",
    "hash#tag.pdf",
    "amp&ersand.pdf",
    "eq=ual.pdf",
    "q?mark.pdf",
    "tab\tname.pdf",
    "new\nline.pdf",
    "cr\rname.pdf",
    "nul\x00name.pdf",
    "<script>.pdf",
    "../../etc/passwd",
    "C:\\Windows\\x.pdf",
    "file.pdf.exe",
    ".hidden",
    "no_extension",
    "UPPER.PDF",
    "dots...pdf",
    "~tilde.pdf",
    "star*.pdf",
    "pipe|.pdf",
    "colon:.pdf",
    "brackets[1].pdf",
    "braces{x}.pdf",
    "caret^.pdf",
    "backtick`.pdf",
    "dollar$.pdf",
    "at@.pdf",
    "excl!.pdf",
    "paren(1).pdf",
    "emoji🇸🇬flag.jpg",
    "zero\u200bwidth.pdf",
    "rtl\u202eexe.pdf",
    "combining e\u0301.pdf",
    "fullwidth\uff03.pdf",
]


def assert_view_link(url: str, key: str, name: str) -> None:
    assert CFG
    u, q = parts(url)
    assert u.netloc == CFG.host and urllib.parse.unquote(u.path) == f"/{CFG.bucket}/{key}"
    assert q["X-Amz-Expires"] == "300" and q["X-Amz-SignedHeaders"] == "host"
    disp = q["response-content-disposition"]
    assert disp.startswith("inline; filename*=UTF-8''")
    encoded = disp.split("''", 1)[1]
    assert re.fullmatch(r"[A-Za-z0-9%._~/-]*", encoded), "only safe characters reach the header"
    assert urllib.parse.unquote(encoded) == name
    problem = verify(url, "GET", {}, CFG.secret)
    assert problem is None, problem


@needs_r2
@pytest.mark.parametrize("name", NAMES)
def test_view_link_keeps_the_file_name(name) -> None:
    key = f"projects/1/gst_proof/{uuid.uuid4()}.pdf"
    assert_view_link(storage.view_link(key, name), key, name)


@needs_r2
@pytest.mark.parametrize("name", NAMES)
def test_opening_a_file_through_the_app(api, world, name) -> None:
    pid = world.p["work"]
    key = f"projects/{pid}/gst_proof/{uuid.uuid4()}.pdf"
    stored = name.replace("\x00", "")  # Postgres text can't hold NUL
    fid = world.c.execute(
        "insert into project_files (project_id, category, url, file_name) "
        "values (%s, 'gst_proof', %s, %s) returning file_id",
        (pid, key, stored),
    ).fetchone()["file_id"]
    try:
        r = api.get(f"/api/py/files/{fid}", headers=H(world, "admin"), follow_redirects=False)
        assert r.status_code == 302
        assert_view_link(r.headers["location"], key, stored)
        # Someone outside the project gets no link, and isn't told the file exists.
        outsider = api.get(f"/api/py/files/{fid}", headers=H(world, "outsider_c"), follow_redirects=False)
        assert outsider.status_code == 404 and "location" not in outsider.headers
    finally:
        world.c.execute("delete from project_files where file_id = %s", (fid,))


# ------------------------------------------------------------------ binding

REF_KEY = "projects/7/panel_pictures/00000000-0000-4000-8000-000000000000.jpg"
REF = {"content-type": "image/jpeg", "content-length": "5000"}


def ref_link() -> str:
    return storage.upload_link(REF_KEY, "image/jpeg", 5000)


def swap(url: str, old: str, new: str) -> str:
    assert old in url
    return url.replace(old, new, 1)


def bump(url: str, param: str, fn) -> str:
    u, q = parts(url)
    q[param] = fn(q[param])
    return urllib.parse.urlunsplit(
        u._replace(query=urllib.parse.urlencode(q, quote_via=urllib.parse.quote, safe="-_.~"))
    )


CHANGES = {
    **{f"method {m}": (lambda u, m=m: (u, m, REF)) for m in ("GET", "HEAD", "DELETE", "POST")},
    **{f"type {t}": (lambda u, t=t: (u, "PUT", {**REF, "content-type": t})) for t in TYPES if t != "image/jpeg"},
    **{
        f"type {t}": (lambda u, t=t: (u, "PUT", {**REF, "content-type": t}))
        for t in ("text/html", "image/JPEG", "image/jpeg; x=1")
    },
    **{
        f"size {s}": (lambda u, s=s: (u, "PUT", {**REF, "content-length": s}))
        for s in ("4999", "5001", "0", "10000", "50000")
    },
    "another key": lambda u: (swap(u, "000000000000.jpg", "000000000001.jpg"), "PUT", REF),
    "another slot": lambda u: (swap(u, "/panel_pictures/", "/gst_proof/"), "PUT", REF),
    "another project": lambda u: (swap(u, "/projects/7/", "/projects/8/"), "PUT", REF),
    "another extension": lambda u: (swap(u, ".jpg?", ".pdf?"), "PUT", REF),
    "the prod bucket": lambda u: (swap(u, f"/{DEV_BUCKET}/", f"/{PROD_BUCKET}/"), "PUT", REF),
    "another account": lambda u: (swap(u, CFG.account, "f" * 32), "PUT", REF),
    "longer expiry": lambda u: (bump(u, "X-Amz-Expires", lambda v: "604800"), "PUT", REF),
    "earlier signing time": lambda u: (
        bump(u, "X-Amz-Date", lambda v: v[:-3] + ("00" if v[-3:-1] != "00" else "01") + "Z"),
        "PUT",
        REF,
    ),
    "another key id": lambda u: (bump(u, "X-Amz-Credential", lambda v: "0" * 32 + v[32:]), "PUT", REF),
    "unsigned header dropped": lambda u: (bump(u, "X-Amz-SignedHeaders", lambda v: "host"), "PUT", REF),
    "signature flipped": lambda u: (
        bump(u, "X-Amz-Signature", lambda v: ("1" if v[0] == "0" else "0") + v[1:]),
        "PUT",
        REF,
    ),
    "extra parameter": lambda u: (u + "&x-id=PutObject", "PUT", REF),
}


@needs_r2
@pytest.mark.parametrize("change", CHANGES)
def test_a_link_is_refused_for_anything_it_was_not_signed_for(change) -> None:
    url = ref_link()
    assert verify(url, "PUT", REF, CFG.secret) is None
    u, method, headers = CHANGES[change](url)
    assert verify(u, method, headers, CFG.secret) is not None


@needs_r2
def test_a_link_signed_with_another_secret_is_refused() -> None:
    assert verify(ref_link(), "PUT", REF, "0" * 64) is not None


@needs_r2
@pytest.mark.parametrize("after", [301, 600, 3600, 86400])
def test_a_link_expires_after_five_minutes(after) -> None:
    assert verify(ref_link(), "PUT", REF, CFG.secret, now=datetime.now(UTC) + timedelta(seconds=after)) == "expired"


@needs_r2
@pytest.mark.parametrize("after", [0, 60, 240, 290])
def test_a_link_works_within_five_minutes(after) -> None:
    assert verify(ref_link(), "PUT", REF, CFG.secret, now=datetime.now(UTC) + timedelta(seconds=after)) is None


@needs_r2
def test_each_link_is_signed_fresh() -> None:
    a, b = storage.upload_link(REF_KEY, "image/jpeg", 5000), storage.upload_link(REF_KEY, "image/jpeg", 5001)
    assert parts(a)[1]["X-Amz-Signature"] != parts(b)[1]["X-Amz-Signature"]


# ------------------------------------------------------------------ docs


def cors_policy() -> list[dict]:
    text = (Path(__file__).resolve().parents[1] / "docs" / "r2.md").read_text(encoding="utf8")
    return json.loads(re.search(r"```json\n(.*?)```", text, re.S).group(1))


def test_documented_cors_allows_the_live_site_and_laptop() -> None:
    assert set(cors_policy()[0]["AllowedOrigins"]) == {LIVE_ORIGIN, LAPTOP_ORIGIN}


@pytest.mark.parametrize("method", ["PUT", "GET", "HEAD"])
def test_documented_cors_allows_what_the_app_does(method) -> None:
    assert method in cors_policy()[0]["AllowedMethods"]


@pytest.mark.parametrize("method", ["DELETE", "POST"])
def test_documented_cors_allows_nothing_more(method) -> None:
    assert method not in cors_policy()[0]["AllowedMethods"]


def test_documented_cors_allows_only_the_content_type_header() -> None:
    assert [h.lower() for h in cors_policy()[0]["AllowedHeaders"]] == ["content-type"]


def test_browser_upload_sends_only_the_signed_header() -> None:
    src = (Path(__file__).resolve().parents[1] / "components" / "project-fields.tsx").read_text(encoding="utf8")
    assert 'fetch(link.uploadUrl, { method: "PUT", body: file, headers: link.headers })' in src


# ------------------------------------------------------------------ live
# Every request below goes to Cloudflare. Keep this group small.

live = pytest.mark.r2_live
STATE: dict[str, object] = {}
BODY = b"GetHomeApps R2 check \xe2\x98\x80"
LIVE_NAME = "太阳能 panel 🌞.png"


def put(c: httpx.Client, url: str, data: bytes, ctype: str) -> httpx.Response:
    return c.put(url, content=data, headers={"content-type": ctype})


@pytest.fixture(scope="module")
def r2():
    with httpx.Client(timeout=30) as c:
        yield c
    for key in STATE.get("cleanup", []):  # type: ignore[union-attr]
        storage.delete(key)


@needs_r2
@live
def test_live_storage_check_through_the_app(api, world, r2) -> None:
    pm = H(world, "pm")
    got = api.get("/api/py/storage/check", headers=pm).json()
    assert got == {"mode": "r2", "environment": "laptop", "bucket": DEV_BUCKET, "ok": True, "problem": None}


@needs_r2
@live
def test_live_upload(r2) -> None:
    key = f"healthcheck/{uuid.uuid4()}.png"
    STATE["key"] = key
    STATE["cleanup"] = [key]
    r = put(r2, storage.upload_link(key, "image/png", len(BODY)), BODY, "image/png")
    assert r.status_code == 200, r.text[:200]


@needs_r2
@live
def test_live_bucket_reports_what_arrived(r2) -> None:
    assert storage.head(STATE["key"]) == (len(BODY), "image/png")


@needs_r2
@live
def test_live_download_is_byte_identical_with_its_name(r2) -> None:
    r = r2.get(storage.view_link(STATE["key"], LIVE_NAME))
    assert r.status_code == 200 and r.content == BODY
    assert r.headers["content-type"] == "image/png"
    disp = r.headers["content-disposition"]
    assert urllib.parse.unquote(disp.split("''", 1)[1]) == LIVE_NAME


@needs_r2
@live
def test_live_bucket_is_private(r2) -> None:
    r = r2.get(f"https://{CFG.host}/{CFG.bucket}/{STATE['key']}")
    assert r.status_code in (400, 401, 403)


@needs_r2
@live
def test_live_anonymous_upload_is_refused(r2) -> None:
    r = put(r2, f"https://{CFG.host}/{CFG.bucket}/healthcheck/anon-{uuid.uuid4()}.png", BODY, "image/png")
    assert r.status_code in (400, 401, 403)


@needs_r2
@live
def test_live_bigger_file_than_signed_is_refused(r2) -> None:
    key = f"healthcheck/{uuid.uuid4()}.png"
    STATE["cleanup"].append(key)  # type: ignore[union-attr]
    r = put(r2, storage.upload_link(key, "image/png", len(BODY)), BODY + b"!", "image/png")
    assert r.status_code == 403


@needs_r2
@live
def test_live_other_type_than_signed_is_refused(r2) -> None:
    key = f"healthcheck/{uuid.uuid4()}.png"
    STATE["cleanup"].append(key)  # type: ignore[union-attr]
    r = put(r2, storage.upload_link(key, "image/png", len(BODY)), BODY, "text/html")
    assert r.status_code == 403


@needs_r2
@live
def test_live_tampered_link_is_refused(r2) -> None:
    key = f"healthcheck/{uuid.uuid4()}.png"
    STATE["cleanup"].append(key)  # type: ignore[union-attr]
    url = bump(storage.upload_link(key, "image/png", len(BODY)), "X-Amz-Expires", lambda v: "604800")
    assert put(r2, url, BODY, "image/png").status_code == 403


@needs_r2
@live
def test_live_link_for_one_key_cannot_write_another(r2) -> None:
    key = f"healthcheck/{uuid.uuid4()}.png"
    other = key.replace(".png", "-x.png")
    STATE["cleanup"] += [key, other]  # type: ignore[operator]
    url = swap(storage.upload_link(key, "image/png", len(BODY)), key, other)
    assert put(r2, url, BODY, "image/png").status_code == 403


@needs_r2
@live
def test_live_expired_link_is_refused(r2) -> None:
    key = f"healthcheck/{uuid.uuid4()}.png"
    STATE["cleanup"].append(key)  # type: ignore[union-attr]
    url = storage._sign(CFG, "PUT", key, 1, {"content-type": "image/png", "content-length": str(len(BODY))}, {})
    time.sleep(2.5)
    assert put(r2, url, BODY, "image/png").status_code == 403


@needs_r2
@live
def test_live_dev_key_cannot_touch_the_prod_bucket(r2) -> None:
    prod = storage.R2(CFG.account, CFG.key_id, CFG.secret, PROD_BUCKET)
    key = f"healthcheck/{uuid.uuid4()}.png"
    r = put(
        r2,
        storage._sign(prod, "PUT", key, 60, {"content-type": "image/png", "content-length": str(len(BODY))}, {}),
        BODY,
        "image/png",
    )
    assert r.status_code in (401, 403)
    assert r2.get(storage._sign(prod, "GET", "healthcheck/never-exists", 60, {}, {})).status_code in (401, 403)


@needs_r2
@live
def test_live_full_upload_through_the_app(api, world, r2) -> None:
    pid, slot = world.p["work"], "panel_pictures"
    lk = api.post(
        f"/api/py/projects/{pid}/files/upload-link",
        headers=H(world, "admin"),
        json={"category": slot, "fileName": LIVE_NAME, "contentType": "image/png", "size": len(BODY)},
    )
    assert lk.status_code == 200
    key = lk.json()["key"]
    STATE["cleanup"].append(key)  # type: ignore[union-attr]
    assert r2.put(lk.json()["uploadUrl"], content=BODY, headers=lk.json()["headers"]).status_code == 200
    done = api.post(
        f"/api/py/projects/{pid}/files",
        headers=H(world, "admin"),
        json={"category": slot, "key": key, "fileName": LIVE_NAME},
    )
    assert done.status_code == 200, done.text
    view = api.get(f"/api/py/files/{done.json()['id']}", headers=H(world, "own_ho"), follow_redirects=False)
    assert view.status_code == 302
    assert r2.get(view.headers["location"]).content == BODY


@needs_r2
@live
def test_live_confirming_a_file_that_never_arrived_is_refused(api, world) -> None:
    pid, slot = world.p["work"], "gst_proof"
    lk = api.post(
        f"/api/py/projects/{pid}/files/upload-link",
        headers=H(world, "admin"),
        json={"category": slot, "fileName": "x.pdf", "contentType": "application/pdf", "size": 10},
    )
    done = api.post(
        f"/api/py/projects/{pid}/files",
        headers=H(world, "admin"),
        json={"category": slot, "key": lk.json()["key"], "fileName": "x.pdf"},
    )
    assert done.status_code == 400 and "never arrived" in done.json()["error"]


CORS = [
    (DEV_BUCKET, LAPTOP_ORIGIN, True),
    (DEV_BUCKET, LIVE_ORIGIN, True),
    (DEV_BUCKET, "https://evil.example.com", False),
    (PROD_BUCKET, LIVE_ORIGIN, True),
    (PROD_BUCKET, LAPTOP_ORIGIN, False),
    (PROD_BUCKET, "https://homesapp-alpha.vercel.app.evil.com", False),
]


@needs_r2
@live
@pytest.mark.parametrize(("bucket", "origin", "allowed"), CORS)
def test_live_cors(r2, bucket, origin, allowed) -> None:
    r = r2.options(
        f"https://{CFG.host}/{bucket}/projects/1/x.png",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert (r.status_code in (200, 204) and r.headers.get("access-control-allow-origin") == origin) is allowed


@needs_r2
@live
def test_live_cleanup_leaves_nothing_behind(r2) -> None:
    for key in STATE["cleanup"]:  # type: ignore[union-attr]
        storage.delete(key)
    STATE["cleanup"] = []
    assert storage.head(STATE["key"]) is None

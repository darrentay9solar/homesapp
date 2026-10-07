"""Phone notifications: the Web Push standard, with no extra libraries.

A phone (or browser) that turned notifications on gives us a subscription:
an endpoint at its push service (Google's for Android/Chrome, Apple's for
iPhone, Mozilla's for Firefox) and two keys. To notify it we:

  1. encrypt the message for that phone only (RFC 8291, "aes128gcm"), so the
     push service carries it without being able to read it;
  2. sign a short token with our VAPID key (RFC 8292), so the push service
     knows the message comes from this app;
  3. POST it to the endpoint.

A 404 or 410 means the phone turned notifications off or the app was removed,
so the subscription is deleted. Checked against RFC 8291's worked example in
tests_py/test_alerts.py.

Settings: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (base64url, from
`npm run vapid-keys`) and VAPID_SUBJECT (mailto: an address that can be
contacted about this app). Without them, push is skipped and recorded so.
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from _lib.auth import env

RECORD_SIZE = 4096


def b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def _public_bytes(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def encrypt(
    payload: bytes,
    p256dh: str,
    auth: str,
    *,
    server_key: ec.EllipticCurvePrivateKey | None = None,
    salt: bytes | None = None,
) -> bytes:
    """RFC 8291 message encryption: one aes128gcm record for this subscription.

    ``server_key`` and ``salt`` are fresh for every message; they're
    parameters only so the RFC's worked example can be reproduced in tests.
    """
    ua_public = b64u_decode(p256dh)
    auth_secret = b64u_decode(auth)
    server_key = server_key or ec.generate_private_key(ec.SECP256R1())
    salt = salt or os.urandom(16)
    as_public = _public_bytes(server_key.public_key())
    shared = server_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public))

    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    if len(payload) > RECORD_SIZE - 17 - 86:
        raise ValueError("Push message too long.")
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)  # 0x02: the last (only) record
    header = salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public
    return header + body


# --------------------------------------------------------------------- VAPID


@dataclass(frozen=True)
class Vapid:
    private_key: ec.EllipticCurvePrivateKey
    public_key: str  # base64url, uncompressed point: what the browser subscribes with
    subject: str


def vapid() -> Vapid | None:
    priv, pub, subject = env("VAPID_PRIVATE_KEY"), env("VAPID_PUBLIC_KEY"), env("VAPID_SUBJECT")
    if not priv or not pub:
        return None
    key = ec.derive_private_key(int.from_bytes(b64u_decode(priv), "big"), ec.SECP256R1())
    if b64u(_public_bytes(key.public_key())) != pub:
        raise RuntimeError("VAPID_PUBLIC_KEY doesn't belong to VAPID_PRIVATE_KEY. Generate them as a pair.")
    return Vapid(key, pub, subject or "mailto:admin@9solarhome.sg")


def new_keys() -> tuple[str, str]:
    """A fresh (public, private) VAPID pair, base64url."""
    key = ec.generate_private_key(ec.SECP256R1())
    priv = key.private_numbers().private_value.to_bytes(32, "big")
    return b64u(_public_bytes(key.public_key())), b64u(priv)


def vapid_header(endpoint: str, v: Vapid, now: float | None = None) -> str:
    u = urllib.parse.urlsplit(endpoint)
    token = jwt.encode(
        {"aud": f"{u.scheme}://{u.netloc}", "exp": int((now or time.time()) + 12 * 3600), "sub": v.subject},
        v.private_key,
        algorithm="ES256",
    )
    return f"vapid t={token}, k={v.public_key}"


# ---------------------------------------------------------------------- send


@dataclass
class PushResult:
    status: str  # sent | gone | failed | skipped
    detail: str | None = None


def send(sub: dict[str, Any], message: dict[str, Any], *, urgent: bool = False) -> PushResult:
    """One message to one subscription ({endpoint, p256dh, auth})."""
    v = vapid()
    if not v:
        return PushResult("skipped", "push not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)")
    body = encrypt(json.dumps(message, separators=(",", ":")).encode(), sub["p256dh"], sub["auth"])
    req = urllib.request.Request(
        sub["endpoint"],
        method="POST",
        data=body,
        headers={
            "Authorization": vapid_header(sub["endpoint"], v),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(24 * 3600),
            "Urgency": "high" if urgent else "normal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8):
            return PushResult("sent")
    except urllib.error.HTTPError as exc:
        if exc.code in (404, 410):
            return PushResult("gone", f"push service answered {exc.code}")
        return PushResult("failed", f"push service answered {exc.code}: {exc.read(300).decode('utf8', 'replace')}")
    except (urllib.error.URLError, TimeoutError) as exc:
        return PushResult("failed", f"push service unreachable: {exc}")

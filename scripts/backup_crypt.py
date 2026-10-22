"""Encrypting production backups (ISO 27001 A.8.13, A.8.24): on this laptop just as in the nightly job.

The format is OpenSSL's `enc -aes-256-cbc -pbkdf2 -iter 200000 -salt` ("Salted__", 8 bytes of salt, then
AES-256-CBC with the key and IV from PBKDF2-HMAC-SHA256), so one command opens a backup from either place:

    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in FILE.tar.gz.enc -out FILE.tar.gz -pass env:BACKUP_PASSPHRASE

The passphrase is BACKUP_PASSPHRASE: the GitHub secret the nightly job uses, and the same line in .env.local
(kept in the company's password manager too). scripts/restore.py opens encrypted backups itself.
"""

from __future__ import annotations

import hashlib
import io
import os
import sys
import tarfile
from pathlib import Path

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

from _lib.db import _from_env_file  # noqa: E402

MAGIC = b"Salted__"
ITERATIONS = 200_000
SUFFIX = ".enc"


def passphrase() -> str:
    return os.environ.get("BACKUP_PASSPHRASE", "").strip() or _from_env_file("BACKUP_PASSPHRASE")


def _key_iv(secret: str, salt: bytes) -> tuple[bytes, bytes]:
    k = hashlib.pbkdf2_hmac("sha256", secret.encode(), salt, ITERATIONS, 48)
    return k[:32], k[32:]


def encrypt_bytes(data: bytes, secret: str) -> bytes:
    salt = os.urandom(8)
    key, iv = _key_iv(secret, salt)
    padder = padding.PKCS7(128).padder()
    enc = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    return MAGIC + salt + enc.update(padder.update(data) + padder.finalize()) + enc.finalize()


def decrypt_bytes(blob: bytes, secret: str) -> bytes:
    if not blob.startswith(MAGIC):
        raise ValueError("This isn't an encrypted backup.")
    key, iv = _key_iv(secret, blob[8:16])
    dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    try:
        unpadder = padding.PKCS7(128).unpadder()
        return unpadder.update(dec.update(blob[16:]) + dec.finalize()) + unpadder.finalize()
    except ValueError as exc:
        raise ValueError("BACKUP_PASSPHRASE doesn't open this backup.") from exc


def encrypt_file(path: Path, secret: str) -> Path:
    """Writes PATH.enc and removes the plain file; checks the result opens first."""
    data = path.read_bytes()
    blob = encrypt_bytes(data, secret)
    if decrypt_bytes(blob, secret) != data:
        raise RuntimeError("The encrypted copy didn't read back the same; the plain file is kept.")
    out = path.with_name(path.name + SUFFIX)
    out.write_bytes(blob)
    path.unlink()
    return out


def open_backup(file: str | Path) -> tarfile.TarFile:
    """A backup to read, encrypted (.enc) or not."""
    p = Path(file)
    if p.name.endswith(SUFFIX):
        secret = passphrase()
        if not secret:
            sys.exit("This backup is encrypted: set BACKUP_PASSPHRASE (in .env.local) to open it.")
        return tarfile.open(fileobj=io.BytesIO(decrypt_bytes(p.read_bytes(), secret)))
    return tarfile.open(p)

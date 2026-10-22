"""Tests never reach a real outside service, whatever .env.local holds (tests_py/conftest.py)."""

from __future__ import annotations

from _lib import assistant, fusionsolar
from _lib.auth import env


def test_fusionsolar_and_claude_arent_connected_in_tests() -> None:
    assert not fusionsolar.configured()
    assert not assistant.configured()
    for key in ("FUSIONSOLAR_URL", "FUSIONSOLAR_PASSWORD", "ANTHROPIC_API_KEY", "RESEND_API_KEY", "TWILIO_AUTH_TOKEN"):
        assert env(key) == ""

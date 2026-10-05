"""Mobile notifications: WhatsApp first, SMS only as a fallback, never both."""

from __future__ import annotations

import pytest

from _lib import notify
from _lib.notify import SendResult


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch):
    log: list[tuple[str, str | None]] = []

    def wa(to, _template, _params, outcome=None):
        log.append(("whatsapp", to))
        return outcome

    monkeypatch.setattr(notify, "send_sms", lambda to, _text: log.append(("sms", to)) or SendResult("sent"))
    return log, wa, monkeypatch


def test_whatsapp_delivered_means_no_sms(calls) -> None:
    log, wa, mp = calls
    mp.setattr(notify, "send_whatsapp", lambda *a: wa(*a, outcome=SendResult("sent")))
    out = notify.send_mobile("+65 9123 4567", "account_approved", ["A", "B", "C"], "text")
    assert [c for c, _ in log] == ["whatsapp"]
    assert set(out) == {"whatsapp"}
    assert log[0][1] == "6591234567"


@pytest.mark.parametrize("status", ["failed", "skipped"])
def test_whatsapp_not_delivered_falls_back_to_sms(calls, status) -> None:
    log, wa, mp = calls
    mp.setattr(notify, "send_whatsapp", lambda *a: wa(*a, outcome=SendResult(status, "x")))
    out = notify.send_mobile("9123 4567", "account_approved", [], "Hi")
    assert [c for c, _ in log] == ["whatsapp", "sms"]
    assert out["sms"].status == "sent"


def test_unconfigured_channels_are_skipped_not_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in ("WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "SMS_FROM"):
        monkeypatch.setenv(k, "")
    monkeypatch.setattr(notify, "env", lambda _k: "")
    out = notify.send_mobile("+65 9123 4567", "account_approved", [], "Hi")
    assert out["whatsapp"].status == "skipped"
    assert out["sms"].status == "skipped"
    assert "SMS skipped" in notify.describe(out)

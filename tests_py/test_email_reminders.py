""" "Email me reminders" (notification settings): reminders by email too, only when the person asks, and only
reminders (_lib/prefs.REMINDER_KINDS, _lib/notify.notify)."""

from __future__ import annotations

import json

import pytest

from _lib import notify
from _lib import prefs as prefs_mod


@pytest.fixture
def sent(monkeypatch):
    out: list[tuple[str, str, str, str]] = []

    def send(to: str, subject: str, html_body: str, text: str) -> notify.SendResult:
        out.append((to, subject, html_body, text))
        return notify.SendResult("sent", provider_id="test")

    monkeypatch.setattr(notify, "send_email", send)
    return out


def person(fx, **prefs):
    u = fx.user("epc_team", full_name="Reminder Person")
    fx.conn.execute(
        "update users set notification_prefs = %s::jsonb where uid = %s",
        (json.dumps(prefs_mod.normalise(prefs)), u["uid"]),
    )
    return u


@pytest.mark.parametrize("kind", prefs_mod.REMINDER_KINDS)
def test_a_reminder_comes_by_email_when_switched_on(fx, sent, kind) -> None:
    u = person(fx, emailReminders=True)
    got = notify.notify(u["uid"], kind, "Meeting in 30 minutes", "Site walk at Tuas, 10:00", link="/calendar?meeting=1")
    assert got["email"].status == "sent"
    to, subject, html_body, text = sent[0]
    assert to == u["email"]
    assert "Meeting in 30 minutes" in subject
    assert "Site walk at Tuas, 10:00" in text and "/calendar?meeting=1" in text
    assert "/calendar?meeting=1" in html_body


@pytest.mark.parametrize("kind", prefs_mod.REMINDER_KINDS)
def test_off_by_default(fx, sent, kind) -> None:
    u = person(fx)
    got = notify.notify(u["uid"], kind, "Reminder", "Body")
    assert "email" not in got and sent == []


def test_not_when_email_is_turned_off(fx, sent) -> None:
    u = person(fx, emailReminders=True, channels={"push": True, "email": False, "mobile": True})
    got = notify.notify(u["uid"], "meeting_reminder", "Reminder", "Body")
    assert got["email"].status == "skipped" and sent == []


def test_not_when_the_category_is_muted(fx, sent) -> None:
    u = person(fx, emailReminders=True, mute=["meetings"])
    got = notify.notify(u["uid"], "meeting_reminder", "Reminder", "Body")
    assert got["email"].status == "skipped" and sent == []


def test_only_reminders(fx, sent) -> None:
    u = person(fx, emailReminders=True)
    got = notify.notify(u["uid"], "support_message", "A reply", "Body")
    assert "email" not in got and sent == []


def test_a_reminder_with_its_own_email_keeps_it(fx, sent) -> None:
    u = person(fx, emailReminders=True)
    own = (u["email"], "Its own subject", "<p>own</p>", "own")
    notify.notify(u["uid"], "meeting_reminder", "Reminder", "Body", email=own)
    assert sent == [own]


def test_in_their_language(fx, sent) -> None:
    u = person(fx, emailReminders=True)
    fx.conn.execute("update users set language = 'zh' where uid = %s", (u["uid"],))
    notify.notify(u["uid"], "meeting_reminder", "Reminder", "Body", link="/calendar")
    assert "打开" in sent[0][2], "the button reads 打开 (Open it)"


def test_the_setting_is_kept_and_defaults_off() -> None:
    assert prefs_mod.normalise({})["emailReminders"] is False
    assert prefs_mod.normalise({"emailReminders": True})["emailReminders"] is True
    assert prefs_mod.normalise({"emailReminders": 1})["emailReminders"] is True

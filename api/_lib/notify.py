"""Notifications: in-app (with a phone notification), email (Resend) and WhatsApp (Meta Cloud API).

Both outbound channels are optional. Without their keys a send is recorded
as "skipped" with the reason, so the app works before the accounts exist and
it is obvious afterwards which messages never went out. See docs/whatsapp.md.
"""

from __future__ import annotations

import base64
import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from _lib import demo, push
from _lib import prefs as prefs_mod
from _lib.auth import env
from _lib.db import fetch_all, fetch_one, transaction
from _lib.i18n import tr

BRAND = "9 Solar Home"


@dataclass
class SendResult:
    status: str  # sent | skipped | failed
    detail: str | None = None  # reason / error
    provider_id: str | None = None

    def describe(self, label: str) -> str:
        if self.status == "sent":
            return f"{label} sent"
        if self.status == "skipped":
            return f"{label} skipped — {self.detail}"
        return f"{label} FAILED — {self.detail}"


def app_url() -> str:
    if explicit := env("APP_URL"):
        return explicit.rstrip("/")
    if os.environ.get("VERCEL_ENV") == "production" and os.environ.get("VERCEL_PROJECT_PRODUCTION_URL"):
        return f"https://{os.environ['VERCEL_PROJECT_PRODUCTION_URL']}"
    if os.environ.get("VERCEL_URL"):
        return f"https://{os.environ['VERCEL_URL']}"
    return "http://localhost:3000"


def _post_json(url: str, token: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    req = urllib.request.Request(
        url,
        method="POST",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except ValueError:
            return exc.code, {}


# ------------------------------------------------------------------ email


def send_email(to: str, subject: str, html_body: str, text: str) -> SendResult:
    key, sender = env("RESEND_API_KEY"), env("EMAIL_FROM")
    if not key or not sender:
        return SendResult("skipped", "email not configured (RESEND_API_KEY / EMAIL_FROM)")
    try:
        status, body = _post_json(
            "https://api.resend.com/emails",
            key,
            {"from": sender, "to": [to], "subject": subject, "html": html_body, "text": text},
        )
    except OSError as exc:
        return SendResult("failed", f"Resend unreachable: {exc}")
    if status >= 300:
        return SendResult("failed", f"Resend {status}: {body.get('message', 'error')}")
    return SendResult("sent", provider_id=body.get("id"))


# --------------------------------------------------------------- whatsapp


def to_whatsapp_number(raw: str | None) -> str | None:
    """'+65 9123 4567', '9123 4567', '6591234567' → '6591234567'. None if not a mobile."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if re.fullmatch(r"[89]\d{7}", digits):
        return f"65{digits}"
    if raw.strip().startswith("+") or digits.startswith("65"):
        return digits if 8 <= len(digits) <= 15 else None
    return None


def send_whatsapp(to: str | None, template: str, params: list[str], *, copy_code: str | None = None) -> SendResult:
    """A template message. ``copy_code`` fills an authentication template's copy-code button."""
    token, phone_id = env("WHATSAPP_TOKEN"), env("WHATSAPP_PHONE_NUMBER_ID")
    if not token or not phone_id:
        return SendResult("skipped", "WhatsApp not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)")
    if not to:
        return SendResult("skipped", "no usable mobile number on file")
    version = env("WHATSAPP_API_VERSION") or "v25.0"
    try:
        status, body = _post_json(
            f"https://graph.facebook.com/{version}/{phone_id}/messages",
            token,
            {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "template",
                "template": {
                    "name": template,
                    "language": {"code": env("WHATSAPP_TEMPLATE_LANG") or "en"},
                    "components": [
                        {"type": "body", "parameters": [{"type": "text", "text": p} for p in params]},
                        *(
                            [
                                {
                                    "type": "button",
                                    "sub_type": "url",
                                    "index": "0",
                                    "parameters": [{"type": "text", "text": copy_code}],
                                }
                            ]
                            if copy_code
                            else []
                        ),
                    ],
                },
            },
        )
    except OSError as exc:
        return SendResult("failed", f"WhatsApp unreachable: {exc}")
    if status >= 300:
        err = body.get("error") or {}
        return SendResult("failed", f"WhatsApp {status} ({err.get('code')}): {err.get('message', 'error')}")
    return SendResult("sent", provider_id=((body.get("messages") or [{}])[0]).get("id"))


# -------------------------------------------------------------------- sms


def send_sms(to: str | None, text: str) -> SendResult:
    """SMS through Twilio, used only when WhatsApp could not deliver.

    SMS_FROM is either a Twilio Messaging Service SID (MG...) or a sender
    name. In Singapore a sender name must be registered with SGNIC's SMS
    Sender ID Registry first, or carriers label it "Likely-SCAM" / block it.
    """
    sid, token, sender = env("TWILIO_ACCOUNT_SID"), env("TWILIO_AUTH_TOKEN"), env("SMS_FROM")
    if not sid or not token or not sender:
        return SendResult("skipped", "SMS not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / SMS_FROM)")
    if not to:
        return SendResult("skipped", "no usable mobile number on file")
    form = {"To": f"+{to}", "Body": text}
    form["MessagingServiceSid" if sender.startswith("MG") else "From"] = sender
    auth = base64.b64encode(f"{sid}:{token}".encode()).decode()
    req = urllib.request.Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
        method="POST",
        data=urllib.parse.urlencode(form).encode(),
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            body = json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            err = json.loads(exc.read() or b"{}")
        except ValueError:
            err = {}
        return SendResult("failed", f"Twilio {exc.code} ({err.get('code')}): {err.get('message', 'error')}")
    except OSError as exc:
        return SendResult("failed", f"Twilio unreachable: {exc}")
    return SendResult("sent", provider_id=body.get("sid"))


def send_mobile(raw_number: str | None, template: str, params: list[str], sms_text: str) -> dict[str, SendResult]:
    """WhatsApp first; SMS only if WhatsApp didn't go out. Never both."""
    to = to_whatsapp_number(raw_number)
    results = {"whatsapp": send_whatsapp(to, template, params)}
    if results["whatsapp"].status != "sent":
        results["sms"] = send_sms(to, sms_text)
    return results


# ------------------------------------------------------------------ links

SITE_KINDS = {"visit_assigned", "visit_reminder", "visit_missed", "crew_arrived_late"}
ACCOUNT_KINDS = {"account_created", "account_approved", "account_rejected", "role_approved", "role_rejected"}
REVIEW_KINDS = {"account_request", "role_request"}
SETTINGS_KINDS = {"location_request"}


def default_link(kind: str, project_id: int | None) -> str:
    """Where an alert takes you: the thing it's about."""
    if kind in REVIEW_KINDS:
        return "/people?tab=requests"
    if kind in SETTINGS_KINDS:
        return "/account?tab=settings"
    if kind in ACCOUNT_KINDS:
        return "/account"
    if project_id:
        return f"/projects/{project_id}#site-visits" if kind in SITE_KINDS else f"/projects/{project_id}"
    return "/alerts"


# ------------------------------------------------------------------ phones


def push_to(
    recipient_uid: int, nid: int, title: str, body: str, link: str, *, urgent: bool = False
) -> SendResult | None:
    """The alert on every phone or browser where this person turned notifications on.

    None when they have none (nothing to record). Phones that are gone are forgotten.
    """
    subs = fetch_all("select * from push_subscriptions where uid = %s", (recipient_uid,))
    if not subs:
        return None
    unread = fetch_one(
        "select count(*)::int as n from notifications where recipient_uid = %s and read_at is null",
        (recipient_uid,),
        actor_uid=recipient_uid,
    )
    message = {"id": nid, "title": title, "body": body, "url": link, "unread": unread["n"] if unread else 0}
    outcomes = []
    for sub in subs:
        r = push.send(sub, message, urgent=urgent)
        outcomes.append(r)
        with transaction(None) as cur:
            if r.status == "gone":
                cur.execute("delete from push_subscriptions where subscription_id = %s", (sub["subscription_id"],))
            elif r.status == "sent":
                cur.execute(
                    "update push_subscriptions set last_success_at = now(), failures = 0 where subscription_id = %s",
                    (sub["subscription_id"],),
                )
            elif r.status == "failed":
                cur.execute(
                    "update push_subscriptions set failures = failures + 1 where subscription_id = %s",
                    (sub["subscription_id"],),
                )
    sent = sum(r.status == "sent" for r in outcomes)
    if sent:
        return SendResult("sent", f"{sent} of {len(outcomes)} devices")
    if all(r.status == "skipped" for r in outcomes):
        return SendResult("skipped", outcomes[0].detail)
    return SendResult("failed", "; ".join(r.detail or r.status for r in outcomes if r.status != "sent")[:500])


# ------------------------------------------------------------- recording


def notify(
    recipient_uid: int,
    kind: str,
    title: str,
    body: str,
    *,
    project_id: int | None = None,
    link: str | None = None,
    urgent: bool = False,
    email: tuple[str, str, str, str] | None = None,  # (to, subject, html, text)
    mobile: tuple[str | None, str, list[str], str] | None = None,  # (number, template, params, sms text)
) -> dict[str, SendResult]:
    """Records an in-app notification, sends on each channel given, records each outcome.

    Ids come from the sequence up front rather than RETURNING: notifications
    are readable only by their recipient (row level security), and Postgres
    applies that to RETURNING too — a PM notifying someone else would be
    refused their own insert.
    """
    if demo.enabled():
        # Nothing leaves the demo: no emails, WhatsApps or texts, even to an address a visitor typed.
        email = mobile = None
    row = fetch_one("select nextval(pg_get_serial_sequence('notifications','notification_id')) as id")
    assert row is not None
    nid = int(row["id"])
    link = link or default_link(kind, project_id)
    with transaction(None) as cur:
        cur.execute(
            "insert into notifications (notification_id, recipient_uid, project_id, kind, title, body, link) "
            "values (%s, %s, %s, %s, %s, %s, %s)",
            (nid, recipient_uid, project_id, kind, title, body, link),
        )

    # The alert is always on their Alerts screen (above). Their settings decide
    # whether it also reaches their phone, inbox or WhatsApp right now.
    person = fetch_one("select language, notification_prefs from users where uid = %s", (recipient_uid,)) or {}
    lang = person.get("language") or "en"
    settings = person.get("notification_prefs") or {}
    why = prefs_mod.silenced(settings, kind)
    off = lambda ch: SendResult("skipped", why or f"{ch} turned off in their settings")  # noqa: E731

    results: dict[str, SendResult] = {}
    try:
        if why or not prefs_mod.channel_on(settings, "push"):
            if fetch_one("select 1 from push_subscriptions where uid = %s", (recipient_uid,)):
                results["push"] = off("phone notifications")
        elif (pushed := push_to(recipient_uid, nid, tr(title, lang), tr(body, lang), link, urgent=urgent)) is not None:
            results["push"] = pushed
    except Exception as exc:  # a phone must never stop the alert itself
        results["push"] = SendResult("failed", f"push error: {exc}")
    if email:
        results["email"] = off("email") if why or not prefs_mod.channel_on(settings, "email") else send_email(*email)
    if mobile:
        if why or not prefs_mod.channel_on(settings, "mobile"):
            results["whatsapp"] = off("WhatsApp and SMS")
        else:
            results.update(send_mobile(*mobile))
    if results:
        with transaction(None) as cur:
            for channel, r in results.items():
                cur.execute(
                    "insert into notification_deliveries "
                    "(notification_id, channel, status, sent_at, failed_at, error, provider_message_id) "
                    "values (%s, %s, %s, case when %s then now() end, case when %s then now() end, %s, %s)",
                    (nid, channel, r.status, r.status == "sent", r.status == "failed", r.detail, r.provider_id),
                )
    return results


def describe(results: dict[str, SendResult]) -> str:
    label = {"email": "Email", "whatsapp": "WhatsApp", "sms": "SMS", "push": "Phone notification"}
    parts = [r.describe(label[ch]) for ch, r in results.items()]
    return " · ".join(parts)


# --------------------------------------------------------------- wording
# WhatsApp template names and parameter order must match what Meta approved
# (docs/whatsapp.md). Edit both together.


def email_shell(heading: str, paragraphs: list[str], cta: tuple[str, str] | None = None) -> tuple[str, str]:
    e = html.escape
    rows = "".join(
        f'<tr><td style="font-size:15px;line-height:1.55;color:#c4cfc7;padding:6px 0">{e(p)}</td></tr>'
        for p in paragraphs
    )
    button = ""
    if cta:
        label, url = cta
        button = (
            f'<tr><td style="padding:20px 0 4px"><a href="{e(url)}" style="display:inline-block;'
            f"background:#16c47f;color:#06120a;font-weight:700;text-decoration:none;padding:12px 20px;"
            f'border-radius:10px">{e(label)}</a></td></tr>'
            f'<tr><td style="font-size:12px;color:#7d8a80;padding-top:10px;word-break:break-all">'
            f"Or open: {e(url)}</td></tr>"
        )
    body = (
        '<!doctype html><html><body style="margin:0;background:#000000;'
        'font-family:-apple-system,Segoe UI,Roboto,sans-serif">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">'
        '<tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:520px;background:#0e1011;border-radius:14px;padding:28px;color:#e8efe9">'
        f'<tr><td style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#16c47f;'
        f'font-weight:700">{BRAND}</td></tr>'
        f'<tr><td style="font-size:22px;font-weight:700;padding:10px 0 6px">{e(heading)}</td></tr>'
        f"{rows}{button}</table></td></tr></table></body></html>"
    )
    text = "\n".join([heading, "", *paragraphs, *(["", f"{cta[0]}: {cta[1]}"] if cta else []), "", f"— {BRAND}"])
    return body, text


def msg_account_created(name: str, role: str, url: str) -> dict[str, Any]:
    h, t = email_shell(
        "Your GetHomeApps account is ready",
        [
            f"Hi {name},",
            f"{BRAND} has created a GetHomeApps account for you as {role}.",
            "Use the button below to set your password and sign in. The link is personal to you — "
            "please don't forward it.",
        ],
        ("Set up my account", url),
    )
    return {
        "email": (f"{BRAND}: your GetHomeApps account ({role})", h, t),
        "whatsapp": ("account_created", [name, role, url]),
        "sms": f"{BRAND}: Hi {name}, your GetHomeApps account ({role}) is ready. Set it up: {url}",
        "title": "Welcome to GetHomeApps",
        "body": f"Your account was created as {role}.",
    }


def msg_account_requested(requester: str, email: str, role: str, url: str) -> dict[str, Any]:
    h, t = email_shell(
        "New account request",
        [f"{requester} ({email}) has asked for a GetHomeApps account as {role}.", "Review it to approve or decline."],
        ("Review request", url),
    )
    return {
        "email": (f"{BRAND}: account request from {requester}", h, t),
        "title": "New account request",
        "body": f"{requester} asked to join as {role}.",
    }


def msg_account_approved(name: str, role: str, url: str) -> dict[str, Any]:
    h, t = email_shell(
        "Your account has been approved",
        [f"Hi {name},", f"Your GetHomeApps account request has been approved. You're set up as {role}."],
        ("Open GetHomeApps", url),
    )
    return {
        "email": (f"{BRAND}: account approved", h, t),
        "whatsapp": ("account_approved", [name, role, url]),
        "sms": f"{BRAND}: Hi {name}, your GetHomeApps account is approved. You're set up as {role}. {url}",
        "title": "Account approved",
        "body": f"You're set up as {role}.",
    }


def msg_account_rejected(name: str, note: str | None) -> dict[str, Any]:
    h, t = email_shell(
        "About your account request",
        [
            f"Hi {name},",
            "Your request for a GetHomeApps account wasn't approved.",
            *([f"Note from {BRAND}: {note}"] if note else []),
            f"If you think this is a mistake, please contact your {BRAND} project manager.",
        ],
    )
    return {
        "email": (f"{BRAND}: account request", h, t),
        "whatsapp": ("account_rejected", [name]),
        "sms": f"{BRAND}: Hi {name}, your GetHomeApps account request wasn't approved."
        + (f" Note: {note}" if note else "")
        + " Please contact your project manager.",
    }


def msg_role_requested(name: str, from_role: str, to_role: str, reason: str | None, url: str) -> dict[str, Any]:
    h, t = email_shell(
        "Role change request",
        [
            f"{name} has asked to change their role from {from_role} to {to_role}.",
            *([f"Their reason: {reason}"] if reason else []),
            "Review it to approve or decline.",
        ],
        ("Review request", url),
    )
    return {
        "email": (f"{BRAND}: {name} asked to become {to_role}", h, t),
        "title": "Role change request",
        "body": f"{name} asked to change from {from_role} to {to_role}.",
    }


def msg_role_decided(name: str, role: str, approved: bool, note: str | None, url: str) -> dict[str, Any]:
    if approved:
        lines = [f"Hi {name},", f"Your role has been changed to {role}."]
        title, sms = "Role changed", f"{BRAND}: Hi {name}, your GetHomeApps role is now {role}. {url}"
    else:
        lines = [
            f"Hi {name},",
            f"Your request to become {role} wasn't approved.",
            *([f"Note from {BRAND}: {note}"] if note else []),
        ]
        title = "Role request declined"
        sms = f"{BRAND}: Hi {name}, your request to become {role} wasn't approved." + (f" Note: {note}" if note else "")
    h, t = email_shell(title, lines, ("Open GetHomeApps", url))
    return {
        "email": (f"{BRAND}: {title.lower()}", h, t),
        "whatsapp": ("role_changed" if approved else "role_declined", [name, role]),
        "sms": sms,
        "title": title,
        "body": f"You're now {role}." if approved else f"Your request to become {role} wasn't approved.",
    }

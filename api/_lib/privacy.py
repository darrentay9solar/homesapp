"""Personal data under Singapore's PDPA: the notice people agree to, and a copy of their own data.

VERSION names the privacy notice now shown at /privacy (app/privacy/page.tsx).
Change both together: a new version asks everyone to read it again.

``my_data(uid)`` is what "Download my data" gives a person: what the app holds
about them, readable, without other people's details or anything that would
let someone into their account (sign-in ids, codes, device keys). The last
four characters of their NRIC are left out, as everywhere in the browser; a
person asks the Data Protection Officer for those.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from _lib.db import fetch_all, fetch_one

VERSION = "2026-10-15"

# Never in the download: ways into the account, other systems' ids, our own storage keys.
HIDDEN = {
    "clerk_user_id",
    "clerk_invitation_id",
    "ic_last4",
    "avatar_key",
    "is_demo",
    "code_hash",
    "endpoint",
    "p256dh",
    "auth",
    "proof_key",
    "check_key",
}


def _plain(v: Any) -> Any:
    if isinstance(v, datetime | date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, list | tuple):
        return [_plain(x) for x in v]
    return v


def _rows(sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    # Read as the person, so the database shows them what it would show them anywhere else.
    rows = fetch_all(sql, params, actor_uid=params["me"])  # type: ignore[arg-type]
    return [{k: _plain(v) for k, v in r.items() if k not in HIDDEN} for r in rows]


def my_data(uid: int) -> dict[str, Any]:
    p = {"me": uid}
    user = fetch_one("select * from users where uid = %(me)s", p, actor_uid=uid)  # type: ignore[arg-type]
    if not user:
        return {}
    profile = {k: _plain(v) for k, v in user.items() if k not in HIDDEN}
    return {
        "about": "Your personal data held by 9 Solar Home in GetHomeApps, as of the time below.",
        "createdAt": datetime.now().astimezone().isoformat(),
        "privacyNoticeVersion": VERSION,
        "profile": profile,
        "accessRequests": _rows(
            "select requested_type, full_name, email, contact_no, address, postal_code, note, status, "
            "created_at, decided_at, decision_note, language, privacy_accepted_at, privacy_version "
            "from account_requests where granted_uid = %(me)s or (clerk_user_id is not null and "
            "clerk_user_id = (select clerk_user_id from users where uid = %(me)s)) order by created_at",
            p,
        ),
        "roleRequests": _rows(
            "select from_type, requested_type, reason, status, created_at, decided_at, decision_note "
            "from role_change_requests where uid = %(me)s order by created_at",
            p,
        ),
        "homes": _rows(
            "select project_code, name, address, postal_code, salutation, homeowner_name, homeowner_contact_no, "
            "homeowner_email, status, current_stage, signed_on, solar_plan, rate_per_kwh, ppa_kind, ppa_years, "
            "installation_start_date, installation_end_date, commission_date, created_at, closed_at "
            "from projects where homeowner_id = %(me)s order by created_at",
            p,
        ),
        "systems": _rows(
            "select project_code, address, postal_code, salutation, homeowner_name, homeowner_contact_no, "
            "homeowner_email, solar_plan, rate_per_kwh, ppa_kind, ppa_years, plan_years, panels, kwp, "
            "turned_on_on, (select coalesce(jsonb_agg(jsonb_build_object('year', c.year, 'doneOn', c.done_on) "
            "order by c.year), '[]') "
            "from maintenance_checks c where c.system_id = maintenance_systems.system_id) as yearly_checks_done, "
            "created_at "
            "from maintenance_systems where homeowner_id = %(me)s order by created_at",
            p,
        ),
        "invoices": _rows(
            "select number, kind, period, kwh, rate, amount, bill_to, bill_address, bill_email, issued_on, "
            "due_on, status, paid_on, paid_amount, paid_via, paid_ref, proof_at, proof_note "
            "from invoices where homeowner_id = %(me)s order by issued_on, number",
            p,
        ),
        "meetings": _rows(
            "select m.title, m.kind, m.starts_at, m.ends_at, m.place, m.location, m.postal_code, m.notes, "
            "(m.organiser_id = %(me)s) as organiser, mp.response, mp.responded_at, m.cancelled_at "
            "from meetings m left join meeting_people mp on mp.meeting_id = m.meeting_id and mp.user_id = %(me)s "
            "where m.organiser_id = %(me)s or mp.user_id = %(me)s order by m.starts_at",
            p,
        ),
        "busyTimes": _rows(
            "select starts_at, ends_at, note, created_at from calendar_blocks where user_id = %(me)s "
            "order by starts_at",
            p,
        ),
        "signatures": _rows(
            "select pr.project_code, s.signer_name, s.signed_at, s.signed_ip, s.signed_user_agent "
            "from project_signatures s left join projects pr on pr.project_id = s.project_id "
            "where s.signed_by = %(me)s order by s.signed_at",
            p,
        ),
        "siteCheckIns": _rows(
            "select pr.project_code, c.checked_in_at, c.lat, c.lng, c.accuracy_m, c.distance_m, c.checked_out_at, "
            "c.checkout_lat, c.checkout_lng, c.checkout_accuracy_m, c.checkout_distance_m "
            "from site_check_ins c left join projects pr on pr.project_id = c.project_id "
            "where c.user_id = %(me)s order by c.checked_in_at",
            p,
        ),
        "filesUploaded": _rows(
            "select pr.project_code, f.category, f.kind, f.file_name, f.content_type, f.size_bytes, f.uploaded_at "
            "from project_files f left join projects pr on pr.project_id = f.project_id "
            "where f.uploaded_by = %(me)s order by f.uploaded_at",
            p,
        ),
        # Staff's uploads not on a project yet (My Files → Unassigned, migration 0048).
        "filesNotOnAProject": _rows(
            "select file_name, kind, content_type, size_bytes, note, uploaded_at from unassigned_files "
            "where uploaded_by = %(me)s order by uploaded_at",
            p,
        ),
        "supportMessages": _rows(
            "select t.subject, m.body, m.created_at from support_messages m join support_threads t "
            "on t.thread_id = m.thread_id where m.sender_uid = %(me)s and m.kind <> 'event' order by m.created_at",
            p,
        ),
        "notifications": _rows(
            "select kind, title, body, link, created_at, read_at from notifications "
            "where recipient_uid = %(me)s order by created_at",
            p,
        ),
        "devices": _rows(
            "select user_agent, created_at, last_success_at from push_subscriptions where uid = %(me)s",
            p,
        ),
        "verificationCodes": _rows(
            "select purpose, channel, created_at, consumed_at from verification_codes where uid = %(me)s "
            "order by created_at",
            p,
        ),
    }

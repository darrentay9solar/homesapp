"""Who may manage whom (migration 0028 enforces the same in the database).

superadmin       everything: every project, every page, every account
                 except superadmins', which exist only in the database
project manager  their own projects, and every account except project
                 managers' and superadmins'
"""

from __future__ import annotations

from fastapi import HTTPException

from _lib.account import Account

ADMIN = ("project_manager", "superadmin")


def is_admin(acct: Account) -> bool:
    return acct.role in ADMIN


def is_super(acct: Account) -> bool:
    return acct.role == "superadmin"


def may_manage(acct: Account, *roles: str | None) -> None:
    """Refuses unless ``acct`` may create, change or grant an account with these roles (current and new)."""
    if "superadmin" in roles:
        raise HTTPException(403, "Superadmin accounts are managed directly in the database.")
    if "project_manager" in roles and not is_super(acct):
        raise HTTPException(403, "Only a superadmin can create or change project manager accounts.")

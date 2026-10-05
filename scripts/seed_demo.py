"""Loads the HTML prototype's demo people and groups into the DEVELOPMENT database.

    .venv/Scripts/python.exe scripts/seed_demo.py

Idempotent: matched by email, so running it twice changes nothing. Refuses
to run against production. Emails use example.com so a seeded account can
never send a real person a message. Projects are added by the Projects
function's seed step.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import psycopg
from psycopg.rows import dict_row

from _lib.db import _from_env_file

PEOPLE = [
    # (full name, role, email, mobile, groups)
    ("Charlotte Sim", "project_manager", "charlotte.demo@example.com", "+65 9001 2201", []),
    ("Priya Nair", "contractor", "priya.demo@example.com", "+65 9001 2202", ["Apex Solar Contractors", "Kim Seng M&E Services"]),
    ("Ravi Kumar", "epc_team", "ravi.demo@example.com", "+65 9001 2203", ["Apex Solar Contractors"]),
    ("Jasmine Lee", "homeowner", "jasmine.demo@example.com", "+65 9123 4477", []),
    ("Daniel Ong", "homeowner", "daniel.demo@example.com", "+65 8877 2210", []),
    ("Farah Ismail", "homeowner", "farah.demo@example.com", "+65 9004 1188", []),
    ("Marcus Teo", "homeowner", "marcus.demo@example.com", "+65 9330 5521", []),
]
GROUPS = ["Apex Solar Contractors", "Kim Seng M&E Services"]


def main() -> None:
    url = _from_env_file("MIGRATION_DATABASE_URL")
    if not url:
        sys.exit("MIGRATION_DATABASE_URL is not set in .env.local")
    prod = _from_env_file("PROD_MIGRATION_DATABASE_URL")
    if prod and psycopg.conninfo.conninfo_to_dict(url)["host"] == psycopg.conninfo.conninfo_to_dict(prod)["host"]:
        sys.exit("Refusing: MIGRATION_DATABASE_URL points at production.")

    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        gid: dict[str, int] = {}
        for name in GROUPS:
            row = c.execute("select group_id from contractor_groups where name = %s", (name,)).fetchone()
            if not row:
                row = c.execute("insert into contractor_groups (name) values (%s) returning group_id", (name,)).fetchone()
            gid[name] = row["group_id"]

        for full_name, role, email, mobile, groups in PEOPLE:
            row = c.execute("select uid from users where lower(email) = %s", (email,)).fetchone()
            if not row:
                row = c.execute(
                    "insert into users (full_name, user_type, email, contact_no) values (%s,%s,%s,%s) returning uid",
                    (full_name, role, email, mobile),
                ).fetchone()
                print(f"  + {full_name} ({role})")
            for g in groups:
                c.execute(
                    "insert into contractor_group_members (group_id, user_id) values (%s, %s) on conflict do nothing",
                    (gid[g], row["uid"]),
                )
    print("Demo people and groups are in the development database.")


if __name__ == "__main__":
    main()

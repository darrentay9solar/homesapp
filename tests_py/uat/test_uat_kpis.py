"""UAT: the KPI page's figures (the business's amounts) go to superadmins and Admin, and to nobody else."""

from __future__ import annotations

import pytest

from uat import spec

pytestmark = pytest.mark.uat


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_sees_the_businesss_figures(api, world, actor) -> None:
    r = api.get("/api/py/kpis", headers=world.h(actor))
    sees = actor != "inactive" and spec.ROLE[actor] in ("superadmin", "finance")
    assert r.status_code == (200 if sees else 403), r.text
    if sees:
        f = r.json()
        assert {"portfolio", "generation", "revenue", "customers", "operations", "checks"} <= set(f)
        assert "homeowner" not in str(f).lower(), "totals only, no one's own figures"

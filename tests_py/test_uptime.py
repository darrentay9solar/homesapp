"""The uptime check's address, and where browsers report what the content security policy would block."""

from __future__ import annotations


def test_health_says_the_app_and_database_answer(client) -> None:
    r = client.get("/api/py/health")
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["database"] == "ok"
    assert set(r.json()) == {"ok", "database", "ms"}  # nothing else about the system


def test_health_says_when_the_database_doesnt(client, monkeypatch) -> None:
    import index

    def down(*_a, **_k):
        raise RuntimeError("quota")

    monkeypatch.setattr(index, "fetch_one", down)
    r = client.get("/api/py/health")
    assert r.status_code == 503 and r.json() == {"ok": False, "database": "unavailable"}


def test_csp_reports_are_taken_without_their_query_strings(client, capsys) -> None:
    report = {
        "csp-report": {
            "violated-directive": "script-src",
            "blocked-uri": "https://evil.example/x.js?email=someone@example.com",
            "document-uri": "https://app.example/projects/1?q=Tan",
        }
    }
    assert client.post("/api/py/csp-report", json=report).status_code == 204
    out = capsys.readouterr().out
    assert "script-src blocked https://evil.example/x.js on https://app.example/projects/1" in out
    assert "someone@example.com" not in out and "Tan" not in out
    assert client.post("/api/py/csp-report", content=b"not json").status_code == 204

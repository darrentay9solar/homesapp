import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type AuditEntry,
  canRevert,
  contributors,
  dayKey,
  dayName,
  fieldLabel,
  formatValue,
  groupSessions,
  groupTimeline,
  matchesEntry,
  type FieldHistory,
  reasonOk,
  type Refs,
  revertVerb,
  versionList,
} from "../lib/client/audit";

const refs: Refs = { users: { "3": "Priya Nair" }, groups: { "1": "Apex Solar Contractors" }, retailers: { "2": "Geneco" } };

let next = 1;
function entry(over: Partial<AuditEntry> & { at: string }): AuditEntry {
  return {
    id: next++,
    action: "update",
    table: "projects",
    page: "projects",
    summary: "Updated project details",
    actor: { uid: 1, name: "Wei Ming Tan", role: "project_manager", roleLabel: "Project Manager" },
    location: { key: "project:101", kind: "project", id: 101, label: "Jalan Kayu Residence" },
    changes: [{ field: "panel_quantity_actual", from: 18, to: 20, state: "current", note: null }],
    revertsId: null,
    restoresId: null,
    reason: null,
    operationId: null,
    revertedBy: [],
    lockedReason: null,
    rowUndo: null,
    ...over,
  };
}
const priya = { uid: 3, name: "Priya Nair", role: "contractor" as const, roleLabel: "Contractor Admin" };

describe("labels", () => {
  it("names known fields the way the screens do", () => {
    assert.equal(fieldLabel("panel_quantity_actual"), "Panel quantity (actual)");
    assert.equal(fieldLabel("user_type"), "Role");
    assert.equal(fieldLabel("contact_no"), "Mobile");
  });
  it("falls back to sentence case, dropping _id", () => {
    assert.equal(fieldLabel("some_new_column"), "Some new column");
    assert.equal(fieldLabel("visit_id"), "Visit");
  });
});

describe("values", () => {
  it("shows empty, booleans and hidden values in words", () => {
    assert.equal(formatValue("address", null), "empty");
    assert.equal(formatValue("address", ""), "empty");
    assert.equal(formatValue("active", false), "No");
    assert.equal(formatValue("waterproofing", true), "Yes");
    assert.equal(formatValue("ic_last4", "<redacted>"), "hidden");
  });
  it("turns ids into names, with a fallback", () => {
    assert.equal(formatValue("user_id", 3, refs), "Priya Nair");
    assert.equal(formatValue("homeowner_id", 99, refs), "Person #99");
    assert.equal(formatValue("contractor_group_id", 1, refs), "Apex Solar Contractors");
    assert.equal(formatValue("electricity_retailer_id", 2, refs), "Geneco");
  });
  it("writes dates and times as people in Singapore do", () => {
    assert.equal(formatValue("sp_submission_date", "2026-07-13"), "13 Jul 2026");
    // 01:30 UTC is 09:30 in Singapore.
    assert.equal(formatValue("checked_in_at", "2026-07-11T01:30:00+00:00"), "11 Jul 2026 09:30");
  });
  it("spells out roles, SP status, milestones and statuses", () => {
    assert.equal(formatValue("user_type", "epc_team"), "EPC Team");
    assert.equal(formatValue("sp_application_status", 1), "Submitted to LEW");
    assert.equal(formatValue("sp_application_status", 3), "Not yet");
    assert.equal(formatValue("milestone_no", 2), "Milestone 2");
    assert.equal(formatValue("status", "awaiting_signature"), "Awaiting signature");
  });
  it("formats sizes and plain numbers", () => {
    assert.equal(formatValue("size_bytes", 2_621_440), "2.5 MB");
    assert.equal(formatValue("size_bytes", 300), "1 KB");
    assert.equal(formatValue("panel_capacity", 12500), "12,500");
  });
});

describe("days", () => {
  it("files an entry under its Singapore date, not UTC's", () => {
    // 20:00 UTC on the 4th is 04:00 on the 5th in Singapore.
    assert.equal(dayKey("2026-10-04T20:00:00Z"), "2026-10-05");
    assert.equal(dayKey("2026-10-04T15:59:00Z"), "2026-10-04");
  });
  it("calls days Today, Yesterday, then by weekday", () => {
    const now = new Date("2026-10-05T04:00:00Z");
    assert.equal(dayName("2026-10-05", now), "Today");
    assert.equal(dayName("2026-10-04", now), "Yesterday");
    assert.equal(dayName("2026-10-01", now), "Thu");
  });
});

describe("timeline", () => {
  const es = [
    entry({ at: "2026-10-05T03:00:00Z" }),
    entry({ at: "2026-10-05T02:00:00Z", actor: priya }),
    entry({ at: "2026-10-05T01:00:00Z", location: { key: "person:7", kind: "person", id: 7, label: "Farah Ismail" }, page: "people" }),
    entry({ at: "2026-10-04T05:00:00Z" }),
  ];
  const days = groupTimeline(es);

  it("puts the newest day first, with one card per place per day", () => {
    assert.deepEqual(days.map((d) => d.key), ["2026-10-05", "2026-10-04"]);
    assert.deepEqual(days[0].cards.map((c) => c.location.label), ["Jalan Kayu Residence", "Farah Ismail"]);
    assert.equal(days[0].count, 3);
    assert.equal(days[1].cards.length, 1);
  });
  it("lists everyone who changed a place, so a shared place can be highlighted", () => {
    const shared = days[0].cards[0];
    assert.deepEqual(shared.people.map((p) => p.name).sort(), ["Priya Nair", "Wei Ming Tan"]);
    assert.equal(days[0].cards[1].people.length, 1);
  });
  it("keeps each card's entries newest first", () => {
    const card = days[0].cards[0];
    assert.ok(card.entries[0].at > card.entries[1].at);
    assert.equal(card.latest, card.entries[0].at);
  });
  it("orders contributors by how much they changed", () => {
    const c = contributors([entry({ at: "2026-10-05T01:00:00Z", actor: priya }), entry({ at: "2026-10-05T02:00:00Z", actor: priya }), entry({ at: "2026-10-05T03:00:00Z" })]);
    assert.deepEqual(c.map((x) => [x.name, x.count]), [["Priya Nair", 2], ["Wei Ming Tan", 1]]);
  });
  it("counts changes made outside the app under one heading", () => {
    const c = contributors([entry({ at: "2026-10-05T01:00:00Z", actor: null })]);
    assert.equal(c[0].name, "Outside the app");
  });
});

describe("sessions", () => {
  it("joins back-to-back changes to one place into one session", () => {
    const s = groupSessions([
      entry({ at: "2026-10-05T03:00:00Z" }),
      entry({ at: "2026-10-05T02:45:00Z" }),
      entry({ at: "2026-10-05T02:20:00Z" }),
    ]);
    assert.equal(s.length, 1);
    assert.equal(s[0].entries.length, 3);
    assert.equal(s[0].start, "2026-10-05T02:20:00Z");
    assert.equal(s[0].end, "2026-10-05T03:00:00Z");
  });
  it("starts a new session after a long gap, at a new place, or on a new day", () => {
    const other = { key: "group:1", kind: "group" as const, id: 1, label: "Apex" };
    const s = groupSessions([
      entry({ at: "2026-10-05T05:00:00Z" }),
      entry({ at: "2026-10-05T03:00:00Z" }), // 2 h gap
      entry({ at: "2026-10-05T02:55:00Z", location: other }), // new place
      entry({ at: "2026-10-04T15:50:00Z", location: other }), // previous Singapore day
    ]);
    assert.equal(s.length, 4);
  });
});

describe("search", () => {
  const e = entry({ at: "2026-10-05T03:00:00Z", actor: priya });
  it("finds by person, place, page, field and values", () => {
    for (const q of ["priya", "jalan kayu", "projects", "panel quantity", "18", "20", "contractor admin"]) {
      assert.ok(matchesEntry(e, q, refs), q);
    }
  });
  it("needs every word to match", () => {
    assert.ok(matchesEntry(e, "priya jalan"));
    assert.ok(!matchesEntry(e, "priya bedok"));
  });
  it("ignores case, accents and extra spaces; empty matches all", () => {
    assert.ok(matchesEntry(e, "  PRÍYA   "));
    assert.ok(matchesEntry(e, ""));
  });
  it("matches names that ids were turned into", () => {
    const m = entry({ at: "2026-10-05T03:00:00Z", changes: [{ field: "user_id", from: null, to: 3, state: "current", note: null }] });
    assert.ok(matchesEntry(m, "priya", refs));
    assert.ok(!matchesEntry(m, "priya"));
  });
});

describe("revert and restore", () => {
  it("is offered while any line is still current", () => {
    assert.ok(canRevert(entry({ at: "2026-10-05T03:00:00Z" })));
    assert.ok(
      !canRevert(entry({ at: "2026-10-05T03:00:00Z", changes: [{ field: "a", from: 1, to: 2, state: "superseded", note: null }] }))
    );
  });
  it("names row actions the way the server does", () => {
    const added = entry({ at: "2026-10-05T03:00:00Z", action: "insert", rowUndo: { verb: "Remove again", kind: "revert", state: "current" } });
    const gone = entry({ at: "2026-10-05T03:00:00Z", action: "delete", rowUndo: { verb: "Restore", kind: "restore_record", state: "reverted" } });
    assert.equal(revertVerb(added), "Remove again");
    assert.equal(revertVerb(gone), "Restore");
    assert.equal(revertVerb(entry({ at: "2026-10-05T03:00:00Z" })), "Revert");
    assert.ok(canRevert(added));
    assert.ok(!canRevert(gone));
  });
  it("needs a real reason", () => {
    assert.ok(!reasonOk(""));
    assert.ok(!reasonOk("   typo    "));
    assert.ok(reasonOk("Wrong panel count entered"));
  });
});

describe("version history", () => {
  const actor = { uid: 1, name: "Wei Ming Tan", role: "project_manager" as const };
  const v = (id: number, value: unknown, deleted = false) => ({
    id, at: `2026-10-0${id}T01:00:00Z`, actor, deleted, value, reason: null, revertsId: null, restoresId: null,
  }); // prettier-ignore
  const h = (over: Partial<FieldHistory>): FieldHistory => ({
    field: "full_name", table: "users", location: "Jasmine Lee", exists: true, current: "C",
    lockedReason: null, versions: [v(3, "C"), v(2, "B"), v(1, "A")], refs, ...over,
  }); // prettier-ignore

  it("marks the value it holds now, and offers the others", () => {
    const list = versionList(h({}));
    assert.deepEqual(list.map((x) => [x.value, x.current, x.restorable]), [["C", true, false], ["B", false, true], ["A", false, true]]);
  });
  it("marks only the newest match when a value repeats", () => {
    const list = versionList(h({ current: "A", versions: [v(3, "A"), v(2, "B"), v(1, "A")] }));
    assert.deepEqual(list.map((x) => x.current), [true, false, false]);
    assert.equal(list[2].restorable, true);
  });
  it("offers nothing when the field is locked or the record is gone", () => {
    assert.ok(versionList(h({ lockedReason: "Set by the system." })).every((x) => !x.restorable));
    assert.ok(versionList(h({ exists: false })).every((x) => !x.restorable && !x.current));
  });
  it("keeps deletions in the history without offering them", () => {
    const list = versionList(h({ versions: [v(3, "C"), v(2, null, true), v(1, "A")] }));
    assert.equal(list[1].deleted, true);
    assert.equal(list[1].restorable, false);
  });
});

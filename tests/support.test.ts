/**
 * Support, as people read it: `npm run test:web`.
 *
 *   tabs      Waiting, In progress, With the assistant, Settled, All
 *   wording   a status in the asker's words, and in a manager's
 *   days      a day label wherever the day changes (Singapore time)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inTab, type Message, statusText, statusTone, type ThreadSummary, withDays } from "../lib/client/support";

function thread(id: number, status: ThreadSummary["status"]): ThreadSummary {
  return {
    id, subject: `Q${id}`, status, statusLabel: status, project: null, openedBy: { uid: 1, name: "A", role: "homeowner" },
    handledBy: null, askedAt: null, answeredAt: null, settledAt: null, createdAt: "2026-10-14T01:00:00Z", mine: true,
  };
}

describe("tabs", () => {
  const all = [thread(1, "waiting"), thread(2, "open"), thread(3, "assistant"), thread(4, "settled"), thread(5, "waiting")];
  it("waiting holds the people waiting for a first answer", () => assert.deepEqual(inTab(all, "waiting").map((t) => t.id), [1, 5]));
  it("each status has its tab", () => {
    assert.deepEqual(inTab(all, "open").map((t) => t.id), [2]);
    assert.deepEqual(inTab(all, "assistant").map((t) => t.id), [3]);
    assert.deepEqual(inTab(all, "settled").map((t) => t.id), [4]);
  });
  it("all is everything", () => assert.equal(inTab(all, "all").length, 5));
});

describe("wording", () => {
  it("the asker reads it as about their project manager", () => {
    assert.equal(statusText("waiting", false), "Waiting for your project manager");
    assert.equal(statusText("open", false), "Your project manager is on it");
  });
  it("a manager reads it plainly", () => {
    assert.equal(statusText("waiting", true), "Waiting for a person");
    assert.equal(statusText("open", true), "In progress");
  });
  it("waiting is the one that stands out", () => {
    assert.equal(statusTone("waiting"), "warning");
    assert.equal(statusTone("settled"), "success");
  });
});

describe("days", () => {
  const m = (id: number, at: string): Message => ({ id, kind: "text", body: "x", at, by: null });
  it("a new label where the Singapore day changes", () => {
    // 23:30 and 23:50 UTC on the 13th are the morning of the 14th in Singapore.
    const days = withDays([m(1, "2026-10-13T10:00:00Z"), m(2, "2026-10-13T15:59:00Z"), m(3, "2026-10-13T16:01:00Z"), m(4, "2026-10-13T23:50:00Z")]);
    assert.deepEqual(days.map((d) => [d.day, d.messages.map((x) => x.id)]), [["2026-10-13", [1, 2]], ["2026-10-14", [3, 4]]]);
  });
  it("nothing to show, no labels", () => assert.deepEqual(withDays([]), []));
});

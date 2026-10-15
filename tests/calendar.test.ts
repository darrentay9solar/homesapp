/**
 * Calendars, worked out on the device: `npm run test:web`.
 *
 *   time      Singapore days and minutes, whatever the device's time zone; weeks start Monday
 *   layout    meetings that overlap sit side by side
 *   busy      who is busy when, a day's load for the mini month, and which start times are free
 *   links     Google Calendar, Outlook, Teams, Meet, Zoom and .ics carry the right times and nothing personal
 *   options   end times, repeats and reminders worded as the API counts them
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDays,
  addMonths,
  busyMinutes,
  busyNames,
  dayLoad,
  durationText,
  endOptions,
  googleCalendarUrl,
  icsFile,
  layoutDay,
  linkKind,
  type Meeting,
  meetScheduleUrl,
  monthGrid,
  nextSlot,
  nthWeekday,
  outlookUrl,
  reminderParts,
  reminderWords,
  repeatWords,
  scheduleUrl,
  sgDay,
  sgMinutes,
  sortUpcoming,
  startOptions,
  teamsNewUrl,
  utcStamp,
  wallTime,
  weekDays,
  weekStart,
} from "../lib/client/calendar";

const at = (day: string, time: string) => `${day}T${time}:00+08:00`;
const span = (day: string, a: string, b: string) => ({ startsAt: at(day, a), endsAt: at(day, b) });

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: 7,
    title: "Site walk, roof",
    kind: "meeting",
    startsAt: at("2026-10-12", "09:30"),
    endsAt: at("2026-10-12", "10:30"),
    place: "online",
    location: null,
    postalCode: null,
    reminders: [60],
    repeat: null,
    seriesId: null,
    laterInSeries: 0,
    onlineLink: "https://teams.microsoft.com/l/meetup-join/abc",
    notes: "Bring the drawings",
    organiser: { uid: 1, name: "Wei Ming Tan" },
    project: { id: 3, name: "Siglap Garden House" },
    system: null,
    checkKey: null,
    status: "waiting",
    people: [],
    myResponse: "accepted",
    canEdit: true,
    canRespond: false,
    ...over,
  };
}

describe("time", () => {
  it("reads instants as Singapore days and minutes", () => {
    assert.equal(sgDay("2026-10-11T16:30:00Z"), "2026-10-12");
    assert.equal(sgMinutes("2026-10-11T16:30:00Z"), 30);
    assert.equal(sgMinutes(at("2026-10-13", "00:00"), "2026-10-12"), 1440);
  });
  it("weeks start on Monday; a month view is six weeks", () => {
    assert.equal(weekStart("2026-10-11"), "2026-10-05");
    assert.equal(weekStart("2026-10-12"), "2026-10-12");
    assert.deepEqual(weekDays("2026-10-14").slice(0, 2), ["2026-10-12", "2026-10-13"]);
    const grid = monthGrid("2026-10-20");
    assert.equal(grid.length, 42);
    assert.equal(grid[0], "2026-09-28");
    assert.equal(addMonths("2026-12-15", 1), "2027-01-01");
    assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  });
  it("wall-clock times for the API, and the next half-hour", () => {
    assert.equal(wallTime("2026-10-12", 570), "2026-10-12T09:30");
    assert.equal(wallTime("2026-10-12", 1440), "2026-10-13T00:00");
    assert.deepEqual(nextSlot(Date.parse(at("2026-10-12", "09:10"))), ["2026-10-12", 570]);
    assert.deepEqual(nextSlot(Date.parse(at("2026-10-12", "23:45"))), ["2026-10-13", 0]);
    assert.equal(durationText(90), "1 hr 30 min");
    assert.equal(durationText(30), "30 min");
  });
});

describe("layout", () => {
  it("puts overlapping meetings side by side, and the rest full width", () => {
    const day = "2026-10-12";
    const placed = layoutDay([{ id: 1, ...span(day, "09:00", "10:00") }, { id: 2, ...span(day, "09:30", "11:00") }, { id: 3, ...span(day, "13:00", "14:00") }], day);
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    assert.deepEqual([by[1].col, by[1].cols, by[2].col, by[2].cols], [0, 2, 1, 2]);
    assert.deepEqual([by[3].col, by[3].cols, by[3].top, by[3].height], [0, 1, 780, 60]);
  });
  it("clips a block that runs over days to each day", () => {
    const [p] = layoutDay([{ startsAt: at("2026-10-11", "13:00"), endsAt: at("2026-10-14", "00:00") }], "2026-10-12");
    assert.deepEqual([p.top, p.height], [0, 1440]);
  });
});

describe("busy", () => {
  const day = "2026-10-12";
  it("merges busy time and says how full a day is", () => {
    assert.deepEqual(busyMinutes([span(day, "09:00", "10:00"), span(day, "09:30", "11:00"), span(day, "14:00", "15:00")], day), [[540, 660], [840, 900]]);
    assert.equal(dayLoad([], day), "free");
    assert.equal(dayLoad([span(day, "09:00", "10:00")], day), "some");
    assert.equal(dayLoad([{ startsAt: at(day, "00:00"), endsAt: at("2026-10-13", "00:00") }], day), "full");
  });
  it("offers start times that are free for everyone and not past", () => {
    const now = Date.parse(at(day, "08:10"));
    const opts = startOptions(day, 60, [span(day, "10:00", "11:00")], now);
    const by = Object.fromEntries(opts.map((o) => [o.minutes, o]));
    assert.equal(by[480].why, "past");
    assert.equal(by[510].free, true);
    assert.equal(by[540].free, true); // 09:00 to 10:00 ends as the busy time starts
    assert.equal(by[570].why, "busy");
    assert.equal(by[660].free, true);
    assert.equal(opts[opts.length - 1].minutes, 20 * 60); // the last hour-long start in the day view
  });
  it("names who is busy", () => {
    const people = [{ uid: 1, name: "Ann", busy: [span(day, "10:00", "11:00")] }, { uid: 2, name: "Ben", busy: [] }];
    assert.deepEqual(busyNames(people, day, 600, 630), ["Ann"]);
    assert.deepEqual(busyNames(people, day, 660, 690), []);
  });
  it("lists invitations to answer first", () => {
    const a = meeting({ id: 1, startsAt: at(day, "08:00") });
    const b = meeting({ id: 2, startsAt: at(day, "15:00"), canRespond: true, myResponse: "pending" });
    assert.deepEqual(sortUpcoming([a, b]).map((m) => m.id), [2, 1]);
  });
});

describe("links", () => {
  it("Google Calendar and Outlook get the times in UTC and the join link", () => {
    assert.equal(utcStamp(at("2026-10-12", "09:30")), "20261012T013000Z");
    const g = new URL(googleCalendarUrl(meeting()));
    assert.equal(g.hostname, "calendar.google.com");
    assert.equal(g.searchParams.get("dates"), "20261012T013000Z/20261012T023000Z");
    assert.match(g.searchParams.get("details") ?? "", /Join: https:\/\/teams/);
    const o = new URL(outlookUrl(meeting()));
    assert.equal(o.searchParams.get("startdt"), "2026-10-12T01:30:00.000Z");
  });
  it("a new Teams meeting carries no names or emails", () => {
    const t = new URL(teamsNewUrl("Roof check", at("2026-10-12", "09:30"), at("2026-10-12", "10:00")));
    assert.deepEqual([...t.searchParams.keys()].sort(), ["endTime", "startTime", "subject"]);
  });
  it("knows a link's service", () => {
    assert.equal(linkKind("https://teams.microsoft.com/l/meetup-join/x"), "teams");
    assert.equal(linkKind("https://meet.google.com/abc-defg-hij"), "meet");
    assert.equal(linkKind("https://example.com/x"), "other");
    assert.equal(linkKind(null), null);
  });
  it("an .ics file escapes text and marks a cancelled meeting", () => {
    const ics = icsFile(meeting({ status: "cancelled" }), Date.parse("2026-10-11T00:00:00Z"));
    assert.match(ics, /SUMMARY:Site walk\\, roof\r\n/);
    assert.match(ics, /DTSTART:20261012T013000Z/);
    assert.match(ics, /STATUS:CANCELLED/);
  });
});

describe("options", () => {
  it("ends every half hour up to 12 hours on, past midnight too", () => {
    const e = endOptions(22 * 60);
    assert.equal(e[0], 22 * 60 + 30);
    assert.equal(e[e.length - 1], 34 * 60);
    assert.equal(e.length, 24);
    assert.equal(wallTime("2026-10-12", 25 * 60), "2026-10-13T01:00");
  });
  it("counts the weekday of the month as the API does: a fifth is the last", () => {
    assert.equal(nthWeekday("2026-10-06"), 1);
    assert.equal(nthWeekday("2026-10-13"), 2);
    assert.equal(nthWeekday("2026-10-28"), 4);
    assert.equal(nthWeekday("2026-10-29"), -1);
  });
  it("words each repeat", () => {
    assert.deepEqual(repeatWords("weekly", "2026-10-13", "en"), ["Weekly on {day}", { day: "Tuesday" }]);
    assert.deepEqual(repeatWords("monthly_weekday", "2026-10-29", "en"), ["Monthly on the {nth} {day}", { nth: "last", day: "Thursday" }]);
    assert.deepEqual(repeatWords("monthly_day", "2026-10-09", "en"), ["Monthly on day {n}", { n: "9" }]);
  });
  it("words a reminder in its largest whole unit", () => {
    assert.deepEqual(reminderParts(60), [1, "hours"]);
    assert.deepEqual(reminderParts(90), [90, "minutes"]);
    assert.deepEqual(reminderParts(2880), [2, "days"]);
    assert.deepEqual(reminderParts(10080), [1, "weeks"]);
    assert.deepEqual(reminderWords(0), ["At the start", {}]);
    assert.deepEqual(reminderWords(60), ["1 hour before", {}]);
    assert.deepEqual(reminderWords(180), ["{n} hours before", { n: "3" }]);
  });
  it("schedules Meet for the meeting's time (not a meeting now), with nothing personal", () => {
    const u = new URL(meetScheduleUrl("Roof check", at("2026-10-12", "09:30"), at("2026-10-12", "10:00")));
    assert.equal(u.hostname, "calendar.google.com");
    assert.equal(u.searchParams.get("dates"), "20261012T013000Z/20261012T020000Z");
    assert.deepEqual([...u.searchParams.keys()].sort(), ["action", "ctz", "dates", "text", "vcon"]);
    assert.notEqual(new URL(scheduleUrl("meet", "x", at("2026-10-12", "09:30"), at("2026-10-12", "10:00"))).hostname, "meet.google.com");
    assert.equal(new URL(scheduleUrl("zoom", "x", at("2026-10-12", "09:30"), at("2026-10-12", "10:00"))).pathname, "/meeting/schedule");
    assert.equal(linkKind("https://us02web.zoom.us/j/123"), "zoom");
  });
});

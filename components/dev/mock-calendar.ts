/**
 * DEVELOPMENT ONLY. A sample week for /dev-preview/calendar and the design
 * check, around today: confirmed meetings, an invitation to answer, two that
 * overlap, a maintenance check, a cancelled one, and blocked-out time. The
 * person is Wei Ming Tan (uid 1), as in mock-api.
 */
import type { Block, BusyPerson, CalendarData, Contacts, Meeting } from "@/lib/client/calendar";
import { addDays, today, wallTime, weekStart } from "@/lib/client/calendar";

const at = (offset: number, h: number, m = 0) => `${wallTime(addDays(today(), offset), h * 60 + m)}:00+08:00`;
const ME = { uid: 1, name: "Wei Ming Tan", role: "project_manager" as const };
const JASMINE = { uid: 5, name: "Jasmine Lee", role: "homeowner" as const };
const PRIYA = { uid: 3, name: "Priya Nair", role: "contractor" as const };
const CHARLOTTE = { uid: 2, name: "Charlotte Sim", role: "project_manager" as const };

function meeting(id: number, over: Partial<Meeting>): Meeting {
  return {
    id,
    title: "Meeting",
    kind: "meeting",
    startsAt: at(1, 10),
    endsAt: at(1, 11),
    place: "online",
    location: null,
    postalCode: null,
    reminders: [60],
    repeat: null,
    seriesId: null,
    laterInSeries: 0,
    onlineLink: "https://teams.microsoft.com/l/meetup-join/sample",
    notes: null,
    organiser: { uid: 1, name: ME.name },
    project: null,
    system: null,
    checkKey: null,
    status: "confirmed",
    people: [
      { ...ME, response: "accepted" },
      { ...JASMINE, response: "accepted" },
    ],
    myResponse: "accepted",
    canEdit: true,
    canRespond: false,
    ...over,
  };
}

const MEETINGS: Meeting[] = [
  meeting(301, { title: "Design review, Siglap Garden House", startsAt: at(0, 9, 30), endsAt: at(0, 10, 30), project: { id: 107, name: "Siglap Garden House" }, notes: "Bring the roof layout and the inverter spec." }),
  meeting(302, { title: "Crew briefing", startsAt: at(0, 14), endsAt: at(0, 15), place: "physical", location: "9 Solar Home office, 10 Ubi Crescent", onlineLink: null, people: [{ ...ME, response: "accepted" }, { ...PRIYA, response: "accepted" }] }),
  meeting(303, { title: "Scaffolding plan", startsAt: at(0, 14, 30), endsAt: at(0, 16), status: "waiting", place: "physical", location: "40 Siglap Hill", onlineLink: null, people: [{ ...ME, response: "accepted" }, { ...PRIYA, response: "pending" }] }),
  meeting(304, { title: "Handover walk-through", startsAt: at(1, 11), endsAt: at(1, 12), organiser: { uid: 2, name: CHARLOTTE.name }, status: "waiting", myResponse: "pending", canEdit: false, canRespond: true, onlineLink: "https://meet.google.com/abc-defg-hij", people: [{ ...CHARLOTTE, response: "accepted" }, { ...ME, response: "pending" }, { ...JASMINE, response: "accepted" }] }),
  meeting(305, { title: "6-month check · 7 Example Avenue", kind: "maintenance_check", startsAt: at(2, 9), endsAt: at(2, 11), place: "physical", location: "7 Example Avenue, Singapore 466001", onlineLink: null, system: { id: 201, address: "7 Example Avenue" }, checkKey: "six_month" }),
  meeting(308, { title: "Weekly site sync", startsAt: at(2, 15), endsAt: at(2, 15, 30), repeat: "weekly", seriesId: 308, laterInSeries: 11, reminders: [1440, 30], organiser: { uid: 2, name: CHARLOTTE.name }, status: "waiting", myResponse: "pending", canEdit: false, canRespond: true, onlineLink: "https://us02web.zoom.us/j/1234567890", people: [{ ...CHARLOTTE, response: "accepted" }, { ...ME, response: "pending" }] }),
  meeting(306, { title: "Quick call", startsAt: at(3, 16), endsAt: at(3, 16, 30), place: "phone", location: "+65 9123 4477", onlineLink: null }),
  meeting(307, { title: "Retailer contract", startsAt: at(4, 10), endsAt: at(4, 11), status: "declined", people: [{ ...ME, response: "accepted" }, { ...JASMINE, response: "declined" }] }),
];

const BLOCKS: Block[] = [
  { id: 401, startsAt: at(1, 13), endsAt: at(1, 18), note: "Training" },
  { id: 402, startsAt: at(5, 0), endsAt: at(7, 0), note: "Leave" },
];

export function mockCalendar(): CalendarData {
  const start = weekStart(today());
  return { me: 1, from: `${start}T00:00:00+08:00`, to: `${addDays(start, 42)}T00:00:00+08:00`, meetings: MEETINGS, blocks: BLOCKS, toAnswer: 1 };
}

export function mockUpcoming(): { meetings: Meeting[] } {
  return { meetings: MEETINGS.filter((m) => m.status !== "cancelled") };
}

export function mockMeeting(id: number): Meeting {
  return MEETINGS.find((m) => m.id === id) ?? MEETINGS[0];
}

export function mockContacts(): Contacts {
  return {
    people: [
      { ...CHARLOTTE, roleLabel: "Project Manager" },
      { ...PRIYA, roleLabel: "Contractor Admin" },
      { uid: 4, name: "Ravi Kumar", role: "epc_team", roleLabel: "EPC Team" },
      { ...JASMINE, roleLabel: "Homeowner", address: "7 Example Avenue", postalCode: "466001" },
    ],
    projects: [
      { id: 101, name: "Tampines Terrace", address: "22 Tampines Ave 5", postalCode: "529653" },
      { id: 107, name: "Siglap Garden House", address: "40 Siglap Hill", postalCode: "456123" },
    ],
    me: { address: "10 Ubi Crescent", postalCode: "408564" },
    video: [],
  };
}

export function mockBusy(search: URLSearchParams): { people: BusyPerson[] } {
  const uids = (search.get("people") ?? "").split(",").filter(Boolean).map(Number);
  const mine = [...MEETINGS.filter((m) => m.myResponse === "accepted" && m.status !== "cancelled"), ...BLOCKS].map((x) => ({ startsAt: x.startsAt, endsAt: x.endsAt }));
  return {
    people: uids.map((uid) => ({
      uid,
      name: uid === 1 ? ME.name : (mockContacts().people.find((p) => p.uid === uid)?.name ?? null),
      busy: uid === 1 ? mine : uid === 5 ? [{ startsAt: at(1, 9), endsAt: at(1, 12) }, { startsAt: at(3, 0), endsAt: at(4, 0) }] : [],
    })),
  };
}

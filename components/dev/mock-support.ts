/**
 * DEVELOPMENT ONLY. Sample support conversations for /dev-preview/support:
 * a manager's inbox, or a homeowner's own (?as=homeowner). Made-up people.
 */

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

const WEI = { uid: 1, name: "Wei Ming Tan", role: "project_manager" as const };
const JAS = { uid: 5, name: "Jasmine Lee", role: "homeowner" as const };
const PRIYA = { uid: 3, name: "Priya Nair", role: "contractor" as const };

export function asHomeowner(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("as") === "homeowner";
}

export function mockSupportMe(base: Record<string, unknown>) {
  return {
    ...base,
    supportUnread: 1,
    supportWaiting: 2,
    user: { uid: 5, fullName: "Jasmine Lee", email: "jasmine@example.com", role: "homeowner", roleLabel: "Homeowner", contactNo: "+65 9123 4477", address: null, postalCode: null, avatar: null },
  };
}

const THREADS = [
  {
    id: 401, subject: "Inverter shows a red light", status: "waiting", statusLabel: "Waiting for a person",
    project: { id: 101, name: "Jalan Kayu Residence" }, openedBy: { uid: 5, name: "Jasmine Lee", role: "homeowner" },
    handledBy: { uid: 1, name: "Wei Ming Tan" }, askedAt: iso(50), answeredAt: null, settledAt: null, createdAt: iso(55), mine: false,
    last: { body: "Asked for a person.", kind: "event", at: iso(50), by: "Jasmine Lee" }, unread: 0,
  },
  {
    id: 402, subject: "Generation looks low this week", status: "open", statusLabel: "In progress",
    project: { id: 102, name: "Seletar Hills Home" }, openedBy: { uid: 7, name: "Farah Ismail", role: "homeowner" },
    handledBy: { uid: 1, name: "Wei Ming Tan" }, askedAt: iso(60 * 26), answeredAt: iso(60 * 25), settledAt: null, createdAt: iso(60 * 26), mine: false,
    last: { body: "I'll check the strings on Thursday's visit.", kind: "text", at: iso(60 * 3), by: "Priya Nair" }, unread: 1,
  },
  {
    id: 403, subject: "When is my next maintenance check?", status: "assistant", statusLabel: "With the assistant",
    project: { id: 103, name: "Punggol Waterway Terrace" }, openedBy: { uid: 6, name: "Daniel Ong", role: "homeowner" },
    handledBy: null, askedAt: null, answeredAt: null, settledAt: null, createdAt: iso(60 * 5), mine: false,
    last: { body: "Your 6-month check is due on 3 Nov. You can book a visit on your project's Maintenance tab.", kind: "assistant", at: iso(60 * 5), by: null }, unread: 0,
  },
  {
    id: 404, subject: "Copy of the handover certificate", status: "settled", statusLabel: "Settled",
    project: { id: 104, name: "Bedok Ria Terrace" }, openedBy: { uid: 8, name: "Marcus Teo", role: "homeowner" },
    handledBy: { uid: 1, name: "Wei Ming Tan" }, askedAt: iso(60 * 72), answeredAt: iso(60 * 70), settledAt: iso(60 * 48), createdAt: iso(60 * 72), mine: false,
    last: { body: "Wei Ming Tan marked this settled.", kind: "event", at: iso(60 * 48), by: "Wei Ming Tan" }, unread: 0,
  },
];

export function mockInbox() {
  if (asHomeowner()) {
    const mine = THREADS.filter((t) => t.id === 401 || t.id === 404).map((t) => ({ ...t, mine: true, openedBy: { uid: 5, name: "Jasmine Lee", role: "homeowner" } }));
    return { threads: mine, staff: false, superadmin: false, canAsk: true, assistant: true, ai: true, projects: [{ id: 101, name: "Jalan Kayu Residence" }] };
  }
  return { threads: THREADS, staff: true, superadmin: false, canAsk: false, assistant: false, ai: false, projects: [] };
}

export function mockThread(id: number) {
  const t = THREADS.find((x) => x.id === id) ?? THREADS[0];
  const homeowner = asHomeowner();
  const messages = [
    { id: 1, kind: "text", body: "The inverter has a red light on since this morning. Is that normal?", at: iso(55), by: JAS },
    { id: 2, kind: "assistant", body: "A red light usually means the inverter has stopped and needs a look. Please don't open it. Your project manager can arrange a check: tap Talk to a person.", at: iso(54), by: null },
    { id: 3, kind: "event", body: "Asked for a person.", at: iso(50), by: JAS },
    { id: 4, kind: "text", body: "Thanks Jasmine. Can you send a photo of the screen? I've asked Priya from Apex to join as well.", at: iso(40), by: WEI },
    { id: 5, kind: "event", body: "Wei Ming Tan added Priya Nair.", at: iso(39), by: WEI },
    { id: 6, kind: "text", body: "Hi Jasmine, it's likely a grid fault after last night's storm. I can reset it remotely in 10 minutes.", at: iso(30), by: PRIYA },
    { id: 7, kind: "call", body: "https://meet.google.com/abc-defg-hij", at: iso(20), by: WEI },
  ];
  return {
    ...t,
    status: "open",
    statusLabel: "In progress",
    mine: homeowner,
    messages,
    members: [
      { uid: 5, name: "Jasmine Lee", role: "homeowner", roleLabel: "Homeowner", asker: true, handler: false },
      { uid: 1, name: "Wei Ming Tan", role: "project_manager", roleLabel: "Project Manager", asker: false, handler: true },
      { uid: 3, name: "Priya Nair", role: "contractor", roleLabel: "Contractor Admin", asker: false, handler: false },
    ],
    can: homeowner
      ? { write: true, askPerson: false, add: false, remove: false, settle: true, reopen: false, assign: false, call: false }
      : { write: true, askPerson: false, add: true, remove: true, settle: true, reopen: false, assign: true, call: true },
  };
}

/** The homeowner's first question, still with the assistant (/dev-preview/support/403?as=homeowner). */
export function mockAssistantThread() {
  const t = THREADS[2];
  return {
    ...t,
    mine: true,
    openedBy: { uid: 5, name: "Jasmine Lee", role: "homeowner" },
    messages: [
      { id: 1, kind: "text", body: "When is my next maintenance check?", at: iso(60 * 5 + 1), by: JAS },
      { id: 2, kind: "assistant", body: "Your 6-month check is due on 3 Nov. You can book a visit on your project's Maintenance tab; a reminder comes 14 days before.", at: iso(60 * 5), by: null },
    ],
    members: [{ uid: 5, name: "Jasmine Lee", role: "homeowner", roleLabel: "Homeowner", asker: true, handler: false }],
    can: { write: true, askPerson: true, add: false, remove: false, settle: true, reopen: false, assign: false, call: false },
  };
}

export function mockAnswers() {
  return {
    ai: false,
    starterLeft: 4,
    answers: [
      { id: 1, question: "When is my next maintenance check?", answer: "Your 6-month and 1-year checks are on your project's Maintenance tab, each with its date.", questionZh: "我的下一次维护检查是什么时候？", answerZh: "您的6个月和1年检查在项目的“维护”标签页中。", position: 1, active: true, updatedAt: iso(600) },
      { id: 2, question: "How do I clean my solar panels?", answer: "Rain keeps them mostly clean. If you'd like them washed, rinse with water only, from the ground; never climb onto the roof.", questionZh: null, answerZh: null, position: 2, active: true, updatedAt: iso(900) },
      { id: 3, question: "What does my warranty cover?", answer: "Panels: 25 years on output. Inverter: 10 years. Workmanship: 5 years.", questionZh: null, answerZh: null, position: 3, active: false, updatedAt: iso(3000) },
    ],
  };
}

export function mockSupportPeople() {
  return {
    people: [
      { uid: 4, name: "Ravi Kumar", email: "ravi@example.com", role: "epc_team", roleLabel: "EPC Team", onProject: true },
      { uid: 2, name: "Charlotte Sim", email: "charlotte@example.com", role: "project_manager", roleLabel: "Project Manager", onProject: false },
      { uid: 11, name: "Sam Tan", email: "sam@example.com", role: "superadmin", roleLabel: "Superadmin", onProject: false },
    ],
  };
}

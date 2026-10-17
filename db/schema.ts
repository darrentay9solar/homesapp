import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * GetHomeApps schema — 9 Solar Home.
 *
 * Three tables from the spec (users, projects, electricity_retailers) plus
 * project_files, which the spec implies: several fields are "Pictures" plural,
 * and a single column cannot hold several files along with who uploaded each
 * one and when.
 */

// ---------------------------------------------------------------- enums

/** A user is exactly one of these. */
export const userTypeEnum = pgEnum("user_type", [
  "homeowner",
  "project_manager",
  "contractor",
  "epc_team",
  // Unfettered access; only ever put straight into the database (migration 0028).
  "superadmin",
  // Shown as "Admin": payments and invoices; read-only everywhere else (migration 0043).
  "finance",
]);

/**
 * Every image or document slot in the spec, as a category on project_files.
 * Adding a new document type is a value here plus a migration — no new column.
 */
export const fileCategoryEnum = pgEnum("file_category", [
  "panel_pictures",
  "inverter_pictures",
  "utility_bill",
  "moc_change",
  "gst_proof",
  "sp_forms_signed",
  "sp_submission_screenshot",
  "pvl_letter",
  "sp_appointment_letter",
  "final_submission_documents",
  "handover_docs",
  "completion_form_signed",
  "as_built_pv_layout",
  // "FusionSolar App Access — Yes/No and Document Upload" in the brief.
  "fusion_solar_access",
]);

/**
 * What happened. Row changes come from triggers; the wider values exist so
 * non-table events (an approval, a site check-in) can share the same log later.
 */
export const auditActionEnum = pgEnum("audit_action", [
  "insert",
  "update",
  "delete",
]);

/**
 * The approval and handover state machine from the brief. Not derivable from
 * field values — "declined" and "PM approved" are decisions, not data.
 */
export const projectStatusEnum = pgEnum("project_status", [
  "draft",
  "awaiting_homeowner",
  "homeowner_declined",
  "homeowner_approved",
  "pm_approved",
  "in_progress",
  "awaiting_signature",
  "signed",
  // Handed over: the development phase is done and the system is in maintenance (was "closed"; migration 0032).
  "maintenance",
]);

export const notificationKindEnum = pgEnum("notification_kind", [
  "approval_request",
  "approval_granted",
  "approval_declined",
  "assignment",
  "visit_assigned",
  "visit_reminder",
  "visit_missed",
  "milestone_complete",
  "signature_request",
  "signed",
  "project_closed",
  // Account lifecycle: a PM created your account; someone asked for one and
  // a PM should look; your request was approved or turned down.
  "account_created",
  "account_request",
  "account_approved",
  "account_rejected",
  // A project manager reverted or restored something you changed.
  "audit_restore",
  // Someone asked to change their role; a PM decided.
  "role_request",
  "role_approved",
  "role_rejected",
  // The crew checked in an hour or more after a visit's start time.
  "crew_arrived_late",
  // A project manager asked someone to share their location.
  "location_request",
  // Meetings (migration 0032): an invitation, an answer, a change or cancellation.
  "meeting_request",
  "meeting_response",
  "meeting_changed",
  // A maintenance check coming up, due today, or overdue.
  "maintenance_due",
  // Managers' warnings (0035): a project gone late, an escalation, the morning summary.
  "project_late",
  "escalation",
  "daily_summary",
  // Support (0036): someone asked for a person, a new message, you were brought in, it was settled.
  "support_request",
  "support_message",
  "support_added",
  "support_settled",
  // A meeting coming up, at the times its organiser chose (0039, 0042).
  "meeting_reminder",
  // Payments (0043): an invoice issued to you, your payment received, proof of payment to check.
  "invoice_issued",
  "payment_received",
  "payment_proof",
]);

/**
 * A self sign-up waiting on a project manager. Approved and rejected requests
 * are kept, not deleted: who let whom in, and when, is exactly the question an
 * access review asks.
 */
export const roleRequestStatusEnum = pgEnum("role_request_status", ["pending", "approved", "rejected", "cancelled"]);

export const accountRequestStatusEnum = pgEnum("account_request_status", [
  "pending",
  "approved",
  "rejected",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "email",
  "whatsapp",
  // Fallback when WhatsApp can't deliver (not configured, or the person
  // isn't on WhatsApp). Never sent as well as WhatsApp, only instead of it.
  "sms",
  // A phone or browser notification (Web Push), alongside in-app.
  "push",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "queued",
  "sent",
  "delivered",
  "failed",
  "skipped",
]);

// ---------------------------------------------------------------- users

export const users = pgTable(
  "users",
  {
    uid: serial("uid").primaryKey(),

    /**
     * Clerk owns identity; this table owns everything else. Nullable because a
     * project manager can record a homeowner before that person has ever signed
     * in — the account gets linked when they accept their invitation.
     *
     * Authorisation lives in `userType` below, never in Clerk metadata, which
     * is editable from the client in some configurations.
     */
    clerkUserId: text("clerk_user_id").unique(),

    fullName: text("full_name"),

    userType: userTypeEnum("user_type").notNull(),

    /**
     * Text, not integer. Singapore numbers are given as "+65 9123 4567"; an
     * integer loses the country code, any leading zero, and the ability to
     * store a landline extension.
     */
    contactNo: varchar("contact_no", { length: 32 }),

    /**
     * Last four characters of the NRIC/FIN only — three digits and the
     * checksum letter, e.g. "567D" from S1234567D.
     *
     * Under the PDPA, collecting a full NRIC is restricted to cases where the
     * law requires it, and nothing here does: these four characters are enough
     * to match a homeowner against SP Group's paperwork. The length limit and
     * the check constraint below make storing a whole NRIC impossible rather
     * than merely discouraged — a validation rule in application code is one
     * forgotten import away from being bypassed.
     */
    icLast4: varchar("ic_last4", { length: 4 }),

    email: varchar("email", { length: 320 }).notNull(),

    /**
     * Either may be entered and the other derived from it through OneMap —
     * a postal code lookup returns the address, and an address lookup returns
     * the postal code. Stored rather than looked up on demand, because OneMap
     * rate-limits and a person's address does not change often.
     */
    address: text("address"),
    postalCode: varchar("postal_code", { length: 6 }),

    active: boolean("active").notNull().default(true),

    /**
     * Set when a project manager created the account and an invitation went
     * out. An invited user with no clerkUserId has not accepted yet; one with
     * neither was approved from a self sign-up, so already has a Clerk login.
     *
     * Only a project manager may insert into this table — enforced by a
     * trigger, not just by the admin page (see migration 0012).
     */
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    invitedBy: integer("invited_by").references((): AnyPgColumn => users.uid, {
      onDelete: "set null",
    }),
    clerkInvitationId: text("clerk_invitation_id"),

    /**
     * Set by the person themselves through verified steps only (migration
     * 0022): when their mobile was last confirmed with a code, and when they
     * last changed their password (the password itself lives in Clerk).
     */
    mobileVerifiedAt: timestamp("mobile_verified_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),

    /**
     * Profile picture: the R2 key (profiles/<uid>/images/<uuid>.jpg). The
     * person sets their own; a project manager can replace or remove anyone's.
     */
    avatarKey: text("avatar_key"),
    avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
    avatarUpdatedBy: integer("avatar_updated_by").references((): AnyPgColumn => users.uid, { onDelete: "set null" }),

    /** Screens, alerts, phone notifications and emails in English or Simplified Chinese. */
    language: varchar("language", { length: 5 }).notNull().default("en"),

    /**
     * When and what to be told about (migration 0025):
     * { pausedUntil, quiet: { on, from, to, urgent }, mute: [category...], channels: { push, email, mobile } }.
     * Alerts are always kept on the Alerts screen; these only silence the phone, email and WhatsApp/SMS.
     */
    notificationPrefs: jsonb("notification_prefs").notNull().default({}),

    /**
     * Set only by a project manager. On disableOn the account disables itself
     * (an expiry); on enableOn a disabled account enables itself. disabledReason
     * says which: "manual" (a PM) or "scheduled" (the expiry date), so moving
     * the expiry later re-enables an expired account but not one a PM disabled.
     */
    disableOn: date("disable_on"),
    enableOn: date("enable_on"),
    disabledReason: varchar("disabled_reason", { length: 12 }),

    /**
     * A sample person on the demo site (migration 0027): visitors can try the
     * app as them without a password. Only the database owner sets it, so
     * only the dev database's seed script; production never has any.
     */
    isDemo: boolean("is_demo").notNull().default(false),

    /**
     * When they agreed to the privacy notice (/privacy), and which version
     * (migration 0044). Only the person sets it, or the approval of their
     * request carrying over what they agreed to when they asked.
     */
    privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
    privacyVersion: text("privacy_version"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive: nobody should be able to register Bob@x.com alongside
    // bob@x.com and end up with two profiles for one person.
    uniqueIndex("users_email_lower_idx").on(table.email),
    // One mobile number, one account: compared by its digits, so the same
    // number typed with or without spaces still counts as taken (0033).
    uniqueIndex("users_contact_no_digits_idx")
      .on(sql`regexp_replace(${table.contactNo}, '[^0-9]', '', 'g')`)
      .where(sql`${table.contactNo} IS NOT NULL`),
    // Three digits then the checksum letter. Rejects a full NRIC outright, so
    // one cannot arrive through a stray import, a seed script or a fixture.
    check("users_ic_last4_format", sql`${table.icLast4} ~ '^[0-9]{3}[A-Za-z]$'`),
  ]
);

// ------------------------------------------------------- account settings

/**
 * One-time codes for confirming a new mobile number, sent by WhatsApp or SMS.
 * Only a hash of the code is kept; a code lasts ten minutes and five wrong
 * tries. Not audited: the change it unlocks (users.contact_no) is.
 */
export const verificationCodes = pgTable(
  "verification_codes",
  {
    codeId: serial("code_id").primaryKey(),
    uid: integer("uid")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    purpose: varchar("purpose", { length: 16 }).notNull(),
    target: varchar("target", { length: 32 }).notNull(),
    codeHash: text("code_hash").notNull(),
    channel: varchar("channel", { length: 12 }),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("verification_codes_uid_idx").on(table.uid, table.createdAt),
    check("verification_codes_purpose", sql`${table.purpose} in ('mobile')`),
    check("verification_codes_channel", sql`${table.channel} in ('whatsapp', 'sms', 'dev')`),
  ]
);

/**
 * Someone with an account asking to change their role ("I've moved from the
 * contractor's office to the EPC crew"). A project manager approves or
 * declines it, as with account requests; approving changes users.user_type.
 */
export const roleChangeRequests = pgTable(
  "role_change_requests",
  {
    requestId: serial("request_id").primaryKey(),
    uid: integer("uid")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    fromType: userTypeEnum("from_type").notNull(),
    requestedType: userTypeEnum("requested_type").notNull(),
    reason: text("reason"),
    status: roleRequestStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: integer("decided_by").references(() => users.uid, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
  },
  (table) => [
    uniqueIndex("role_change_requests_one_pending").on(table.uid).where(sql`${table.status} = 'pending'`),
    check("role_change_requests_differs", sql`${table.requestedType} <> ${table.fromType}`),
  ]
);

// ------------------------------------------------------- account requests

/**
 * Someone who signed up through Clerk by themselves and is asking for access.
 *
 * Kept apart from users on purpose: a row in users is an account, and an
 * account exists only once a project manager has said so. Until then the
 * person can sign in to Clerk but the app shows them nothing except "waiting
 * for approval". On approval a users row is created from this one and linked
 * through grantedUid.
 */
export const accountRequests = pgTable(
  "account_requests",
  {
    requestId: serial("request_id").primaryKey(),

    /** The Clerk identity asking. Verified by Clerk before this row exists. */
    clerkUserId: text("clerk_user_id").notNull(),
    email: varchar("email", { length: 320 }).notNull(),

    fullName: text("full_name").notNull(),
    /** What they asked to be. The approving PM may grant something else. */
    requestedType: userTypeEnum("requested_type").notNull(),
    contactNo: varchar("contact_no", { length: 32 }),
    icLast4: varchar("ic_last4", { length: 4 }),
    address: text("address"),
    postalCode: varchar("postal_code", { length: 6 }),
    /** Free text from the requester — "I'm with ABC Electrical", say. */
    note: text("note"),
    /** The language they signed up in: the decision reaches them in it, and their account starts in it. */
    language: varchar("language", { length: 5 }).notNull().default("en"),
    /** They agreed to the privacy notice when asking (migration 0044); carried to the account. */
    privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
    privacyVersion: text("privacy_version"),

    status: accountRequestStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: integer("decided_by").references(() => users.uid, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
    grantedUid: integer("granted_uid").references(() => users.uid, { onDelete: "set null" }),
  },
  (table) => [
    // One open request per person; a rejected one can be followed by another.
    uniqueIndex("account_requests_one_pending_idx")
      .on(table.clerkUserId)
      .where(sql`${table.status} = 'pending'`),
    index("account_requests_status_idx").on(table.status, table.createdAt),
    check("account_requests_ic_last4_format", sql`${table.icLast4} ~ '^[0-9]{3}[A-Za-z]$'`),
  ]
);

// -------------------------------------------------------- retailers

export const electricityRetailers = pgTable("electricity_retailers", {
  retailerId: serial("retailer_id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --------------------------------------------------------------- projects

export const projects = pgTable("projects", {
  projectId: serial("project_id").primaryKey(),

  /** How the project is identified everywhere a person sees it. */
  name: varchar("name", { length: 200 }).notNull().default(""),

  address: text("address").notNull(),

  /**
   * The 9 Solar Home project manager who owns this project. Separate from the
   * contractor: the PM approves, overrides and closes, and the dashboard is
   * grouped by them.
   */
  projectManagerId: integer("project_manager_id").references(() => users.uid, {
    onDelete: "set null",
  }),

  /** Salesperson or deal reference that brought the project in. */
  sales: varchar("sales", { length: 160 }),

  /** Free-running stage counter the admin team maintains alongside milestones. */
  currentStage: integer("current_stage"),

  /**
   * One homeowner per project, per the spec. Restricted rather than cascading:
   * deleting a person should never silently delete their installation record.
   */
  homeownerId: integer("homeowner_id").references(() => users.uid, {
    onDelete: "restrict",
  }),

  /**
   * The homeowner's name when they have no account yet (the brief: "If the
   * account is not yet created, it can be input in as a text"). Such a project
   * stays a draft — a name can't approve or e-sign — until an account is linked.
   */
  homeownerName: text("homeowner_name"),

  /** Homeowner Contact No. from Create Project — required, account or not. */
  homeownerContactNo: varchar("homeowner_contact_no", { length: 32 }),

  /** The PM who created it. project_manager_id is who owns it now. */
  createdBy: integer("created_by").references(() => users.uid, { onDelete: "set null" }),

  // ---- installation -----------------------------------------------------
  /** The project's start date, set at creation; only a PM may change it. */
  installationStartDate: date("installation_start_date"),
  /** Panel Installation Completion Date — a Milestone 1 field, not the target. */
  installationEndDate: date("installation_end_date"),
  /**
   * When the project should be finished. Set at creation (three weeks after
   * the start if not given); past it and unfinished, the project is late.
   * Only a PM may change it.
   */
  targetEndDate: date("target_end_date"),

  /** Homeowner approval gate from the original brief. */
  confirmedByHomeowner: boolean("confirmed_by_homeowner"),

  waterproofing: boolean("waterproofing"),
  createGroupChat: boolean("create_group_chat"),

  // ---- panels and inverter ----------------------------------------------
  panelQuantityEstimate: integer("panel_quantity_estimate"),
  panelQuantityActual: integer("panel_quantity_actual"),

  /**
   * Watts per panel, not kilowatts and not the system total.
   * (Left as panel_capacity rather than panel_capacity_w: renaming a column
   * makes drizzle-kit ask whether it is a rename or a new column, which needs
   * an interactive prompt. Not worth it for a suffix.)
   */
  panelCapacity: integer("panel_capacity"),

  inverterToOrder: text("inverter_to_order"),
  inverterCollected: boolean("inverter_collected"),
  inverterDate: date("inverter_date"),
  inverterSerialNumber: varchar("inverter_serial_number", { length: 120 }),

  // ---- scaffolding -------------------------------------------------------
  scaffoldingRemoval: boolean("scaffolding_removal"),
  scaffoldingRemovalDate: date("scaffolding_removal_date"),

  // ---- commissioning -----------------------------------------------------
  inverterCommissionGridConnection: boolean("inverter_commission_grid_connection"),
  commissionDate: date("commission_date"),
  rcbBreakerReplacement: boolean("rcb_breaker_replacement"),
  rcbBreakerReplacementDate: date("rcb_breaker_replacement_date"),

  // ---- retailer ----------------------------------------------------------
  electricityRetailerId: integer("electricity_retailer_id").references(
    () => electricityRetailers.retailerId,
    { onDelete: "set null" }
  ),
  retailerContractEndDate: date("retailer_contract_end_date"),

  // ---- SP Group ----------------------------------------------------------
  /**
   * 1 = submitted to LEW, 2 = LEW submitted to SP, 3 = unchecked.
   *
   * NOT NULL defaulting to 3 on purpose: if null were also allowed there would
   * be two ways to say "not started", and every report would have to handle
   * both. A CHECK constraint (added in migration 0010 by hand) rejects any
   * value other than 1, 2 or 3.
   */
  spApplicationStatus: integer("sp_application_status").notNull().default(3),
  spSubmissionDate: date("sp_submission_date"),
  pvlReceivedDate: date("pvl_received_date"),
  preInspectionDate: date("pre_inspection_date"),
  spAppointmentLetterReceivedDate: date("sp_appointment_letter_received_date"),
  meterReplacementDate: date("meter_replacement_date"),
  spTurnOnInspectionDate: date("sp_turn_on_inspection_date"),

  // ---- handover ----------------------------------------------------------
  fusionSolarAppAccess: boolean("fusion_solar_app_access"),

  // ---- workflow ----------------------------------------------------------
  status: projectStatusEnum("status").notNull().default("draft"),

  /**
   * Contractor, in the three forms the brief allows: a whole group, named
   * individuals (see projectAssignments), or free text when the outfit has no
   * accounts yet.
   */
  contractorGroupId: integer("contractor_group_id").references(
    () => contractorGroups.groupId,
    { onDelete: "set null" }
  ),
  contractorText: text("contractor_text"),

  /**
   * Site coordinates, used to measure how far a crew is from the roof when
   * they check in. Without these there is nothing to measure against, and the
   * trigger refuses the check-in rather than letting it through unverified.
   *
   * Resolved from OneMap (SLA) once, when the project is set up. Never looked
   * up during a check-in: OneMap rate-limits aggressively — three rapid
   * requests was enough to get a 429 — and a crew on a roof should not depend
   * on a third-party API answering.
   */
  siteLat: doublePrecision("site_lat"),
  siteLng: doublePrecision("site_lng"),

  /**
   * Singapore postal codes are unique per building, which street text is not:
   * searching OneMap for "14 Jalan Kayu" returns five fuzzy matches and none
   * of them that address. This is the field to geocode from.
   */
  postalCode: varchar("postal_code", { length: 6 }),

  /** What OneMap actually matched, so a wrong match is visible to a PM. */
  geocodedAddress: text("geocoded_address"),
  geocodeSource: varchar("geocode_source", { length: 32 }),
  geocodedAt: timestamp("geocoded_at", { withTimezone: true }),

  /**
   * How close a crew must be, in metres. A column rather than a constant so a
   * large landed property can be widened without a deployment.
   */
  checkInRadiusM: integer("check_in_radius_m").notNull().default(100),

  /** When a project manager closed the project after the homeowner signed (migration 0029). */
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: integer("closed_by").references(() => users.uid, { onDelete: "set null" }),

  // ---- the client record (0038, from 9 Solar Home's project list) ---------
  /** 9 Solar Home's own project code, e.g. 9SH0123. */
  projectCode: text("project_code"),
  salutation: text("salutation"),
  homeownerEmail: text("homeowner_email"),
  /** When the client signed. */
  signedOn: date("signed_on"),
  referrer: text("referrer"),
  solarPlan: text("solar_plan"),
  ratePerKwh: numeric("rate_per_kwh", { precision: 8, scale: 4 }),
  ppaKind: text("ppa_kind"),
  ppaYears: smallint("ppa_years"),
  phase: smallint("phase"),
  dongleSerial: text("dongle_serial"),
  /** Where an imported project came from, e.g. clients-2026-10-14#9SH0123. */
  importRef: text("import_ref"),
  /** What an import set by itself (dates not in the list), for the manager to check. */
  recordNote: text("record_note"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // One homeowner, one project (0043).
  uniqueIndex("projects_one_per_homeowner").on(table.homeownerId).where(sql`${table.homeownerId} IS NOT NULL`),
]);

// ---------------------------------------------------------- project files

/**
 * Every uploaded image and document. One row per file, so "Panel Pictures" can
 * hold twenty and "Utility Bill" one, through the same mechanism — and each
 * carries who uploaded it and when, which a column of URLs could not.
 */
export const projectFiles = pgTable("project_files", {
  fileId: serial("file_id").primaryKey(),

  projectId: integer("project_id")
    .notNull()
    .references(() => projects.projectId, { onDelete: "cascade" }),

  category: fileCategoryEnum("category").notNull(),

  /** Object-storage URL. The bytes never live in Postgres. */
  url: text("url").notNull(),
  fileName: text("file_name").notNull(),
  contentType: varchar("content_type", { length: 120 }),
  sizeBytes: integer("size_bytes"),
  /** "image" or "document": which folder of the project it's stored in (projects/<id>/images|documents/...). */
  kind: varchar("kind", { length: 10 }).notNull().default("document"),

  uploadedBy: integer("uploaded_by").references(() => users.uid, {
    onDelete: "set null",
  }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

// ------------------------------------------------------------ audit log

/**
 * Append-only record of every row written, changed or removed.
 *
 * Three properties make this an audit trail rather than a table of notes, and
 * all three are enforced in Postgres rather than in application code (see the
 * accompanying `audit_triggers` migration):
 *
 *   1. Nothing can read it except the dedicated audit role, which only the
 *      project-manager view connects with. The app's own role has no
 *      privileges on this table at all.
 *   2. Nothing can write to it directly either. Entries appear only as a side
 *      effect of a real data change, via SECURITY DEFINER triggers, so the
 *      application cannot forge or omit an entry.
 *   3. No UPDATE or DELETE is granted to anybody. A log a project manager can
 *      quietly edit is not a log.
 *
 * The actor is captured twice on purpose: a foreign key so it can be joined,
 * and a snapshot of their name, email and role so the history stays truthful
 * after someone is renamed, changes role, or leaves.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    auditId: bigserial("audit_id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),

    actorUid: integer("actor_uid").references(() => users.uid, {
      onDelete: "set null",
    }),
    actorEmail: varchar("actor_email", { length: 320 }),
    actorName: text("actor_name"),
    /** Their role at the time of the action, not their role now. */
    actorRole: userTypeEnum("actor_role"),
    actorClerkId: text("actor_clerk_id"),

    action: auditActionEnum("action").notNull(),
    entityTable: text("entity_table").notNull(),
    /** Text so one column serves every table's primary key type. */
    entityId: text("entity_id"),

    /** `{ "panel_quantity_actual": { "from": 18, "to": 20 } }` */
    changes: jsonb("changes"),

    /**
     * Set when this entry undoes an earlier one.
     *
     * Reverting never removes the original — a revert is itself a change, and
     * both facts are true. This column makes the chain explicit so the audit
     * view can show "↩ reverts #412" instead of two unrelated-looking edits.
     */
    revertsAuditId: bigint("reverts_audit_id", { mode: "number" }),

    /**
     * The row's full primary key, `{ "project_id": 7, "milestone_no": 2 }`.
     * entity_id holds only the first column, which cannot identify a row in
     * a table with a composite key — and a revert has to find the exact row.
     */
    entityKey: jsonb("entity_key"),

    /**
     * The project the row belonged to, read from the whole row rather than
     * the diff, so "everything that happened on this job" is one query even
     * for an update that never touched project_id. No foreign key: the
     * history must outlive the project.
     */
    projectId: integer("project_id"),

    /**
     * Set when this entry brings back an earlier state: a value as some
     * earlier entry left it, or a record that entry deleted. Points at that
     * entry. (reverts_audit_id is for undoing one change; this is for
     * restoring to a point in time.)
     */
    restoresAuditId: bigint("restores_audit_id", { mode: "number" }),

    /**
     * Why a revert or restore was made. Required — the database refuses a
     * revert or restore without one — and written on every entry the
     * operation produces.
     */
    reason: text("reason"),

    /** Groups every entry one revert or restore wrote, so it reads as one act. */
    operationId: uuid("operation_id"),
  },
  (table) => [
    // "What happened to this project" — the audit page's main query.
    index("audit_log_entity_idx").on(
      table.entityTable,
      table.entityId,
      table.occurredAt.desc()
    ),
    // "What has this person done" — the other way people read an audit log.
    index("audit_log_actor_idx").on(table.actorUid, table.occurredAt.desc()),
    index("audit_log_project_idx").on(table.projectId, table.occurredAt.desc()),
    index("audit_log_reverts_idx").on(table.revertsAuditId),
    index("audit_log_restores_idx").on(table.restoresAuditId),
    index("audit_log_operation_idx").on(table.operationId),
  ]
);

// ------------------------------------------------------ contractor groups

export const contractorGroups = pgTable("contractor_groups", {
  groupId: serial("group_id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Membership is many-to-many on purpose: subcontractors routinely work for
 * more than one outfit, and forcing a single group would mean duplicate
 * accounts for the same person.
 */
export const contractorGroupMembers = pgTable(
  "contractor_group_members",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => contractorGroups.groupId, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    addedBy: integer("added_by").references(() => users.uid, { onDelete: "set null" }),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index("contractor_group_members_user_idx").on(table.userId),
  ]
);

/** Individuals named on a project directly, rather than through a group. */
export const projectAssignments = pgTable(
  "project_assignments",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedBy: integer("assigned_by").references(() => users.uid, {
      onDelete: "set null",
    }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_assignments_user_idx").on(table.userId),
  ]
);

// ------------------------------------------------------------ site visits

export const siteVisits = pgTable(
  "site_visits",
  {
    visitId: serial("visit_id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "cascade" }),
    scheduledDate: date("scheduled_date").notNull(),
    scheduledTime: varchar("scheduled_time", { length: 5 }),
    worksNote: text("works_note"),
    createdBy: integer("created_by").references(() => users.uid, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("site_visits_project_date_idx").on(table.projectId, table.scheduledDate)]
);

/**
 * Which reminders a visit has had: "before" (an hour before it starts) and
 * "missed" (an hour after, with no check-in). One row per kind, so the
 * reminder job can run as often as it likes without anyone hearing twice.
 */
export const visitReminders = pgTable(
  "visit_reminders",
  {
    visitId: integer("visit_id")
      .notNull()
      .references(() => siteVisits.visitId, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 12 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.visitId, table.kind] }),
    check("visit_reminders_kind", sql`${table.kind} in ('before', 'missed')`),
  ]
);

/**
 * A crew arriving on site, and later leaving.
 *
 * There is deliberately no "late" or "missed" column. That is derived — a
 * site_visits row whose date has passed with no check-in — because a stored
 * flag would need a nightly job to stay honest and would be wrong in between.
 */
export const siteCheckIns = pgTable(
  "site_check_ins",
  {
    checkInId: serial("check_in_id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "cascade" }),

    /** Null for an unscheduled visit, which the brief explicitly allows. */
    visitId: integer("visit_id").references(() => siteVisits.visitId, {
      onDelete: "set null",
    }),

    userId: integer("user_id")
      .notNull()
      .references(() => users.uid, { onDelete: "restrict" }),

    checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
    crewIn: integer("crew_in").notNull(),

    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),

    /**
     * Distance from the site at the moment of check-in, in metres. Stored
     * rather than recomputed: if the site coordinates are corrected later,
     * history must not silently change where the crew was standing.
     */
    distanceM: doublePrecision("distance_m"),

    /**
     * Reported accuracy of the fix, in metres. A reading accurate to ±200 m
     * tells you nothing against a 100 m radius, so the trigger refuses it —
     * and in that case "not receiving GPS signal" is literally true.
     */
    accuracyM: doublePrecision("accuracy_m"),

    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    crewOut: integer("crew_out"),

    /**
     * Check-out is verified independently of check-in. Otherwise a crew could
     * arrive, check in, leave, and close the day from anywhere.
     */
    checkoutLat: doublePrecision("checkout_lat"),
    checkoutLng: doublePrecision("checkout_lng"),
    checkoutDistanceM: doublePrecision("checkout_distance_m"),
    checkoutAccuracyM: doublePrecision("checkout_accuracy_m"),
  },
  (table) => [
    index("site_check_ins_project_idx").on(table.projectId, table.checkedInAt.desc()),
    index("site_check_ins_user_idx").on(table.userId, table.checkedInAt.desc()),
  ]
);

// -------------------------------------------------------------- milestones

/**
 * When a milestone was first reached. Completion itself is derived from the
 * field values, so there is no "complete" flag to contradict the data — the
 * presence of a row is the record, and the unique key stops it double-firing.
 */
export const projectMilestones = pgTable(
  "project_milestones",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "cascade" }),
    milestoneNo: integer("milestone_no").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
    completedBy: integer("completed_by").references(() => users.uid, {
      onDelete: "set null",
    }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.milestoneNo] }),
    check(
      "project_milestones_no_range",
      sql`${table.milestoneNo} between 1 and 3`
    ),
  ]
);

// ------------------------------------------------------------- signatures

/**
 * The homeowner's e-signature on the handover certificate.
 *
 * Kept apart from project_files because a signature is not an upload: it
 * carries legal weight, so it records who signed, when, from where, and what
 * exactly they were shown. certificateHash pins the document version — a
 * signature that cannot prove what it was applied to is worth little.
 */
export const projectSignatures = pgTable(
  "project_signatures",
  {
    signatureId: serial("signature_id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "cascade" }),
    signedBy: integer("signed_by")
      .notNull()
      .references(() => users.uid, { onDelete: "restrict" }),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),

    /** Object-storage URL of the captured signature image. */
    signatureUrl: text("signature_url").notNull(),

    /** SHA-256 of the certificate as rendered at signing time. */
    certificateHash: varchar("certificate_hash", { length: 64 }),
    certificateUrl: text("certificate_url"),

    /** Weak evidence on its own, but worth having if a signature is disputed. */
    signedIp: varchar("signed_ip", { length: 45 }),
    signedUserAgent: text("signed_user_agent"),

    /** The name the homeowner typed under their signature. */
    signerName: text("signer_name"),
    /** Exactly what they were shown and signed; certificateHash is its SHA-256. */
    certificate: jsonb("certificate"),
  },
  (table) => [
    // One signature per project. Re-signing means voiding and reissuing, which
    // should be a deliberate act rather than a silent second row.
    uniqueIndex("project_signatures_project_idx").on(table.projectId),
  ]
);

// ---------------------------------------------------------- upload intents

/**
 * An upload link handed out and not yet used. The link's file is registered
 * (project_files, users.avatar_key) when the upload finishes, and the row goes.
 * A row older than a day is an abandoned upload: the scheduled job deletes
 * whatever reached storage under its key, so storage only holds files the
 * app knows about. Removed files are untouched; they were registered once and
 * stay restorable from the audit log.
 */
export const uploadIntents = pgTable(
  "upload_intents",
  {
    key: text("key").primaryKey(),
    uid: integer("uid").references(() => users.uid, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("upload_intents_created_idx").on(table.createdAt)]
);

// ------------------------------------------------------------- maintenance

/**
 * A system 9 Solar Home looks after once it's turned on (migration 0031).
 * A handed-over project becomes one by itself (project_id); systems from
 * before the app are imported (import_ref) and assigned to a manager later.
 * Values, who may write and the conversion are enforced in the migration.
 */
export const maintenanceSystems = pgTable(
  "maintenance_systems",
  {
    systemId: serial("system_id").primaryKey(),
    projectId: integer("project_id").references(() => projects.projectId, { onDelete: "set null" }),
    /** e.g. "listing-2026-08-28#12": the source sheet and its S/N. */
    importRef: text("import_ref"),
    address: text("address").notNull(),
    postalCode: varchar("postal_code", { length: 6 }),
    runBy: integer("run_by").references(() => users.uid, { onDelete: "set null" }),
    homeownerId: integer("homeowner_id").references(() => users.uid, { onDelete: "set null" }),
    homeownerName: text("homeowner_name"),
    homeownerContactNo: varchar("homeowner_contact_no", { length: 32 }),
    /** 'ppa' (with ppa_years) or 'value_buy'. */
    ppaKind: text("ppa_kind"),
    ppaYears: smallint("ppa_years"),
    planYears: smallint("plan_years"),
    /** "7 years excluding 1st year" rather than "Free for 7 years". */
    planExcludesFirstYear: boolean("plan_excludes_first_year"),
    /** [{ count: 23, wp: 635 }, { count: 3, wp: 620 }] */
    panels: jsonb("panels").notNull().default([]),
    kwp: numeric("kwp", { precision: 8, scale: 3 }),
    /** 1 (single-phase) or 3. */
    phase: smallint("phase"),
    inverters: text("inverters").array().notNull().default(sql`'{}'::text[]`),
    turnedOnOn: date("turned_on_on"),
    sixMonthDue: date("six_month_due"),
    sixMonthDoneOn: date("six_month_done_on"),
    oneYearDue: date("one_year_due"),
    oneYearDoneOn: date("one_year_done_on"),
    roofAccess: boolean("roof_access"),
    urgent: boolean("urgent").notNull().default(false),
    urgentNote: text("urgent_note"),
    notes: text("notes"),
    // The client record (0038): the project list's columns, kept with the system.
    projectCode: text("project_code"),
    salutation: text("salutation"),
    homeownerEmail: text("homeowner_email"),
    signedOn: date("signed_on"),
    salesperson: text("salesperson"),
    referrer: text("referrer"),
    solarPlan: text("solar_plan"),
    ratePerKwh: numeric("rate_per_kwh", { precision: 8, scale: 4 }),
    epc: text("epc"),
    inverterSerials: text("inverter_serials").array().notNull().default(sql`'{}'::text[]`),
    dongleSerials: text("dongle_serials").array().notNull().default(sql`'{}'::text[]`),
    installationStart: date("installation_start"),
    installationEnd: date("installation_end"),
    estMonthlyKwh: numeric("est_monthly_kwh", { precision: 10, scale: 2 }),
    billingPeriod: text("billing_period"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("maintenance_systems_project_idx").on(table.projectId),
    uniqueIndex("maintenance_systems_import_idx").on(table.importRef),
    // One homeowner, one system (0043).
    uniqueIndex("systems_one_per_homeowner").on(table.homeownerId).where(sql`${table.homeownerId} IS NOT NULL`),
    index("maintenance_systems_run_by_idx").on(table.runBy),
  ]
);

// ----------------------------------------------------------- notifications

/**
 * One row per recipient. Readable only by that person, enforced by the same
 * row level security mechanism as the audit log.
 */
export const notifications = pgTable(
  "notifications",
  {
    notificationId: bigserial("notification_id", { mode: "number" }).primaryKey(),
    recipientUid: integer("recipient_uid")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.projectId, {
      onDelete: "cascade",
    }),
    kind: notificationKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Where tapping the alert goes, e.g. /projects/7#site-visits. */
    link: text("link"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    index("notifications_recipient_idx").on(table.recipientUid, table.createdAt.desc()),
  ]
);

/**
 * A phone or browser where someone turned notifications on (Web Push). One
 * person can have several (phone, tablet, laptop). Removed when they turn it
 * off, or when the push service says the phone no longer accepts them.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    subscriptionId: serial("subscription_id").primaryKey(),
    uid: integer("uid")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    failures: integer("failures").notNull().default(0),
  },
  (table) => [index("push_subscriptions_uid_idx").on(table.uid)]
);

/**
 * One row per channel attempted, separate from the message itself.
 *
 * Email and WhatsApp fail and need retrying; in-app does not. Keeping delivery
 * apart means a failed WhatsApp send can be retried without duplicating the
 * notification or marking it unread again. providerMessageId is what lets a
 * later delivery receipt be reconciled back to the attempt.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    deliveryId: bigserial("delivery_id", { mode: "number" }).primaryKey(),
    notificationId: bigint("notification_id", { mode: "number" })
      .notNull()
      .references(() => notifications.notificationId, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    status: deliveryStatusEnum("status").notNull().default("queued"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    error: text("error"),
    providerMessageId: text("provider_message_id"),
  },
  (table) => [
    index("notification_deliveries_notification_idx").on(table.notificationId),
    // Finding what still needs sending or retrying.
    index("notification_deliveries_status_idx").on(table.status, table.queuedAt),
  ]
);

// ------------------------------------------------------------- relations

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  uploads: many(projectFiles),
}));

export const electricityRetailersRelations = relations(
  electricityRetailers,
  ({ many }) => ({ projects: many(projects) })
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  homeowner: one(users, {
    fields: [projects.homeownerId],
    references: [users.uid],
  }),
  electricityRetailer: one(electricityRetailers, {
    fields: [projects.electricityRetailerId],
    references: [electricityRetailers.retailerId],
  }),
  files: many(projectFiles),
}));

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, {
    fields: [projectFiles.projectId],
    references: [projects.projectId],
  }),
  uploader: one(users, {
    fields: [projectFiles.uploadedBy],
    references: [users.uid],
  }),
}));

// ----------------------------------------------------------------- types

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ElectricityRetailer = typeof electricityRetailers.$inferSelect;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type AccountRequest = typeof accountRequests.$inferSelect;
export type UserType = (typeof userTypeEnum.enumValues)[number];
export type FileCategory = (typeof fileCategoryEnum.enumValues)[number];
export type NewProjectFile = typeof projectFiles.$inferInsert;

// ------------------------------------------------------------------ meetings

/**
 * A meeting, on 30-minute marks (migration 0032). A maintenance check is a
 * meeting with system_id and check_key. Cancelled, not deleted, so it stays
 * on record. Who may write is enforced in the migration.
 */
export const meetings = pgTable(
  "meetings",
  {
    meetingId: serial("meeting_id").primaryKey(),
    title: text("title").notNull(),
    /** 'meeting' or 'maintenance_check'. */
    kind: text("kind").notNull().default("meeting"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** 'online', 'physical' (an address; 'site' and 'office' before 0042) or 'phone'; any can carry a video link. */
    place: text("place").notNull().default("online"),
    location: text("location"),
    /** A physical meeting's postal code, which found its address (0042). */
    postalCode: text("postal_code"),
    onlineLink: text("online_link"),
    /** When everyone is reminded, in minutes before the start: up to five, up to four weeks; an hour unless chosen (0042). */
    reminders: integer("reminders").array().notNull().default(sql`'{60}'::integer[]`),
    /** A repeating meeting: each time is its own meeting, sharing the first one's meeting_id (0042). */
    seriesId: integer("series_id"),
    /** How it repeats: 'daily', 'weekdays', 'weekly', 'fortnightly', 'monthly_day', 'monthly_weekday' or 'yearly'. */
    repeat: text("repeat"),
    notes: text("notes"),
    organiserId: integer("organiser_id")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.projectId, { onDelete: "set null" }),
    systemId: integer("system_id").references(() => maintenanceSystems.systemId, { onDelete: "set null" }),
    /** 'six_month' or 'one_year', for a maintenance check. */
    checkKey: text("check_key"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: integer("cancelled_by").references(() => users.uid, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("meetings_time_idx").on(table.startsAt, table.endsAt),
    index("meetings_system_idx").on(table.systemId, table.checkKey),
    index("meetings_series_idx").on(table.seriesId, table.startsAt),
  ]
);

/** Who's invited, the organiser too (accepted). An accepted meeting blocks that time in their calendar. */
export const meetingPeople = pgTable(
  "meeting_people",
  {
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.meetingId, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    /** 'pending', 'accepted' or 'declined'. */
    response: text("response").notNull().default("pending"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ name: "meeting_people_pk", columns: [table.meetingId, table.userId] }), index("meeting_people_user_idx").on(table.userId)]
);

/** Time a person has blocked out in their own calendar: an afternoon, or whole days at once. */
export const calendarBlocks = pgTable(
  "calendar_blocks",
  {
    blockId: serial("block_id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("calendar_blocks_user_idx").on(table.userId, table.startsAt)]
);

/** Which maintenance reminder (14 days before, on the day, overdue) went out for which check, so each goes once. */
export const maintenanceReminders = pgTable(
  "maintenance_reminders",
  {
    systemId: integer("system_id")
      .notNull()
      .references(() => maintenanceSystems.systemId, { onDelete: "cascade" }),
    checkKey: text("check_key").notNull(),
    due: date("due").notNull(),
    stage: text("stage").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "maintenance_reminders_pk", columns: [table.systemId, table.checkKey, table.due, table.stage] })]
);

/**
 * Which warning (a project gone late, an escalation, the morning summary)
 * went to whom about what, so each goes once (_lib/watch.py, 0034).
 */
export const watchAlerts = pgTable(
  "watch_alerts",
  {
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    recipientUid: integer("recipient_uid")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "watch_alerts_pk", columns: [table.kind, table.subject, table.recipientUid] }),
    check("watch_alerts_kind", sql`${table.kind} in ('project_late', 'escalation', 'daily_summary')`),
  ]
);

/**
 * A support conversation (0036): a homeowner asks; the assistant answers
 * what it can; a project manager settles the rest, bringing in anyone who
 * can help. status: assistant, waiting (for a person), open, settled.
 */
export const supportThreads = pgTable(
  "support_threads",
  {
    threadId: serial("thread_id").primaryKey(),
    subject: text("subject").notNull(),
    openedBy: integer("opened_by")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.projectId, { onDelete: "set null" }),
    handledBy: integer("handled_by").references(() => users.uid, { onDelete: "set null" }),
    status: text("status").notNull().default("assistant"),
    askedAt: timestamp("asked_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settledBy: integer("settled_by").references(() => users.uid, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("support_threads_opened_by_idx").on(table.openedBy),
    index("support_threads_handled_by_idx").on(table.handledBy),
    check(
      "support_threads_values",
      sql`${table.status} in ('assistant', 'waiting', 'open', 'settled') and btrim(${table.subject}) <> '' and length(${table.subject}) <= 120`
    ),
  ]
);

/** Who is in a support conversation, and how far each has read. */
export const supportMembers = pgTable(
  "support_members",
  {
    threadId: integer("thread_id")
      .notNull()
      .references(() => supportThreads.threadId, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    addedBy: integer("added_by"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    lastReadId: bigint("last_read_id", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    primaryKey({ name: "support_members_pk", columns: [table.threadId, table.userId] }),
    index("support_members_user_idx").on(table.userId),
  ]
);

/** What was said in a support conversation. Insert only. kind: text, assistant, event, call (a video call link, 0037). */
export const supportMessages = pgTable(
  "support_messages",
  {
    messageId: bigserial("message_id", { mode: "number" }).primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => supportThreads.threadId, { onDelete: "cascade" }),
    senderUid: integer("sender_uid").references(() => users.uid, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("text"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("support_messages_thread_idx").on(table.threadId, table.messageId),
    check(
      "support_messages_values",
      sql`${table.kind} in ('text', 'assistant', 'event', 'call') and btrim(${table.body}) <> '' and length(${table.body}) <= 4000 and ((${table.kind} = 'assistant') = (${table.senderUid} is null)) and (${table.kind} <> 'call' or ${table.body} ~ '^https://[^\\s]+$')`
    ),
  ]
);

/** The assistant's answers to common questions, kept by project managers. Turned off, never deleted. */
export const supportFaq = pgTable(
  "support_faq",
  {
    faqId: serial("faq_id").primaryKey(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    questionZh: text("question_zh"),
    answerZh: text("answer_zh"),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    updatedBy: integer("updated_by").references(() => users.uid, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "support_faq_values",
      sql`btrim(${table.question}) <> '' and length(${table.question}) <= 300 and btrim(${table.answer}) <> '' and length(${table.answer}) <= 3000 and (${table.questionZh} is null or length(${table.questionZh}) <= 300) and (${table.answerZh} is null or length(${table.answerZh}) <= 3000)`
    ),
  ]
);

/** kWh a system generated each month (0038). */
export const systemOutput = pgTable(
  "system_output",
  {
    systemId: integer("system_id")
      .notNull()
      .references(() => maintenanceSystems.systemId, { onDelete: "cascade" }),
    month: date("month").notNull(),
    kwh: numeric("kwh", { precision: 10, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "system_output_pk", columns: [table.systemId, table.month] })]
);

/** A system's billing period for each month (0038). */
export const systemBilling = pgTable(
  "system_billing",
  {
    systemId: integer("system_id")
      .notNull()
      .references(() => maintenanceSystems.systemId, { onDelete: "cascade" }),
    month: date("month").notNull(),
    period: text("period").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "system_billing_pk", columns: [table.systemId, table.month] })]
);

/** What a homeowner said, on a project or a system (0038). */
export const clientFeedback = pgTable("client_feedback", {
  feedbackId: serial("feedback_id").primaryKey(),
  projectId: integer("project_id").references(() => projects.projectId, { onDelete: "cascade" }),
  systemId: integer("system_id").references(() => maintenanceSystems.systemId, { onDelete: "cascade" }),
  body: text("body").notNull(),
  importRef: text("import_ref"),
  createdBy: integer("created_by").references(() => users.uid, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Each inverter model's phase, price and warranty: project managers' reference (0038). */
export const inverterModels = pgTable("inverter_models", {
  /** The model with spaces and "TL" taken out, so the list's spellings match. */
  modelKey: text("model_key").primaryKey(),
  model: text("model").notNull(),
  phase: smallint("phase"),
  priceExGst: numeric("price_ex_gst", { precision: 10, scale: 2 }),
  priceInclGst: numeric("price_incl_gst", { precision: 10, scale: 2 }),
  warrantyYears: smallint("warranty_years"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Which meeting reminder went to whom, for which start time: its minutes before ('day' and 'soon' before 0042). */
export const meetingReminders = pgTable(
  "meeting_reminders",
  {
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.meetingId, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "meeting_reminders_pk", columns: [table.meetingId, table.userId, table.stage, table.startsAt] })]
);

/** Each Excel export: who took which list (projects or people) and how many rows. Insert only, and audited. */
export const dataExports = pgTable("data_exports", {
  exportId: serial("export_id").primaryKey(),
  /** 'projects' or 'people'. */
  what: text("what").notNull(),
  rowCount: integer("row_count").notNull(),
  exportedBy: integer("exported_by")
    .notNull()
    .references(() => users.uid, { onDelete: "cascade" }),
  exportedAt: timestamp("exported_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- payments (0043)

/**
 * The company's details for the invoice's header, its PayNow QR, the admin
 * fee, the plan's length and days to pay, and the invoice's design. One row.
 * Written by Admin and superadmins only.
 */
export const financeSettings = pgTable(
  "finance_settings",
  {
    id: integer("id").primaryKey().default(1),
    companyName: text("company_name").notNull().default("9 Solar Home"),
    companyAddress: text("company_address"),
    companyUen: text("company_uen"),
    companyEmail: text("company_email"),
    companyPhone: text("company_phone"),
    logoKey: text("logo_key"),
    qrKey: text("qr_key"),
    payNote: text("pay_note").notNull(),
    adminFee: numeric("admin_fee", { precision: 12, scale: 2 }).notNull().default("3500"),
    planYears: integer("plan_years").notNull().default(8),
    dueDays: integer("due_days").notNull().default(14),
    accent: text("accent").notNull().default("#0B8A5A"),
    invoiceTitle: text("invoice_title").notNull().default("INVOICE"),
    intro: text("intro"),
    footer: text("footer"),
    terms: text("terms"),
    /** Which parts the invoice shows: logo, qr, uen, kwh, terms. */
    show: jsonb("show").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer("updated_by"),
  },
  (table) => [check("finance_settings_one", sql`${table.id} = 1`)]
);

/**
 * What a homeowner owes: the admin fee (a project's, paid before its
 * handover) or a month's solar power (a system's: kWh x the contract's rate).
 * Issued, then paid (marked by Admin, or matched from the bank's statement)
 * or voided; never deleted.
 */
export const invoices = pgTable(
  "invoices",
  {
    invoiceId: serial("invoice_id").primaryKey(),
    /** 'INV-2026-00042'. */
    number: text("number").notNull(),
    /** 'admin_fee' or 'monthly'. */
    kind: text("kind").notNull(),
    projectId: integer("project_id").references(() => projects.projectId, { onDelete: "set null" }),
    systemId: integer("system_id").references(() => maintenanceSystems.systemId, { onDelete: "set null" }),
    homeownerId: integer("homeowner_id").references(() => users.uid, { onDelete: "set null" }),
    billTo: text("bill_to").notNull(),
    billAddress: text("bill_address"),
    billEmail: text("bill_email"),
    /** The month a monthly invoice is for (its first day). */
    period: date("period"),
    kwh: numeric("kwh", { precision: 10, scale: 2 }),
    rate: numeric("rate", { precision: 10, scale: 4 }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    issuedOn: date("issued_on").notNull().defaultNow(),
    dueOn: date("due_on").notNull(),
    /** 'issued', 'paid' or 'void'. */
    status: text("status").notNull().default("issued"),
    paidOn: date("paid_on"),
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }),
    /** 'manual' (marked by Admin) or 'statement' (matched from the bank's statement). */
    paidVia: text("paid_via"),
    paidRef: text("paid_ref"),
    confirmedBy: integer("confirmed_by"),
    /** Proof of payment the homeowner attached. */
    proofKey: text("proof_key"),
    proofAt: timestamp("proof_at", { withTimezone: true }),
    proofNote: text("proof_note"),
    voidReason: text("void_reason"),
    notes: text("notes"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invoices_number_idx").on(table.number),
    uniqueIndex("invoices_one_fee_idx").on(table.projectId).where(sql`${table.kind} = 'admin_fee' AND ${table.status} <> 'void'`),
    uniqueIndex("invoices_one_month_idx").on(table.systemId, table.period).where(sql`${table.kind} = 'monthly' AND ${table.status} <> 'void'`),
    index("invoices_homeowner_idx").on(table.homeownerId),
  ]
);

/** Each bank statement uploaded: its credits, what each matched, and when Admin confirmed them. */
export const bankStatements = pgTable("bank_statements", {
  statementId: serial("statement_id").primaryKey(),
  fileName: text("file_name").notNull(),
  lines: jsonb("lines").notNull().default(sql`'[]'::jsonb`),
  matched: integer("matched").notNull().default(0),
  uploadedBy: integer("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

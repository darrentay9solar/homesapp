import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
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
  "closed",
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
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "email",
  "whatsapp",
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

    active: boolean("active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive: nobody should be able to register Bob@x.com alongside
    // bob@x.com and end up with two profiles for one person.
    uniqueIndex("users_email_lower_idx").on(table.email),
    // Three digits then the checksum letter. Rejects a full NRIC outright, so
    // one cannot arrive through a stray import, a seed script or a fixture.
    check("users_ic_last4_format", sql`${table.icLast4} ~ '^[0-9]{3}[A-Za-z]$'`),
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

  address: text("address").notNull(),

  /**
   * One homeowner per project, per the spec. Restricted rather than cascading:
   * deleting a person should never silently delete their installation record.
   */
  homeownerId: integer("homeowner_id").references(() => users.uid, {
    onDelete: "restrict",
  }),

  // ---- installation -----------------------------------------------------
  installationStartDate: date("installation_start_date"),
  installationEndDate: date("installation_end_date"),

  /** Homeowner approval gate from the original brief. */
  confirmedByHomeowner: boolean("confirmed_by_homeowner"),

  waterproofing: boolean("waterproofing"),
  createGroupChat: boolean("create_group_chat"),

  // ---- panels and inverter ----------------------------------------------
  panelQuantityEstimate: integer("panel_quantity_estimate"),
  panelQuantityActual: integer("panel_quantity_actual"),

  /** Watt-peak per panel. Stored as an integer; see README on units. */
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
  spApplicationStatus: boolean("sp_application_status"),
  spSubmissionDate: date("sp_submission_date"),
  pvlReceivedDate: date("pvl_received_date"),
  preInspectionDate: date("pre_inspection_date"),
  spAppointmentLetterReceivedDate: date("sp_appointment_letter_received_date"),
  meterReplacementDate: date("meter_replacement_date"),
  spTurnOnInspectionDate: date("sp_turn_on_inspection_date"),

  // ---- handover ----------------------------------------------------------
  asBuiltPvLayout: boolean("as_built_pv_layout"),
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

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    index("notifications_recipient_idx").on(table.recipientUid, table.createdAt.desc()),
  ]
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
export type NewProjectFile = typeof projectFiles.$inferInsert;

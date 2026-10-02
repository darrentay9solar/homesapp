import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  pgEnum,
  pgTable,
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

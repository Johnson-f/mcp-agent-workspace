import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { ownerScopeType } from "./artifacts";

export const automationState = pgEnum("automation_state", [
  "draft",
  "pending_approval",
  "live",
  "paused",
  "needs_reconfiguration",
  "archived",
]);

export const automationVersionState = pgEnum("automation_version_state", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "superseded",
]);

export const automationScheduleKind = pgEnum("automation_schedule_kind", [
  "manual_only",
  "recurring",
]);

export const automationMissedRunPolicy = pgEnum(
  "automation_missed_run_policy",
  ["skip", "backfill_if_enabled"],
);

export const automationOverlapPolicy = pgEnum("automation_overlap_policy", [
  "skip",
  "queue_one",
  "cancel_old",
  "allow_overlap",
]);

export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    ownerType: ownerScopeType("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    title: text("title").notNull(),
    state: automationState("state").notNull().default("draft"),
    currentVersionId: uuid("current_version_id"),
    temporalScheduleId: text("temporal_schedule_id"),
    consecutiveFailureCount: integer("consecutive_failure_count")
      .notNull()
      .default(0),
    failureThreshold: integer("failure_threshold").notNull().default(3),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", {
      withTimezone: true,
      mode: "date",
    }),
    liveAt: timestamp("live_at", { withTimezone: true, mode: "date" }),
    pausedAt: timestamp("paused_at", { withTimezone: true, mode: "date" }),
    needsReconfigurationAt: timestamp("needs_reconfiguration_at", {
      withTimezone: true,
      mode: "date",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("automations_owner_state_idx").on(
      table.ownerType,
      table.ownerId,
      table.state,
    ),
    index("automations_owner_created_idx").on(
      table.ownerType,
      table.ownerId,
      table.createdAt.desc(),
    ),
    uniqueIndex("automations_temporal_schedule_uidx").on(
      table.temporalScheduleId,
    ),
    check(
      "automations_failure_count_check",
      sql`${table.consecutiveFailureCount} >= 0`,
    ),
    check(
      "automations_failure_threshold_check",
      sql`${table.failureThreshold} > 0`,
    ),
  ],
);

export const automationVersions = pgTable(
  "automation_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    state: automationVersionState("state").notNull().default("draft"),
    runBriefVersionId: uuid("run_brief_version_id").notNull(),
    scheduleKind: automationScheduleKind("schedule_kind").notNull(),
    scheduleTimezone: text("schedule_timezone").notNull(),
    scheduleRule: text("schedule_rule"),
    missedRunPolicy: automationMissedRunPolicy("missed_run_policy")
      .notNull()
      .default("skip"),
    overlapPolicy: automationOverlapPolicy("overlap_policy")
      .notNull()
      .default("skip"),
    scheduleConfig: jsonb("schedule_config")
      .$type<Record<string, unknown>>()
      .notNull(),
    runBudget: jsonb("run_budget").$type<Record<string, unknown>>().notNull(),
    outputDestination: jsonb("output_destination")
      .$type<Record<string, unknown>>()
      .notNull(),
    retentionPolicy: jsonb("retention_policy")
      .$type<Record<string, unknown>>()
      .notNull(),
    toolAuthorizationSnapshot: jsonb("tool_authorization_snapshot")
      .$type<Record<string, unknown>[]>()
      .notNull(),
    activationPreflight: jsonb("activation_preflight")
      .$type<Record<string, unknown>>(),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", {
      withTimezone: true,
      mode: "date",
    }),
    activatedAt: timestamp("activated_at", {
      withTimezone: true,
      mode: "date",
    }),
    supersededByVersionId: uuid("superseded_by_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("automation_versions_number_uidx").on(
      table.automationId,
      table.versionNumber,
    ),
    index("automation_versions_automation_state_idx").on(
      table.automationId,
      table.state,
    ),
    index("automation_versions_run_brief_idx").on(table.runBriefVersionId),
    check("automation_versions_number_check", sql`${table.versionNumber} > 0`),
    check(
      "automation_versions_recurring_rule_check",
      sql`${table.scheduleKind} = 'manual_only' OR ${table.scheduleRule} IS NOT NULL`,
    ),
  ],
);

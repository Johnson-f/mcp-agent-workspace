import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { ownerScopeType } from "./artifacts";

export const runKind = pgEnum("run_kind", ["agent", "automation"]);

export const automationRunTriggerSource = pgEnum(
	"automation_run_trigger_source",
	["manual", "scheduled"],
);

export const runState = pgEnum("run_state", [
	"queued",
	"running",
	"waiting_for_user",
	"completed",
	"completed_partial",
	"failed",
	"cancelled",
	"expired",
	"skipped",
]);

export const runStepType = pgEnum("run_step_type", [
	"message",
	"brief_created",
	"tool_selected",
	"tool_call_started",
	"tool_call_completed",
	"tool_call_failed",
	"approval_requested",
	"approval_granted",
	"approval_rejected",
	"evidence_degraded",
	"budget_reached",
	"final_output",
	"run_failed",
]);

export const auditActorType = pgEnum("audit_actor_type", [
	"user",
	"system",
	"worker",
]);

export const runs = pgTable(
	"runs",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		ownerType: ownerScopeType("owner_type").notNull(),
		ownerId: uuid("owner_id").notNull(),
		kind: runKind("kind").notNull(),
		state: runState("state").notNull().default("queued"),
		title: text("title").notNull(),
		conversationId: uuid("conversation_id"),
		runBriefVersionId: uuid("run_brief_version_id"),
		automationId: uuid("automation_id"),
		automationVersionId: uuid("automation_version_id"),
		temporalWorkflowId: text("temporal_workflow_id"),
		temporalRunId: text("temporal_run_id"),
		startedByUserId: uuid("started_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		triggerSource: automationRunTriggerSource("trigger_source"),
		triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		scheduledFireTime: timestamp("scheduled_fire_time", {
			withTimezone: true,
			mode: "date",
		}),
		finalRunStepId: uuid("final_run_step_id"),
		finalArtifactIds: jsonb("final_artifact_ids")
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		budgetUsage: jsonb("budget_usage")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		failure: jsonb("failure").$type<Record<string, unknown>>(),
		queuedAt: timestamp("queued_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
		completedAt: timestamp("completed_at", {
			withTimezone: true,
			mode: "date",
		}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("runs_owner_created_idx").on(
			table.ownerType,
			table.ownerId,
			table.createdAt.desc(),
		),
		index("runs_state_created_idx").on(table.state, table.createdAt),
		index("runs_temporal_workflow_idx").on(table.temporalWorkflowId),
		check(
			"runs_automation_parent_check",
			sql`(${table.kind} = 'agent' AND ${table.automationId} IS NULL AND ${table.automationVersionId} IS NULL) OR (${table.kind} = 'automation' AND ${table.automationId} IS NOT NULL AND ${table.automationVersionId} IS NOT NULL)`,
		),
	],
);

export const runSteps = pgTable(
	"run_steps",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		runId: uuid("run_id")
			.notNull()
			.references(() => runs.id, { onDelete: "cascade" }),
		ownerType: ownerScopeType("owner_type").notNull(),
		ownerId: uuid("owner_id").notNull(),
		type: runStepType("type").notNull(),
		summary: text("summary").notNull(),
		visibleToUser: boolean("visible_to_user").notNull().default(true),
		relatedArtifactIds: jsonb("related_artifact_ids")
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		redactedMetadata: jsonb("redacted_metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		occurredAt: timestamp("occurred_at", {
			withTimezone: true,
			mode: "date",
		})
			.notNull()
			.defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("run_steps_run_occurred_idx").on(table.runId, table.occurredAt),
		index("run_steps_owner_occurred_idx").on(
			table.ownerType,
			table.ownerId,
			table.occurredAt.desc(),
		),
	],
);

export const auditLogEvents = pgTable(
	"audit_log_events",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		ownerType: ownerScopeType("owner_type").notNull(),
		ownerId: uuid("owner_id").notNull(),
		actorType: auditActorType("actor_type").notNull(),
		actorUserId: uuid("actor_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		eventName: text("event_name").notNull(),
		targetType: text("target_type").notNull(),
		targetId: text("target_id").notNull(),
		runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
		redactedMetadata: jsonb("redacted_metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("audit_log_events_owner_created_idx").on(
			table.ownerType,
			table.ownerId,
			table.createdAt.desc(),
		),
		index("audit_log_events_run_created_idx").on(table.runId, table.createdAt),
		index("audit_log_events_target_idx").on(table.targetType, table.targetId),
	],
);

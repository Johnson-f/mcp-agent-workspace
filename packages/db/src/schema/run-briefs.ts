import { sql } from "drizzle-orm";
import {
	boolean,
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
import { automations } from "./automations";
import { mcpConnections } from "./mcp-connections";
import { mcpTools } from "./mcp-tools";

export const conversationState = pgEnum("conversation_state", [
	"drafting",
	"awaiting_user_input",
	"ready_for_run_brief",
	"run_brief_created",
	"closed",
]);

export const conversationMessageRole = pgEnum("conversation_message_role", [
	"user",
	"assistant",
	"system",
]);

export const runBriefVersionState = pgEnum("run_brief_version_state", [
	"draft",
	"pending_approval",
	"approved",
	"rejected",
	"superseded",
]);

export const runBriefMode = pgEnum("run_brief_mode", [
	"manual_agent_run",
	"automation",
]);

export const toolAuthorizationSnapshotState = pgEnum(
	"tool_authorization_snapshot_state",
	["proposed", "approved", "rejected", "revoked", "stale"],
);

export const conversations = pgTable(
	"conversations",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		ownerType: ownerScopeType("owner_type").notNull(),
		ownerId: uuid("owner_id").notNull(),
		title: text("title").notNull(),
		state: conversationState("state").notNull().default("drafting"),
		pinnedAt: timestamp("pinned_at", { withTimezone: true, mode: "date" }),
		archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
		automationId: uuid("automation_id").references(() => automations.id, {
			onDelete: "set null",
		}),
		createdByUserId: uuid("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("conversations_owner_updated_idx").on(
			table.ownerType,
			table.ownerId,
			table.updatedAt.desc(),
		),
		index("conversations_created_by_idx").on(table.createdByUserId),
		index("conversations_owner_pinned_updated_idx").on(
			table.ownerType,
			table.ownerId,
			table.pinnedAt.desc(),
			table.updatedAt.desc(),
		),
	],
);

export const conversationMessages = pgTable(
	"conversation_messages",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		role: conversationMessageRole("role").notNull(),
		content: text("content").notNull(),
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		contributedToRunBriefVersionId: uuid("contributed_to_run_brief_version_id"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
	},
	(table) => [
    index("conversation_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    uniqueIndex("conversation_messages_client_message_uidx")
      .on(
        table.conversationId,
        sql`(${table.metadata} ->> 'clientMessageId')`,
      )
      .where(
        sql`${table.role} = 'user' AND (${table.metadata} ->> 'clientMessageId') IS NOT NULL`,
      ),
  ],
);

export const runBriefs = pgTable(
	"run_briefs",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		ownerType: ownerScopeType("owner_type").notNull(),
		ownerId: uuid("owner_id").notNull(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		currentVersionId: uuid("current_version_id"),
		createdByUserId: uuid("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("run_briefs_conversation_idx").on(table.conversationId),
		index("run_briefs_owner_updated_idx").on(
			table.ownerType,
			table.ownerId,
			table.updatedAt.desc(),
		),
	],
);

export const runBriefVersions = pgTable(
	"run_brief_versions",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		runBriefId: uuid("run_brief_id")
			.notNull()
			.references(() => runBriefs.id, { onDelete: "cascade" }),
		versionNumber: integer("version_number").notNull(),
		mode: runBriefMode("mode").notNull(),
		state: runBriefVersionState("state").notNull(),
		schemaVersion: text("schema_version").notNull(),
		structuredBrief: jsonb("structured_brief")
			.$type<Record<string, unknown>>()
			.notNull(),
		evaluation: jsonb("evaluation").$type<Record<string, unknown>>().notNull(),
		approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		approvedAt: timestamp("approved_at", {
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
		uniqueIndex("run_brief_versions_number_uidx").on(
			table.runBriefId,
			table.versionNumber,
		),
		index("run_brief_versions_run_brief_state_idx").on(
			table.runBriefId,
			table.state,
		),
		check("run_brief_versions_number_check", sql`${table.versionNumber} > 0`),
	],
);

export const toolAuthorizationSnapshots = pgTable(
	"tool_authorization_snapshots",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		ownerType: ownerScopeType("owner_type").notNull(),
		ownerId: uuid("owner_id").notNull(),
		runBriefVersionId: uuid("run_brief_version_id")
			.notNull()
			.references(() => runBriefVersions.id, { onDelete: "cascade" }),
		state: toolAuthorizationSnapshotState("state").notNull(),
		mcpConnectionId: uuid("mcp_connection_id").references(
			() => mcpConnections.id,
			{ onDelete: "set null" },
		),
		mcpToolId: uuid("mcp_tool_id").references(() => mcpTools.id, {
			onDelete: "set null",
		}),
		serverId: text("server_id"),
		toolName: text("tool_name").notNull(),
		required: boolean("required").notNull(),
		writeCapable: boolean("write_capable").notNull(),
		schemaHash: text("schema_hash").notNull(),
		annotationHash: text("annotation_hash").notNull(),
		annotations: jsonb("annotations").$type<Record<string, unknown>>(),
		acknowledgedWriteCapability: boolean("acknowledged_write_capability")
			.notNull()
			.default(false),
		allowedOutcomeBoundary: text("allowed_outcome_boundary"),
		reason: text("reason").notNull(),
		approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		approvedAt: timestamp("approved_at", {
			withTimezone: true,
			mode: "date",
		}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("tool_auth_snapshots_run_brief_idx").on(table.runBriefVersionId),
		index("tool_auth_snapshots_owner_state_idx").on(
			table.ownerType,
			table.ownerId,
			table.state,
		),
	],
);

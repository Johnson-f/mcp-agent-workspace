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
import { artifacts } from "./artifacts";
import { conversationAgentTurns } from "./interactive-agent";
import { mcpConnections } from "./mcp-connections";
import { mcpTools } from "./mcp-tools";
import { conversations } from "./run-briefs";

export const mcpToolCallStatus = pgEnum("mcp_tool_call_status", [
  "pending",
  "awaiting_approval",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "denied",
]);

export const mcpApprovalStatus = pgEnum("mcp_approval_status", [
  "not_required",
  "pending",
  "approved",
  "rejected",
]);

export const mcpToolCalls = pgTable(
  "mcp_tool_calls",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => mcpConnections.id, {
      onDelete: "set null",
    }),
    toolId: uuid("tool_id").references(() => mcpTools.id, {
      onDelete: "set null",
    }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    agentTurnId: uuid("agent_turn_id").references(
      () => conversationAgentTurns.id,
      { onDelete: "set null" },
    ),
    stepNumber: integer("step_number"),
    argumentsArtifactId: uuid("arguments_artifact_id").references(
      () => artifacts.id,
      { onDelete: "set null" },
    ),
    resultArtifactId: uuid("result_artifact_id").references(() => artifacts.id, {
      onDelete: "set null",
    }),
    agentReason: text("agent_reason"),
    riskClassification: text("risk_classification"),
    idempotencyKey: text("idempotency_key").notNull(),
    connectionName: text("connection_name").notNull(),
    toolName: text("tool_name").notNull(),
    argumentsRedacted: jsonb("arguments_redacted")
      .$type<Record<string, unknown>>()
      .notNull(),
    argumentsHash: text("arguments_hash").notNull(),
    resultRedacted: jsonb("result_redacted").$type<unknown>(),
    status: mcpToolCallStatus("status").notNull().default("pending"),
    approvalStatus: mcpApprovalStatus("approval_status")
      .notNull()
      .default("pending"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    deniedAt: timestamp("denied_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_tool_calls_user_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("mcp_tool_calls_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    index("mcp_tool_calls_connection_created_idx").on(
      table.connectionId,
      table.createdAt.desc(),
    ),
    index("mcp_tool_calls_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    check(
      "mcp_tool_calls_duration_ms_check",
      sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`,
    ),
  ],
);

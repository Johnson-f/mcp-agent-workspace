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
import { mcpToolCalls } from "./mcp-audit";
import { conversationMessages, conversations } from "./run-briefs";

export const conversationActivityKind = pgEnum("conversation_activity_kind", [
  "reasoning_summary",
  "tool",
  "automation",
  "status",
]);

export const conversationActivityStatus = pgEnum(
  "conversation_activity_status",
  ["running", "waiting", "completed", "failed", "incomplete"],
);

export const conversationTurnActivities = pgTable(
  "conversation_turn_activities",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id").notNull(),
    assistantMessageId: uuid("assistant_message_id").references(
      () => conversationMessages.id,
      { onDelete: "set null" },
    ),
    sequence: integer("sequence").notNull(),
    kind: conversationActivityKind("kind").notNull(),
    status: conversationActivityStatus("status").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    toolCallId: uuid("tool_call_id").references(() => mcpToolCalls.id, {
      onDelete: "set null",
    }),
    publicMetadata: jsonb("public_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_turn_activities_turn_sequence_uidx").on(
      table.turnId,
      table.sequence,
    ),
    uniqueIndex("conversation_turn_activities_tool_call_uidx")
      .on(table.toolCallId)
      .where(sql`${table.toolCallId} IS NOT NULL`),
    index("conversation_turn_activities_conversation_started_idx").on(
      table.conversationId,
      table.startedAt,
      table.sequence,
    ),
    check("conversation_turn_activities_sequence_check", sql`${table.sequence} > 0`),
    check("conversation_turn_activities_title_check", sql`char_length(${table.title}) <= 200`),
    check(
      "conversation_turn_activities_content_check",
      sql`${table.content} IS NULL OR char_length(${table.content}) <= 16384`,
    ),
  ],
);

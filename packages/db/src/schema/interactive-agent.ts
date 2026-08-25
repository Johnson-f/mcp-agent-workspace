import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { conversationMessages, conversations } from "./run-briefs";

export const interactiveAgentApprovalPolicy = pgEnum(
  "interactive_agent_approval_policy",
  ["always_ask", "tool_policy", "auto_approve_eligible"],
);

export const conversationAgentTurnState = pgEnum(
  "conversation_agent_turn_state",
  [
    "running",
    "awaiting_approval",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ],
);

export const interactiveAgentPreferences = pgTable(
  "interactive_agent_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    approvalPolicy: interactiveAgentApprovalPolicy("approval_policy")
      .notNull()
      .default("always_ask"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
);

export const conversationAgentTurns = pgTable(
  "conversation_agent_turns",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userMessageId: uuid("user_message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    assistantMessageId: uuid("assistant_message_id").references(
      () => conversationMessages.id,
      { onDelete: "set null" },
    ),
    state: conversationAgentTurnState("state").notNull().default("running"),
    stepCount: integer("step_count").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
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
    index("conversation_agent_turns_conversation_updated_idx").on(
      table.conversationId,
      table.updatedAt.desc(),
    ),
    uniqueIndex("conversation_agent_turns_user_message_uidx").on(
      table.userMessageId,
    ),
  ],
);

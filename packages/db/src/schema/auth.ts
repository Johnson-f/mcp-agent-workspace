import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userStatus = pgEnum("user_status", ["active", "disabled"]);

export const webhookEventStatus = pgEnum("webhook_event_status", [
  "pending",
  "processed",
  "failed",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    stytchUserId: text("stytch_user_id").notNull().unique(),
    primaryEmail: text("primary_email"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    status: userStatus("status").notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", {
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
  (table) => [index("users_status_idx").on(table.status)],
);

export const stytchWebhookEvents = pgTable(
  "stytch_webhook_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: webhookEventStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastError: text("last_error"),
  },
  (table) => [
    index("stytch_webhook_events_status_received_idx").on(
      table.status,
      table.receivedAt,
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { mcpConnections } from "./mcp-connections";

export const mcpApprovalMode = pgEnum("mcp_approval_mode", [
  "always",
  "risky",
  "never",
]);

export const mcpTools = pgTable(
  "mcp_tools",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => mcpConnections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    description: text("description"),
    inputSchema: jsonb("input_schema")
      .$type<Record<string, unknown>>()
      .notNull(),
    outputSchema: jsonb("output_schema").$type<Record<string, unknown>>(),
    annotations: jsonb("annotations").$type<Record<string, unknown>>(),
    schemaHash: text("schema_hash").notNull(),
    annotationHash: text("annotation_hash").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    available: boolean("available").notNull().default(true),
    approvalMode: mcpApprovalMode("approval_mode")
      .notNull()
      .default("always"),
    discoveredAt: timestamp("discovered_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_tools_connection_name_uidx").on(
      table.connectionId,
      table.name,
    ),
    index("mcp_tools_connection_enabled_idx").on(
      table.connectionId,
      table.enabled,
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const mcpTransport = pgEnum("mcp_transport", [
  "streamable_http",
  "sse",
  "stdio",
]);

export const mcpAuthType = pgEnum("mcp_auth_type", [
  "none",
  "bearer",
  "oauth2",
  "custom_headers",
]);

export const mcpConnectionStatus = pgEnum("mcp_connection_status", [
  "pending",
  "auth_required",
  "connected",
  "error",
  "disabled",
]);

export const mcpConnections = pgTable(
  "mcp_connections",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    transport: mcpTransport("transport").notNull(),
    endpointUrl: text("endpoint_url"),
    command: text("command"),
    commandArgs: jsonb("command_args").$type<string[]>(),
    authType: mcpAuthType("auth_type").notNull().default("none"),
    status: mcpConnectionStatus("status").notNull().default("pending"),
    serverName: text("server_name"),
    serverVersion: text("server_version"),
    protocolVersion: text("protocol_version"),
    capabilities: jsonb("capabilities").$type<Record<string, unknown>>(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    lastConnectedAt: timestamp("last_connected_at", {
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
    uniqueIndex("mcp_connections_user_name_uidx").on(
      table.userId,
      table.name,
    ),
    index("mcp_connections_user_status_idx").on(table.userId, table.status),
    check(
      "mcp_connections_transport_config_check",
      sql`(${table.transport} IN ('streamable_http', 'sse') AND ${table.endpointUrl} IS NOT NULL AND ${table.command} IS NULL) OR (${table.transport} = 'stdio' AND ${table.command} IS NOT NULL AND ${table.endpointUrl} IS NULL)`,
    ),
  ],
);

export const mcpCredentials = pgTable(
  "mcp_credentials",
  {
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => mcpConnections.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce").notNull(),
    authTag: text("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId] }),
    check("mcp_credentials_key_version_check", sql`${table.keyVersion} > 0`),
  ],
);

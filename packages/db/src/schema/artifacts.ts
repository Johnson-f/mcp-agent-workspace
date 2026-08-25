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

export const ownerScopeType = pgEnum("owner_scope_type", [
  "user",
  "workspace",
]);

export const artifactPurpose = pgEnum("artifact_purpose", [
  "tool_arguments",
  "tool_result",
  "model_prompt",
  "model_output",
  "checkpoint_state",
  "final_output",
  "evidence",
  "delivery_payload",
  "other",
]);

export const artifactStorageKind = pgEnum("artifact_storage_kind", [
  "postgres_encrypted",
  "object_encrypted",
]);

export const artifactSensitivity = pgEnum("artifact_sensitivity", [
  "low",
  "sensitive",
  "restricted",
]);

export const artifactRetentionState = pgEnum("artifact_retention_state", [
  "active",
  "raw_deleted",
  "deleted",
]);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    ownerType: ownerScopeType("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    runId: uuid("run_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    purpose: artifactPurpose("purpose").notNull(),
    sensitivity: artifactSensitivity("sensitivity").notNull(),
    storageKind: artifactStorageKind("storage_kind").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteLength: integer("byte_length").notNull(),
    sha256Hash: text("sha256_hash").notNull(),
    encryptionAlgorithm: text("encryption_algorithm").notNull(),
    encryptionKeyVersion: integer("encryption_key_version").notNull(),
    encryptionKeyId: text("encryption_key_id").notNull(),
    encryptionNonce: text("encryption_nonce").notNull(),
    encryptionAuthTag: text("encryption_auth_tag").notNull(),
    redactedSummary: jsonb("redacted_summary")
      .$type<Record<string, unknown>>()
      .notNull(),
    retentionPolicy: jsonb("retention_policy")
      .$type<Record<string, unknown>>()
      .notNull(),
    rawRetainUntil: timestamp("raw_retain_until", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    summaryRetainUntil: timestamp("summary_retain_until", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    retentionState: artifactRetentionState("retention_state")
      .notNull()
      .default("active"),
    rawDeletedAt: timestamp("raw_deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("artifacts_storage_key_uidx").on(table.storageKey),
    index("artifacts_owner_created_idx").on(
      table.ownerType,
      table.ownerId,
      table.createdAt.desc(),
    ),
    index("artifacts_run_created_idx").on(table.runId, table.createdAt.desc()),
    index("artifacts_raw_retention_idx").on(
      table.retentionState,
      table.rawRetainUntil,
    ),
    index("artifacts_summary_retention_idx").on(
      table.retentionState,
      table.summaryRetainUntil,
    ),
    check("artifacts_byte_length_check", sql`${table.byteLength} >= 0`),
    check(
      "artifacts_encryption_key_version_check",
      sql`${table.encryptionKeyVersion} > 0`,
    ),
    check(
      "artifacts_retention_window_check",
      sql`${table.summaryRetainUntil} >= ${table.rawRetainUntil}`,
    ),
  ],
);

export const artifactBlobs = pgTable(
  "artifact_blobs",
  {
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.artifactId] })],
);

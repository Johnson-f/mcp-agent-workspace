import { and, eq, lte } from "drizzle-orm";
import { getDatabase } from "./client";
import { artifactBlobs, artifacts } from "./schema";

export type ArtifactOwnerType = "user" | "workspace";

export interface ArtifactOwnerScope {
  ownerType: ArtifactOwnerType;
  ownerId: string;
}

export type ArtifactPurpose =
  | "tool_arguments"
  | "tool_result"
  | "model_prompt"
  | "model_output"
  | "checkpoint_state"
  | "final_output"
  | "evidence"
  | "delivery_payload"
  | "other";

export type ArtifactSensitivity = "low" | "sensitive" | "restricted";

export type ArtifactRetentionState = "active" | "raw_deleted" | "deleted";

export type ArtifactStorageKind = "postgres_encrypted" | "object_encrypted";

export interface ArtifactRetentionPolicy {
  rawLowDays: number;
  rawSensitiveDays: number;
  rawRestrictedDays: number;
  summaryDays: number;
  disabledOwnerRawDays: number;
  disabledOwnerSummaryDays: number;
}

export interface ArtifactRetentionPlan {
  policy: ArtifactRetentionPolicy;
  rawRetainUntil: Date;
  summaryRetainUntil: Date;
}

export interface ArtifactEncryptionEnvelope {
  algorithm: "AES-256-GCM";
  keyId: string;
  keyVersion: number;
  nonce: string;
  authTag: string;
}

export interface EncryptedArtifactPayload extends ArtifactEncryptionEnvelope {
  ciphertext: string;
}

export interface ArtifactKeyMaterial {
  id: string;
  version: number;
  key: string;
}

export interface CreateArtifactInput {
  owner: ArtifactOwnerScope;
  purpose: ArtifactPurpose;
  sensitivity: ArtifactSensitivity;
  payload: string | Uint8Array;
  redactedSummary: Record<string, unknown>;
  contentType?: string;
  runId?: string | null;
  createdByUserId?: string | null;
  storageKey?: string;
  retentionPolicy?: Partial<ArtifactRetentionPolicy>;
  now?: Date;
}

export interface StoredArtifactMetadata {
  id: string;
  ownerType: ArtifactOwnerType;
  ownerId: string;
  runId: string | null;
  purpose: ArtifactPurpose;
  sensitivity: ArtifactSensitivity;
  storageKind: ArtifactStorageKind;
  storageKey: string;
  contentType: string;
  byteLength: number;
  sha256Hash: string;
  encryption: ArtifactEncryptionEnvelope;
  redactedSummary: Record<string, unknown>;
  retentionPolicy: ArtifactRetentionPolicy;
  rawRetainUntil: Date;
  summaryRetainUntil: Date;
  retentionState: ArtifactRetentionState;
}

export interface ArtifactStorageAdapter {
  createArtifact(input: CreateArtifactInput): Promise<StoredArtifactMetadata>;
  readArtifactPayload(artifactId: string): Promise<Uint8Array>;
  markArtifactRawDeleted(artifactId: string, now?: Date): Promise<void>;
  deleteArtifactSummary(artifactId: string, now?: Date): Promise<void>;
}

export class ArtifactEncryptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactEncryptionConfigurationError";
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(artifactId: string) {
    super(`Artifact not found: ${artifactId}`);
    this.name = "ArtifactNotFoundError";
  }
}

const ARTIFACT_ENCRYPTION_ALGORITHM = "AES-256-GCM";
const DEFAULT_ARTIFACT_KEY_ID = "local-v1";
const DEFAULT_ARTIFACT_KEY_VERSION = 1;

const encodeBase64 = (value: Uint8Array) =>
  Buffer.from(value).toString("base64url");

const decodeBase64 = (value: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(value, "base64url"));

const toPayloadBytes = (
  payload: string | Uint8Array,
): Uint8Array<ArrayBuffer> =>
  typeof payload === "string"
    ? new TextEncoder().encode(payload)
    : new Uint8Array(payload);

const toJsonRecord = (value: Record<string, unknown>) => ({
  ...value,
});

const assertPositiveInteger = (value: number, name: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ArtifactEncryptionConfigurationError(
      `${name} must be a positive integer.`,
    );
  }
};

const parseArtifactKeyVersion = () => {
  const version = Number(
    process.env.ARTIFACT_ENCRYPTION_KEY_VERSION ??
      DEFAULT_ARTIFACT_KEY_VERSION,
  );
  assertPositiveInteger(version, "ARTIFACT_ENCRYPTION_KEY_VERSION");
  return version;
};

const validateKeyMaterial = (material: ArtifactKeyMaterial) => {
  const rawKey = decodeBase64(material.key);
  if (rawKey.byteLength !== 32) {
    throw new ArtifactEncryptionConfigurationError(
      `Artifact encryption key ${material.id}:${material.version} must be a base64url-encoded 32-byte key.`,
    );
  }
  assertPositiveInteger(material.version, "artifact key version");
  return rawKey;
};

const currentArtifactKey = (): ArtifactKeyMaterial => {
  const key = process.env.ARTIFACT_ENCRYPTION_KEY;

  if (!key) {
    throw new ArtifactEncryptionConfigurationError(
      "ARTIFACT_ENCRYPTION_KEY must be configured before storing artifacts.",
    );
  }

  return {
    id: process.env.ARTIFACT_ENCRYPTION_KEY_ID ?? DEFAULT_ARTIFACT_KEY_ID,
    version: parseArtifactKeyVersion(),
    key,
  };
};

const keyRing = (): ArtifactKeyMaterial[] => {
  const rawKeyRing = process.env.ARTIFACT_ENCRYPTION_KEYRING_JSON;
  if (!rawKeyRing) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeyRing);
  } catch {
    throw new ArtifactEncryptionConfigurationError(
      "ARTIFACT_ENCRYPTION_KEYRING_JSON must be valid JSON.",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { keys?: unknown }).keys)
  ) {
    throw new ArtifactEncryptionConfigurationError(
      "ARTIFACT_ENCRYPTION_KEYRING_JSON must be shaped like {\"keys\":[{\"id\":\"...\",\"version\":1,\"key\":\"...\"}]}",
    );
  }

  return (parsed as { keys: unknown[] }).keys.map((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as ArtifactKeyMaterial).id !== "string" ||
      typeof (candidate as ArtifactKeyMaterial).version !== "number" ||
      typeof (candidate as ArtifactKeyMaterial).key !== "string"
    ) {
      throw new ArtifactEncryptionConfigurationError(
        "Every artifact keyring entry must include id, version, and key.",
      );
    }

    const material = candidate as ArtifactKeyMaterial;
    validateKeyMaterial(material);
    return material;
  });
};

const resolveArtifactKey = async (keyId: string, keyVersion: number) => {
  const candidates = [currentArtifactKey(), ...keyRing()];
  const material = candidates.find(
    (candidate) => candidate.id === keyId && candidate.version === keyVersion,
  );

  if (!material) {
    throw new ArtifactEncryptionConfigurationError(
      `Artifact encryption key ${keyId}:${keyVersion} is not configured.`,
    );
  }

  return crypto.subtle.importKey(
    "raw",
    validateKeyMaterial(material),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
};

export const defaultArtifactRetentionPolicy = (): ArtifactRetentionPolicy => ({
  rawLowDays: 90,
  rawSensitiveDays: 30,
  rawRestrictedDays: 7,
  summaryDays: 365,
  disabledOwnerRawDays: 0,
  disabledOwnerSummaryDays: 0,
});

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const rawRetentionDaysFor = (
  sensitivity: ArtifactSensitivity,
  policy: ArtifactRetentionPolicy,
) => {
  if (sensitivity === "restricted") {
    return policy.rawRestrictedDays;
  }
  if (sensitivity === "sensitive") {
    return policy.rawSensitiveDays;
  }
  return policy.rawLowDays;
};

export const planArtifactRetention = (
  sensitivity: ArtifactSensitivity,
  now = new Date(),
  overrides: Partial<ArtifactRetentionPolicy> = {},
): ArtifactRetentionPlan => {
  const policy = { ...defaultArtifactRetentionPolicy(), ...overrides };
  const rawDays = rawRetentionDaysFor(sensitivity, policy);

  return {
    policy,
    rawRetainUntil: addDays(now, rawDays),
    summaryRetainUntil: addDays(now, policy.summaryDays),
  };
};

export const planDisabledOwnerArtifactRetention = (
  now = new Date(),
  overrides: Partial<ArtifactRetentionPolicy> = {},
): ArtifactRetentionPlan => {
  const policy = { ...defaultArtifactRetentionPolicy(), ...overrides };

  return {
    policy,
    rawRetainUntil: addDays(now, policy.disabledOwnerRawDays),
    summaryRetainUntil: addDays(now, policy.disabledOwnerSummaryDays),
  };
};

export const shouldDeleteRawArtifact = (
  artifact: Pick<StoredArtifactMetadata, "rawRetainUntil" | "retentionState">,
  now = new Date(),
) =>
  artifact.retentionState === "active" &&
  artifact.rawRetainUntil.getTime() <= now.getTime();

export const shouldDeleteArtifactSummary = (
  artifact: Pick<
    StoredArtifactMetadata,
    "summaryRetainUntil" | "retentionState"
  >,
  now = new Date(),
) =>
  artifact.retentionState !== "deleted" &&
  artifact.summaryRetainUntil.getTime() <= now.getTime();

export const encryptArtifactPayload = async (
  payload: string | Uint8Array,
): Promise<EncryptedArtifactPayload> => {
  const currentKey = currentArtifactKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = toPayloadBytes(payload);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      await resolveArtifactKey(currentKey.id, currentKey.version),
      plaintext,
    ),
  );
  const tagStart = encrypted.byteLength - 16;

  return {
    algorithm: ARTIFACT_ENCRYPTION_ALGORITHM,
    keyId: currentKey.id,
    keyVersion: currentKey.version,
    ciphertext: encodeBase64(encrypted.slice(0, tagStart)),
    authTag: encodeBase64(encrypted.slice(tagStart)),
    nonce: encodeBase64(nonce),
  };
};

export const decryptArtifactPayload = async (
  encrypted: EncryptedArtifactPayload,
): Promise<Uint8Array> => {
  if (encrypted.algorithm !== ARTIFACT_ENCRYPTION_ALGORITHM) {
    throw new Error(
      `Unsupported artifact encryption algorithm: ${encrypted.algorithm}`,
    );
  }

  const ciphertext = decodeBase64(encrypted.ciphertext);
  const authTag = decodeBase64(encrypted.authTag);
  const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.byteLength);

  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64(encrypted.nonce),
        tagLength: 128,
      },
      await resolveArtifactKey(encrypted.keyId, encrypted.keyVersion),
      combined,
    ),
  );
};

export const hashArtifactPayload = async (payload: string | Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", toPayloadBytes(payload));
  return encodeBase64(new Uint8Array(digest));
};

const toStoredArtifactMetadata = (
  row: typeof artifacts.$inferSelect,
): StoredArtifactMetadata => ({
  id: row.id,
  ownerType: row.ownerType,
  ownerId: row.ownerId,
  runId: row.runId,
  purpose: row.purpose,
  sensitivity: row.sensitivity,
  storageKind: row.storageKind,
  storageKey: row.storageKey,
  contentType: row.contentType,
  byteLength: row.byteLength,
  sha256Hash: row.sha256Hash,
  encryption: {
    algorithm: row.encryptionAlgorithm as "AES-256-GCM",
    keyId: row.encryptionKeyId,
    keyVersion: row.encryptionKeyVersion,
    nonce: row.encryptionNonce,
    authTag: row.encryptionAuthTag,
  },
  redactedSummary: row.redactedSummary,
  retentionPolicy: row.retentionPolicy as unknown as ArtifactRetentionPolicy,
  rawRetainUntil: row.rawRetainUntil,
  summaryRetainUntil: row.summaryRetainUntil,
  retentionState: row.retentionState,
});

export class PostgresEncryptedArtifactStorage
  implements ArtifactStorageAdapter
{
  async createArtifact(
    input: CreateArtifactInput,
  ): Promise<StoredArtifactMetadata> {
    const now = input.now ?? new Date();
    const payload = toPayloadBytes(input.payload);
    const encrypted = await encryptArtifactPayload(payload);
    const retention = planArtifactRetention(
      input.sensitivity,
      now,
      input.retentionPolicy,
    );
    const storageKey =
      input.storageKey ??
      `artifacts/${input.owner.ownerType}/${input.owner.ownerId}/${crypto.randomUUID()}`;

    return getDatabase().transaction(async (tx) => {
      const [artifact] = await tx
        .insert(artifacts)
        .values({
          ownerType: input.owner.ownerType,
          ownerId: input.owner.ownerId,
          runId: input.runId ?? null,
          createdByUserId: input.createdByUserId ?? null,
          purpose: input.purpose,
          sensitivity: input.sensitivity,
          storageKind: "postgres_encrypted",
          storageKey,
          contentType: input.contentType ?? "application/octet-stream",
          byteLength: payload.byteLength,
          sha256Hash: await hashArtifactPayload(payload),
          encryptionAlgorithm: encrypted.algorithm,
          encryptionKeyId: encrypted.keyId,
          encryptionKeyVersion: encrypted.keyVersion,
          encryptionNonce: encrypted.nonce,
          encryptionAuthTag: encrypted.authTag,
          redactedSummary: toJsonRecord(input.redactedSummary),
          retentionPolicy: toJsonRecord({ ...retention.policy }),
          rawRetainUntil: retention.rawRetainUntil,
          summaryRetainUntil: retention.summaryRetainUntil,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!artifact) {
        throw new Error("Artifact metadata could not be stored.");
      }

      await tx.insert(artifactBlobs).values({
        artifactId: artifact.id,
        ciphertext: encrypted.ciphertext,
        createdAt: now,
      });

      return toStoredArtifactMetadata(artifact);
    });
  }

  async readArtifactPayload(artifactId: string): Promise<Uint8Array> {
    const [artifact] = await getDatabase()
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, artifactId))
      .limit(1);

    if (!artifact || artifact.retentionState !== "active") {
      throw new ArtifactNotFoundError(artifactId);
    }

    const [blob] = await getDatabase()
      .select()
      .from(artifactBlobs)
      .where(eq(artifactBlobs.artifactId, artifactId))
      .limit(1);

    if (!blob) {
      throw new ArtifactNotFoundError(artifactId);
    }

    return decryptArtifactPayload({
      algorithm: artifact.encryptionAlgorithm as "AES-256-GCM",
      keyId: artifact.encryptionKeyId,
      keyVersion: artifact.encryptionKeyVersion,
      nonce: artifact.encryptionNonce,
      authTag: artifact.encryptionAuthTag,
      ciphertext: blob.ciphertext,
    });
  }

  async markArtifactRawDeleted(
    artifactId: string,
    now = new Date(),
  ): Promise<void> {
    await getDatabase().transaction(async (tx) => {
      await tx
        .delete(artifactBlobs)
        .where(eq(artifactBlobs.artifactId, artifactId));
      await tx
        .update(artifacts)
        .set({
          retentionState: "raw_deleted",
          rawDeletedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(artifacts.id, artifactId),
            eq(artifacts.retentionState, "active"),
          ),
        );
    });
  }

  async deleteArtifactSummary(
    artifactId: string,
    now = new Date(),
  ): Promise<void> {
    await getDatabase().transaction(async (tx) => {
      await tx
        .delete(artifactBlobs)
        .where(eq(artifactBlobs.artifactId, artifactId));
      await tx
        .update(artifacts)
        .set({
          redactedSummary: {},
          retentionState: "deleted",
          rawDeletedAt: now,
          deletedAt: now,
          updatedAt: now,
        })
        .where(eq(artifacts.id, artifactId));
    });
  }

  async listRawArtifactsDueForDeletion(now = new Date(), limit = 100) {
    const rows = await getDatabase()
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.storageKind, "postgres_encrypted"),
          eq(artifacts.retentionState, "active"),
          lte(artifacts.rawRetainUntil, now),
        ),
      )
      .limit(limit);

    return rows.map(toStoredArtifactMetadata);
  }

  async listSummariesDueForDeletion(now = new Date(), limit = 100) {
    const rows = await getDatabase()
      .select()
      .from(artifacts)
      .where(
        and(
          lte(artifacts.summaryRetainUntil, now),
          lte(artifacts.rawRetainUntil, now),
        ),
      )
      .limit(limit);

    return rows
      .map(toStoredArtifactMetadata)
      .filter((artifact) => artifact.retentionState !== "deleted");
  }
}

import { afterEach, describe, expect, test } from "vitest";
import {
  ArtifactEncryptionConfigurationError,
  decryptArtifactPayload,
  defaultArtifactRetentionPolicy,
  encryptArtifactPayload,
  hashArtifactPayload,
  planArtifactRetention,
  planDisabledOwnerArtifactRetention,
  shouldDeleteArtifactSummary,
  shouldDeleteRawArtifact,
  type StoredArtifactMetadata,
} from "./artifacts";

const base64UrlKey = (fill: number) =>
  Buffer.alloc(32, fill).toString("base64url");

const configureArtifactKey = (fill = 7) => {
  process.env.ARTIFACT_ENCRYPTION_KEY = base64UrlKey(fill);
  process.env.ARTIFACT_ENCRYPTION_KEY_ID = "test-key";
  process.env.ARTIFACT_ENCRYPTION_KEY_VERSION = "3";
};

const artifactRecord = (
  overrides: Partial<StoredArtifactMetadata>,
): StoredArtifactMetadata => ({
  id: "artifact-1",
  ownerType: "workspace",
  ownerId: "workspace-1",
  runId: null,
  purpose: "tool_result",
  sensitivity: "sensitive",
  storageKind: "postgres_encrypted",
  storageKey: "artifacts/workspace/workspace-1/artifact-1",
  contentType: "application/json",
  byteLength: 32,
  sha256Hash: "hash",
  encryption: {
    algorithm: "AES-256-GCM",
    keyId: "test-key",
    keyVersion: 3,
    nonce: "nonce",
    authTag: "tag",
  },
  redactedSummary: {},
  retentionPolicy: defaultArtifactRetentionPolicy(),
  rawRetainUntil: new Date("2026-01-01T00:00:00.000Z"),
  summaryRetainUntil: new Date("2026-12-31T00:00:00.000Z"),
  retentionState: "active",
  ...overrides,
});

afterEach(() => {
  delete process.env.ARTIFACT_ENCRYPTION_KEY;
  delete process.env.ARTIFACT_ENCRYPTION_KEY_ID;
  delete process.env.ARTIFACT_ENCRYPTION_KEY_VERSION;
  delete process.env.ARTIFACT_ENCRYPTION_KEYRING_JSON;
});

describe("artifact encryption", () => {
  test("round-trips payloads with AES-256-GCM and envelope metadata", async () => {
    configureArtifactKey();

    const encrypted = await encryptArtifactPayload("secret email payload");
    const decrypted = await decryptArtifactPayload(encrypted);

    expect(encrypted.algorithm).toBe("AES-256-GCM");
    expect(encrypted.keyId).toBe("test-key");
    expect(encrypted.keyVersion).toBe(3);
    expect(encrypted.ciphertext).not.toContain("secret");
    expect(new TextDecoder().decode(decrypted)).toBe("secret email payload");
  });

  test("decrypts older key versions from the configured keyring", async () => {
    configureArtifactKey(1);
    process.env.ARTIFACT_ENCRYPTION_KEY_ID = "current";
    process.env.ARTIFACT_ENCRYPTION_KEY_VERSION = "2";

    const encryptedWithOldKey = await encryptArtifactPayload("old payload");
    process.env.ARTIFACT_ENCRYPTION_KEY = base64UrlKey(2);
    process.env.ARTIFACT_ENCRYPTION_KEY_ID = "new";
    process.env.ARTIFACT_ENCRYPTION_KEY_VERSION = "3";
    process.env.ARTIFACT_ENCRYPTION_KEYRING_JSON = JSON.stringify({
      keys: [{ id: "current", version: 2, key: base64UrlKey(1) }],
    });

    const decrypted = await decryptArtifactPayload(encryptedWithOldKey);

    expect(new TextDecoder().decode(decrypted)).toBe("old payload");
  });

  test("fails closed when the encryption key is missing or malformed", async () => {
    await expect(encryptArtifactPayload("payload")).rejects.toBeInstanceOf(
      ArtifactEncryptionConfigurationError,
    );

    process.env.ARTIFACT_ENCRYPTION_KEY = Buffer.alloc(8, 1).toString(
      "base64url",
    );

    await expect(encryptArtifactPayload("payload")).rejects.toBeInstanceOf(
      ArtifactEncryptionConfigurationError,
    );
  });

  test("hashes equivalent payload bytes deterministically", async () => {
    const fromString = await hashArtifactPayload("same payload");
    const fromBytes = await hashArtifactPayload(
      new TextEncoder().encode("same payload"),
    );

    expect(fromString).toBe(fromBytes);
  });
});

describe("artifact retention", () => {
  test("plans deterministic default raw and summary retention windows", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const low = planArtifactRetention("low", now);
    const sensitive = planArtifactRetention("sensitive", now);
    const restricted = planArtifactRetention("restricted", now);

    expect(low.rawRetainUntil.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(sensitive.rawRetainUntil.toISOString()).toBe(
      "2026-01-31T00:00:00.000Z",
    );
    expect(restricted.rawRetainUntil.toISOString()).toBe(
      "2026-01-08T00:00:00.000Z",
    );
    expect(sensitive.summaryRetainUntil.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  test("plans immediate cleanup for disabled owner scopes by default", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const plan = planDisabledOwnerArtifactRetention(now);

    expect(plan.rawRetainUntil).toEqual(now);
    expect(plan.summaryRetainUntil).toEqual(now);
  });

  test("separates raw deletion from redacted summary deletion", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");

    expect(
      shouldDeleteRawArtifact(
        artifactRecord({
          rawRetainUntil: new Date("2026-01-31T00:00:00.000Z"),
        }),
        now,
      ),
    ).toBe(true);
    expect(
      shouldDeleteArtifactSummary(
        artifactRecord({
          retentionState: "raw_deleted",
          summaryRetainUntil: new Date("2026-01-31T00:00:00.000Z"),
        }),
        now,
      ),
    ).toBe(true);
    expect(
      shouldDeleteRawArtifact(
        artifactRecord({
          retentionState: "raw_deleted",
          rawRetainUntil: new Date("2026-01-31T00:00:00.000Z"),
        }),
        now,
      ),
    ).toBe(false);
  });
});

import { describe, expect, test } from "vitest";
import {
  canViewAuditLog,
  projectRunHistoryVisibility,
  stripUserMetadata,
  type AuditLogEventRecordForVisibility,
  type RunRecordForVisibility,
  type RunStepRecordForVisibility,
} from "./run-history-visibility";

const ownerScope = {
  ownerType: "workspace",
  ownerId: "workspace_123",
} as const;

const run = {
  id: "run_123",
  ownerScope,
  kind: "automation",
  state: "completed_partial",
  title: "Morning watchlist brief",
  startedAt: "2026-08-17T12:00:00.000Z",
  completedAt: "2026-08-17T12:02:00.000Z",
} satisfies RunRecordForVisibility;

const steps = [
  {
    id: "step_tool_started",
    runId: "run_123",
    type: "tool_call_started",
    summary: "Calling MCP tool get_watchlist_news.",
    occurredAt: "2026-08-17T12:00:20.000Z",
    visibleToUser: true,
    relatedArtifacts: [
      {
        id: "artifact_args",
        purpose: "tool_arguments",
        sensitivity: "sensitive",
        retentionState: "active",
        rawAvailable: true,
        redactedSummary: { symbol: "[string:4]" },
      },
    ],
    redactedMetadata: {
      toolName: "get_watchlist_news",
      argumentsRedacted: { symbol: "[string:4]" },
      argumentsHash: "hash_should_not_be_user_visible",
      storageKey: "artifacts/workspace/workspace_123/raw",
      nonce: "nonce_should_not_be_user_visible",
    },
  },
  {
    id: "step_internal",
    runId: "run_123",
    type: "message",
    summary: "Internal checkpoint persisted.",
    occurredAt: "2026-08-17T12:00:30.000Z",
    visibleToUser: false,
    relatedArtifacts: [],
    redactedMetadata: { temporalWorkflowId: "workflow_123" },
  },
  {
    id: "step_denied",
    runId: "run_123",
    type: "tool_call_failed",
    summary: "This MCP tool was not approved for this Run.",
    occurredAt: "2026-08-17T12:01:00.000Z",
    visibleToUser: true,
    relatedArtifacts: [],
    redactedMetadata: {
      code: "authorization_missing",
      message: "This MCP tool was not approved for this Run.",
      toolAuthorizationSnapshotId: "snapshot_123",
    },
  },
  {
    id: "step_final",
    runId: "run_123",
    type: "final_output",
    summary: "The run completed with degraded evidence.",
    occurredAt: "2026-08-17T12:02:00.000Z",
    visibleToUser: true,
    relatedArtifacts: [
      {
        id: "artifact_final",
        purpose: "final_output",
        sensitivity: "low",
        retentionState: "raw_deleted",
        rawAvailable: true,
        redactedSummary: { sections: ["evidence", "summary"] },
      },
    ],
    redactedMetadata: {
      status: "completed_partial",
      evidenceStatus: "degraded",
    },
  },
] satisfies RunStepRecordForVisibility[];

const auditEvents = [
  {
    id: "audit_allowed",
    ownerScope,
    actorType: "system",
    actorUserId: null,
    eventName: "mcp.tool_call.allowed",
    targetType: "mcp_tool_call",
    targetId: "tool_call_123",
    runId: "run_123",
    createdAt: "2026-08-17T12:00:20.000Z",
    redactedMetadata: {
      mcpConnectionId: "connection_123",
      argumentsHash: "hash_admin_can_see",
      argumentsRedacted: { symbol: "[string:4]" },
    },
  },
  {
    id: "audit_credential",
    ownerScope,
    actorType: "user",
    actorUserId: "user_admin",
    eventName: "mcp.connection.credential_rotated",
    targetType: "mcp_connection",
    targetId: "connection_123",
    runId: null,
    createdAt: "2026-08-17T11:59:00.000Z",
    redactedMetadata: {
      connectionName: "Webull",
    },
  },
] satisfies AuditLogEventRecordForVisibility[];

describe("run history visibility", () => {
  test("shows every workspace role the user-facing Run Steps only", () => {
    const projection = projectRunHistoryVisibility({
      run,
      steps,
      auditEvents,
      viewerRole: "viewer",
    });

    expect(projection.adminAuditLog).toBeNull();
    expect(projection.userRunHistory.steps.map((step) => step.id)).toEqual([
      "step_tool_started",
      "step_denied",
      "step_final",
    ]);
    expect(projection.userRunHistory.finalOutputArtifactIds).toEqual([
      "artifact_final",
    ]);
  });

  test("keeps internal identifiers, hashes, and storage details out of user metadata", () => {
    const projection = projectRunHistoryVisibility({
      run,
      steps,
      auditEvents,
      viewerRole: "editor",
    });

    expect(projection.userRunHistory.steps[0]?.publicMetadata).toEqual({
      toolName: "get_watchlist_news",
      argumentsRedacted: { symbol: "[string:4]" },
    });
    expect(JSON.stringify(projection.userRunHistory)).not.toContain(
      "hash_should_not_be_user_visible",
    );
    expect(JSON.stringify(projection.userRunHistory)).not.toContain(
      "artifacts/workspace",
    );
    expect(JSON.stringify(projection.userRunHistory)).not.toContain(
      "workflow_123",
    );
  });

  test("marks raw artifacts unavailable after raw retention deletion", () => {
    const projection = projectRunHistoryVisibility({
      run,
      steps,
      auditEvents,
      viewerRole: "viewer",
    });

    const finalArtifact = projection.userRunHistory.steps
      .find((step) => step.id === "step_final")
      ?.artifacts.at(0);

    expect(finalArtifact?.rawAvailable).toBe(false);
    expect(finalArtifact?.redactedSummary).toEqual({
      sections: ["evidence", "summary"],
    });
  });

  test("shows owner/admin the admin audit stream including run and control-plane events", () => {
    const projection = projectRunHistoryVisibility({
      run,
      steps,
      auditEvents,
      viewerRole: "owner_admin",
    });

    expect(canViewAuditLog("owner_admin")).toBe(true);
    expect(canViewAuditLog("approver")).toBe(false);
    expect(projection.adminAuditLog?.events.map((event) => event.id)).toEqual([
      "audit_credential",
      "audit_allowed",
    ]);
    expect(projection.adminAuditLog?.events[1]?.redactedMetadata).toMatchObject({
      argumentsHash: "hash_admin_can_see",
    });
  });

  test("strips sensitive metadata keys even when metadata is already called redacted", () => {
    expect(
      stripUserMetadata({
        toolName: "send_email",
        token: "secret",
        authTag: "tag",
        keyVersion: 3,
        message: "Delivered.",
      }),
    ).toEqual({
      toolName: "send_email",
      message: "Delivered.",
    });
  });
});

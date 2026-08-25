export type OwnerType = "user" | "workspace";

export interface OwnerScopeRef {
  ownerType: OwnerType;
  ownerId: string;
}

export type WorkspaceRole = "owner_admin" | "editor" | "approver" | "viewer";

export type RunKind = "agent" | "automation";

export type RunState =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "completed"
  | "completed_partial"
  | "failed"
  | "cancelled"
  | "expired"
  | "skipped";

export type RunStepType =
  | "message"
  | "brief_created"
  | "tool_selected"
  | "tool_call_started"
  | "tool_call_completed"
  | "tool_call_failed"
  | "approval_requested"
  | "approval_granted"
  | "approval_rejected"
  | "evidence_degraded"
  | "budget_reached"
  | "final_output"
  | "run_failed";

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

export interface RunHistoryArtifactRecord {
  id: string;
  purpose: ArtifactPurpose;
  sensitivity: ArtifactSensitivity;
  retentionState: ArtifactRetentionState;
  redactedSummary: Record<string, unknown>;
  rawAvailable: boolean;
}

export interface RunRecordForVisibility {
  id: string;
  ownerScope: OwnerScopeRef;
  kind: RunKind;
  state: RunState;
  title: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunStepRecordForVisibility {
  id: string;
  runId: string;
  type: RunStepType;
  summary: string;
  occurredAt: string;
  visibleToUser: boolean;
  relatedArtifacts: RunHistoryArtifactRecord[];
  redactedMetadata: Record<string, unknown>;
}

export type AuditActorType = "user" | "system" | "worker";

export interface AuditLogEventRecordForVisibility {
  id: string;
  ownerScope: OwnerScopeRef;
  actorType: AuditActorType;
  actorUserId: string | null;
  eventName: string;
  targetType: string;
  targetId: string;
  runId: string | null;
  createdAt: string;
  redactedMetadata: Record<string, unknown>;
}

export interface UserRunHistoryStepView {
  id: string;
  type: RunStepType;
  summary: string;
  occurredAt: string;
  publicMetadata: Record<string, unknown>;
  artifacts: RunHistoryArtifactRecord[];
}

export interface UserRunHistoryView {
  schemaVersion: "run-history-user-view.v1";
  run: RunRecordForVisibility;
  steps: UserRunHistoryStepView[];
  finalOutputArtifactIds: string[];
}

export interface AdminAuditEventView {
  id: string;
  actorType: AuditActorType;
  actorUserId: string | null;
  eventName: string;
  targetType: string;
  targetId: string;
  runId: string | null;
  createdAt: string;
  redactedMetadata: Record<string, unknown>;
}

export interface AdminAuditLogView {
  schemaVersion: "run-history-admin-audit-view.v1";
  ownerScope: OwnerScopeRef;
  events: AdminAuditEventView[];
}

export interface RunHistoryVisibilityInput {
  run: RunRecordForVisibility;
  steps: RunStepRecordForVisibility[];
  auditEvents: AuditLogEventRecordForVisibility[];
  viewerRole: WorkspaceRole;
}

export interface RunHistoryVisibilityProjection {
  userRunHistory: UserRunHistoryView;
  adminAuditLog: AdminAuditLogView | null;
}

const USER_METADATA_ALLOWLIST = new Set([
  "argumentsRedacted",
  "code",
  "connectionName",
  "durationMs",
  "evidenceStatus",
  "message",
  "outputDestinationKind",
  "reason",
  "resultSummary",
  "status",
  "toolName",
]);

const SENSITIVE_METADATA_KEY_PATTERN =
  /(?:auth|credential|secret|token|ciphertext|nonce|authTag|keyId|keyVersion|storageKey|temporal|rawPayload|plaintext|hash)$/i;

export const canViewRunHistory = (_role: WorkspaceRole) => true;

export const canViewAuditLog = (role: WorkspaceRole) =>
  role === "owner_admin";

export const stripUserMetadata = (
  metadata: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) =>
        USER_METADATA_ALLOWLIST.has(key) &&
        !SENSITIVE_METADATA_KEY_PATTERN.test(key),
    ),
  );

const sanitizeArtifactForTimeline = (
  artifact: RunHistoryArtifactRecord,
): RunHistoryArtifactRecord => ({
  id: artifact.id,
  purpose: artifact.purpose,
  sensitivity: artifact.sensitivity,
  retentionState: artifact.retentionState,
  rawAvailable:
    artifact.rawAvailable && artifact.retentionState === "active",
  redactedSummary: artifact.redactedSummary,
});

const toUserStep = (
  step: RunStepRecordForVisibility,
): UserRunHistoryStepView => ({
  id: step.id,
  type: step.type,
  summary: step.summary,
  occurredAt: step.occurredAt,
  publicMetadata: stripUserMetadata(step.redactedMetadata),
  artifacts: step.relatedArtifacts.map(sanitizeArtifactForTimeline),
});

const toAuditEventView = (
  event: AuditLogEventRecordForVisibility,
): AdminAuditEventView => ({
  id: event.id,
  actorType: event.actorType,
  actorUserId: event.actorUserId,
  eventName: event.eventName,
  targetType: event.targetType,
  targetId: event.targetId,
  runId: event.runId,
  createdAt: event.createdAt,
  redactedMetadata: event.redactedMetadata,
});

export const projectRunHistoryVisibility = (
  input: RunHistoryVisibilityInput,
): RunHistoryVisibilityProjection => {
  const visibleSteps = input.steps
    .filter((step) => step.runId === input.run.id && step.visibleToUser)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

  const finalOutputArtifactIds = visibleSteps
    .filter((step) => step.type === "final_output")
    .flatMap((step) => step.relatedArtifacts.map((artifact) => artifact.id));

  return {
    userRunHistory: {
      schemaVersion: "run-history-user-view.v1",
      run: input.run,
      steps: visibleSteps.map(toUserStep),
      finalOutputArtifactIds,
    },
    adminAuditLog: canViewAuditLog(input.viewerRole)
      ? {
          schemaVersion: "run-history-admin-audit-view.v1",
          ownerScope: input.run.ownerScope,
          events: input.auditEvents
            .filter(
              (event) =>
                event.ownerScope.ownerType === input.run.ownerScope.ownerType &&
                event.ownerScope.ownerId === input.run.ownerScope.ownerId &&
                (event.runId === null || event.runId === input.run.id),
            )
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .map(toAuditEventView),
        }
      : null,
  };
};

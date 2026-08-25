export type AutomationOwnerType = "user" | "workspace";

export interface AutomationOwnerScopeRef {
  ownerType: AutomationOwnerType;
  ownerId: string;
}

export type AutomationState =
  | "draft"
  | "pending_approval"
  | "live"
  | "paused"
  | "needs_reconfiguration"
  | "archived";

export type AutomationVersionState =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "superseded";

export type AutomationRunBriefVersionState =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "superseded";

export type AutomationToolAuthorizationState =
  | "proposed"
  | "approved"
  | "rejected"
  | "revoked"
  | "stale";

export type McpConnectionStatus =
  | "pending"
  | "auth_required"
  | "connected"
  | "error"
  | "disabled";

export type ScheduleKind = "manual_only" | "recurring";

export type MissedRunPolicy = "skip" | "backfill_if_enabled";

export type OverlapPolicy =
  | "skip"
  | "queue_one"
  | "cancel_old"
  | "allow_overlap";

export type RunTerminalState =
  | "completed"
  | "completed_partial"
  | "failed"
  | "cancelled"
  | "expired"
  | "skipped";

export interface AutomationScheduleConfig {
  kind: ScheduleKind;
  timezone: string;
  rule: string | null;
  missedRunPolicy: MissedRunPolicy;
  overlapPolicy: OverlapPolicy;
}

export interface AutomationRunBudgetConfig {
  preset: "small" | "standard" | "deep";
  maxLlmSteps: number;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxRetryAttempts: number;
  maxOutputBytes: number;
  maxSpendUsdCents: number | null;
}

export interface AutomationOutputDestinationConfig {
  kind: "in_app" | "email" | "slack" | "webhook";
  destinationRef: string | null;
  authorized: boolean;
}

export interface AutomationRetentionConfig {
  rawLowDays: number;
  rawSensitiveDays: number;
  rawRestrictedDays: number;
  summaryDays: number;
}

export interface AutomationRecordRef {
  id: string;
  ownerScope: AutomationOwnerScopeRef;
  state: AutomationState;
  currentVersionId: string | null;
  consecutiveFailureCount: number;
  failureThreshold: number;
}

export interface AutomationVersionRef {
  id: string;
  automationId: string;
  state: AutomationVersionState;
  runBriefVersionId: string;
  schedule: AutomationScheduleConfig;
  runBudget: AutomationRunBudgetConfig | null;
  outputDestination: AutomationOutputDestinationConfig | null;
  retentionPolicy: AutomationRetentionConfig | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
}

export interface RunBriefVersionRef {
  id: string;
  state: AutomationRunBriefVersionState;
}

export interface ToolAuthorizationSnapshotRef {
  id: string;
  state: AutomationToolAuthorizationState;
  mcpConnectionId: string;
  mcpToolId: string;
  toolName: string;
  required: boolean;
  writeCapable: boolean;
  acknowledgedWriteCapability: boolean;
  allowedOutcomeBoundary: string | null;
}

export interface McpConnectionRef {
  id: string;
  status: McpConnectionStatus;
}

export interface CurrentToolCatalogRef {
  refreshedAt: string | null;
  toolsById: Record<
    string,
    {
      id: string;
      connectionId: string;
      available: boolean;
      schemaHash: string;
      annotationHash: string;
    }
  >;
}

export interface AutomationActivationPreflightInput {
  automation: AutomationRecordRef;
  version: AutomationVersionRef;
  runBriefVersion: RunBriefVersionRef;
  toolAuthorizations: ToolAuthorizationSnapshotRef[];
  connections: McpConnectionRef[];
  currentToolCatalog: CurrentToolCatalogRef;
}

export type AutomationPreflightBlockerCode =
  | "automation_archived"
  | "automation_version_mismatch"
  | "automation_version_not_approved"
  | "run_brief_not_approved"
  | "tool_authorization_missing"
  | "tool_authorization_not_approved"
  | "write_boundary_missing"
  | "required_connection_unavailable"
  | "required_tool_unavailable"
  | "tool_catalog_not_current"
  | "schedule_timezone_missing"
  | "schedule_rule_missing"
  | "run_budget_missing"
  | "output_destination_missing"
  | "output_destination_not_authorized"
  | "retention_policy_missing";

export interface AutomationPreflightBlocker {
  code: AutomationPreflightBlockerCode;
  message: string;
  targetId: string | null;
}

export interface TemporalScheduleIntent {
  action: "create_or_update" | "delete";
  scheduleId: string;
  automationId: string;
  automationVersionId: string;
  timezone: string;
  rule: string;
  overlapPolicy: OverlapPolicy;
  missedRunPolicy: MissedRunPolicy;
}

export interface AutomationActivationPreflightResult {
  canActivate: boolean;
  nextAutomationState: AutomationState;
  blockers: AutomationPreflightBlocker[];
  temporalScheduleIntent: TemporalScheduleIntent | null;
}

export interface AutomationRunStartPreflightInput {
  ownerScopeActive: boolean;
  automation: AutomationRecordRef;
  version: AutomationVersionRef;
  toolAuthorizations: ToolAuthorizationSnapshotRef[];
  connections: McpConnectionRef[];
  scheduledFireTime: string;
  now: string;
  isMissedFire: boolean;
  backfillEnabled: boolean;
  hasRunningRun: boolean;
}

export type AutomationRunStartAction =
  | "start_run"
  | "skip_run"
  | "queue_one"
  | "cancel_old_then_start"
  | "mark_needs_reconfiguration";

export interface AutomationRunStartPreflightResult {
  action: AutomationRunStartAction;
  runState: "queued" | "skipped" | null;
  nextAutomationState: AutomationState;
  reason: string;
}

export interface AutomationFailureThresholdInput {
  automation: AutomationRecordRef;
  terminalRunState: RunTerminalState;
}

export interface AutomationFailureThresholdResult {
  consecutiveFailureCount: number;
  nextAutomationState: AutomationState;
  needsNotification: boolean;
}

export const DEFAULT_SCHEDULE_TIMEZONE = "America/New_York";

export const defaultAutomationScheduleConfig = (
  overrides: Partial<AutomationScheduleConfig> = {},
): AutomationScheduleConfig => ({
  kind: "recurring",
  timezone: DEFAULT_SCHEDULE_TIMEZONE,
  rule: null,
  missedRunPolicy: "skip",
  overlapPolicy: "skip",
  ...overrides,
});

export const temporalScheduleIdForAutomation = (automationId: string) =>
  `automation:${automationId}`;

const present = (value: string | null | undefined) =>
  typeof value === "string" && value.trim().length > 0;

const blocker = (
  code: AutomationPreflightBlockerCode,
  message: string,
  targetId: string | null = null,
): AutomationPreflightBlocker => ({ code, message, targetId });

const connectionById = (connections: McpConnectionRef[]) =>
  new Map(connections.map((connection) => [connection.id, connection]));

export const evaluateAutomationActivationPreflight = (
  input: AutomationActivationPreflightInput,
): AutomationActivationPreflightResult => {
  const blockers: AutomationPreflightBlocker[] = [];

  if (input.automation.state === "archived") {
    blockers.push(
      blocker(
        "automation_archived",
        "Archived Automations cannot be activated.",
        input.automation.id,
      ),
    );
  }

  if (input.version.automationId !== input.automation.id) {
    blockers.push(
      blocker(
        "automation_version_mismatch",
        "Automation Version does not belong to this Automation.",
        input.version.id,
      ),
    );
  }

  if (input.version.state !== "approved" || !input.version.approvedAt) {
    blockers.push(
      blocker(
        "automation_version_not_approved",
        "Automation Version must be approved before activation.",
        input.version.id,
      ),
    );
  }

  if (
    input.runBriefVersion.id !== input.version.runBriefVersionId ||
    input.runBriefVersion.state !== "approved"
  ) {
    blockers.push(
      blocker(
        "run_brief_not_approved",
        "Automation activation requires an approved Run Brief Version.",
        input.version.runBriefVersionId,
      ),
    );
  }

  if (input.toolAuthorizations.length === 0) {
    blockers.push(
      blocker(
        "tool_authorization_missing",
        "Automation activation requires at least one approved Tool Authorization Snapshot.",
      ),
    );
  }

  const connections = connectionById(input.connections);
  for (const authorization of input.toolAuthorizations) {
    if (authorization.state !== "approved") {
      blockers.push(
        blocker(
          "tool_authorization_not_approved",
          "Every Tool Authorization Snapshot must be approved.",
          authorization.id,
        ),
      );
    }

    if (
      authorization.writeCapable &&
      (!authorization.acknowledgedWriteCapability ||
        !present(authorization.allowedOutcomeBoundary))
    ) {
      blockers.push(
        blocker(
          "write_boundary_missing",
          "Write-capable Tool Authorization Snapshots require an allowed outcome boundary.",
          authorization.id,
        ),
      );
    }

    if (authorization.required) {
      const connection = connections.get(authorization.mcpConnectionId);
      if (!connection || connection.status !== "connected") {
        blockers.push(
          blocker(
            "required_connection_unavailable",
            "Required MCP Connections must be connected before activation.",
            authorization.mcpConnectionId,
          ),
        );
      }

      const currentTool =
        input.currentToolCatalog.toolsById[authorization.mcpToolId];
      if (!currentTool || !currentTool.available) {
        blockers.push(
          blocker(
            "required_tool_unavailable",
            "Required MCP tools must be present in the current tool catalog before activation.",
            authorization.mcpToolId,
          ),
        );
      }
    }
  }

  if (!input.currentToolCatalog.refreshedAt) {
    blockers.push(
      blocker(
        "tool_catalog_not_current",
        "Tool catalog must be refreshed before Automation activation.",
      ),
    );
  }

  if (!present(input.version.schedule.timezone)) {
    blockers.push(
      blocker(
        "schedule_timezone_missing",
        "Automation Schedule must include an explicit timezone.",
        input.version.id,
      ),
    );
  }

  if (
    input.version.schedule.kind === "recurring" &&
    !present(input.version.schedule.rule)
  ) {
    blockers.push(
      blocker(
        "schedule_rule_missing",
        "Recurring Automations require a schedule rule.",
        input.version.id,
      ),
    );
  }

  if (!input.version.runBudget) {
    blockers.push(
      blocker(
        "run_budget_missing",
        "Automation activation requires a Run Budget.",
        input.version.id,
      ),
    );
  }

  if (!input.version.outputDestination) {
    blockers.push(
      blocker(
        "output_destination_missing",
        "Automation activation requires an Output Destination.",
        input.version.id,
      ),
    );
  } else if (
    input.version.outputDestination.kind !== "in_app" &&
    !input.version.outputDestination.authorized
  ) {
    blockers.push(
      blocker(
        "output_destination_not_authorized",
        "External Output Destinations must be authorized before activation.",
        input.version.id,
      ),
    );
  }

  if (!input.version.retentionPolicy) {
    blockers.push(
      blocker(
        "retention_policy_missing",
        "Automation activation requires an Artifact Retention Policy.",
        input.version.id,
      ),
    );
  }

  const canActivate = blockers.length === 0;
  const temporalScheduleIntent =
    canActivate && input.version.schedule.kind === "recurring"
      ? {
          action: "create_or_update" as const,
          scheduleId: temporalScheduleIdForAutomation(input.automation.id),
          automationId: input.automation.id,
          automationVersionId: input.version.id,
          timezone: input.version.schedule.timezone,
          rule: input.version.schedule.rule as string,
          overlapPolicy: input.version.schedule.overlapPolicy,
          missedRunPolicy: input.version.schedule.missedRunPolicy,
        }
      : null;

  return {
    canActivate,
    nextAutomationState: canActivate ? "live" : "needs_reconfiguration",
    blockers,
    temporalScheduleIntent,
  };
};

export const evaluateAutomationRunStartPreflight = (
  input: AutomationRunStartPreflightInput,
): AutomationRunStartPreflightResult => {
  if (!input.ownerScopeActive) {
    return {
      action: "mark_needs_reconfiguration",
      runState: null,
      nextAutomationState: "needs_reconfiguration",
      reason: "Owner Scope is disabled or deleted.",
    };
  }

  if (input.automation.state !== "live") {
    return {
      action: "skip_run",
      runState: "skipped",
      nextAutomationState: input.automation.state,
      reason: "Automation is not live.",
    };
  }

  if (
    input.version.state !== "approved" ||
    input.version.id !== input.automation.currentVersionId
  ) {
    return {
      action: "mark_needs_reconfiguration",
      runState: null,
      nextAutomationState: "needs_reconfiguration",
      reason: "Current Automation Version is not approved or no longer current.",
    };
  }

  const connections = connectionById(input.connections);
  const missingRequiredTool = input.toolAuthorizations.some(
    (authorization) =>
      authorization.required &&
      (authorization.state !== "approved" ||
        connections.get(authorization.mcpConnectionId)?.status !== "connected"),
  );

  if (missingRequiredTool) {
    return {
      action: "mark_needs_reconfiguration",
      runState: null,
      nextAutomationState: "needs_reconfiguration",
      reason:
        "A required Tool Authorization or MCP Connection is unavailable at run start.",
    };
  }

  if (
    input.isMissedFire &&
    (input.version.schedule.missedRunPolicy === "skip" ||
      !input.backfillEnabled)
  ) {
    return {
      action: "skip_run",
      runState: "skipped",
      nextAutomationState: "live",
      reason: `Missed scheduled fire at ${input.scheduledFireTime}; backfill is not enabled.`,
    };
  }

  if (input.hasRunningRun) {
    if (input.version.schedule.overlapPolicy === "skip") {
      return {
        action: "skip_run",
        runState: "skipped",
        nextAutomationState: "live",
        reason: "Previous Automation Run is still running.",
      };
    }

    if (input.version.schedule.overlapPolicy === "queue_one") {
      return {
        action: "queue_one",
        runState: "queued",
        nextAutomationState: "live",
        reason: "Previous Automation Run is still running; queueing one run.",
      };
    }

    if (input.version.schedule.overlapPolicy === "cancel_old") {
      return {
        action: "cancel_old_then_start",
        runState: "queued",
        nextAutomationState: "live",
        reason: "Previous Automation Run will be cancelled before this run starts.",
      };
    }
  }

  return {
    action: "start_run",
    runState: "queued",
    nextAutomationState: "live",
    reason: `Scheduled fire accepted at ${input.now}.`,
  };
};

export const evaluateAutomationFailureThreshold = (
  input: AutomationFailureThresholdInput,
): AutomationFailureThresholdResult => {
  const failedOrDegraded =
    input.terminalRunState === "failed" ||
    input.terminalRunState === "completed_partial" ||
    input.terminalRunState === "expired";
  const consecutiveFailureCount = failedOrDegraded
    ? input.automation.consecutiveFailureCount + 1
    : 0;
  const thresholdReached =
    failedOrDegraded &&
    consecutiveFailureCount >= input.automation.failureThreshold;

  return {
    consecutiveFailureCount,
    nextAutomationState: thresholdReached
      ? "needs_reconfiguration"
      : input.automation.state,
    needsNotification: thresholdReached,
  };
};

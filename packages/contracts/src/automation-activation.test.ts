import { describe, expect, test } from "vitest";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  defaultAutomationScheduleConfig,
  evaluateAutomationActivationPreflight,
  evaluateAutomationFailureThreshold,
  evaluateAutomationRunStartPreflight,
  temporalScheduleIdForAutomation,
  type AutomationActivationPreflightInput,
  type AutomationRecordRef,
  type AutomationVersionRef,
  type ToolAuthorizationSnapshotRef,
} from "./automation-activation";

const ownerScope = {
  ownerType: "workspace",
  ownerId: "workspace_123",
} as const;

const automation = {
  id: "automation_123",
  ownerScope,
  state: "pending_approval",
  currentVersionId: null,
  consecutiveFailureCount: 0,
  failureThreshold: 3,
} satisfies AutomationRecordRef;

const schedule = defaultAutomationScheduleConfig({
  rule: "FREQ=DAILY;BYHOUR=8;BYMINUTE=0",
});

const version = {
  id: "automation_version_123",
  automationId: "automation_123",
  state: "approved",
  runBriefVersionId: "run_brief_version_123",
  schedule,
  runBudget: {
    preset: "standard",
    maxLlmSteps: 12,
    maxToolCalls: 20,
    maxRuntimeMs: 900_000,
    maxRetryAttempts: 3,
    maxOutputBytes: 24_000,
    maxSpendUsdCents: null,
  },
  outputDestination: {
    kind: "in_app",
    destinationRef: null,
    authorized: true,
  },
  retentionPolicy: {
    rawLowDays: 90,
    rawSensitiveDays: 30,
    rawRestrictedDays: 7,
    summaryDays: 365,
  },
  approvedByUserId: "user_123",
  approvedAt: "2026-08-17T12:00:00.000Z",
} satisfies AutomationVersionRef;

const toolAuthorization = {
  id: "tool_auth_snapshot_123",
  state: "approved",
  mcpConnectionId: "connection_123",
  mcpToolId: "tool_123",
  toolName: "read_watchlist",
  required: true,
  writeCapable: false,
  acknowledgedWriteCapability: false,
  allowedOutcomeBoundary: null,
} satisfies ToolAuthorizationSnapshotRef;

const activationInput = (
  overrides: Partial<AutomationActivationPreflightInput> = {},
): AutomationActivationPreflightInput => ({
  automation,
  version,
  runBriefVersion: {
    id: "run_brief_version_123",
    state: "approved",
  },
  toolAuthorizations: [toolAuthorization],
  connections: [{ id: "connection_123", status: "connected" }],
  currentToolCatalog: {
    refreshedAt: "2026-08-17T12:00:00.000Z",
    toolsById: {
      tool_123: {
        id: "tool_123",
        connectionId: "connection_123",
        available: true,
        schemaHash: "schema_hash",
        annotationHash: "annotation_hash",
      },
    },
  },
  ...overrides,
});

describe("Automation activation preflight", () => {
  test("activates only after approved brief, approved version, tools, schedule, budget, output, and retention pass", () => {
    const result = evaluateAutomationActivationPreflight(activationInput());

    expect(result.canActivate).toBe(true);
    expect(result.nextAutomationState).toBe("live");
    expect(result.blockers).toEqual([]);
    expect(result.temporalScheduleIntent).toEqual({
      action: "create_or_update",
      scheduleId: temporalScheduleIdForAutomation("automation_123"),
      automationId: "automation_123",
      automationVersionId: "automation_version_123",
      timezone: DEFAULT_SCHEDULE_TIMEZONE,
      rule: "FREQ=DAILY;BYHOUR=8;BYMINUTE=0",
      overlapPolicy: "skip",
      missedRunPolicy: "skip",
    });
  });

  test("blocks activation when a required connection is unavailable", () => {
    const result = evaluateAutomationActivationPreflight(
      activationInput({
        connections: [{ id: "connection_123", status: "error" }],
      }),
    );

    expect(result.canActivate).toBe(false);
    expect(result.nextAutomationState).toBe("needs_reconfiguration");
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "required_connection_unavailable",
    );
    expect(result.temporalScheduleIntent).toBeNull();
  });

  test("blocks activation when recurring schedule rule is missing", () => {
    const result = evaluateAutomationActivationPreflight(
      activationInput({
        version: {
          ...version,
          schedule: defaultAutomationScheduleConfig(),
        },
      }),
    );

    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "schedule_rule_missing",
    );
  });

  test("blocks write-capable tools without acknowledgement and outcome boundary", () => {
    const result = evaluateAutomationActivationPreflight(
      activationInput({
        toolAuthorizations: [
          {
            ...toolAuthorization,
            toolName: "send_email",
            writeCapable: true,
          },
        ],
      }),
    );

    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "write_boundary_missing",
    );
  });
});

describe("Automation scheduled run start preflight", () => {
  const liveAutomation = {
    ...automation,
    state: "live",
    currentVersionId: "automation_version_123",
  } satisfies AutomationRecordRef;

  test("starts a queued run when the live automation still passes runtime preflight", () => {
    const result = evaluateAutomationRunStartPreflight({
      ownerScopeActive: true,
      automation: liveAutomation,
      version,
      toolAuthorizations: [toolAuthorization],
      connections: [{ id: "connection_123", status: "connected" }],
      scheduledFireTime: "2026-08-17T12:00:00.000Z",
      now: "2026-08-17T12:00:01.000Z",
      isMissedFire: false,
      backfillEnabled: false,
      hasRunningRun: false,
    });

    expect(result.action).toBe("start_run");
    expect(result.runState).toBe("queued");
    expect(result.nextAutomationState).toBe("live");
  });

  test("skips missed runs by default instead of backfilling silently", () => {
    const result = evaluateAutomationRunStartPreflight({
      ownerScopeActive: true,
      automation: liveAutomation,
      version,
      toolAuthorizations: [toolAuthorization],
      connections: [{ id: "connection_123", status: "connected" }],
      scheduledFireTime: "2026-08-17T12:00:00.000Z",
      now: "2026-08-17T13:00:00.000Z",
      isMissedFire: true,
      backfillEnabled: false,
      hasRunningRun: false,
    });

    expect(result.action).toBe("skip_run");
    expect(result.runState).toBe("skipped");
  });

  test("uses overlap policy when a previous run is still running", () => {
    const skipped = evaluateAutomationRunStartPreflight({
      ownerScopeActive: true,
      automation: liveAutomation,
      version,
      toolAuthorizations: [toolAuthorization],
      connections: [{ id: "connection_123", status: "connected" }],
      scheduledFireTime: "2026-08-17T12:00:00.000Z",
      now: "2026-08-17T12:00:01.000Z",
      isMissedFire: false,
      backfillEnabled: false,
      hasRunningRun: true,
    });
    const queued = evaluateAutomationRunStartPreflight({
      ownerScopeActive: true,
      automation: liveAutomation,
      version: {
        ...version,
        schedule: { ...schedule, overlapPolicy: "queue_one" },
      },
      toolAuthorizations: [toolAuthorization],
      connections: [{ id: "connection_123", status: "connected" }],
      scheduledFireTime: "2026-08-17T12:00:00.000Z",
      now: "2026-08-17T12:00:01.000Z",
      isMissedFire: false,
      backfillEnabled: false,
      hasRunningRun: true,
    });

    expect(skipped.action).toBe("skip_run");
    expect(queued.action).toBe("queue_one");
  });

  test("marks automation as needing reconfiguration when required authorization is stale at runtime", () => {
    const result = evaluateAutomationRunStartPreflight({
      ownerScopeActive: true,
      automation: liveAutomation,
      version,
      toolAuthorizations: [{ ...toolAuthorization, state: "stale" }],
      connections: [{ id: "connection_123", status: "connected" }],
      scheduledFireTime: "2026-08-17T12:00:00.000Z",
      now: "2026-08-17T12:00:01.000Z",
      isMissedFire: false,
      backfillEnabled: false,
      hasRunningRun: false,
    });

    expect(result.action).toBe("mark_needs_reconfiguration");
    expect(result.nextAutomationState).toBe("needs_reconfiguration");
  });
});

describe("Automation failure threshold", () => {
  test("moves live automation to needs_reconfiguration after repeated failures", () => {
    const result = evaluateAutomationFailureThreshold({
      automation: {
        ...automation,
        state: "live",
        consecutiveFailureCount: 2,
        failureThreshold: 3,
      },
      terminalRunState: "failed",
    });

    expect(result.consecutiveFailureCount).toBe(3);
    expect(result.nextAutomationState).toBe("needs_reconfiguration");
    expect(result.needsNotification).toBe(true);
  });

  test("resets consecutive failure count after a successful run", () => {
    const result = evaluateAutomationFailureThreshold({
      automation: {
        ...automation,
        state: "live",
        consecutiveFailureCount: 2,
      },
      terminalRunState: "completed",
    });

    expect(result.consecutiveFailureCount).toBe(0);
    expect(result.nextAutomationState).toBe("live");
  });
});

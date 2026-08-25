import { describe, expect, test } from "vitest";
import {
  evaluateEvalRouteCoverage,
  evaluateGoldenAutomationScenario,
  REQUIRED_V1_EVAL_LAYERS,
} from "./eval-route";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  defaultAutomationScheduleConfig,
  temporalScheduleIdForAutomation,
  type AutomationActivationPreflightInput,
  type AutomationRecordRef,
  type AutomationVersionRef,
  type ToolAuthorizationSnapshotRef,
} from "./automation-activation";
import {
  createEmptyRunBriefDraft,
  type ProposedToolAuthorization,
  type RunBriefDraft,
} from "./conversation-run-brief";
import type { RunHistoryVisibilityInput } from "./run-history-visibility";

const ownerScope = {
  ownerType: "workspace",
  ownerId: "workspace_123",
} as const;

const readWatchlistTool = {
  id: "tool_auth_watchlist",
  mcpConnectionId: "connection_webull",
  mcpToolId: "tool_watchlist",
  toolName: "read_watchlist",
  displayName: "Read watchlist",
  description: "Reads symbols from the user's watchlist.",
  required: true,
  reason: "The Automation needs the current list of symbols every run.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  state: "approved",
  acknowledgedWriteCapability: false,
  allowedOutcomeBoundary: null,
} satisfies ProposedToolAuthorization;

const readNewsTool = {
  ...readWatchlistTool,
  id: "tool_auth_news",
  mcpToolId: "tool_news",
  toolName: "read_latest_news",
  displayName: "Read latest news",
  description: "Reads current news for a symbol.",
  reason: "The Automation needs fresh news for each watchlist symbol.",
} satisfies ProposedToolAuthorization;

const sendEmailTool = {
  ...readWatchlistTool,
  id: "tool_auth_email",
  mcpConnectionId: "connection_email",
  mcpToolId: "tool_send_email",
  toolName: "send_email",
  displayName: "Send email",
  description: "Sends an email message.",
  required: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
  acknowledgedWriteCapability: true,
  allowedOutcomeBoundary:
    "May send one summary email to the approved destination after each run.",
} satisfies ProposedToolAuthorization;

const completeAutomationDraft = (): RunBriefDraft => ({
  ...createEmptyRunBriefDraft("automation"),
  goal:
    "Every weekday morning, summarize latest news for every symbol in my Webull watchlist.",
  successCriteria: [
    "Fetch the current watchlist during the run.",
    "Check current news for each watchlist symbol.",
    "Separate verified evidence from interpretation.",
  ],
  expectedOutput:
    "A concise summary grouped by symbol with evidence links and interpretation separated.",
  requiredTools: [readWatchlistTool, readNewsTool],
  optionalTools: [sendEmailTool],
  outputDestination: {
    kind: "email",
    destinationRef: "approved_digest_email",
    authorized: true,
  },
  schedule: defaultAutomationScheduleConfig({
    rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=0",
  }),
  userApprovedFinalBrief: true,
});

const automation = {
  id: "automation_123",
  ownerScope,
  state: "pending_approval",
  currentVersionId: null,
  consecutiveFailureCount: 0,
  failureThreshold: 3,
} satisfies AutomationRecordRef;

const liveAutomation = {
  ...automation,
  state: "live",
  currentVersionId: "automation_version_123",
} satisfies AutomationRecordRef;

const automationVersion = {
  id: "automation_version_123",
  automationId: "automation_123",
  state: "approved",
  runBriefVersionId: "run_brief_version_123",
  schedule: defaultAutomationScheduleConfig({
    rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=0",
  }),
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
    kind: "email",
    destinationRef: "approved_digest_email",
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

const watchlistToolSnapshot = {
  id: "tool_snapshot_watchlist",
  state: "approved",
  mcpConnectionId: "connection_webull",
  mcpToolId: "tool_watchlist",
  toolName: "read_watchlist",
  required: true,
  writeCapable: false,
  acknowledgedWriteCapability: false,
  allowedOutcomeBoundary: null,
} satisfies ToolAuthorizationSnapshotRef;

const newsToolSnapshot = {
  id: "tool_snapshot_news",
  state: "approved",
  mcpConnectionId: "connection_webull",
  mcpToolId: "tool_news",
  toolName: "read_latest_news",
  required: true,
  writeCapable: false,
  acknowledgedWriteCapability: false,
  allowedOutcomeBoundary: null,
} satisfies ToolAuthorizationSnapshotRef;

const emailToolSnapshot = {
  id: "tool_snapshot_email",
  state: "approved",
  mcpConnectionId: "connection_email",
  mcpToolId: "tool_send_email",
  toolName: "send_email",
  required: false,
  writeCapable: true,
  acknowledgedWriteCapability: true,
  allowedOutcomeBoundary:
    "May send one summary email to the approved destination after each run.",
} satisfies ToolAuthorizationSnapshotRef;

const toolSnapshots = [
  watchlistToolSnapshot,
  newsToolSnapshot,
  emailToolSnapshot,
] satisfies ToolAuthorizationSnapshotRef[];

const activation = {
  automation,
  version: automationVersion,
  runBriefVersion: {
    id: "run_brief_version_123",
    state: "approved",
  },
  toolAuthorizations: toolSnapshots,
  connections: [
    { id: "connection_webull", status: "connected" },
    { id: "connection_email", status: "connected" },
  ],
  currentToolCatalog: {
    refreshedAt: "2026-08-17T12:00:00.000Z",
    toolsById: {
      tool_watchlist: {
        id: "tool_watchlist",
        connectionId: "connection_webull",
        available: true,
        schemaHash: "schema_watchlist",
        annotationHash: "annotation_watchlist",
      },
      tool_news: {
        id: "tool_news",
        connectionId: "connection_webull",
        available: true,
        schemaHash: "schema_news",
        annotationHash: "annotation_news",
      },
      tool_send_email: {
        id: "tool_send_email",
        connectionId: "connection_email",
        available: true,
        schemaHash: "schema_email",
        annotationHash: "annotation_email",
      },
    },
  },
} satisfies AutomationActivationPreflightInput;

const visibility = {
  run: {
    id: "run_123",
    ownerScope,
    kind: "automation",
    state: "completed",
    title: "Webull watchlist morning digest",
    startedAt: "2026-08-17T12:00:00.000Z",
    completedAt: "2026-08-17T12:02:00.000Z",
  },
  viewerRole: "owner_admin",
  steps: [
    {
      id: "step_tool",
      runId: "run_123",
      type: "tool_call_completed",
      summary: "Fetched watchlist symbols and latest news.",
      occurredAt: "2026-08-17T12:01:00.000Z",
      visibleToUser: true,
      relatedArtifacts: [
        {
          id: "artifact_news",
          purpose: "tool_result",
          sensitivity: "sensitive",
          retentionState: "active",
          rawAvailable: true,
          redactedSummary: { symbolsChecked: 8 },
        },
      ],
      redactedMetadata: {
        toolName: "read_latest_news",
        resultSummary: "8 symbols checked",
        argumentsHash: "hidden_from_user_history",
      },
    },
    {
      id: "step_final",
      runId: "run_123",
      type: "final_output",
      summary: "Delivered the morning digest.",
      occurredAt: "2026-08-17T12:02:00.000Z",
      visibleToUser: true,
      relatedArtifacts: [
        {
          id: "artifact_final",
          purpose: "final_output",
          sensitivity: "low",
          retentionState: "active",
          rawAvailable: true,
          redactedSummary: { sections: ["evidence", "summary"] },
        },
      ],
      redactedMetadata: {
        status: "completed",
        outputDestinationKind: "email",
      },
    },
  ],
  auditEvents: [
    {
      id: "audit_allowed",
      ownerScope,
      actorType: "system",
      actorUserId: null,
      eventName: "mcp.tool_call.allowed",
      targetType: "mcp_tool_call",
      targetId: "tool_call_123",
      runId: "run_123",
      createdAt: "2026-08-17T12:00:30.000Z",
      redactedMetadata: {
        argumentsHash: "admin_visible_hash",
      },
    },
  ],
} satisfies RunHistoryVisibilityInput;

describe("v1 eval route coverage", () => {
  test("requires every accepted v1 accuracy layer before implementation is complete", () => {
    expect(evaluateEvalRouteCoverage(REQUIRED_V1_EVAL_LAYERS)).toEqual({
      ready: true,
      coveredLayers: REQUIRED_V1_EVAL_LAYERS,
      missingLayers: [],
    });

    expect(
      evaluateEvalRouteCoverage([
        "golden_interview_scenarios",
        "run_brief_schema_validation",
      ]),
    ).toMatchObject({
      ready: false,
      missingLayers: [
        "forbidden_assumption_detection",
        "tool_approval_policy",
        "mcp_gateway_denials",
        "mcp_gateway_idempotency",
        "automation_activation_preflight",
        "schedule_policy",
        "bridge_failure_mapping",
        "artifact_retention",
        "run_history_visibility",
      ],
    });
  });
});

describe("golden automation scenarios", () => {
  test("blocks an underspecified automation instead of guessing schedule, tools, output, or success criteria", () => {
    const result = evaluateGoldenAutomationScenario({
      id: "watchlist-news-underspecified",
      title: "Underspecified watchlist news automation",
      userRequest:
        "Check my watchlist and tell me what matters every morning.",
      draft: {
        ...createEmptyRunBriefDraft("automation"),
        goal: "Check my watchlist and tell me what matters every morning.",
        schedule: defaultAutomationScheduleConfig(),
        outputDestination: null,
      },
      expected: {
        canCreateRunBriefVersion: false,
        canApproveRunBriefVersion: false,
        missingRunBriefFieldPaths: [
          "successCriteria",
          "expectedOutput",
          "tools",
          "outputDestination",
          "schedule.rule",
        ],
        writeToolAcknowledgementIds: [],
        forbiddenAssumptionsBlocked: [
          {
            name: "Assume which MCP tools to use",
            relatedMissingFieldPath: "tools",
          },
          {
            name: "Assume exact schedule from 'every morning'",
            relatedMissingFieldPath: "schedule.rule",
          },
          {
            name: "Assume output destination",
            relatedMissingFieldPath: "outputDestination",
          },
        ],
      },
    });

    expect(result.passed).toBe(true);
  });

  test("approves and activates a fully specified watchlist digest automation", () => {
    const result = evaluateGoldenAutomationScenario({
      id: "webull-watchlist-digest-approved",
      title: "Approved Webull watchlist digest",
      userRequest:
        "Every weekday at 8 AM New York time, check my Webull watchlist, fetch latest news for every symbol, and email me a summary.",
      draft: completeAutomationDraft(),
      activation,
      runStart: {
        ownerScopeActive: true,
        automation: liveAutomation,
        version: automationVersion,
        toolAuthorizations: toolSnapshots,
        connections: [
          { id: "connection_webull", status: "connected" },
          { id: "connection_email", status: "connected" },
        ],
        scheduledFireTime: "2026-08-18T12:00:00.000Z",
        now: "2026-08-18T12:00:01.000Z",
        isMissedFire: false,
        backfillEnabled: false,
        hasRunningRun: false,
      },
      visibility,
      expected: {
        canCreateRunBriefVersion: true,
        canApproveRunBriefVersion: true,
        missingRunBriefFieldPaths: [],
        writeToolAcknowledgementIds: [],
        forbiddenAssumptionsBlocked: [],
        activationCanActivate: true,
        activationBlockerCodes: [],
        temporalScheduleId: temporalScheduleIdForAutomation("automation_123"),
        runStartAction: "start_run",
        userVisibleRunStepTypes: ["tool_call_completed", "final_output"],
        adminAuditVisible: true,
      },
    });

    expect(result.passed).toBe(true);
  });

  test("moves live automation to needs_reconfiguration when required authorization is stale", () => {
    const result = evaluateGoldenAutomationScenario({
      id: "stale-required-tool-runtime",
      title: "Stale required tool at runtime",
      userRequest:
        "Run the approved Webull watchlist digest automation on schedule.",
      draft: completeAutomationDraft(),
      runStart: {
        ownerScopeActive: true,
        automation: liveAutomation,
        version: automationVersion,
        toolAuthorizations: [
          { ...watchlistToolSnapshot, state: "stale" },
          newsToolSnapshot,
          emailToolSnapshot,
        ],
        connections: [
          { id: "connection_webull", status: "connected" },
          { id: "connection_email", status: "connected" },
        ],
        scheduledFireTime: "2026-08-18T12:00:00.000Z",
        now: "2026-08-18T12:00:01.000Z",
        isMissedFire: false,
        backfillEnabled: false,
        hasRunningRun: false,
      },
      expected: {
        canCreateRunBriefVersion: true,
        canApproveRunBriefVersion: true,
        missingRunBriefFieldPaths: [],
        writeToolAcknowledgementIds: [],
        forbiddenAssumptionsBlocked: [],
        runStartAction: "mark_needs_reconfiguration",
      },
    });

    expect(result.passed).toBe(true);
  });
});

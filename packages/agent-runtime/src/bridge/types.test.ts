import { describe, expect, test } from "vitest";
import {
  bridgeStatusToRunState,
  validateRunWorkflowInput,
  zeroBudgetUsageDelta,
  type BridgeStepStatus,
  type RunWorkflowInput,
} from "./types";

const baseInput = {
  schemaVersion: "run-workflow-input.v1",
  runId: "run_123",
  ownerScope: {
    ownerType: "workspace",
    ownerId: "workspace_123",
  },
  conversationId: "conversation_123",
  runBriefVersionId: "run_brief_version_123",
  automationId: null,
  automationVersionId: null,
  startedByUserId: "user_123",
  triggerSource: null,
  runBudget: {
    maxLlmSteps: 8,
    maxToolCalls: 12,
    maxRuntimeMs: 300_000,
    maxRetryAttempts: 3,
    maxOutputBytes: 32_000,
    maxSpendUsdCents: 250,
  },
  executionPolicy: {
    allowWaitingForUser: true,
    allowUnapprovedTools: false,
    requiredToolUnavailable: "retry_then_partial",
    optionalToolUnavailable: "continue_degraded",
  },
  modelExecutionProfile: {
    provider: "openai",
    model: "gpt-5",
    settingsArtifactId: null,
    toolPolicyVersion: "tool-policy.v1",
  },
  initialCheckpointId: null,
} satisfies Omit<RunWorkflowInput, "kind">;

describe("Run Workflow input validation", () => {
  test("allows manual Agent Runs to wait for the present user", () => {
    expect(() =>
      validateRunWorkflowInput({
        ...baseInput,
        kind: "agent",
      }),
    ).not.toThrow();
  });

  test("rejects Automation Runs that can wait for surprise user input", () => {
    expect(() =>
      validateRunWorkflowInput({
        ...baseInput,
        kind: "automation",
        automationId: "automation_123",
        automationVersionId: "automation_version_123",
      }),
    ).toThrow("Automation Runs cannot wait");
  });

  test("rejects any Run Workflow that allows unapproved tools", () => {
    expect(() =>
      validateRunWorkflowInput({
        ...baseInput,
        kind: "agent",
        executionPolicy: {
          ...baseInput.executionPolicy,
          allowUnapprovedTools: true as false,
        },
      }),
    ).toThrow("cannot allow unapproved tools");
  });
});

describe("Bridge status mapping", () => {
  test.each([
    ["advanced", "running"],
    ["completed", "completed"],
    ["completed_partial", "completed_partial"],
    ["retryable_failed", "failed"],
    ["non_retryable_failed", "failed"],
    ["budget_exhausted", "completed_partial"],
  ] satisfies Array<[BridgeStepStatus, string]>)(
    "maps %s to %s",
    (bridgeStatus, runState) => {
      expect(
        bridgeStatusToRunState({ ...baseInput, kind: "agent" }, bridgeStatus),
      ).toBe(runState);
    },
  );

  test("maps manual user input waits only for Agent Runs", () => {
    expect(
      bridgeStatusToRunState(
        { ...baseInput, kind: "agent" },
        "needs_user_input",
      ),
    ).toBe("waiting_for_user");

    expect(
      bridgeStatusToRunState(
        {
          kind: "automation",
          executionPolicy: {
            ...baseInput.executionPolicy,
            allowWaitingForUser: false,
          },
        },
        "needs_user_input",
      ),
    ).toBe("failed");
  });
});

describe("Budget usage deltas", () => {
  test("start at zero for every tracked budget dimension", () => {
    expect(zeroBudgetUsageDelta()).toEqual({
      llmSteps: 0,
      toolCalls: 0,
      runtimeMs: 0,
      retryAttempts: 0,
      outputBytes: 0,
      promptTokens: 0,
      completionTokens: 0,
      spendUsdCents: 0,
    });
  });
});

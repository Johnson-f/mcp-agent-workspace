import { describe, expect, it } from "vitest";
import { validateRunWorkflowInput, type RunWorkflowInput } from "./bridge/types";

const automationInput: RunWorkflowInput = {
  schemaVersion: "run-workflow-input.v1",
  runId: "run-1",
  kind: "automation",
  ownerScope: { ownerType: "workspace", ownerId: "workspace-1" },
  conversationId: "conversation-1",
  runBriefVersionId: "brief-version-1",
  automationId: "automation-1",
  automationVersionId: "automation-version-1",
  startedByUserId: "user-1",
  triggerSource: "manual",
  runBudget: {
    maxLlmSteps: 6,
    maxToolCalls: 8,
    maxRuntimeMs: 180_000,
    maxRetryAttempts: 2,
    maxOutputBytes: 12_000,
    maxSpendUsdCents: 100,
  },
  executionPolicy: {
    allowWaitingForUser: false,
    allowUnapprovedTools: false,
    requiredToolUnavailable: "retry_then_partial",
    optionalToolUnavailable: "continue_degraded",
  },
  modelExecutionProfile: {
    provider: "openai",
    model: "gpt-5.5",
    settingsArtifactId: null,
    toolPolicyVersion: "tool-policy.v1",
  },
  initialCheckpointId: null,
};

describe("Automation Run workflow input", () => {
  it("accepts a manual trigger with no waiting-for-user policy", () => {
    expect(() => validateRunWorkflowInput(automationInput)).not.toThrow();
  });

  it("requires a trigger source for Automation Runs", () => {
    expect(() =>
      validateRunWorkflowInput({ ...automationInput, triggerSource: null }),
    ).toThrow("trigger source");
  });
});

import { proxyActivities } from "@temporalio/workflow";
import type * as bridgeActivities from "./activities";
import type {
  BridgeStepResult,
  BudgetUsageDelta,
  DurableOperation,
  RunWorkflowInput,
  RunWorkflowResult,
} from "./types";
import {
  bridgeStatusToRunState,
  isTerminalBridgeStatus,
  validateRunWorkflowInput,
  zeroBudgetUsageDelta,
} from "./types";

const activities = proxyActivities<typeof bridgeActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
  },
});

const addBudgetUsage = (
  left: BudgetUsageDelta,
  right: BudgetUsageDelta,
): BudgetUsageDelta => ({
  llmSteps: left.llmSteps + right.llmSteps,
  toolCalls: left.toolCalls + right.toolCalls,
  runtimeMs: left.runtimeMs + right.runtimeMs,
  retryAttempts: left.retryAttempts + right.retryAttempts,
  outputBytes: left.outputBytes + right.outputBytes,
  promptTokens: left.promptTokens + right.promptTokens,
  completionTokens: left.completionTokens + right.completionTokens,
  spendUsdCents: left.spendUsdCents + right.spendUsdCents,
});

const applyResult = (
  result: BridgeStepResult,
  usage: BudgetUsageDelta,
) => ({
  checkpointId: result.checkpointId,
  budgetUsage: addBudgetUsage(usage, result.budgetUsageDelta),
});

const toWorkflowResult = (
  input: RunWorkflowInput,
  result: BridgeStepResult,
  budgetUsage: BudgetUsageDelta,
): RunWorkflowResult => ({
  schemaVersion: "run-workflow-result.v1",
  runId: input.runId,
  state: bridgeStatusToRunState(input, result.status),
  finalRunStepId: result.runStepId,
  finalArtifactIds: result.artifactIds,
  checkpointId: result.checkpointId,
  budgetUsage,
  failure: result.failure,
});

const budgetExceededReason = (
  input: RunWorkflowInput,
  usage: BudgetUsageDelta,
) => {
  if (usage.llmSteps > input.runBudget.maxLlmSteps) {
    return "Run Budget reached: maximum LLM steps exceeded.";
  }
  if (usage.toolCalls > input.runBudget.maxToolCalls) {
    return "Run Budget reached: maximum MCP tool calls exceeded.";
  }
  if (usage.runtimeMs > input.runBudget.maxRuntimeMs) {
    return "Run Budget reached: maximum runtime exceeded.";
  }
  if (usage.outputBytes > input.runBudget.maxOutputBytes) {
    return "Run Budget reached: maximum output size exceeded.";
  }
  return null;
};

const persistBudgetReached = async (
  input: RunWorkflowInput,
  checkpointId: string | null,
  budgetUsage: BudgetUsageDelta,
  reason: string,
  finalArtifactIds: string[],
) =>
  activities.markRunBudgetReached({
    schemaVersion: "bridge-activity-input.v1",
    kind: "budget_reached",
    runId: input.runId,
    ownerScope: input.ownerScope,
    checkpointId,
    idempotencyKey: `${input.runId}:budget_reached:${reason}`,
    budgetUsage,
    reason,
    finalArtifactIds,
  });

const operationInputBase = (
  input: RunWorkflowInput,
  checkpointId: string | null,
  operation: DurableOperation,
) => ({
  schemaVersion: "bridge-activity-input.v1" as const,
  runId: input.runId,
  ownerScope: input.ownerScope,
  checkpointId,
  idempotencyKey: `${input.runId}:${operation.kind}:${
    "modelCallId" in operation
      ? operation.modelCallId
      : "toolCallId" in operation
        ? operation.toolCallId
        : "artifactIntentId" in operation
          ? operation.artifactIntentId
          : "checkpointIntentId" in operation
            ? operation.checkpointIntentId
            : `${operation.runStepType}:${operation.summary}`
  }`,
});

const executeDurableOperation = async (
  input: RunWorkflowInput,
  checkpointId: string | null,
  operation: DurableOperation,
): Promise<BridgeStepResult> => {
  const base = operationInputBase(input, checkpointId, operation);

  switch (operation.kind) {
    case "model_call":
      return activities.executeModelCall({
        ...base,
        kind: operation.kind,
        modelCallId: operation.modelCallId,
        modelExecutionProfile: input.modelExecutionProfile,
        promptArtifactIds: operation.promptArtifactIds,
        allowedToolAuthorizationSnapshotIds:
          operation.allowedToolAuthorizationSnapshotIds,
      });
    case "mcp_tool_call":
      return activities.executeMcpToolCall({
        ...base,
        kind: operation.kind,
        toolCallId: operation.toolCallId,
        mcpConnectionId: operation.mcpConnectionId,
        mcpToolId: operation.mcpToolId,
        toolAuthorizationSnapshotId: operation.toolAuthorizationSnapshotId,
        argumentsArtifactId: operation.argumentsArtifactId,
      });
    case "artifact_write":
      return activities.writeArtifact({
        ...base,
        kind: operation.kind,
        artifactIntentId: operation.artifactIntentId,
        sourceArtifactIds: operation.sourceArtifactIds,
        purpose: operation.purpose,
      });
    case "checkpoint_save":
      return activities.saveCheckpoint({
        ...base,
        kind: operation.kind,
        checkpointIntentId: operation.checkpointIntentId,
        stateArtifactId: operation.stateArtifactId,
      });
    case "run_step_persist":
      return activities.persistRunStep({
        ...base,
        kind: operation.kind,
        runStepType: operation.runStepType,
        summary: operation.summary,
        relatedArtifactIds: operation.relatedArtifactIds,
        redactedMetadata: operation.redactedMetadata,
      });
  }
};

export async function runWorkflow(
  input: RunWorkflowInput,
): Promise<RunWorkflowResult> {
  validateRunWorkflowInput(input);

  let checkpointId = input.initialCheckpointId;
  let budgetUsage = zeroBudgetUsageDelta();

  for (let step = 0; step < input.runBudget.maxLlmSteps + input.runBudget.maxToolCalls + 32; step += 1) {
    const graphResult = await activities.advanceGraph({
      schemaVersion: "bridge-activity-input.v1",
      kind: "graph_advance",
      runId: input.runId,
      ownerScope: input.ownerScope,
      checkpointId,
      idempotencyKey: `${input.runId}:graph_advance:${step}`,
      runBriefVersionId: input.runBriefVersionId,
    });
    const appliedGraph = applyResult(graphResult, budgetUsage);
    checkpointId = appliedGraph.checkpointId ?? checkpointId;
    budgetUsage = appliedGraph.budgetUsage;
    const graphBudgetReason = budgetExceededReason(input, budgetUsage);
    if (graphBudgetReason) {
      const budgetResult = await persistBudgetReached(
        input,
        checkpointId,
        budgetUsage,
        graphBudgetReason,
        graphResult.artifactIds,
      );
      return toWorkflowResult(input, budgetResult, budgetUsage);
    }

    if (isTerminalBridgeStatus(graphResult.status)) {
      return toWorkflowResult(input, graphResult, budgetUsage);
    }

    if (!graphResult.durableOperation) {
      return toWorkflowResult(
        input,
        {
          schemaVersion: "bridge-step-result.v1",
          status: "non_retryable_failed",
          runId: input.runId,
          runStepId: graphResult.runStepId,
          artifactIds: graphResult.artifactIds,
          checkpointId,
          budgetUsageDelta: zeroBudgetUsageDelta(),
          failure: {
            code: "unknown_failure",
            message: "Graph advance did not return a durable operation.",
            retryable: false,
          },
        },
        budgetUsage,
      );
    }

    const operationResult = await executeDurableOperation(
      input,
      checkpointId,
      graphResult.durableOperation,
    );
    const appliedOperation = applyResult(operationResult, budgetUsage);
    checkpointId = appliedOperation.checkpointId ?? checkpointId;
    budgetUsage = appliedOperation.budgetUsage;
    const operationBudgetReason = budgetExceededReason(input, budgetUsage);
    if (operationBudgetReason) {
      const budgetResult = await persistBudgetReached(
        input,
        checkpointId,
        budgetUsage,
        operationBudgetReason,
        operationResult.artifactIds,
      );
      return toWorkflowResult(input, budgetResult, budgetUsage);
    }

    if (isTerminalBridgeStatus(operationResult.status)) {
      return toWorkflowResult(input, operationResult, budgetUsage);
    }
  }

  return {
    schemaVersion: "run-workflow-result.v1",
    runId: input.runId,
    state: "completed_partial",
    finalRunStepId: null,
    finalArtifactIds: [],
    checkpointId,
    budgetUsage,
    failure: {
      code: "budget_exhausted",
      message: "Run Workflow exhausted its bridge step budget.",
      retryable: false,
    },
  };
}

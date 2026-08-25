export type OwnerType = "user" | "workspace";

export interface OwnerScopeRef {
  ownerType: OwnerType;
  ownerId: string;
}

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

export type BridgeStepStatus =
  | "advanced"
  | "completed"
  | "completed_partial"
  | "retryable_failed"
  | "non_retryable_failed"
  | "budget_exhausted"
  | "needs_user_input";

export type BridgeFailureCode =
  | "activity_not_implemented"
  | "budget_exhausted"
  | "checkpoint_unavailable"
  | "invalid_run_policy"
  | "model_call_failed"
  | "tool_call_denied"
  | "tool_call_failed"
  | "artifact_write_failed"
  | "persistence_failed"
  | "unknown_failure";

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

export interface RunBudget {
  maxLlmSteps: number;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxRetryAttempts: number;
  maxOutputBytes: number;
  maxSpendUsdCents: number | null;
}

export interface BudgetUsageDelta {
  llmSteps: number;
  toolCalls: number;
  runtimeMs: number;
  retryAttempts: number;
  outputBytes: number;
  promptTokens: number;
  completionTokens: number;
  spendUsdCents: number;
}

export const zeroBudgetUsageDelta = (): BudgetUsageDelta => ({
  llmSteps: 0,
  toolCalls: 0,
  runtimeMs: 0,
  retryAttempts: 0,
  outputBytes: 0,
  promptTokens: 0,
  completionTokens: 0,
  spendUsdCents: 0,
});

export interface ModelExecutionProfileRef {
  provider: string;
  model: string;
  settingsArtifactId: string | null;
  toolPolicyVersion: string;
}

export interface RunExecutionPolicy {
  allowWaitingForUser: boolean;
  allowUnapprovedTools: false;
  requiredToolUnavailable: "retry_then_fail" | "retry_then_partial";
  optionalToolUnavailable: "continue_degraded";
}

export interface RunWorkflowInput {
  schemaVersion: "run-workflow-input.v1";
  runId: string;
  kind: RunKind;
  ownerScope: OwnerScopeRef;
  conversationId: string | null;
  runBriefVersionId: string;
  automationId: string | null;
  automationVersionId: string | null;
  startedByUserId: string | null;
  triggerSource: "manual" | "scheduled" | null;
  runBudget: RunBudget;
  executionPolicy: RunExecutionPolicy;
  modelExecutionProfile: ModelExecutionProfileRef;
  initialCheckpointId: string | null;
}

export interface RunWorkflowResult {
  schemaVersion: "run-workflow-result.v1";
  runId: string;
  state: RunState;
  finalRunStepId: string | null;
  finalArtifactIds: string[];
  checkpointId: string | null;
  budgetUsage: BudgetUsageDelta;
  failure: BridgeFailure | null;
}

export interface CheckpointRef {
  checkpointId: string;
  namespace: "langgraph";
  persistedAt: string;
}

export interface BridgeFailure {
  code: BridgeFailureCode;
  message: string;
  retryable: boolean;
}

export interface BridgeActivityBaseInput {
  schemaVersion: "bridge-activity-input.v1";
  runId: string;
  ownerScope: OwnerScopeRef;
  checkpointId: string | null;
  idempotencyKey: string;
}

export interface BridgeStepResult {
  schemaVersion: "bridge-step-result.v1";
  status: BridgeStepStatus;
  runId: string;
  runStepId: string | null;
  artifactIds: string[];
  checkpointId: string | null;
  budgetUsageDelta: BudgetUsageDelta;
  failure: BridgeFailure | null;
}

export type DurableOperation =
  | ModelCallOperation
  | McpToolCallOperation
  | ArtifactWriteOperation
  | CheckpointSaveOperation
  | RunStepPersistOperation;

export interface GraphAdvanceActivityInput extends BridgeActivityBaseInput {
  kind: "graph_advance";
  runBriefVersionId: string;
}

export interface GraphAdvanceActivityResult extends BridgeStepResult {
  durableOperation: DurableOperation | null;
}

export interface ModelCallOperation {
  kind: "model_call";
  modelCallId: string;
  promptArtifactIds: string[];
  allowedToolAuthorizationSnapshotIds: string[];
}

export interface ModelCallActivityInput extends BridgeActivityBaseInput {
  kind: "model_call";
  modelCallId: string;
  modelExecutionProfile: ModelExecutionProfileRef;
  promptArtifactIds: string[];
  allowedToolAuthorizationSnapshotIds: string[];
}

export interface McpToolCallOperation {
  kind: "mcp_tool_call";
  toolCallId: string;
  mcpConnectionId: string;
  mcpToolId: string;
  toolAuthorizationSnapshotId: string;
  argumentsArtifactId: string;
}

export interface McpToolCallActivityInput extends BridgeActivityBaseInput {
  kind: "mcp_tool_call";
  toolCallId: string;
  mcpConnectionId: string;
  mcpToolId: string;
  toolAuthorizationSnapshotId: string;
  argumentsArtifactId: string;
}

export interface ArtifactWriteOperation {
  kind: "artifact_write";
  artifactIntentId: string;
  sourceArtifactIds: string[];
  purpose:
    | "model_output"
    | "tool_result"
    | "checkpoint_state"
    | "final_output";
}

export interface ArtifactWriteActivityInput extends BridgeActivityBaseInput {
  kind: "artifact_write";
  artifactIntentId: string;
  sourceArtifactIds: string[];
  purpose: ArtifactWriteOperation["purpose"];
}

export interface CheckpointSaveOperation {
  kind: "checkpoint_save";
  checkpointIntentId: string;
  stateArtifactId: string;
}

export interface CheckpointSaveActivityInput extends BridgeActivityBaseInput {
  kind: "checkpoint_save";
  checkpointIntentId: string;
  stateArtifactId: string;
}

export interface RunStepPersistOperation {
  kind: "run_step_persist";
  runStepType: RunStepType;
  summary: string;
  relatedArtifactIds: string[];
  redactedMetadata: Record<string, unknown>;
}

export interface RunStepPersistActivityInput extends BridgeActivityBaseInput {
  kind: "run_step_persist";
  runStepType: RunStepType;
  summary: string;
  relatedArtifactIds: string[];
  redactedMetadata: Record<string, unknown>;
}

export interface BudgetReachedActivityInput extends BridgeActivityBaseInput {
  kind: "budget_reached";
  budgetUsage: BudgetUsageDelta;
  reason: string;
  finalArtifactIds: string[];
}

export type BridgeActivityInput =
  | GraphAdvanceActivityInput
  | ModelCallActivityInput
  | McpToolCallActivityInput
  | ArtifactWriteActivityInput
  | CheckpointSaveActivityInput
  | RunStepPersistActivityInput
  | BudgetReachedActivityInput;

export const bridgeTerminalStatuses = [
  "completed",
  "completed_partial",
  "non_retryable_failed",
  "budget_exhausted",
  "needs_user_input",
] as const satisfies readonly BridgeStepStatus[];

export const isTerminalBridgeStatus = (
  status: BridgeStepStatus,
): boolean =>
  bridgeTerminalStatuses.some((terminalStatus) => terminalStatus === status);

export const bridgeStatusToRunState = (
  input: Pick<RunWorkflowInput, "kind" | "executionPolicy">,
  status: BridgeStepStatus,
): RunState => {
  switch (status) {
    case "advanced":
      return "running";
    case "completed":
      return "completed";
    case "completed_partial":
      return "completed_partial";
    case "retryable_failed":
    case "non_retryable_failed":
      return "failed";
    case "budget_exhausted":
      return "completed_partial";
    case "needs_user_input":
      return input.kind === "agent" && input.executionPolicy.allowWaitingForUser
        ? "waiting_for_user"
        : "failed";
  }
};

export const validateRunWorkflowInput = (input: RunWorkflowInput) => {
  if (input.executionPolicy.allowUnapprovedTools !== false) {
    throw new Error("Run Workflow cannot allow unapproved tools.");
  }

  if (input.kind === "automation" && input.executionPolicy.allowWaitingForUser) {
    throw new Error("Automation Runs cannot wait for surprise user input.");
  }

  if (input.kind === "automation" && !input.automationVersionId) {
    throw new Error("Automation Runs require an Automation Version.");
  }

  if (input.kind === "automation" && !input.triggerSource) {
    throw new Error("Automation Runs require a trigger source.");
  }

  if (input.kind === "agent" && input.automationVersionId) {
    throw new Error("Agent Runs cannot be tied to an Automation Version.");
  }
};

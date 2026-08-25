import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { DurableOperation, McpToolCallOperation } from "./types";

export type AgentGraphPhase =
  | "intro_recorded"
  | "model_prompt_created"
  | "model_decision_recorded"
  | "tool_completed"
  | "completed";

export type ModelIntent = "tool_decision" | "final_output";

export interface PendingToolCallState {
  toolCallId: string;
  mcpConnectionId: string;
  mcpToolId: string;
  toolAuthorizationSnapshotId: string;
  argumentsArtifactId: string;
  toolName: string;
}

export interface CompletedToolCallState {
  toolCallId: string;
  toolName: string;
  toolAuthorizationSnapshotId: string;
  resultArtifactId: string;
  completedRunStepId: string;
}

export interface AgentGraphState {
  phase: AgentGraphPhase;
  runId: string;
  promptArtifactIds: string[];
  approvedToolAuthorizationSnapshotIds: string[];
  modelIntent: ModelIntent | null;
  pendingToolCall: PendingToolCallState | null;
  completedToolCalls: CompletedToolCallState[];
  finalArtifactIds: string[];
  finalRunStepId: string | null;
  durableOperation: DurableOperation | null;
}

const AgentGraphAnnotation = Annotation.Root({
  phase: Annotation<AgentGraphPhase>(),
  runId: Annotation<string>(),
  promptArtifactIds: Annotation<string[]>({
    default: () => [],
    reducer: (_left, right) => right,
  }),
  approvedToolAuthorizationSnapshotIds: Annotation<string[]>({
    default: () => [],
    reducer: (_left, right) => right,
  }),
  modelIntent: Annotation<ModelIntent | null>({
    default: () => null,
    reducer: (_left, right) => right,
  }),
  pendingToolCall: Annotation<PendingToolCallState | null>({
    default: () => null,
    reducer: (_left, right) => right,
  }),
  completedToolCalls: Annotation<CompletedToolCallState[]>({
    default: () => [],
    reducer: (_left, right) => right,
  }),
  finalArtifactIds: Annotation<string[]>({
    default: () => [],
    reducer: (_left, right) => right,
  }),
  finalRunStepId: Annotation<string | null>({
    default: () => null,
    reducer: (_left, right) => right,
  }),
  durableOperation: Annotation<DurableOperation | null>({
    default: () => null,
    reducer: (_left, right) => right,
  }),
});

const modelCallOperation = (
  state: typeof AgentGraphAnnotation.State,
): DurableOperation => ({
  kind: "model_call",
  modelCallId: `${state.runId}:model:${state.modelIntent ?? "tool_decision"}:${state.completedToolCalls.length}`,
  promptArtifactIds: state.promptArtifactIds,
  allowedToolAuthorizationSnapshotIds:
    state.approvedToolAuthorizationSnapshotIds,
});

const toolCallOperation = (
  pendingToolCall: PendingToolCallState,
): McpToolCallOperation => ({
  kind: "mcp_tool_call",
  toolCallId: pendingToolCall.toolCallId,
  mcpConnectionId: pendingToolCall.mcpConnectionId,
  mcpToolId: pendingToolCall.mcpToolId,
  toolAuthorizationSnapshotId:
    pendingToolCall.toolAuthorizationSnapshotId,
  argumentsArtifactId: pendingToolCall.argumentsArtifactId,
});

const decideNextOperation = (state: typeof AgentGraphAnnotation.State) => {
  if (state.phase === "model_prompt_created") {
    return { durableOperation: modelCallOperation(state) };
  }

  if (state.phase === "model_decision_recorded" && state.pendingToolCall) {
    return { durableOperation: toolCallOperation(state.pendingToolCall) };
  }

  return { durableOperation: null };
};

const graph = new StateGraph(AgentGraphAnnotation)
  .addNode("decideNextOperation", decideNextOperation)
  .addEdge(START, "decideNextOperation")
  .addEdge("decideNextOperation", END)
  .compile();

export const decideNextAgentOperation = async (
  state: Omit<AgentGraphState, "durableOperation">,
) => {
  const result = await graph.invoke({
    ...state,
    durableOperation: null,
  });
  return result.durableOperation;
};

import { describe, expect, test } from "vitest";
import { decideNextAgentOperation } from "./agent-graph";

const baseState = {
  runId: "run_123",
  promptArtifactIds: ["prompt_123"],
  approvedToolAuthorizationSnapshotIds: ["tool_auth_123"],
  modelIntent: "tool_decision" as const,
  pendingToolCall: null,
  completedToolCalls: [],
  finalArtifactIds: [],
  finalRunStepId: null,
};

describe("Agent LangGraph routing", () => {
  test("routes a model prompt checkpoint to a model call", async () => {
    const operation = await decideNextAgentOperation({
      ...baseState,
      phase: "model_prompt_created",
    });

    expect(operation).toMatchObject({
      kind: "model_call",
      promptArtifactIds: ["prompt_123"],
      allowedToolAuthorizationSnapshotIds: ["tool_auth_123"],
    });
  });

  test("routes a recorded model tool decision to an MCP tool call", async () => {
    const operation = await decideNextAgentOperation({
      ...baseState,
      phase: "model_decision_recorded",
      pendingToolCall: {
        toolCallId: "tool_call_123",
        mcpConnectionId: "mcp_connection_123",
        mcpToolId: "mcp_tool_123",
        toolAuthorizationSnapshotId: "tool_auth_123",
        argumentsArtifactId: "args_123",
        toolName: "watchlist.read",
      },
    });

    expect(operation).toMatchObject({
      kind: "mcp_tool_call",
      toolCallId: "tool_call_123",
      toolAuthorizationSnapshotId: "tool_auth_123",
      argumentsArtifactId: "args_123",
    });
  });
});

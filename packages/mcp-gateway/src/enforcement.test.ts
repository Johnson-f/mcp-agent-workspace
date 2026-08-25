import { describe, expect, test } from "vitest";
import {
  enforceMcpGatewayToolCall,
  type CurrentMcpConnectionState,
  type CurrentMcpToolState,
  type McpGatewayToolCallContext,
  type McpGatewayToolCallRequest,
  type ToolAuthorizationSnapshot,
} from "./enforcement";
import { hashToolArguments } from "./tool-call-policy";

const ownerScope = {
  ownerType: "workspace",
  ownerId: "workspace_123",
} as const;

const request = {
  schemaVersion: "mcp-gateway-tool-call-request.v1",
  runId: "run_123",
  ownerScope,
  toolCallId: "tool_call_123",
  idempotencyKey: "run_123:mcp_tool_call:tool_call_123",
  mcpConnectionId: "connection_123",
  mcpToolId: "tool_123",
  toolAuthorizationSnapshotId: "tool_auth_snapshot_123",
  argumentsArtifactId: "artifact_args_123",
  arguments: {
    symbol: "AAPL",
  },
} satisfies McpGatewayToolCallRequest;

const connection = {
  id: "connection_123",
  ownerScope,
  status: "connected",
} satisfies CurrentMcpConnectionState;

const tool = {
  id: "tool_123",
  connectionId: "connection_123",
  name: "get_watchlist_news",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["symbol"],
    properties: {
      symbol: { type: "string" },
    },
  },
  schemaHash: "schema_hash_123",
  annotationHash: "annotation_hash_123",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },
  available: true,
} satisfies CurrentMcpToolState;

const snapshot = {
  id: "tool_auth_snapshot_123",
  ownerScope,
  state: "approved",
  mcpConnectionId: "connection_123",
  mcpToolId: "tool_123",
  serverId: "server_123",
  toolName: "get_watchlist_news",
  schemaHash: "schema_hash_123",
  annotationHash: "annotation_hash_123",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },
  required: true,
  approvedByUserId: "user_123",
  approvedAt: "2026-08-17T00:00:00.000Z",
  acknowledgedWriteCapability: false,
  allowedOutcomeBoundary: null,
} satisfies ToolAuthorizationSnapshot;

const context = (
  override: Partial<McpGatewayToolCallContext> = {},
): McpGatewayToolCallContext => ({
  connection,
  tool,
  authorizationSnapshot: snapshot,
  existingToolCall: null,
  ...override,
});

describe("MCP Gateway enforcement", () => {
  test("allows approved read-only tool calls and returns audit/run-step/artifact intents", async () => {
    const decision = await enforceMcpGatewayToolCall(request, context());

    expect(decision.status).toBe("allowed");
    expect(decision.denial).toBeNull();
    expect(decision.auditEvent.eventName).toBe("mcp.tool_call.allowed");
    expect(decision.runStep?.type).toBe("tool_call_started");
    expect(decision.artifactIntent).toEqual({
      purpose: "tool_arguments",
      sourceArtifactIds: ["artifact_args_123"],
      redactedSummary: { symbol: "[string:4]" },
    });
  });

  test("denies calls without a Tool Authorization Snapshot", async () => {
    const decision = await enforceMcpGatewayToolCall(
      request,
      context({ authorizationSnapshot: null }),
    );

    expect(decision.status).toBe("denied");
    expect(decision.denial?.code).toBe("authorization_missing");
    expect(decision.auditEvent.eventName).toBe("mcp.tool_call.denied");
    expect(decision.runStep?.type).toBe("tool_call_failed");
  });

  test("denies stale authorizations when schema or annotation fingerprints changed", async () => {
    const decision = await enforceMcpGatewayToolCall(
      request,
      context({
        tool: {
          ...tool,
          annotationHash: "changed_annotation_hash",
        },
      }),
    );

    expect(decision.status).toBe("denied");
    expect(decision.denial?.code).toBe("authorization_stale");
  });

  test("denies write-capable tools without acknowledgement and outcome boundary", async () => {
    const writeAnnotations = {
      readOnlyHint: false,
      destructiveHint: false,
    };
    const decision = await enforceMcpGatewayToolCall(
      request,
      context({
        tool: {
          ...tool,
          annotationHash: "write_annotation_hash",
          annotations: writeAnnotations,
        },
        authorizationSnapshot: {
          ...snapshot,
          annotationHash: "write_annotation_hash",
          annotations: writeAnnotations,
        },
      }),
    );

    expect(decision.status).toBe("denied");
    expect(decision.denial?.code).toBe("write_boundary_missing");
  });

  test("allows write-capable tools with acknowledgement and an outcome boundary", async () => {
    const writeAnnotations = {
      readOnlyHint: false,
      destructiveHint: false,
    };
    const decision = await enforceMcpGatewayToolCall(
      request,
      context({
        tool: {
          ...tool,
          annotationHash: "write_annotation_hash",
          annotations: writeAnnotations,
        },
        authorizationSnapshot: {
          ...snapshot,
          annotationHash: "write_annotation_hash",
          annotations: writeAnnotations,
          acknowledgedWriteCapability: true,
          allowedOutcomeBoundary:
            "May send one summary email to the approved destination.",
        },
      }),
    );

    expect(decision.status).toBe("allowed");
  });

  test("replays idempotent calls with the same argument hash", async () => {
    const decision = await enforceMcpGatewayToolCall(
      request,
      context({
        existingToolCall: {
          toolCallId: "tool_call_existing",
          idempotencyKey: request.idempotencyKey,
          argumentsHash: await hashToolArguments(request.arguments),
          status: "succeeded",
          resultArtifactId: "artifact_result_123",
        },
      }),
    );

    expect(decision.status).toBe("replayed");
    expect(decision.toolCallId).toBe("tool_call_existing");
    expect(decision.auditEvent.eventName).toBe("mcp.tool_call.replayed");
  });

  test("denies idempotency key reuse with different arguments", async () => {
    const decision = await enforceMcpGatewayToolCall(
      request,
      context({
        existingToolCall: {
          toolCallId: "tool_call_existing",
          idempotencyKey: request.idempotencyKey,
          argumentsHash: await hashToolArguments({ symbol: "MSFT" }),
          status: "succeeded",
          resultArtifactId: "artifact_result_123",
        },
      }),
    );

    expect(decision.status).toBe("denied");
    expect(decision.denial?.code).toBe("idempotency_conflict");
  });

  test("denies owner scope mismatches", async () => {
    const decision = await enforceMcpGatewayToolCall(
      request,
      context({
        connection: {
          ...connection,
          ownerScope: {
            ownerType: "workspace",
            ownerId: "workspace_other",
          },
        },
      }),
    );

    expect(decision.status).toBe("denied");
    expect(decision.denial?.code).toBe("owner_scope_mismatch");
  });

  test("denies arguments that do not match the current approved schema", async () => {
    const decision = await enforceMcpGatewayToolCall(
      {
        ...request,
        arguments: {
          symbol: 123,
        },
      },
      context(),
    );

    expect(decision.status).toBe("denied");
    expect(decision.denial?.code).toBe("schema_validation_failed");
  });
});

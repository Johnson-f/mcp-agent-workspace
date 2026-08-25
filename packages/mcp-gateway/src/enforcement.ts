import { fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/client";
import { hashToolArguments, redactToolArguments } from "./tool-call-policy";

export type OwnerType = "user" | "workspace";

export interface OwnerScopeRef {
  ownerType: OwnerType;
  ownerId: string;
}

export type McpGatewayDecisionStatus =
  | "allowed"
  | "denied"
  | "replayed";

export type McpGatewayDenialCode =
  | "owner_scope_mismatch"
  | "connection_unavailable"
  | "tool_unavailable"
  | "authorization_missing"
  | "authorization_not_approved"
  | "authorization_stale"
  | "authorization_target_mismatch"
  | "schema_validation_failed"
  | "idempotency_conflict"
  | "write_boundary_missing";

export type ToolAuthorizationSnapshotState =
  | "approved"
  | "rejected"
  | "revoked"
  | "stale";

export interface ToolAuthorizationSnapshot {
  id: string;
  ownerScope: OwnerScopeRef;
  state: ToolAuthorizationSnapshotState;
  mcpConnectionId: string;
  mcpToolId: string;
  serverId: string | null;
  toolName: string;
  schemaHash: string;
  annotationHash: string;
  annotations: Record<string, unknown> | null;
  required: boolean;
  approvedByUserId: string;
  approvedAt: string;
  acknowledgedWriteCapability: boolean;
  allowedOutcomeBoundary: string | null;
}

export interface CurrentMcpConnectionState {
  id: string;
  ownerScope: OwnerScopeRef;
  status: "pending" | "auth_required" | "connected" | "error" | "disabled";
}

export interface CurrentMcpToolState {
  id: string;
  connectionId: string;
  name: string;
  inputSchema: Record<string, unknown>;
  schemaHash: string;
  annotationHash: string;
  annotations: Record<string, unknown> | null;
  available: boolean;
}

export interface ExistingToolCallRecord {
  toolCallId: string;
  idempotencyKey: string;
  argumentsHash: string;
  status:
    | "pending"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "denied";
  resultArtifactId: string | null;
}

export interface McpGatewayToolCallRequest {
  schemaVersion: "mcp-gateway-tool-call-request.v1";
  runId: string;
  ownerScope: OwnerScopeRef;
  toolCallId: string;
  idempotencyKey: string;
  mcpConnectionId: string;
  mcpToolId: string;
  toolAuthorizationSnapshotId: string;
  argumentsArtifactId: string;
  arguments: Record<string, unknown>;
}

export interface McpGatewayToolCallContext {
  connection: CurrentMcpConnectionState | null;
  tool: CurrentMcpToolState | null;
  authorizationSnapshot: ToolAuthorizationSnapshot | null;
  existingToolCall: ExistingToolCallRecord | null;
}

export interface McpGatewayAuditEvent {
  eventName:
    | "mcp.tool_call.allowed"
    | "mcp.tool_call.denied"
    | "mcp.tool_call.replayed";
  ownerScope: OwnerScopeRef;
  actorType: "system";
  targetType: "mcp_tool_call";
  targetId: string;
  redactedMetadata: Record<string, unknown>;
}

export interface McpGatewayRunStep {
  type: "tool_call_started" | "tool_call_failed";
  summary: string;
  redactedMetadata: Record<string, unknown>;
}

export interface McpGatewayArtifactIntent {
  purpose: "tool_arguments" | "tool_result";
  sourceArtifactIds: string[];
  redactedSummary: Record<string, unknown>;
}

export interface McpGatewayDecisionBase {
  schemaVersion: "mcp-gateway-tool-call-decision.v1";
  status: McpGatewayDecisionStatus;
  runId: string;
  toolCallId: string;
  idempotencyKey: string;
  auditEvent: McpGatewayAuditEvent;
  runStep: McpGatewayRunStep | null;
  artifactIntent: McpGatewayArtifactIntent | null;
}

export interface McpGatewayAllowedDecision extends McpGatewayDecisionBase {
  status: "allowed";
  connectionId: string;
  toolId: string;
  toolName: string;
  argumentsHash: string;
  denial: null;
}

export interface McpGatewayDeniedDecision extends McpGatewayDecisionBase {
  status: "denied";
  connectionId: string | null;
  toolId: string | null;
  toolName: string | null;
  argumentsHash: string;
  denial: {
    code: McpGatewayDenialCode;
    message: string;
  };
}

export interface McpGatewayReplayedDecision extends McpGatewayDecisionBase {
  status: "replayed";
  connectionId: string;
  toolId: string;
  toolName: string;
  argumentsHash: string;
  resultArtifactId: string | null;
  denial: null;
}

export type McpGatewayToolCallDecision =
  | McpGatewayAllowedDecision
  | McpGatewayDeniedDecision
  | McpGatewayReplayedDecision;

const sameOwnerScope = (left: OwnerScopeRef, right: OwnerScopeRef) =>
  left.ownerType === right.ownerType && left.ownerId === right.ownerId;

const isWriteCapable = (annotations: Record<string, unknown> | null) =>
  annotations?.readOnlyHint !== true || annotations.destructiveHint === true;

const auditEvent = (
  request: McpGatewayToolCallRequest,
  eventName: McpGatewayAuditEvent["eventName"],
  metadata: Record<string, unknown>,
): McpGatewayAuditEvent => ({
  eventName,
  ownerScope: request.ownerScope,
  actorType: "system",
  targetType: "mcp_tool_call",
  targetId: request.toolCallId,
  redactedMetadata: metadata,
});

const denied = async (
  request: McpGatewayToolCallRequest,
  context: McpGatewayToolCallContext,
  code: McpGatewayDenialCode,
  message: string,
): Promise<McpGatewayDeniedDecision> => {
  const argumentsHash = await hashToolArguments(request.arguments);
  const metadata = {
    code,
    message,
    mcpConnectionId: request.mcpConnectionId,
    mcpToolId: request.mcpToolId,
    toolAuthorizationSnapshotId: request.toolAuthorizationSnapshotId,
    argumentsHash,
    argumentsRedacted: redactToolArguments(request.arguments),
  };

  return {
    schemaVersion: "mcp-gateway-tool-call-decision.v1",
    status: "denied",
    runId: request.runId,
    toolCallId: request.toolCallId,
    idempotencyKey: request.idempotencyKey,
    connectionId: context.connection?.id ?? null,
    toolId: context.tool?.id ?? null,
    toolName: context.tool?.name ?? null,
    argumentsHash,
    denial: { code, message },
    auditEvent: auditEvent(request, "mcp.tool_call.denied", metadata),
    runStep: {
      type: "tool_call_failed",
      summary: message,
      redactedMetadata: metadata,
    },
    artifactIntent: null,
  };
};

const validateToolArguments = async (
  tool: CurrentMcpToolState,
  argumentsValue: Record<string, unknown>,
) => {
  const encoded = JSON.stringify(argumentsValue);
  if (encoded.length > 65_536) {
    return "Tool arguments must be 64 KB or smaller.";
  }

  try {
    const schema = fromJsonSchema(tool.inputSchema as JsonSchemaType);
    const validation = await schema["~standard"].validate(argumentsValue);
    return validation.issues
      ? `Tool arguments do not match the approved schema: ${validation.issues[0]?.message.slice(0, 200) ?? "invalid arguments"}`
      : null;
  } catch {
    return "This server advertised an invalid input schema for the tool.";
  }
};

export const enforceMcpGatewayToolCall = async (
  request: McpGatewayToolCallRequest,
  context: McpGatewayToolCallContext,
): Promise<McpGatewayToolCallDecision> => {
  const argumentsHash = await hashToolArguments(request.arguments);
  const existing = context.existingToolCall;

  if (existing) {
    if (existing.argumentsHash !== argumentsHash) {
      return denied(
        request,
        context,
        "idempotency_conflict",
        "This tool call idempotency key was already used with different arguments.",
      );
    }

    return {
      schemaVersion: "mcp-gateway-tool-call-decision.v1",
      status: "replayed",
      runId: request.runId,
      toolCallId: existing.toolCallId,
      idempotencyKey: request.idempotencyKey,
      connectionId: request.mcpConnectionId,
      toolId: request.mcpToolId,
      toolName: context.tool?.name ?? "unknown",
      argumentsHash,
      resultArtifactId: existing.resultArtifactId,
      denial: null,
      auditEvent: auditEvent(request, "mcp.tool_call.replayed", {
        originalToolCallId: existing.toolCallId,
        status: existing.status,
        resultArtifactId: existing.resultArtifactId,
      }),
      runStep: null,
      artifactIntent: null,
    };
  }

  if (!context.connection) {
    return denied(
      request,
      context,
      "connection_unavailable",
      "The approved MCP connection is unavailable.",
    );
  }

  if (!sameOwnerScope(request.ownerScope, context.connection.ownerScope)) {
    return denied(
      request,
      context,
      "owner_scope_mismatch",
      "The MCP connection does not belong to this Owner Scope.",
    );
  }

  if (context.connection.status !== "connected") {
    return denied(
      request,
      context,
      "connection_unavailable",
      "Reconnect this MCP server before calling its tools.",
    );
  }

  if (!context.tool || context.tool.connectionId !== context.connection.id) {
    return denied(
      request,
      context,
      "tool_unavailable",
      "The approved MCP tool is unavailable.",
    );
  }

  if (!context.tool.available) {
    return denied(
      request,
      context,
      "tool_unavailable",
      "This MCP tool is no longer advertised by the server.",
    );
  }

  const snapshot = context.authorizationSnapshot;
  if (!snapshot) {
    return denied(
      request,
      context,
      "authorization_missing",
      "This MCP tool was not approved for this Run.",
    );
  }

  if (!sameOwnerScope(request.ownerScope, snapshot.ownerScope)) {
    return denied(
      request,
      context,
      "owner_scope_mismatch",
      "The Tool Authorization Snapshot does not belong to this Owner Scope.",
    );
  }

  if (snapshot.state !== "approved") {
    return denied(
      request,
      context,
      "authorization_not_approved",
      "This MCP tool authorization is not approved.",
    );
  }

  if (
    snapshot.mcpConnectionId !== request.mcpConnectionId ||
    snapshot.mcpToolId !== request.mcpToolId ||
    snapshot.mcpConnectionId !== context.connection.id ||
    snapshot.mcpToolId !== context.tool.id ||
    snapshot.toolName !== context.tool.name
  ) {
    return denied(
      request,
      context,
      "authorization_target_mismatch",
      "This MCP tool call does not match its approved Tool Authorization Snapshot.",
    );
  }

  if (
    snapshot.schemaHash !== context.tool.schemaHash ||
    snapshot.annotationHash !== context.tool.annotationHash
  ) {
    return denied(
      request,
      context,
      "authorization_stale",
      "This MCP tool changed after approval and must be reviewed again.",
    );
  }

  if (
    isWriteCapable(snapshot.annotations) &&
    (!snapshot.acknowledgedWriteCapability || !snapshot.allowedOutcomeBoundary)
  ) {
    return denied(
      request,
      context,
      "write_boundary_missing",
      "Write-capable MCP tools require explicit acknowledgement and an allowed outcome boundary.",
    );
  }

  const argumentError = await validateToolArguments(context.tool, request.arguments);
  if (argumentError) {
    return denied(
      request,
      context,
      "schema_validation_failed",
      argumentError,
    );
  }

  const metadata = {
    mcpConnectionId: request.mcpConnectionId,
    mcpToolId: request.mcpToolId,
    toolAuthorizationSnapshotId: request.toolAuthorizationSnapshotId,
    argumentsArtifactId: request.argumentsArtifactId,
    argumentsHash,
    argumentsRedacted: redactToolArguments(request.arguments),
  };

  return {
    schemaVersion: "mcp-gateway-tool-call-decision.v1",
    status: "allowed",
    runId: request.runId,
    toolCallId: request.toolCallId,
    idempotencyKey: request.idempotencyKey,
    connectionId: context.connection.id,
    toolId: context.tool.id,
    toolName: context.tool.name,
    argumentsHash,
    denial: null,
    auditEvent: auditEvent(request, "mcp.tool_call.allowed", metadata),
    runStep: {
      type: "tool_call_started",
      summary: `Calling MCP tool ${context.tool.name}.`,
      redactedMetadata: metadata,
    },
    artifactIntent: {
      purpose: "tool_arguments",
      sourceArtifactIds: [request.argumentsArtifactId],
      redactedSummary: redactToolArguments(request.arguments),
    },
  };
};

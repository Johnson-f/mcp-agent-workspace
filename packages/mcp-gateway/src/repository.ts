import type { McpConnection, McpTool } from "@agents/contracts";
import type { Tool } from "@modelcontextprotocol/client";
import { and, desc, eq, getDatabase, inArray, sql } from "@agents/db";
import {
  mcpConnections,
  mcpCredentials,
  mcpToolCalls,
  mcpTools,
} from "@agents/db/schema";
import type { EncryptedCredential } from "./credentials";

type ConnectionRow = typeof mcpConnections.$inferSelect;
type ToolRow = typeof mcpTools.$inferSelect;
type ToolCallRow = typeof mcpToolCalls.$inferSelect;

const toIso = (value: Date | null) => value?.toISOString() ?? null;

const toRemoteTransport = (
  transport: ConnectionRow["transport"],
): McpConnection["transport"] => {
  if (transport === "streamable_http" || transport === "sse") {
    return transport;
  }

  throw new Error("Local stdio MCP connections are not exposed through RPC.");
};

export const toConnectionView = (row: ConnectionRow): McpConnection => ({
  id: row.id,
  name: row.name,
  transport: toRemoteTransport(row.transport),
  endpointUrl: row.endpointUrl ?? "",
  authType: row.authType,
  status: row.status,
  serverName: row.serverName,
  serverVersion: row.serverVersion,
  protocolVersion: row.protocolVersion,
  lastErrorCode: row.lastErrorCode,
  lastErrorMessage: row.lastErrorMessage,
  lastConnectedAt: toIso(row.lastConnectedAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toToolView = (row: ToolRow): McpTool => ({
  id: row.id,
  connectionId: row.connectionId,
  name: row.name,
  title: row.title,
  description: row.description,
  inputSchema: row.inputSchema,
  outputSchema: row.outputSchema,
  annotations: row.annotations,
  enabled: row.enabled,
  available: row.available,
  approvalMode: row.approvalMode,
  discoveredAt: row.discoveredAt.toISOString(),
  lastSeenAt: row.lastSeenAt.toISOString(),
});

export const listConnections = async (userId: string) => {
  const rows = await getDatabase()
    .select()
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, userId))
    .orderBy(desc(mcpConnections.createdAt));

  return rows
    .filter((row) => row.transport !== "stdio")
    .map(toConnectionView);
};

export const findConnection = async (userId: string, connectionId: string) => {
  const [row] = await getDatabase()
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.id, connectionId),
        eq(mcpConnections.userId, userId),
      ),
    )
    .limit(1);

  return row;
};

export const createConnection = async (input: {
  userId: string;
  name: string;
  endpointUrl: string;
  transport: "streamable_http" | "sse";
  authType: "none" | "bearer" | "oauth2" | "custom_headers";
  encryptedCredential?: EncryptedCredential;
}) =>
  getDatabase().transaction(async (transaction) => {
    const [connection] = await transaction
      .insert(mcpConnections)
      .values({
        userId: input.userId,
        name: input.name,
        endpointUrl: input.endpointUrl,
        transport: input.transport,
        authType: input.authType,
      })
      .returning();

    if (!connection) {
      throw new Error("The MCP connection could not be created.");
    }

    if (input.encryptedCredential) {
      await transaction.insert(mcpCredentials).values({
        connectionId: connection.id,
        ...input.encryptedCredential,
      });
    }

    return connection;
  });

export const getEncryptedCredential = async (connectionId: string) => {
  const [credential] = await getDatabase()
    .select({
      ciphertext: mcpCredentials.ciphertext,
      nonce: mcpCredentials.nonce,
      authTag: mcpCredentials.authTag,
      keyVersion: mcpCredentials.keyVersion,
    })
    .from(mcpCredentials)
    .where(eq(mcpCredentials.connectionId, connectionId))
    .limit(1);

  return credential;
};

export const saveEncryptedCredential = async (
  connectionId: string,
  credential: EncryptedCredential,
) => {
  const now = new Date();
  await getDatabase()
    .insert(mcpCredentials)
    .values({ connectionId, ...credential })
    .onConflictDoUpdate({
      target: mcpCredentials.connectionId,
      set: {
        ...credential,
        updatedAt: now,
      },
    });
};

export const setConnectionOAuthCredential = async (
  connectionId: string,
  credential: EncryptedCredential,
) => {
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(mcpConnections)
      .set({
        authType: "oauth2",
        status: "pending",
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(mcpConnections.id, connectionId));
    await transaction
      .insert(mcpCredentials)
      .values({ connectionId, ...credential })
      .onConflictDoUpdate({
        target: mcpCredentials.connectionId,
        set: { ...credential, updatedAt: new Date() },
      });
  });
};

export const markConnectionAuthRequired = async (connectionId: string) => {
  const [row] = await getDatabase()
    .update(mcpConnections)
    .set({
      status: "auth_required",
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(mcpConnections.id, connectionId))
    .returning();

  if (!row) {
    throw new Error("The MCP connection no longer exists.");
  }
  return row;
};

export const markConnectionConnected = async (input: {
  connectionId: string;
  transport: "streamable_http" | "sse";
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  capabilities: Record<string, unknown>;
}) => {
  const now = new Date();
  const [row] = await getDatabase()
    .update(mcpConnections)
    .set({
      transport: input.transport,
      status: "connected",
      serverName: input.serverName,
      serverVersion: input.serverVersion,
      protocolVersion: input.protocolVersion,
      capabilities: input.capabilities,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastConnectedAt: now,
      updatedAt: now,
    })
    .where(eq(mcpConnections.id, input.connectionId))
    .returning();

  if (!row) {
    throw new Error("The MCP connection no longer exists.");
  }

  return row;
};

export const markConnectionFailed = async (
  connectionId: string,
  code: string,
  message: string,
) => {
  const [row] = await getDatabase()
    .update(mcpConnections)
    .set({
      status: "error",
      lastErrorCode: code,
      lastErrorMessage: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(mcpConnections.id, connectionId))
    .returning();

  return row;
};

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
};

const sha256Hex = async (value: unknown) => {
  const canonical = canonicalize(value);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Buffer.from(digest).toString("hex");
};

const hashToolSchema = async (tool: Tool) =>
  sha256Hex({
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  });

const hashToolAnnotations = async (tool: Tool) =>
  sha256Hex(tool.annotations ?? null);

export const replaceDiscoveredTools = async (
  connectionId: string,
  tools: Tool[],
) => {
  const now = new Date();
  const values = await Promise.all(
    tools.map(async (tool) => ({
      connectionId,
      name: tool.name,
      title: tool.title ?? null,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      outputSchema: (tool.outputSchema as Record<string, unknown> | undefined) ?? null,
      annotations: (tool.annotations as Record<string, unknown> | undefined) ?? null,
      schemaHash: await hashToolSchema(tool),
      annotationHash: await hashToolAnnotations(tool),
      lastSeenAt: now,
      updatedAt: now,
    })),
  );

  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(mcpTools)
      .set({ available: false, updatedAt: now })
      .where(eq(mcpTools.connectionId, connectionId));

    for (let index = 0; index < values.length; index += 100) {
      const chunk = values.slice(index, index + 100);
      if (chunk.length === 0) {
        continue;
      }

      await transaction
        .insert(mcpTools)
        .values(chunk)
        .onConflictDoUpdate({
          target: [mcpTools.connectionId, mcpTools.name],
          set: {
            title: sql.raw('excluded."title"'),
            description: sql.raw('excluded."description"'),
            inputSchema: sql.raw('excluded."input_schema"'),
            outputSchema: sql.raw('excluded."output_schema"'),
            annotations: sql.raw('excluded."annotations"'),
            schemaHash: sql.raw('excluded."schema_hash"'),
            annotationHash: sql.raw('excluded."annotation_hash"'),
            available: true,
            lastSeenAt: now,
            updatedAt: now,
          },
        });
    }
  });
};

export const listTools = async (userId: string, connectionId: string) => {
  const connection = await findConnection(userId, connectionId);
  if (!connection) {
    return null;
  }

  const rows = await getDatabase()
    .select()
    .from(mcpTools)
    .where(eq(mcpTools.connectionId, connectionId))
    .orderBy(mcpTools.name);

  return rows.map(toToolView);
};

export const updateToolPolicy = async (input: {
  userId: string;
  toolId: string;
  enabled: boolean;
  approvalMode: "always" | "risky" | "never";
}) => {
  const [row] = await getDatabase()
    .update(mcpTools)
    .set({
      enabled: input.enabled,
      approvalMode: input.approvalMode,
      updatedAt: new Date(),
    })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpTools.id, input.toolId),
        eq(mcpTools.connectionId, mcpConnections.id),
        eq(mcpConnections.userId, input.userId),
      ),
    )
    .returning();

  return row ? toToolView(row) : null;
};

export const updateToolPolicies = async (input: {
  userId: string;
  connectionId: string;
  toolIds: string[];
  enabled?: boolean;
  approvalMode?: "always" | "risky" | "never";
}) => {
  const rows = await getDatabase()
    .update(mcpTools)
    .set({
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.approvalMode === undefined
        ? {}
        : { approvalMode: input.approvalMode }),
      updatedAt: new Date(),
    })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpTools.connectionId, mcpConnections.id),
        eq(mcpConnections.id, input.connectionId),
        eq(mcpConnections.userId, input.userId),
        inArray(mcpTools.id, input.toolIds),
      ),
    )
    .returning();
  return rows.map(toToolView);
};

export const findToolForExecution = async (userId: string, toolId: string) => {
  const [row] = await getDatabase()
    .select({ tool: mcpTools, connection: mcpConnections })
    .from(mcpTools)
    .innerJoin(
      mcpConnections,
      eq(mcpTools.connectionId, mcpConnections.id),
    )
    .where(and(eq(mcpTools.id, toolId), eq(mcpConnections.userId, userId)))
    .limit(1);

  return row;
};

export const createToolCall = async (input: {
  userId: string;
  connectionId: string;
  toolId: string;
  idempotencyKey: string;
  connectionName: string;
  toolName: string;
  argumentsRedacted: Record<string, unknown>;
  argumentsHash: string;
  requiresApproval: boolean;
  conversationId?: string;
  agentTurnId?: string;
  stepNumber?: number;
  argumentsArtifactId?: string;
  agentReason?: string;
  riskClassification?: string;
}) => {
  const running = !input.requiresApproval;
  const [row] = await getDatabase()
    .insert(mcpToolCalls)
    .values({
      userId: input.userId,
      connectionId: input.connectionId,
      toolId: input.toolId,
      conversationId: input.conversationId ?? null,
      agentTurnId: input.agentTurnId ?? null,
      stepNumber: input.stepNumber ?? null,
      argumentsArtifactId: input.argumentsArtifactId ?? null,
      agentReason: input.agentReason?.slice(0, 1_000) ?? null,
      riskClassification: input.riskClassification ?? null,
      idempotencyKey: input.idempotencyKey,
      connectionName: input.connectionName,
      toolName: input.toolName,
      argumentsRedacted:
        sql`${JSON.stringify(input.argumentsRedacted)}::jsonb`,
      argumentsHash: input.argumentsHash,
      status: running ? "running" : "awaiting_approval",
      approvalStatus: running ? "not_required" : "pending",
      startedAt: running ? new Date() : null,
    })
    .onConflictDoNothing({
      target: [mcpToolCalls.userId, mcpToolCalls.idempotencyKey],
    })
    .returning();

  return row;
};

export const findToolCallByIdempotency = async (
  userId: string,
  idempotencyKey: string,
) => {
  const [row] = await getDatabase()
    .select()
    .from(mcpToolCalls)
    .where(
      and(
        eq(mcpToolCalls.userId, userId),
        eq(mcpToolCalls.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  return row;
};

export const findToolCall = async (userId: string, callId: string) => {
  const [row] = await getDatabase()
    .select()
    .from(mcpToolCalls)
    .where(
      and(eq(mcpToolCalls.id, callId), eq(mcpToolCalls.userId, userId)),
    )
    .limit(1);

  return row;
};

export const findPendingToolCallForAgentTurn = async (
  userId: string,
  agentTurnId: string,
) => {
  const [row] = await getDatabase()
    .select()
    .from(mcpToolCalls)
    .where(
      and(
        eq(mcpToolCalls.userId, userId),
        eq(mcpToolCalls.agentTurnId, agentTurnId),
        eq(mcpToolCalls.status, "awaiting_approval"),
      ),
    )
    .orderBy(desc(mcpToolCalls.createdAt))
    .limit(1);
  return row ?? null;
};

export const markToolCallApprovedAndRunning = async (
  userId: string,
  callId: string,
) => {
  const now = new Date();
  const [row] = await getDatabase()
    .update(mcpToolCalls)
    .set({
      status: "running",
      approvalStatus: "approved",
      approvedAt: now,
      startedAt: now,
    })
    .where(
      and(
        eq(mcpToolCalls.id, callId),
        eq(mcpToolCalls.userId, userId),
        eq(mcpToolCalls.status, "awaiting_approval"),
        eq(mcpToolCalls.approvalStatus, "pending"),
      ),
    )
    .returning();

  return row;
};

export const completeToolCall = async (input: {
  callId: string;
  status: "succeeded" | "failed";
  resultRedacted?: unknown;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
  resultArtifactId?: string;
}) => {
  const [row] = await getDatabase()
    .update(mcpToolCalls)
    .set({
      status: input.status,
      resultRedacted:
        input.resultRedacted === undefined
          ? null
          : sql`${JSON.stringify(input.resultRedacted)}::jsonb`,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage?.slice(0, 500) ?? null,
      completedAt: new Date(),
      durationMs: input.durationMs,
      resultArtifactId: input.resultArtifactId ?? null,
    })
    .where(eq(mcpToolCalls.id, input.callId))
    .returning();

  return row;
};

export const denyToolCall = async (userId: string, callId: string) => {
  const now = new Date();
  const [row] = await getDatabase()
    .update(mcpToolCalls)
    .set({
      status: "denied",
      approvalStatus: "rejected",
      deniedAt: now,
      completedAt: now,
    })
    .where(
      and(
        eq(mcpToolCalls.id, callId),
        eq(mcpToolCalls.userId, userId),
        eq(mcpToolCalls.status, "awaiting_approval"),
        eq(mcpToolCalls.approvalStatus, "pending"),
      ),
    )
    .returning();
  return row ?? null;
};

export type McpToolCallRow = ToolCallRow;

export const deleteConnection = async (userId: string, connectionId: string) => {
  const rows = await getDatabase()
    .delete(mcpConnections)
    .where(
      and(
        eq(mcpConnections.id, connectionId),
        eq(mcpConnections.userId, userId),
      ),
    )
    .returning({ id: mcpConnections.id });

  return rows.length > 0;
};

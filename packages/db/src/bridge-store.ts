import { and, eq } from "drizzle-orm";
import { getDatabase } from "./client";
import {
  auditLogEvents,
  mcpConnections,
  mcpToolCalls,
  mcpTools,
  runBriefs,
  runBriefVersions,
  runs,
  runSteps,
  toolAuthorizationSnapshots,
} from "./schema";

export type BridgeOwnerType = "user" | "workspace";

export interface BridgeOwnerScope {
  ownerType: BridgeOwnerType;
  ownerId: string;
}

export interface AppendBridgeRunStepInput {
  runId: string;
  ownerScope: BridgeOwnerScope;
  type: typeof runSteps.$inferInsert.type;
  summary: string;
  relatedArtifactIds?: string[];
  redactedMetadata?: Record<string, unknown>;
  visibleToUser?: boolean;
}

export interface FinishBridgeRunInput {
  runId: string;
  state: typeof runs.$inferInsert.state;
  finalRunStepId: string | null;
  finalArtifactIds: string[];
  budgetUsage: Record<string, unknown>;
  failure: Record<string, unknown> | null;
}

export const getBridgeRun = async (runId: string) => {
  const [run] = await getDatabase()
    .select()
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);

  return run ?? null;
};

export const markBridgeRunRunning = async (runId: string) => {
  const now = new Date();
  await getDatabase()
    .update(runs)
    .set({
      state: "running",
      startedAt: now,
      updatedAt: now,
    })
    .where(eq(runs.id, runId));
};

export const finishBridgeRun = async (input: FinishBridgeRunInput) => {
  const now = new Date();
  await getDatabase()
    .update(runs)
    .set({
      state: input.state,
      finalRunStepId: input.finalRunStepId,
      finalArtifactIds: input.finalArtifactIds,
      budgetUsage: input.budgetUsage,
      failure: input.failure,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(runs.id, input.runId));
};

export const appendBridgeRunStep = async (input: AppendBridgeRunStepInput) => {
  const [step] = await getDatabase()
    .insert(runSteps)
    .values({
      runId: input.runId,
      ownerType: input.ownerScope.ownerType,
      ownerId: input.ownerScope.ownerId,
      type: input.type,
      summary: input.summary,
      visibleToUser: input.visibleToUser ?? true,
      relatedArtifactIds: input.relatedArtifactIds ?? [],
      redactedMetadata: input.redactedMetadata ?? {},
      occurredAt: new Date(),
      createdAt: new Date(),
    })
    .returning();

  if (!step) {
    throw new Error("Run Step could not be stored.");
  }

  return step;
};

export const getBridgeRunBriefVersion = async (
  runBriefVersionId: string,
) => {
  const [row] = await getDatabase()
    .select({ version: runBriefVersions, brief: runBriefs })
    .from(runBriefVersions)
    .innerJoin(runBriefs, eq(runBriefVersions.runBriefId, runBriefs.id))
    .where(eq(runBriefVersions.id, runBriefVersionId))
    .limit(1);

  return row ?? null;
};

export const listApprovedBridgeToolAuthorizations = async (
  runBriefVersionId: string,
) =>
  getDatabase()
    .select()
    .from(toolAuthorizationSnapshots)
    .where(
      and(
        eq(toolAuthorizationSnapshots.runBriefVersionId, runBriefVersionId),
        eq(toolAuthorizationSnapshots.state, "approved"),
      ),
    );

export const listApprovedBridgeToolAuthorizationDetails = async (
  runBriefVersionId: string,
) =>
  getDatabase()
    .select({ authorization: toolAuthorizationSnapshots, tool: mcpTools })
    .from(toolAuthorizationSnapshots)
    .leftJoin(mcpTools, eq(toolAuthorizationSnapshots.mcpToolId, mcpTools.id))
    .where(
      and(
        eq(toolAuthorizationSnapshots.runBriefVersionId, runBriefVersionId),
        eq(toolAuthorizationSnapshots.state, "approved"),
      ),
    );

export const getMcpGatewayToolCallContextForBridge = async (input: {
  ownerScope: BridgeOwnerScope;
  mcpConnectionId: string;
  mcpToolId: string;
  toolAuthorizationSnapshotId: string;
  idempotencyKey: string;
}) => {
  const database = getDatabase();
  const [connection] = await database
    .select()
    .from(mcpConnections)
    .where(eq(mcpConnections.id, input.mcpConnectionId))
    .limit(1);
  const [tool] = await database
    .select()
    .from(mcpTools)
    .where(eq(mcpTools.id, input.mcpToolId))
    .limit(1);
  const [authorizationSnapshot] = await database
    .select()
    .from(toolAuthorizationSnapshots)
    .where(eq(toolAuthorizationSnapshots.id, input.toolAuthorizationSnapshotId))
    .limit(1);
  const [existingToolCall] = connection
    ? await database
        .select()
        .from(mcpToolCalls)
        .where(
          and(
            eq(mcpToolCalls.userId, connection.userId),
            eq(mcpToolCalls.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1)
    : [];

  return {
    connection: connection
      ? {
          id: connection.id,
          ownerScope: input.ownerScope,
          status: connection.status,
        }
      : null,
    tool: tool
      ? {
          id: tool.id,
          connectionId: tool.connectionId,
          name: tool.name,
          inputSchema: tool.inputSchema,
          schemaHash: tool.schemaHash,
          annotationHash: tool.annotationHash,
          annotations: tool.annotations,
          available: tool.available && tool.enabled,
        }
      : null,
    authorizationSnapshot: authorizationSnapshot
      ? {
          id: authorizationSnapshot.id,
          ownerScope: {
            ownerType: authorizationSnapshot.ownerType,
            ownerId: authorizationSnapshot.ownerId,
          },
          state:
            authorizationSnapshot.state === "proposed"
              ? "rejected"
              : authorizationSnapshot.state,
          mcpConnectionId: authorizationSnapshot.mcpConnectionId ?? "",
          mcpToolId: authorizationSnapshot.mcpToolId ?? "",
          serverId: authorizationSnapshot.serverId,
          toolName: authorizationSnapshot.toolName,
          schemaHash: authorizationSnapshot.schemaHash,
          annotationHash: authorizationSnapshot.annotationHash,
          annotations: authorizationSnapshot.annotations,
          required: authorizationSnapshot.required,
          approvedByUserId: authorizationSnapshot.approvedByUserId ?? "",
          approvedAt:
            authorizationSnapshot.approvedAt?.toISOString() ??
            authorizationSnapshot.createdAt.toISOString(),
          acknowledgedWriteCapability:
            authorizationSnapshot.acknowledgedWriteCapability,
          allowedOutcomeBoundary:
            authorizationSnapshot.allowedOutcomeBoundary,
        }
      : null,
    existingToolCall: existingToolCall
      ? {
          toolCallId: existingToolCall.id,
          idempotencyKey: existingToolCall.idempotencyKey,
          argumentsHash: existingToolCall.argumentsHash,
          status:
            existingToolCall.status === "awaiting_approval"
              ? "pending"
              : existingToolCall.status,
          resultArtifactId: null,
        }
      : null,
  };
};

export const appendBridgeAuditEvent = async (input: {
  ownerScope: BridgeOwnerScope;
  actorType: "system" | "worker";
  actorUserId?: string | null;
  eventName: string;
  targetType: string;
  targetId: string;
  runId?: string | null;
  redactedMetadata?: Record<string, unknown>;
}) => {
  await getDatabase().insert(auditLogEvents).values({
    ownerType: input.ownerScope.ownerType,
    ownerId: input.ownerScope.ownerId,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    eventName: input.eventName,
    targetType: input.targetType,
    targetId: input.targetId,
    runId: input.runId ?? null,
    redactedMetadata: input.redactedMetadata ?? {},
    createdAt: new Date(),
  });
};

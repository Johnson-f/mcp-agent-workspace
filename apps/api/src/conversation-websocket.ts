import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import {
  parseConversationClientMessage,
  resolveConversationModeForMessage,
  serializeConversationServerMessage,
  type AgentToolApproval,
  type ConversationClientMessage,
  type ConversationMode,
  type ConversationServerMessage,
  type ConversationUserMessage,
} from "@agents/contracts";
import {
  generateConversationTitle,
  interactiveAgentToolResultDisposition,
  normalizeAutomationProposal,
  runInteractiveAgentStep,
  streamConversationModel,
  type AutomationProposal,
  type InteractiveAgentToolResult,
} from "@agents/agent-runtime";
import {
  appendStreamingAssistantMessage,
  appendStreamingUserMessage,
  createConversationAgentTurn,
  getActiveConversationAgentTurn,
  getConversationForUser,
  updateConversationGeneratedTitle,
  updateConversationAgentTurn,
  upsertAuthenticatedUser,
  listTurnActivities,
} from "@agents/db";
import { mcpService } from "@agents/mcp-gateway";
import { authenticateRequest } from "./auth/stytch";
import { ConversationActivityWriter } from "./conversation-activity-writer";

const MAX_ASSISTANT_BYTES = 65_536;

interface ConnectionContext {
  userId: string;
  conversationId: string;
}

interface ActiveTurn {
  abortController: AbortController;
  socket: WebSocket;
  turnId: string;
  mode: ConversationMode;
  pendingApproval: (AgentToolApproval & {
    resolve: (approved: boolean) => void;
    decided: boolean;
  }) | null;
}

const connectionContexts = new WeakMap<FastifyRequest, ConnectionContext>();
const activeTurns = new Map<string, ActiveTurn>();

const send = (socket: WebSocket, message: ConversationServerMessage) => {
  if (socket.readyState === 1) {
    socket.send(serializeConversationServerMessage(message));
  }
};

const sendToActiveTurn = (
  conversationId: string,
  message: ConversationServerMessage,
) => {
  const active = activeTurns.get(conversationId);
  if (active) send(active.socket, message);
};

const requestForAuthentication = (request: FastifyRequest) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }
  const url = new URL(request.url, "http://api.internal");
  const devUserId = url.searchParams.get("devUserId")?.trim();
  if (devUserId) headers.set("x-agents-dev-user-id", devUserId);
  return new Request(url, { headers });
};

const allowedOrigin = () =>
  new URL(process.env.APP_URL ?? "http://localhost:3040").origin;

const loadAvailableToolNames = async (userId: string) => {
  const connections = await mcpService.listConnections(userId);
  const groups = await Promise.all(
    connections
      .filter((connection) => connection.status === "connected")
      .map(async (connection) =>
        (await mcpService.listTools(userId, connection.id)) ?? [],
      ),
  );
  return groups
    .flat()
    .filter((tool) => tool.enabled && tool.available)
    .map((tool) => tool.name);
};

const toConversationModelMessage = (message: {
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown>;
}) => {
  const rawProposal = message.metadata.automationProposal;
  const proposal =
    rawProposal && typeof rawProposal === "object" && !Array.isArray(rawProposal)
      ? normalizeAutomationProposal(rawProposal as Record<string, unknown>)
      : null;
  return {
    role: message.role,
    content: message.content,
    ...(proposal ? { automationProposal: proposal } : {}),
  };
};

const failure = (
  socket: WebSocket,
  input: {
    turnId: string | null;
    code: string;
    message: string;
    retryable: boolean;
  },
) => send(socket, { type: "turn_failed", ...input });

const isServiceError = (value: unknown): value is { _tag: string; message: string } =>
  Boolean(value && typeof value === "object" && "_tag" in value);

const runInteractiveAgentTurn = async (input: {
  context: ConnectionContext;
  active: ActiveTurn;
  userMessageId: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  initialToolResults?: InteractiveAgentToolResult[];
  initialToolCalls?: Array<Record<string, unknown>>;
  initialToolCallCount?: number;
  startStep?: number;
  activityWriter: ConversationActivityWriter;
}) => {
  const { active, context } = input;
  await createConversationAgentTurn({
    id: active.turnId,
    conversationId: context.conversationId,
    userMessageId: input.userMessageId,
  });
  const availableTools = await mcpService.listInteractiveAgentTools(
    context.userId,
  );
  const tools = availableTools.flatMap((tool) =>
    tool.inputSchema && typeof tool.inputSchema === "object"
      ? [
          {
            ...tool,
            inputSchema: tool.inputSchema as Record<string, unknown>,
            annotations:
              tool.annotations && typeof tool.annotations === "object"
                ? (tool.annotations as Record<string, unknown>)
                : null,
          },
        ]
      : [],
  );
  const completedToolResults: InteractiveAgentToolResult[] = [
    ...(input.initialToolResults ?? []),
  ];
  const agentToolCalls: Array<Record<string, unknown>> = [
    ...(input.initialToolCalls ?? []),
  ];
  let assistantText = "";
  let toolCallCount = input.initialToolCallCount ?? 0;
  const toolActivityIds = new Map<string, string>();

  for (let step = input.startStep ?? 1; step <= 8; step += 1) {
    await updateConversationAgentTurn({
      turnId: active.turnId,
      state: "running",
      stepCount: step,
      toolCallCount,
    });
    sendToActiveTurn(context.conversationId, {
      type: "agent_step_started",
      turnId: active.turnId,
      step,
    });
    let firstDelta = true;
    const model = await runInteractiveAgentStep({
      messages: input.messages,
      tools,
      completedToolResults,
      signal: active.abortController.signal,
      onTextDelta: (delta) => {
        const separator = firstDelta && assistantText.trim() ? "\n\n" : "";
        firstDelta = false;
        assistantText += separator + delta;
        if (
          new TextEncoder().encode(assistantText).byteLength >
          MAX_ASSISTANT_BYTES
        ) {
          active.abortController.abort("assistant_output_too_large");
          throw new Error("Assistant response exceeded 64 KB.");
        }
        if (separator) {
          sendToActiveTurn(context.conversationId, {
            type: "assistant_delta",
            turnId: active.turnId,
            delta: separator,
          });
        }
        sendToActiveTurn(context.conversationId, {
          type: "assistant_delta",
          turnId: active.turnId,
          delta,
        });
      },
      onReasoningSummaryEvent: (event) => input.activityWriter.reasoning(event),
    });

    if (!model.toolRequest) {
      const content = assistantText.trim() || model.assistantText;
      const persisted = await appendStreamingAssistantMessage({
        userId: context.userId,
        conversationId: context.conversationId,
        turnId: active.turnId,
        content,
        agentToolCalls,
      });
      if ("_tag" in persisted) throw new Error(persisted.message);
      await input.activityWriter.linkAssistantMessage(persisted.id);
      await updateConversationAgentTurn({
        turnId: active.turnId,
        state: "completed",
        stepCount: step,
        toolCallCount,
        assistantMessageId: persisted.id,
      });
      sendToActiveTurn(context.conversationId, {
        type: "turn_completed",
        turnId: active.turnId,
        messageId: persisted.id,
      });
      return;
    }

    toolCallCount += 1;
    if (toolCallCount > 5) {
      throw new Error("Agent tool-call limit reached.");
    }
    const prepared = await mcpService.prepareInteractiveAgentToolCall(
      context.userId,
      {
        toolId: model.toolRequest.tool.id,
        arguments: model.toolRequest.arguments,
        idempotencyKey: `agent_${active.turnId.replaceAll("-", "")}_${step}`,
        conversationId: context.conversationId,
        agentTurnId: active.turnId,
        stepNumber: step,
        reason: `Use ${model.toolRequest.tool.title ?? model.toolRequest.tool.name} to continue the request.`,
      },
    );
    if (isServiceError(prepared)) {
      const failedActivity = await input.activityWriter.start({
        kind: "tool",
        title: model.toolRequest.tool.title ?? model.toolRequest.tool.name,
      });
      await input.activityWriter.fail(failedActivity.id, "Tool request failed.");
      sendToActiveTurn(context.conversationId, {
        type: "tool_call_completed",
        turnId: active.turnId,
        callId: model.toolRequest.providerCallId,
        toolName: model.toolRequest.tool.name,
        resultPreview: { error: prepared.message },
        isError: true,
      });
      completedToolResults.push({
        toolName: model.toolRequest.tool.name,
        result: { error: prepared.message },
        isError: true,
      });
      agentToolCalls.push({
        callId: model.toolRequest.providerCallId,
        toolName: model.toolRequest.tool.name,
        status: "failed",
        isError: true,
      });
      continue;
    }

    let callResult = prepared.call;
    const toolActivity = await input.activityWriter.start({
      kind: "tool",
      title: `${prepared.tool.connectionName} · ${model.toolRequest.tool.title ?? prepared.tool.name.replaceAll("_", " ")}`,
      status:
        callResult.status === "awaiting_approval" ? "waiting" : "running",
      toolCallId: callResult.callId,
    });
    toolActivityIds.set(callResult.callId, toolActivity.id);
    if (callResult.status === "awaiting_approval") {
      const approval: AgentToolApproval = {
        turnId: active.turnId,
        callId: callResult.callId,
        toolId: prepared.tool.id,
        toolName: prepared.tool.name,
        connectionName: prepared.tool.connectionName,
        reason: prepared.reason,
        argumentsPreview: prepared.argumentsPreview,
        risk: prepared.risk,
      };
      await updateConversationAgentTurn({
        turnId: active.turnId,
        state: "awaiting_approval",
        stepCount: step,
        toolCallCount,
      });
      const approved = await new Promise<boolean>((resolve) => {
        active.pendingApproval = { ...approval, resolve, decided: false };
        sendToActiveTurn(context.conversationId, {
          type: "tool_approval_required",
          ...approval,
        });
      });
      active.pendingApproval = null;
      if (!approved) {
        const denied = await mcpService.denyInteractiveAgentToolCall(
          context.userId,
          { callId: approval.callId, agentTurnId: active.turnId },
        );
        const toolName = isServiceError(denied)
          ? approval.toolName
          : denied.toolName;
        sendToActiveTurn(context.conversationId, {
          type: "tool_call_denied",
          turnId: active.turnId,
          callId: approval.callId,
          toolName,
        });
        completedToolResults.push({
          toolName,
          result: { denied: true },
          isError: true,
        });
        agentToolCalls.push({
          callId: approval.callId,
          toolName,
          status: "denied",
          isError: true,
        });
        await input.activityWriter.fail(toolActivity.id, "Tool call denied.");
        continue;
      }
      await input.activityWriter.setStatus(toolActivity.id, "running");
      sendToActiveTurn(context.conversationId, {
        type: "tool_call_started",
        turnId: active.turnId,
        callId: approval.callId,
        toolName: approval.toolName,
      });
      const approvedResult = await mcpService.approveInteractiveAgentToolCall(
        context.userId,
        { callId: approval.callId, agentTurnId: active.turnId },
      );
      if (isServiceError(approvedResult)) {
        callResult = {
          callId: approval.callId,
          status: "failed",
          approvalRequired: true,
          isError: true,
          result: null,
          errorMessage: approvedResult.message,
          durationMs: null,
        };
      } else {
        callResult = approvedResult;
      }
    } else {
      sendToActiveTurn(context.conversationId, {
        type: "tool_call_started",
        turnId: active.turnId,
        callId: callResult.callId,
        toolName: prepared.tool.name,
      });
    }

    sendToActiveTurn(context.conversationId, {
      type: "tool_call_completed",
      turnId: active.turnId,
      callId: callResult.callId,
      toolName: prepared.tool.name,
      resultPreview: callResult.isError
        ? { error: callResult.errorMessage }
        : { status: "Completed" },
      isError: callResult.isError,
    });
    const currentToolActivityId =
      toolActivityIds.get(callResult.callId) ?? toolActivity.id;
    if (callResult.isError) {
      await input.activityWriter.fail(
        currentToolActivityId,
        "Tool execution failed.",
      );
    } else {
      await input.activityWriter.complete(currentToolActivityId);
    }
    completedToolResults.push({
      toolName: prepared.tool.name,
      result: callResult.result,
      isError: callResult.isError,
    });
    agentToolCalls.push({
      callId: callResult.callId,
      toolName: prepared.tool.name,
      status: callResult.isError ? "failed" : "completed",
      isError: callResult.isError,
    });
    if (
      interactiveAgentToolResultDisposition({ isError: callResult.isError }) ===
      "finish_with_error"
    ) {
      const explanation = `I couldn't complete that request because **${prepared.tool.name}** failed. ${callResult.errorMessage ?? "Check the MCP connection and try again."}`;
      const separator = assistantText.trim() ? "\n\n" : "";
      assistantText += separator + explanation;
      sendToActiveTurn(context.conversationId, {
        type: "assistant_delta",
        turnId: active.turnId,
        delta: separator + explanation,
      });
      const persisted = await appendStreamingAssistantMessage({
        userId: context.userId,
        conversationId: context.conversationId,
        turnId: active.turnId,
        content: assistantText,
        agentToolCalls,
      });
      if ("_tag" in persisted) throw new Error(persisted.message);
      await input.activityWriter.linkAssistantMessage(persisted.id);
      await updateConversationAgentTurn({
        turnId: active.turnId,
        state: "failed",
        stepCount: step,
        toolCallCount,
        assistantMessageId: persisted.id,
        failureCode: "tool_execution_failed",
        failureMessage: callResult.errorMessage,
      });
      sendToActiveTurn(context.conversationId, {
        type: "turn_completed",
        turnId: active.turnId,
        messageId: persisted.id,
      });
      return;
    }
  }

  throw new Error("Agent step limit reached.");
};

const handleUserMessage = async (
  socket: WebSocket,
  context: ConnectionContext,
  input: ConversationUserMessage,
) => {
  if (activeTurns.has(context.conversationId)) {
    failure(socket, {
      turnId: null,
      code: "turn_in_progress",
      message: "Wait for the current response to finish.",
      retryable: true,
    });
    return;
  }

  const effectiveMode = resolveConversationModeForMessage(
    input.mode,
    input.content,
  );
  const turnId = randomUUID();
  const abortController = new AbortController();
  const active: ActiveTurn = {
    abortController,
    socket,
    turnId,
    mode: effectiveMode,
    pendingApproval: null,
  };
  activeTurns.set(context.conversationId, active);
  let assistantText = "";
  let automationProposal: AutomationProposal | null = null;
  let activityWriter: ConversationActivityWriter | null = null;

  try {
    const detail = await getConversationForUser(
      context.userId,
      context.conversationId,
    );
    if ("_tag" in detail) throw new Error(detail.message);
    if (detail.conversation.archivedAt) {
      failure(socket, {
        turnId: null,
        code: "conversation_archived",
        message: "Restore this conversation before sending a new message.",
        retryable: false,
      });
      return;
    }
    const persistedUser = await appendStreamingUserMessage({
      userId: context.userId,
      conversationId: context.conversationId,
      clientMessageId: input.clientMessageId,
      content: input.content,
    });
    if ("_tag" in persistedUser) throw new Error(persistedUser.message);
    sendToActiveTurn(context.conversationId, {
      type: "user_message_accepted",
      clientMessageId: input.clientMessageId,
      messageId: persistedUser.message.id,
      duplicate: persistedUser.duplicate,
    });
    if (persistedUser.duplicate) return;

    sendToActiveTurn(context.conversationId, {
      type: "turn_started",
      clientMessageId: input.clientMessageId,
      turnId,
    });
    activityWriter = await ConversationActivityWriter.create({
      conversationId: context.conversationId,
      turnId,
      broadcast: (message) => sendToActiveTurn(context.conversationId, message),
    });

    const titlePromise =
      detail.conversation.title === "New automation"
        ? generateConversationTitle(input.content)
            .then(async (title) => {
              const updated = await updateConversationGeneratedTitle({
                userId: context.userId,
                conversationId: context.conversationId,
                title,
              });
              if (!("_tag" in updated)) {
                sendToActiveTurn(context.conversationId, {
                  type: "conversation_title",
                  title: updated.title,
                });
              }
            })
            .catch(() => undefined)
        : Promise.resolve();

    if (effectiveMode === "agent") {
      await runInteractiveAgentTurn({
        context,
        active,
        userMessageId: persistedUser.message.id,
        messages: [
          ...detail.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          { role: "user", content: input.content },
        ],
        activityWriter,
      });
      await titlePromise;
      return;
    }

    const model = await streamConversationModel({
      mode: effectiveMode,
      messages: [
        ...detail.messages.map(toConversationModelMessage),
        { role: "user", content: input.content },
      ],
      availableToolNames: await loadAvailableToolNames(context.userId),
      signal: abortController.signal,
      onEvent: async (event) => {
        if (event.type === "reasoning_summary") {
          await activityWriter?.reasoning(event.event);
          return;
        }
        if (event.type === "automation_proposal") {
          automationProposal = event.proposal;
          const proposalActivity = await activityWriter?.start({
            kind: "automation",
            title: "Prepared automation proposal",
          });
          if (proposalActivity) {
            await activityWriter?.complete(proposalActivity.id);
          }
          sendToActiveTurn(context.conversationId, {
            type: "automation_proposal",
            turnId,
            proposal: event.proposal,
          });
          return;
        }
        assistantText += event.delta;
        if (new TextEncoder().encode(assistantText).byteLength > MAX_ASSISTANT_BYTES) {
          abortController.abort("assistant_output_too_large");
          throw new Error("Assistant response exceeded 64 KB.");
        }
        sendToActiveTurn(context.conversationId, {
          type: "assistant_delta",
          turnId,
          delta: event.delta,
        });
      },
    });
    assistantText = model.assistantMessage;
    const persistedAssistant = await appendStreamingAssistantMessage({
      userId: context.userId,
      conversationId: context.conversationId,
      turnId,
      content: assistantText,
      automationProposal,
    });
    if ("_tag" in persistedAssistant) throw new Error(persistedAssistant.message);
    await activityWriter.linkAssistantMessage(persistedAssistant.id);
    await titlePromise;
    sendToActiveTurn(context.conversationId, {
      type: "turn_completed",
      turnId,
      messageId: persistedAssistant.id,
    });
  } catch (error) {
    const aborted = abortController.signal.aborted;
    if (assistantText.trim()) {
      const partial = await appendStreamingAssistantMessage({
        userId: context.userId,
        conversationId: context.conversationId,
        turnId,
        content: assistantText,
        automationProposal,
        incomplete: true,
      }).catch(() => undefined);
      if (partial && !("_tag" in partial)) {
        await activityWriter?.linkAssistantMessage(partial.id).catch(() => undefined);
      }
    }
    await activityWriter?.markIncomplete().catch(() => undefined);
    if (effectiveMode === "agent") {
      await updateConversationAgentTurn({
        turnId,
        state: aborted ? "cancelled" : "failed",
        failureCode: aborted ? "agent_cancelled" : "agent_failed",
        failureMessage:
          error instanceof Error ? error.message : "Interactive Agent failed.",
      }).catch(() => undefined);
    }
    if (!aborted || socket.readyState === 1) {
      failure(socket, {
        turnId,
        code: aborted ? "turn_cancelled" : "model_failed",
        message: aborted
          ? "Response generation was cancelled."
          : "The AI response could not be completed.",
        retryable: !aborted,
      });
    }
  } finally {
    const current = activeTurns.get(context.conversationId);
    if (current?.turnId === turnId) activeTurns.delete(context.conversationId);
  }
};

const handleClientMessage = async (
  socket: WebSocket,
  context: ConnectionContext,
  frame: string,
) => {
  let input: ConversationClientMessage;
  try {
    input = parseConversationClientMessage(frame);
  } catch (error) {
    failure(socket, {
      turnId: null,
      code: "invalid_frame",
      message: error instanceof Error ? error.message : "Invalid message.",
      retryable: false,
    });
    return;
  }
  if (input.type === "user_message") {
    await handleUserMessage(socket, context, input);
    return;
  }
  const active = activeTurns.get(context.conversationId);
  const pending = active?.pendingApproval;
  if (
    !active ||
    !pending ||
    pending.decided ||
    active.turnId !== input.turnId ||
    pending.callId !== input.callId
  ) {
    failure(socket, {
      turnId: input.turnId,
      code: "approval_conflict",
      message: "This tool call is no longer awaiting your decision.",
      retryable: false,
    });
    return;
  }
  pending.decided = true;
  pending.resolve(input.type === "tool_call_approve");
};

const recoverPendingAgentTurn = async (
  socket: WebSocket,
  context: ConnectionContext,
) => {
  if (activeTurns.has(context.conversationId)) return;
  const row = await getActiveConversationAgentTurn(context.conversationId);
  if (!row) return;
  if (row.state === "running") {
    await updateConversationAgentTurn({
      turnId: row.id,
      state: "interrupted",
      failureCode: "agent_interrupted",
      failureMessage: "The Agent process restarted during model execution.",
    });
    return;
  }
  const pending = await mcpService.getPendingInteractiveAgentToolCall(
    context.userId,
    row.id,
  );
  if (!pending?.toolId) return;
  const active: ActiveTurn = {
    abortController: new AbortController(),
    socket,
    turnId: row.id,
    mode: "agent",
    pendingApproval: null,
  };
  activeTurns.set(context.conversationId, active);
  try {
    const approval: AgentToolApproval = {
      turnId: row.id,
      callId: pending.callId,
      toolId: pending.toolId,
      toolName: pending.toolName,
      connectionName: pending.connectionName,
      reason: pending.reason,
      argumentsPreview: pending.argumentsPreview,
      risk: pending.risk,
    };
    const approved = await new Promise<boolean>((resolve) => {
      active.pendingApproval = { ...approval, resolve, decided: false };
      send(socket, {
        type: "agent_turn_snapshot",
        turnId: row.id,
        status: "awaiting_approval",
        pendingApproval: approval,
      });
    });
    active.pendingApproval = null;
    let result: InteractiveAgentToolResult;
    let historyCall: Record<string, unknown>;
    if (approved) {
      sendToActiveTurn(context.conversationId, {
        type: "tool_call_started",
        turnId: row.id,
        callId: pending.callId,
        toolName: pending.toolName,
      });
      const executed = await mcpService.approveInteractiveAgentToolCall(
        context.userId,
        { callId: pending.callId, agentTurnId: row.id },
      );
      const failed = isServiceError(executed) || executed.isError;
      result = {
        toolName: pending.toolName,
        result: isServiceError(executed)
          ? { error: executed.message }
          : executed.result,
        isError: failed,
      };
      historyCall = {
        callId: pending.callId,
        toolName: pending.toolName,
        status: failed ? "failed" : "completed",
        isError: failed,
      };
      sendToActiveTurn(context.conversationId, {
        type: "tool_call_completed",
        turnId: row.id,
        callId: pending.callId,
        toolName: pending.toolName,
        resultPreview: failed ? { error: "Tool execution failed" } : { status: "Completed" },
        isError: failed,
      });
    } else {
      await mcpService.denyInteractiveAgentToolCall(context.userId, {
        callId: pending.callId,
        agentTurnId: row.id,
      });
      result = {
        toolName: pending.toolName,
        result: { denied: true },
        isError: true,
      };
      historyCall = {
        callId: pending.callId,
        toolName: pending.toolName,
        status: "denied",
        isError: true,
      };
      sendToActiveTurn(context.conversationId, {
        type: "tool_call_denied",
        turnId: row.id,
        callId: pending.callId,
        toolName: pending.toolName,
      });
    }
    const detail = await getConversationForUser(
      context.userId,
      context.conversationId,
    );
    if ("_tag" in detail) throw new Error(detail.message);
    await runInteractiveAgentTurn({
      context,
      active,
      userMessageId: row.userMessageId,
      messages: detail.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      initialToolResults: [result],
      initialToolCalls: [historyCall],
      initialToolCallCount: row.toolCallCount,
      startStep: row.stepCount + 1,
      activityWriter: await ConversationActivityWriter.create({
        conversationId: context.conversationId,
        turnId: row.id,
        broadcast: (message) => sendToActiveTurn(context.conversationId, message),
      }),
    });
  } catch (error) {
    await updateConversationAgentTurn({
      turnId: row.id,
      state: "failed",
      failureCode: "agent_recovery_failed",
      failureMessage:
        error instanceof Error ? error.message : "Agent recovery failed.",
    });
    failure(active.socket, {
      turnId: row.id,
      code: "agent_recovery_failed",
      message: "The Agent could not resume this tool call.",
      retryable: true,
    });
  } finally {
    const current = activeTurns.get(context.conversationId);
    if (current?.turnId === row.id) activeTurns.delete(context.conversationId);
  }
};

export const registerConversationWebSocket = async (app: FastifyInstance) => {
  app.get<{ Params: { conversationId: string } }>(
    "/ws/conversations/:conversationId",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        if (request.headers.origin !== allowedOrigin()) {
          return reply.status(403).send({ error: "origin_not_allowed" });
        }
        const identity = await authenticateRequest(requestForAuthentication(request));
        if (!identity) {
          return reply.status(401).send({ error: "unauthenticated" });
        }
        const user = await upsertAuthenticatedUser(identity);
        const conversation = await getConversationForUser(
          user.id,
          request.params.conversationId,
        );
        if ("_tag" in conversation) {
          return reply.status(404).send({ error: "not_found" });
        }
        connectionContexts.set(request, {
          userId: user.id,
          conversationId: request.params.conversationId,
        });
      },
    },
    (socket, request) => {
      const context = connectionContexts.get(request);
      if (!context) return socket.close(1008, "Unauthorized");
      send(socket, { type: "connection_ready", conversationId: context.conversationId });
      const active = activeTurns.get(context.conversationId);
      if (active) {
        active.socket = socket;
        void listTurnActivities(active.turnId).then((activities) => {
          if (activities.length > 0) {
            send(socket, {
              type: "activity_snapshot",
              turnId: active.turnId,
              activities,
            });
          }
        });
        if (active.mode === "agent") {
          send(socket, {
            type: "agent_turn_snapshot",
            turnId: active.turnId,
            status: active.pendingApproval ? "awaiting_approval" : "running",
            pendingApproval: active.pendingApproval
              ? {
                  turnId: active.pendingApproval.turnId,
                  callId: active.pendingApproval.callId,
                  toolId: active.pendingApproval.toolId,
                  toolName: active.pendingApproval.toolName,
                  connectionName: active.pendingApproval.connectionName,
                  reason: active.pendingApproval.reason,
                  argumentsPreview: active.pendingApproval.argumentsPreview,
                  risk: active.pendingApproval.risk,
                }
              : null,
          });
        }
      } else {
        void recoverPendingAgentTurn(socket, context);
      }
      socket.on("message", (data: { toString(): string }) => {
        void handleClientMessage(socket, context, data.toString());
      });
      socket.on("close", () => {
        const active = activeTurns.get(context.conversationId);
        if (
          active &&
          active.socket === socket &&
          !active.pendingApproval
        ) {
          active.abortController.abort("socket_closed");
        }
      });
    },
  );
};

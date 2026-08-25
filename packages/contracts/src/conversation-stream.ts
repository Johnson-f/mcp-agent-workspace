import type { ConversationActivity } from "./unified-automation";

export const MAX_CONVERSATION_MESSAGE_BYTES = 32_768;

export type ConversationMode = "chat" | "agent" | "automation";

const explicitAutomationRequestPatterns = [
  /^(?:please\s+)?(?:create|make|build|set\s*up|configure)\s+(?:me\s+)?(?:an?\s+)?automation\b/i,
  /\b(?:i\s+(?:(?:want|would\s+like|need)\s+(?:you\s+)?to|wanna(?:\s+you\s+to)?)|can\s+you|could\s+you|would\s+you|please|let['’]?s)\s+(?:help\s+me\s+)?(?:create|make|build|set\s*up|configure)\s+(?:an?\s+)?automation\b/i,
  /^(?:please\s+)?automate\b/i,
];

export const resolveConversationModeForMessage = (
  requestedMode: ConversationMode,
  content: string,
): ConversationMode =>
  requestedMode === "agent" &&
  explicitAutomationRequestPatterns.some((pattern) => pattern.test(content.trim()))
    ? "automation"
    : requestedMode;

export type AgentToolRisk = "read" | "write" | "destructive" | "unknown";

export interface AgentToolApproval {
  turnId: string;
  callId: string;
  toolId: string;
  toolName: string;
  connectionName: string;
  reason: string;
  argumentsPreview: Record<string, unknown>;
  risk: AgentToolRisk;
}

export interface ConversationUserMessage {
  type: "user_message";
  clientMessageId: string;
  content: string;
  mode: ConversationMode;
}

export type ConversationClientMessage =
  | ConversationUserMessage
  | { type: "tool_call_approve"; turnId: string; callId: string }
  | { type: "tool_call_deny"; turnId: string; callId: string };

export type ConversationServerMessage =
  | { type: "connection_ready"; conversationId: string }
  | {
      type: "turn_started";
      clientMessageId: string;
      turnId: string;
    }
  | {
      type: "user_message_accepted";
      clientMessageId: string;
      messageId: string;
      duplicate?: boolean;
    }
  | { type: "conversation_title"; title: string }
  | { type: "assistant_delta"; turnId: string; delta: string }
  | {
      type: "activity_started";
      turnId: string;
      activity: ConversationActivity;
    }
  | {
      type: "activity_delta";
      turnId: string;
      activityId: string;
      delta: string;
    }
  | {
      type: "activity_completed";
      turnId: string;
      activity: ConversationActivity;
    }
  | {
      type: "activity_failed";
      turnId: string;
      activity: ConversationActivity;
    }
  | {
      type: "activity_snapshot";
      turnId: string;
      activities: readonly ConversationActivity[];
    }
  | { type: "automation_proposal"; turnId: string; proposal: unknown }
  | { type: "agent_step_started"; turnId: string; step: number }
  | ({ type: "tool_approval_required" } & AgentToolApproval)
  | {
      type: "tool_call_started";
      turnId: string;
      callId: string;
      toolName: string;
    }
  | {
      type: "tool_call_completed";
      turnId: string;
      callId: string;
      toolName: string;
      resultPreview: unknown;
      isError: boolean;
    }
  | {
      type: "tool_call_denied";
      turnId: string;
      callId: string;
      toolName: string;
    }
  | {
      type: "agent_turn_snapshot";
      turnId: string;
      status: "running" | "awaiting_approval";
      pendingApproval: AgentToolApproval | null;
    }
  | { type: "turn_completed"; turnId: string; messageId: string }
  | {
      type: "turn_failed";
      turnId: string | null;
      code: string;
      message: string;
      retryable: boolean;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedId = (value: unknown) =>
  typeof value === "string" && value.trim() && value.length <= 200
    ? value.trim()
    : null;

export const parseConversationClientMessage = (
  frame: string,
): ConversationClientMessage => {
  let value: unknown;
  try {
    value = JSON.parse(frame);
  } catch {
    throw new Error("WebSocket frame must contain valid JSON.");
  }
  if (!isRecord(value)) {
    throw new Error("WebSocket frame must contain an object.");
  }
  if (
    value.type === "tool_call_approve" ||
    value.type === "tool_call_deny"
  ) {
    const turnId = boundedId(value.turnId);
    const callId = boundedId(value.callId);
    if (!turnId || !callId) {
      throw new Error("A tool decision requires turnId and callId.");
    }
    return { type: value.type, turnId, callId };
  }
  if (
    value.type !== "user_message" ||
    typeof value.clientMessageId !== "string" ||
    !value.clientMessageId.trim() ||
    typeof value.content !== "string" ||
    !value.content.trim()
  ) {
    throw new Error("A user message requires clientMessageId and content.");
  }
  if (
    value.mode !== undefined &&
    value.mode !== "chat" &&
    value.mode !== "agent" &&
    value.mode !== "automation"
  ) {
    throw new Error("Conversation mode must be chat, agent, or automation.");
  }
  if (new TextEncoder().encode(value.content).byteLength > MAX_CONVERSATION_MESSAGE_BYTES) {
    throw new Error("Conversation messages must be 32 KB or smaller.");
  }
  return {
    type: "user_message",
    clientMessageId: value.clientMessageId.trim().slice(0, 200),
    content: value.content,
    mode:
      value.mode === "agent" || value.mode === "automation"
        ? value.mode
        : "chat",
  };
};

export const serializeConversationServerMessage = (
  message: ConversationServerMessage,
) => JSON.stringify(message);

import type {
  AgentToolApproval,
  ConversationActivity,
  ConversationServerMessage,
} from "@agents/contracts";

export interface AgentToolActivity {
  callId: string;
  toolName: string;
  status: "running" | "completed" | "denied";
  resultPreview: unknown | null;
  isError: boolean;
}

export interface ConversationStreamState {
  status: "idle" | "starting" | "streaming" | "failed";
  clientMessageId: string | null;
  turnId: string | null;
  optimisticUserText: string;
  assistantText: string;
  automationProposal: unknown | null;
  pendingApproval: AgentToolApproval | null;
  toolActivities: AgentToolActivity[];
  activities: ConversationActivity[];
  error: string | null;
}

export const initialConversationStreamState: ConversationStreamState = {
  status: "idle",
  clientMessageId: null,
  turnId: null,
  optimisticUserText: "",
  assistantText: "",
  automationProposal: null,
  pendingApproval: null,
  toolActivities: [],
  activities: [],
  error: null,
};

const upsertActivity = (
  activities: readonly ConversationActivity[],
  activity: ConversationActivity,
) =>
  [...activities.filter((item) => item.id !== activity.id), activity].sort(
    (left, right) => left.sequence - right.sequence,
  );

export const reduceConversationStreamState = (
  state: ConversationStreamState,
  event: ConversationServerMessage,
): ConversationStreamState => {
  switch (event.type) {
    case "turn_started":
      return {
        ...state,
        status: "starting",
        clientMessageId: event.clientMessageId,
        turnId: event.turnId,
        assistantText: "",
        automationProposal: null,
        pendingApproval: null,
        toolActivities: [],
        activities: [],
        error: null,
      };
    case "assistant_delta":
      if (state.turnId && event.turnId !== state.turnId) return state;
      return {
        ...state,
        status: "streaming",
        turnId: event.turnId,
        assistantText: state.assistantText + event.delta,
      };
    case "automation_proposal":
      return event.turnId === state.turnId
        ? { ...state, automationProposal: event.proposal }
        : state;
    case "activity_started":
    case "activity_completed":
    case "activity_failed":
      return event.turnId === state.turnId
        ? {
            ...state,
            status: "streaming",
            activities: upsertActivity(state.activities, event.activity),
          }
        : state;
    case "activity_delta":
      return event.turnId === state.turnId
        ? {
            ...state,
            activities: state.activities.map((activity) =>
              activity.id === event.activityId
                ? {
                    ...activity,
                    content: `${activity.content ?? ""}${event.delta}`,
                  }
                : activity,
            ),
          }
        : state;
    case "activity_snapshot":
      return {
        ...state,
        status: "streaming",
        turnId: event.turnId,
        activities: [...event.activities].sort(
          (left, right) => left.sequence - right.sequence,
        ),
      };
    case "agent_step_started":
      return event.turnId === state.turnId
        ? { ...state, status: "streaming" }
        : state;
    case "tool_approval_required":
      return event.turnId === state.turnId
        ? {
            ...state,
            status: "streaming",
            pendingApproval: {
              turnId: event.turnId,
              callId: event.callId,
              toolId: event.toolId,
              toolName: event.toolName,
              connectionName: event.connectionName,
              reason: event.reason,
              argumentsPreview: event.argumentsPreview,
              risk: event.risk,
            },
          }
        : state;
    case "tool_call_started":
      return event.turnId === state.turnId
        ? {
            ...state,
            pendingApproval: null,
            toolActivities: [
              ...state.toolActivities.filter(
                (activity) => activity.callId !== event.callId,
              ),
              {
                callId: event.callId,
                toolName: event.toolName,
                status: "running",
                resultPreview: null,
                isError: false,
              },
            ],
          }
        : state;
    case "tool_call_completed":
      return event.turnId === state.turnId
        ? {
            ...state,
            pendingApproval: null,
            toolActivities: [
              ...state.toolActivities.filter(
                (activity) => activity.callId !== event.callId,
              ),
              {
                callId: event.callId,
                toolName: event.toolName,
                status: "completed",
                resultPreview: event.resultPreview,
                isError: event.isError,
              },
            ],
          }
        : state;
    case "tool_call_denied":
      return event.turnId === state.turnId
        ? {
            ...state,
            pendingApproval: null,
            toolActivities: [
              ...state.toolActivities.filter(
                (activity) => activity.callId !== event.callId,
              ),
              {
                callId: event.callId,
                toolName: event.toolName,
                status: "denied",
                resultPreview: null,
                isError: true,
              },
            ],
          }
        : state;
    case "agent_turn_snapshot":
      return {
        ...state,
        status: "streaming",
        turnId: event.turnId,
        pendingApproval: event.pendingApproval,
      };
    case "turn_failed":
      return {
        ...state,
        status: "failed",
        turnId: event.turnId,
        error: event.message,
      };
    case "connection_ready":
    case "user_message_accepted":
    case "conversation_title":
    case "turn_completed":
      return state;
  }
};

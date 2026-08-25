import type {
  ConversationActivity,
  ConversationActivityKind,
  ConversationActivityStatus,
  ConversationServerMessage,
} from "@agents/contracts";
import type { ModelReasoningSummaryEvent } from "@agents/agent-runtime";
import {
  appendConversationActivityDelta,
  completeConversationActivity,
  failConversationActivity,
  linkTurnActivitiesToAssistantMessage,
  listTurnActivities,
  markTurnActivitiesIncomplete,
  setConversationActivityStatus,
  startConversationActivity,
} from "@agents/db";

type Broadcast = (message: ConversationServerMessage) => void;

export class ConversationActivityWriter {
  readonly conversationId: string;
  readonly turnId: string;
  private readonly broadcast: Broadcast;
  private sequence: number;
  private readonly reasoningActivityIds = new Map<string, string>();

  private constructor(input: {
    conversationId: string;
    turnId: string;
    broadcast: Broadcast;
    initialSequence: number;
  }) {
    this.conversationId = input.conversationId;
    this.turnId = input.turnId;
    this.broadcast = input.broadcast;
    this.sequence = input.initialSequence;
  }

  static async create(input: {
    conversationId: string;
    turnId: string;
    broadcast: Broadcast;
  }) {
    const existing = await listTurnActivities(input.turnId);
    const writer = new ConversationActivityWriter({
      ...input,
      initialSequence: existing.reduce(
        (maximum, activity) => Math.max(maximum, activity.sequence),
        0,
      ),
    });
    if (existing.length > 0) {
      input.broadcast({
        type: "activity_snapshot",
        turnId: input.turnId,
        activities: existing,
      });
    }
    return writer;
  }

  async start(input: {
    kind: ConversationActivityKind;
    title: string;
    content?: string | null;
    status?: ConversationActivityStatus;
    toolCallId?: string | null;
  }) {
    const activity = await startConversationActivity({
      conversationId: this.conversationId,
      turnId: this.turnId,
      sequence: ++this.sequence,
      ...input,
    });
    this.broadcast({ type: "activity_started", turnId: this.turnId, activity });
    return activity;
  }

  async delta(activityId: string, delta: string) {
    const updated = await appendConversationActivityDelta(activityId, delta);
    if (!updated) return;
    this.broadcast({
      type: "activity_delta",
      turnId: this.turnId,
      activityId,
      delta,
    });
  }

  async setStatus(activityId: string, status: "running" | "waiting") {
    const activity = await setConversationActivityStatus(activityId, status);
    if (!activity) return;
    this.broadcast({ type: "activity_started", turnId: this.turnId, activity });
  }

  async complete(activityId: string, content?: string | null) {
    const activity = await completeConversationActivity(activityId, content);
    if (!activity) return;
    this.broadcast({
      type: "activity_completed",
      turnId: this.turnId,
      activity,
    });
  }

  async fail(activityId: string, content?: string | null) {
    const activity = await failConversationActivity(activityId, content);
    if (!activity) return;
    this.broadcast({ type: "activity_failed", turnId: this.turnId, activity });
  }

  async reasoning(event: ModelReasoningSummaryEvent) {
    const key = `${event.providerItemId}:${event.summaryIndex}`;
    let activityId = this.reasoningActivityIds.get(key);
    if (!activityId) {
      const activity = await this.start({
        kind: "reasoning_summary",
        title: "Reasoning",
        content: null,
      });
      activityId = activity.id;
      this.reasoningActivityIds.set(key, activityId);
    }
    if (event.type === "delta") await this.delta(activityId, event.delta);
    if (event.type === "completed") await this.complete(activityId, event.text);
  }

  async linkAssistantMessage(assistantMessageId: string) {
    await linkTurnActivitiesToAssistantMessage(this.turnId, assistantMessageId);
  }

  async markIncomplete() {
    await markTurnActivitiesIncomplete(this.turnId);
  }
}

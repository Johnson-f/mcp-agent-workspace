import { asc, eq } from "drizzle-orm";
import { getDatabase } from "./client";
import { conversationTurnActivities } from "./schema";

type ConversationActivityKind =
  | "reasoning_summary"
  | "tool"
  | "automation"
  | "status";
type ConversationActivityStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "incomplete";

const MAX_ACTIVITY_CONTENT = 16_384;

export const boundedActivityContent = (content: string | null) =>
  content === null ? null : content.slice(0, MAX_ACTIVITY_CONTENT);

type ActivityRowView = Pick<
  typeof conversationTurnActivities.$inferSelect,
  | "id"
  | "turnId"
  | "assistantMessageId"
  | "sequence"
  | "kind"
  | "status"
  | "title"
  | "content"
  | "startedAt"
  | "completedAt"
>;

const toActivityView = (row: ActivityRowView) => ({
  id: row.id,
  turnId: row.turnId,
  sequence: row.sequence,
  kind: row.kind,
  status: row.status,
  title: row.title,
  content: row.content,
  startedAt: row.startedAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
});

const groupStatus = (
  rows: readonly ActivityRowView[],
): ConversationActivityStatus => {
  if (rows.some((row) => row.status === "running" || row.status === "waiting")) {
    return "running";
  }
  if (rows.some((row) => row.status === "failed")) return "failed";
  if (rows.some((row) => row.status === "incomplete")) return "incomplete";
  return "completed";
};

export const groupConversationActivityRows = (
  rows: readonly ActivityRowView[],
) => {
  const groups = new Map<string, ActivityRowView[]>();
  for (const row of rows) {
    groups.set(row.turnId, [...(groups.get(row.turnId) ?? []), row]);
  }
  return [...groups.entries()].map(([turnId, turnRows]) => {
    const ordered = [...turnRows].sort(
      (left, right) => left.sequence - right.sequence,
    );
    return {
      turnId,
      assistantMessageId:
        ordered.find((row) => row.assistantMessageId)?.assistantMessageId ?? null,
      status: groupStatus(ordered),
      activities: ordered.map(toActivityView),
    };
  });
};

export const startConversationActivity = async (input: {
  conversationId: string;
  turnId: string;
  sequence: number;
  kind: ConversationActivityKind;
  status?: ConversationActivityStatus;
  title: string;
  content?: string | null;
  toolCallId?: string | null;
  publicMetadata?: Record<string, unknown>;
}) => {
  const [row] = await getDatabase()
    .insert(conversationTurnActivities)
    .values({
      conversationId: input.conversationId,
      turnId: input.turnId,
      sequence: input.sequence,
      kind: input.kind,
      status: input.status ?? "running",
      title: input.title.trim().slice(0, 200),
      content: boundedActivityContent(input.content ?? null),
      toolCallId: input.toolCallId ?? null,
      publicMetadata: input.publicMetadata ?? {},
    })
    .returning();
  if (!row) throw new Error("Conversation activity could not be stored.");
  return toActivityView(row);
};

export const appendConversationActivityDelta = async (
  activityId: string,
  delta: string,
) => {
  const [current] = await getDatabase()
    .select()
    .from(conversationTurnActivities)
    .where(eq(conversationTurnActivities.id, activityId))
    .limit(1);
  if (!current) return null;
  const [updated] = await getDatabase()
    .update(conversationTurnActivities)
    .set({
      content: boundedActivityContent(`${current.content ?? ""}${delta}`),
      updatedAt: new Date(),
    })
    .where(eq(conversationTurnActivities.id, activityId))
    .returning();
  return updated ? toActivityView(updated) : null;
};

const finishConversationActivity = async (
  activityId: string,
  status: "completed" | "failed" | "incomplete",
  content?: string | null,
) => {
  const now = new Date();
  const [updated] = await getDatabase()
    .update(conversationTurnActivities)
    .set({
      status,
      ...(content === undefined ? {} : { content: boundedActivityContent(content) }),
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(conversationTurnActivities.id, activityId))
    .returning();
  return updated ? toActivityView(updated) : null;
};

export const completeConversationActivity = (
  activityId: string,
  content?: string | null,
) => finishConversationActivity(activityId, "completed", content);

export const failConversationActivity = (
  activityId: string,
  content?: string | null,
) => finishConversationActivity(activityId, "failed", content);

export const setConversationActivityStatus = async (
  activityId: string,
  status: "running" | "waiting",
) => {
  const [updated] = await getDatabase()
    .update(conversationTurnActivities)
    .set({ status, updatedAt: new Date() })
    .where(eq(conversationTurnActivities.id, activityId))
    .returning();
  return updated ? toActivityView(updated) : null;
};

export const markTurnActivitiesIncomplete = async (turnId: string) => {
  const now = new Date();
  await getDatabase()
    .update(conversationTurnActivities)
    .set({ status: "incomplete", completedAt: now, updatedAt: now })
    .where(eq(conversationTurnActivities.turnId, turnId));
};

export const linkTurnActivitiesToAssistantMessage = async (
  turnId: string,
  assistantMessageId: string,
) => {
  await getDatabase()
    .update(conversationTurnActivities)
    .set({ assistantMessageId, updatedAt: new Date() })
    .where(eq(conversationTurnActivities.turnId, turnId));
};

export const listConversationActivityGroups = async (conversationId: string) => {
  const rows = await getDatabase()
    .select()
    .from(conversationTurnActivities)
    .where(eq(conversationTurnActivities.conversationId, conversationId))
    .orderBy(
      asc(conversationTurnActivities.startedAt),
      asc(conversationTurnActivities.sequence),
    );
  return groupConversationActivityRows(rows);
};

export const listTurnActivities = async (turnId: string) => {
  const rows = await getDatabase()
    .select()
    .from(conversationTurnActivities)
    .where(eq(conversationTurnActivities.turnId, turnId))
    .orderBy(asc(conversationTurnActivities.sequence));
  return rows.map(toActivityView);
};

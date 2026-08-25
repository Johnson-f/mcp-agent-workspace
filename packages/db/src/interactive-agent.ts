import { and, desc, eq, inArray } from "drizzle-orm";
import { getDatabase } from "./client";
import {
  conversationAgentTurns,
  interactiveAgentPreferences,
} from "./schema";

export const getInteractiveAgentPreferences = async (userId: string) => {
  const [row] = await getDatabase()
    .select()
    .from(interactiveAgentPreferences)
    .where(eq(interactiveAgentPreferences.userId, userId))
    .limit(1);
  return {
    approvalPolicy: row?.approvalPolicy ?? ("always_ask" as const),
    updatedAt: (row?.updatedAt ?? new Date(0)).toISOString(),
  };
};

export const updateInteractiveAgentPreferences = async (input: {
  userId: string;
  approvalPolicy: "always_ask" | "tool_policy" | "auto_approve_eligible";
}) => {
  const now = new Date();
  const [row] = await getDatabase()
    .insert(interactiveAgentPreferences)
    .values({
      userId: input.userId,
      approvalPolicy: input.approvalPolicy,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: interactiveAgentPreferences.userId,
      set: { approvalPolicy: input.approvalPolicy, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error("Interactive Agent preferences could not be saved.");
  return {
    approvalPolicy: row.approvalPolicy,
    updatedAt: row.updatedAt.toISOString(),
  };
};

export const createConversationAgentTurn = async (input: {
  id?: string;
  conversationId: string;
  userMessageId: string;
}) => {
  const [row] = await getDatabase()
    .insert(conversationAgentTurns)
    .values(input)
    .onConflictDoNothing({ target: conversationAgentTurns.userMessageId })
    .returning();
  if (row) return row;
  const [existing] = await getDatabase()
    .select()
    .from(conversationAgentTurns)
    .where(eq(conversationAgentTurns.userMessageId, input.userMessageId))
    .limit(1);
  if (!existing) throw new Error("Interactive Agent turn could not be stored.");
  return existing;
};

export const updateConversationAgentTurn = async (input: {
  turnId: string;
  state?:
    | "running"
    | "awaiting_approval"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  stepCount?: number;
  toolCallCount?: number;
  assistantMessageId?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}) => {
  const now = new Date();
  const [row] = await getDatabase()
    .update(conversationAgentTurns)
    .set({
      ...(input.state ? { state: input.state } : {}),
      ...(input.stepCount === undefined ? {} : { stepCount: input.stepCount }),
      ...(input.toolCallCount === undefined
        ? {}
        : { toolCallCount: input.toolCallCount }),
      ...(input.assistantMessageId === undefined
        ? {}
        : { assistantMessageId: input.assistantMessageId }),
      ...(input.failureCode === undefined
        ? {}
        : { failureCode: input.failureCode }),
      ...(input.failureMessage === undefined
        ? {}
        : { failureMessage: input.failureMessage?.slice(0, 500) ?? null }),
      ...(input.state === "completed" || input.state === "failed"
        ? { completedAt: now }
        : {}),
      updatedAt: now,
    })
    .where(eq(conversationAgentTurns.id, input.turnId))
    .returning();
  return row ?? null;
};

export const getActiveConversationAgentTurn = async (
  conversationId: string,
) => {
  const [row] = await getDatabase()
    .select()
    .from(conversationAgentTurns)
    .where(
      and(
        eq(conversationAgentTurns.conversationId, conversationId),
        inArray(conversationAgentTurns.state, ["running", "awaiting_approval"]),
      ),
    )
    .orderBy(desc(conversationAgentTurns.updatedAt))
    .limit(1);
  return row ?? null;
};

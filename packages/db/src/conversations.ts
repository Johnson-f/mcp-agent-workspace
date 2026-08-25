import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDatabase } from "./client";
import {
	conversationMessages,
	conversationAgentTurns,
	conversations,
	auditLogEvents,
	runs,
	runBriefs,
	runBriefVersions,
	workspaceMemberships,
} from "./schema";
import type { ProductFlowError } from "./product-flow";
import { listConversationActivityGroups } from "./conversation-activities";

type ConversationRow = typeof conversations.$inferSelect;

const invalidRequest = (message: string): ProductFlowError => ({
	_tag: "InvalidRequest",
	message,
});

const notFound = (message: string): ProductFlowError => ({
	_tag: "NotFound",
	message,
});

const conflict = (message: string): ProductFlowError => ({
	_tag: "Conflict",
	message,
});

export const normalizeConversationTitle = (value: string) => {
	const normalized = value.trim().replace(/\s+/g, " ");
	return normalized.length > 0 ? normalized.slice(0, 80) : null;
};

export const conversationTitleFromFirstMessage = (content: string) =>
	normalizeConversationTitle(content) ?? "New automation";

export const toConversationSummary = (row: ConversationRow) => ({
	id: row.id,
	title: row.title,
	state: row.state,
	pinnedAt: row.pinnedAt?.toISOString() ?? null,
	archivedAt: row.archivedAt?.toISOString() ?? null,
	automationId: row.automationId,
	updatedAt: row.updatedAt.toISOString(),
});

const toMessageView = (message: typeof conversationMessages.$inferSelect) => ({
  id: message.id,
  conversationId: message.conversationId,
  role: message.role,
  content: message.content,
  metadata: message.metadata,
  createdAt: message.createdAt.toISOString(),
});

const findConversationRowForUser = async (
	userId: string,
	conversationId: string,
) => {
	const [row] = await getDatabase()
		.select({ conversation: conversations })
		.from(conversations)
		.innerJoin(
			workspaceMemberships,
			and(
				eq(conversations.ownerType, "workspace"),
				eq(conversations.ownerId, workspaceMemberships.workspaceId),
			),
		)
		.where(
			and(
				eq(conversations.id, conversationId),
				eq(workspaceMemberships.userId, userId),
			),
		)
		.limit(1);

	return row?.conversation ?? null;
};

export const listConversationsForUser = async (userId: string) => {
	const rows = await getDatabase()
		.select({ conversation: conversations })
		.from(conversations)
		.innerJoin(
			workspaceMemberships,
			and(
				eq(conversations.ownerType, "workspace"),
				eq(conversations.ownerId, workspaceMemberships.workspaceId),
			),
		)
		.where(and(eq(workspaceMemberships.userId, userId), isNull(conversations.archivedAt)))
		.orderBy(
			sql`${conversations.pinnedAt} DESC NULLS LAST`,
			desc(conversations.updatedAt),
		);

	return rows.map(({ conversation }) => toConversationSummary(conversation));
};

export const listArchivedConversationsForUser = async (userId: string) => {
	const rows = await getDatabase()
		.select({ conversation: conversations })
		.from(conversations)
		.innerJoin(
			workspaceMemberships,
			and(
				eq(conversations.ownerType, "workspace"),
				eq(conversations.ownerId, workspaceMemberships.workspaceId),
			),
		)
		.where(and(eq(workspaceMemberships.userId, userId), isNotNull(conversations.archivedAt)))
		.orderBy(desc(conversations.archivedAt));
	return rows.map(({ conversation }) => toConversationSummary(conversation));
};

export const setConversationArchivedForUser = async (input: {
	userId: string;
	conversationId: string;
	archived: boolean;
}) => {
	const conversation = await findConversationRowForUser(input.userId, input.conversationId);
	if (!conversation) return notFound("Conversation not found.");
	const active = await getDatabase()
		.select({ id: conversationAgentTurns.id })
		.from(conversationAgentTurns)
		.where(
			and(
				eq(conversationAgentTurns.conversationId, conversation.id),
				inArray(conversationAgentTurns.state, ["running", "awaiting_approval"]),
			),
		)
		.limit(1);
	if (active.length > 0) return conflict("Wait for the active conversation turn to finish.");
	const now = new Date();
	const [updated] = await getDatabase()
		.update(conversations)
		.set({
			archivedAt: input.archived ? now : null,
			pinnedAt: null,
			updatedAt: now,
		})
		.where(eq(conversations.id, conversation.id))
		.returning();
	if (!updated) return notFound("Conversation not found.");
	await getDatabase().insert(auditLogEvents).values({
		ownerType: conversation.ownerType,
		ownerId: conversation.ownerId,
		actorType: "user",
		actorUserId: input.userId,
		eventName: input.archived ? "conversation.archived" : "conversation.restored",
		targetType: "conversation",
		targetId: conversation.id,
		redactedMetadata: {},
	});
	return toConversationSummary(updated);
};

export const deleteConversationForUser = async (input: {
	userId: string;
	conversationId: string;
	confirmationTitle: string;
}) => {
	const conversation = await findConversationRowForUser(input.userId, input.conversationId);
	if (!conversation) return notFound("Conversation not found.");
	if (conversation.automationId) {
		return conflict("This conversation is linked to an Automation and cannot be deleted.");
	}
	if (input.confirmationTitle !== conversation.title) {
		return invalidRequest("Enter the exact conversation title to confirm deletion.");
	}
	const active = await getDatabase()
		.select({ id: conversationAgentTurns.id })
		.from(conversationAgentTurns)
		.where(
			and(
				eq(conversationAgentTurns.conversationId, conversation.id),
				inArray(conversationAgentTurns.state, ["running", "awaiting_approval"]),
			),
		)
		.limit(1);
	if (active.length > 0) return conflict("Wait for the active conversation turn to finish.");
	await getDatabase().transaction(async (transaction) => {
		await transaction
			.update(runs)
			.set({ conversationId: null, updatedAt: new Date() })
			.where(eq(runs.conversationId, conversation.id));
		await transaction.insert(auditLogEvents).values({
			ownerType: conversation.ownerType,
			ownerId: conversation.ownerId,
			actorType: "user",
			actorUserId: input.userId,
			eventName: "conversation.deleted",
			targetType: "conversation",
			targetId: conversation.id,
			redactedMetadata: {},
		});
		await transaction.delete(conversations).where(eq(conversations.id, conversation.id));
	});
};

export const getConversationForUser = async (
	userId: string,
	conversationId: string,
) => {
	const conversation = await findConversationRowForUser(userId, conversationId);
	if (!conversation) {
		return notFound("Conversation not found.");
	}

	const messages = await getDatabase()
		.select()
		.from(conversationMessages)
		.where(eq(conversationMessages.conversationId, conversation.id))
		.orderBy(conversationMessages.createdAt);
	const activities = await listConversationActivityGroups(conversation.id);

	const [brief] = await getDatabase()
		.select()
		.from(runBriefs)
		.where(eq(runBriefs.conversationId, conversation.id))
		.limit(1);

	const [version] = brief?.currentVersionId
		? await getDatabase()
				.select()
				.from(runBriefVersions)
				.where(eq(runBriefVersions.id, brief.currentVersionId))
				.limit(1)
		: [];

	return {
		conversation: toConversationSummary(conversation),
		messages: messages.map((message) => ({
			id: message.id,
			conversationId: message.conversationId,
			role: message.role,
			content: message.content,
			metadata: message.metadata,
			createdAt: message.createdAt.toISOString(),
		})),
		currentRunBriefVersion: version
			? {
					id: version.id,
					runBriefId: version.runBriefId,
					versionNumber: version.versionNumber,
					mode: version.mode,
					state: version.state,
					schemaVersion: version.schemaVersion,
					structuredBrief: version.structuredBrief,
					evaluation: version.evaluation,
					approvedAt: version.approvedAt?.toISOString() ?? null,
					createdAt: version.createdAt.toISOString(),
					updatedAt: version.updatedAt.toISOString(),
				}
			: null,
		activities,
	};
};

export const renameConversationForUser = async (input: {
	userId: string;
	conversationId: string;
	title: string;
}) => {
	const title = normalizeConversationTitle(input.title);
	if (!title) {
		return invalidRequest("Conversation title is required.");
	}
	const conversation = await findConversationRowForUser(
		input.userId,
		input.conversationId,
	);
	if (!conversation) {
		return notFound("Conversation not found.");
	}

	const [updated] = await getDatabase()
		.update(conversations)
		.set({ title, updatedAt: new Date() })
		.where(eq(conversations.id, conversation.id))
		.returning();

	return updated
		? toConversationSummary(updated)
		: notFound("Conversation not found.");
};

export const setConversationPinnedForUser = async (input: {
	userId: string;
	conversationId: string;
	pinned: boolean;
}) => {
	const conversation = await findConversationRowForUser(
		input.userId,
		input.conversationId,
	);
	if (!conversation) {
		return notFound("Conversation not found.");
	}

	const [updated] = await getDatabase()
		.update(conversations)
		.set({ pinnedAt: input.pinned ? new Date() : null, updatedAt: new Date() })
		.where(eq(conversations.id, conversation.id))
		.returning();

	return updated
		? toConversationSummary(updated)
		: notFound("Conversation not found.");
};

export const closeConversationForUser = async (input: {
	userId: string;
	conversationId: string;
}) => {
	const conversation = await findConversationRowForUser(
		input.userId,
		input.conversationId,
	);
	if (!conversation) {
		return notFound("Conversation not found.");
	}

	const [updated] = await getDatabase()
		.update(conversations)
		.set({ state: "closed", updatedAt: new Date() })
		.where(eq(conversations.id, conversation.id))
		.returning();

	return updated
		? toConversationSummary(updated)
		: notFound("Conversation not found.");
};

export const appendConversationModelTurn = async (input: {
	userId: string;
	conversationId: string;
	userContent: string;
	assistantContent: string;
	assistantMetadata?: Record<string, unknown>;
}) => {
	const userContent = input.userContent.trim();
	const assistantContent = input.assistantContent.trim();
	if (!userContent || !assistantContent) {
		return invalidRequest(
			"Conversation turn requires user and assistant content.",
		);
	}
	const conversation = await findConversationRowForUser(
		input.userId,
		input.conversationId,
	);
	if (!conversation) {
		return notFound("Conversation not found.");
	}

	const now = new Date();
	await getDatabase().transaction(async (transaction) => {
		await transaction.insert(conversationMessages).values([
			{
				conversationId: conversation.id,
				role: "user",
				content: userContent,
				metadata: {},
				createdAt: now,
			},
			{
				conversationId: conversation.id,
				role: "assistant",
				content: assistantContent,
				metadata: input.assistantMetadata ?? {},
				createdAt: now,
			},
		]);
		await transaction
			.update(conversations)
			.set({
				title:
					conversation.title === "New automation"
						? conversationTitleFromFirstMessage(userContent)
						: conversation.title,
				updatedAt: now,
			})
			.where(eq(conversations.id, conversation.id));
	});

  return getConversationForUser(input.userId, input.conversationId);
};

export const appendStreamingUserMessage = async (input: {
  userId: string;
  conversationId: string;
  clientMessageId: string;
  content: string;
}) => {
  const conversation = await findConversationRowForUser(
    input.userId,
    input.conversationId,
  );
  if (!conversation) return notFound("Conversation not found.");

  const [existing] = await getDatabase()
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversation.id),
        sql`${conversationMessages.metadata} ->> 'clientMessageId' = ${input.clientMessageId}`,
      ),
    )
    .limit(1);
  if (existing) {
    return { message: toMessageView(existing), duplicate: true };
  }

  const now = new Date();
  const [message] = await getDatabase()
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      role: "user",
      content: input.content,
      metadata: { clientMessageId: input.clientMessageId },
      createdAt: now,
    })
    .returning();
  if (!message) throw new Error("Conversation Message could not be stored.");
  await getDatabase()
    .update(conversations)
    .set({ updatedAt: now })
    .where(eq(conversations.id, conversation.id));
  return { message: toMessageView(message), duplicate: false };
};

export const appendStreamingAssistantMessage = async (input: {
  userId: string;
  conversationId: string;
  turnId: string;
  content: string;
  automationProposal?: Record<string, unknown> | null;
  incomplete?: boolean;
  agentToolCalls?: Array<Record<string, unknown>>;
}) => {
  const conversation = await findConversationRowForUser(
    input.userId,
    input.conversationId,
  );
  if (!conversation) return notFound("Conversation not found.");
  const [message] = await getDatabase()
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      role: "assistant",
      content: input.content,
      metadata: {
        turnId: input.turnId,
        ...(input.automationProposal
          ? { automationProposal: input.automationProposal }
          : {}),
        ...(input.incomplete ? { incomplete: true } : {}),
        ...(input.agentToolCalls?.length
          ? { agentToolCalls: input.agentToolCalls }
          : {}),
      },
      createdAt: new Date(),
    })
    .returning();
  if (!message) throw new Error("Assistant Message could not be stored.");
  await getDatabase()
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));
  return toMessageView(message);
};

export const updateConversationGeneratedTitle = async (input: {
  userId: string;
  conversationId: string;
  title: string;
}) => {
  const conversation = await findConversationRowForUser(
    input.userId,
    input.conversationId,
  );
  if (!conversation) return notFound("Conversation not found.");
  const title = normalizeConversationTitle(input.title);
  if (!title) return invalidRequest("Conversation title is required.");
  const [updated] = await getDatabase()
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id))
    .returning();
  return updated
    ? toConversationSummary(updated)
    : notFound("Conversation not found.");
};

import { and, desc, eq, inArray, max } from "drizzle-orm";
import { PostgresEncryptedArtifactStorage } from "./artifacts";
import { getDatabase } from "./client";
import { conversationTitleFromFirstMessage } from "./conversations";
import {
	artifacts,
	conversationMessages,
	conversations,
	mcpConnections,
	mcpTools,
	runBriefs,
	runBriefVersions,
	runs,
	runSteps,
	toolAuthorizationSnapshots,
	workspaceMemberships,
	workspaces,
} from "./schema";

export type ProductFlowError =
	| { _tag: "InvalidRequest"; message: string }
	| { _tag: "NotFound"; message: string }
	| { _tag: "Conflict"; message: string };

export interface SaveRunBriefDraftInput {
	userId: string;
	conversationId: string;
	mode: "manual_agent_run" | "automation";
	schemaVersion: string;
	structuredBrief: Record<string, unknown>;
	evaluation: Record<string, unknown>;
	runBriefState: "draft" | "pending_approval";
	conversationState:
		| "drafting"
		| "awaiting_user_input"
		| "ready_for_run_brief"
		| "run_brief_created"
		| "closed";
	toolAuthorizations: Array<{
		mcpConnectionId: string;
		mcpToolId: string;
		toolName: string;
		required: boolean;
		reason: string;
		state: "proposed" | "approved" | "rejected" | "revoked" | "stale";
		writeCapable: boolean;
		acknowledgedWriteCapability: boolean;
		allowedOutcomeBoundary: string | null;
		annotations: Record<string, unknown> | null;
	}>;
	userMessage?: string;
	assistantMessage?: string;
}

type WorkspaceRow = typeof workspaces.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;
type ConversationMessageRow = typeof conversationMessages.$inferSelect;
type RunBriefRow = typeof runBriefs.$inferSelect;
type RunBriefVersionRow = typeof runBriefVersions.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type RunStepRow = typeof runSteps.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;

const artifactStorage = new PostgresEncryptedArtifactStorage();

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

const toIso = (value: Date | null) => value?.toISOString() ?? null;

export const toConversationView = (row: ConversationRow) => ({
	id: row.id,
	ownerType: row.ownerType,
	ownerId: row.ownerId,
	title: row.title,
	state: row.state,
	pinnedAt: toIso(row.pinnedAt),
	automationId: row.automationId,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
});

export const toConversationMessageView = (row: ConversationMessageRow) => ({
	id: row.id,
	conversationId: row.conversationId,
	role: row.role,
	content: row.content,
	metadata: row.metadata,
	createdAt: row.createdAt.toISOString(),
});

export const toRunBriefVersionView = (
	version: RunBriefVersionRow,
	brief: Pick<RunBriefRow, "conversationId">,
) => ({
	id: version.id,
	runBriefId: version.runBriefId,
	conversationId: brief.conversationId,
	versionNumber: version.versionNumber,
	mode: version.mode,
	state: version.state,
	schemaVersion: version.schemaVersion,
	structuredBrief: version.structuredBrief,
	evaluation: version.evaluation,
	approvedAt: toIso(version.approvedAt),
	createdAt: version.createdAt.toISOString(),
	updatedAt: version.updatedAt.toISOString(),
});

export const toAgentRunView = (row: RunRow) => ({
	id: row.id,
	state: row.state,
	title: row.title,
	conversationId: row.conversationId,
	runBriefVersionId: row.runBriefVersionId ?? "",
	temporalWorkflowId: row.temporalWorkflowId,
	temporalRunId: row.temporalRunId,
	createdAt: row.createdAt.toISOString(),
});

const USER_RUN_METADATA_ALLOWLIST = new Set([
	"argumentsRedacted",
	"code",
	"connectionName",
	"durationMs",
	"evidenceStatus",
	"message",
	"outputDestinationKind",
	"reason",
	"resultSummary",
	"status",
	"toolName",
]);

const SENSITIVE_METADATA_KEY_PATTERN =
	/(?:auth|credential|secret|token|ciphertext|nonce|authTag|keyId|keyVersion|storageKey|temporal|rawPayload|plaintext|hash)$/i;

const stripUserRunMetadata = (metadata: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(metadata).filter(
			([key]) =>
				USER_RUN_METADATA_ALLOWLIST.has(key) &&
				!SENSITIVE_METADATA_KEY_PATTERN.test(key),
		),
	);

const toRunHistoryArtifactView = (artifact: ArtifactRow) => ({
	id: artifact.id,
	purpose: artifact.purpose,
	sensitivity: artifact.sensitivity,
	retentionState: artifact.retentionState,
	rawAvailable: artifact.retentionState === "active",
	redactedSummary: artifact.redactedSummary,
});

const toRunHistoryStepView = (
	step: RunStepRow,
	relatedArtifacts: ArtifactRow[],
) => ({
	id: step.id,
	type: step.type,
	summary: step.summary,
	occurredAt: step.occurredAt.toISOString(),
	publicMetadata: stripUserRunMetadata(step.redactedMetadata),
	artifacts: relatedArtifacts.map(toRunHistoryArtifactView),
});

const readFinalOutputText = async (artifactId: string) => {
	try {
		const payload = new TextDecoder().decode(
			await artifactStorage.readArtifactPayload(artifactId),
		);
		const parsed = JSON.parse(payload) as unknown;
		if (
			parsed &&
			typeof parsed === "object" &&
			"text" in parsed &&
			typeof parsed.text === "string"
		) {
			return parsed.text;
		}
	} catch {
		return null;
	}

	return null;
};

export const ensurePersonalWorkspace = async (
	userId: string,
): Promise<WorkspaceRow> => {
	const database = getDatabase();
	const now = new Date();
	const [existing] = await database
		.select()
		.from(workspaces)
		.where(eq(workspaces.personalOwnerUserId, userId))
		.limit(1);

	if (existing) {
		await database
			.insert(workspaceMemberships)
			.values({
				workspaceId: existing.id,
				userId,
				role: "owner_admin",
			})
			.onConflictDoUpdate({
				target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
				set: { role: "owner_admin" },
			});
		return existing;
	}

	return database.transaction(async (transaction) => {
		const [workspace] = await transaction
			.insert(workspaces)
			.values({
				kind: "personal",
				name: "Personal Workspace",
				personalOwnerUserId: userId,
				createdByUserId: userId,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		if (!workspace) {
			throw new Error("Personal Workspace could not be created.");
		}

		await transaction.insert(workspaceMemberships).values({
			workspaceId: workspace.id,
			userId,
			role: "owner_admin",
			createdAt: now,
		});

		return workspace;
	});
};

const findConversationForUser = async (
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

export const createConversation = async (input: {
	userId: string;
	title?: string;
	initialMessage?: string;
}) => {
	const workspace = await ensurePersonalWorkspace(input.userId);
	const now = new Date();
	const title =
		input.title?.trim() ||
		(input.initialMessage
			? conversationTitleFromFirstMessage(input.initialMessage)
			: "New automation");

	return getDatabase().transaction(async (transaction) => {
		const [conversation] = await transaction
			.insert(conversations)
			.values({
				ownerType: "workspace",
				ownerId: workspace.id,
				title,
				state: "drafting",
				createdByUserId: input.userId,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		if (!conversation) {
			throw new Error("Conversation could not be created.");
		}

		let message: ConversationMessageRow | null = null;
		const content = input.initialMessage?.trim();
		if (content) {
			[message] = await transaction
				.insert(conversationMessages)
				.values({
					conversationId: conversation.id,
					role: "user",
					content,
					createdAt: now,
				})
				.returning();
		}

		return {
			conversation: toConversationView(conversation),
			message: message ? toConversationMessageView(message) : null,
		};
	});
};

export const appendConversationMessage = async (input: {
	userId: string;
	conversationId: string;
	content: string;
	role?: "user" | "assistant" | "system";
}) => {
	const content = input.content.trim();
	if (!content) {
		return invalidRequest("Message content is required.");
	}

	const conversation = await findConversationForUser(
		input.userId,
		input.conversationId,
	);
	if (!conversation) {
		return notFound("Conversation not found.");
	}

	const now = new Date();
	const role = input.role ?? "user";
	const nextTitle =
		role === "user" && conversation.title === "New automation"
			? conversationTitleFromFirstMessage(content)
			: conversation.title;
	const [message] = await getDatabase()
		.insert(conversationMessages)
		.values({
			conversationId: conversation.id,
			role,
			content,
			createdAt: now,
		})
		.returning();

	await getDatabase()
		.update(conversations)
		.set({ title: nextTitle, updatedAt: now })
		.where(eq(conversations.id, conversation.id));

	if (!message) {
		throw new Error("Conversation Message could not be created.");
	}

	return toConversationMessageView(message);
};

const findToolRowsForUser = async (userId: string, toolIds: string[]) => {
	const rows = await getDatabase()
		.select({ tool: mcpTools, connection: mcpConnections })
		.from(mcpTools)
		.innerJoin(mcpConnections, eq(mcpTools.connectionId, mcpConnections.id))
		.where(eq(mcpConnections.userId, userId));

	const byId = new Map(rows.map((row) => [row.tool.id, row]));
	return toolIds.map((id) => byId.get(id) ?? null);
};

const getOrCreateRunBrief = async (
	transaction: Parameters<
		Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
	>[0],
	input: {
		userId: string;
		conversation: ConversationRow;
	},
) => {
	const [existing] = await transaction
		.select()
		.from(runBriefs)
		.where(eq(runBriefs.conversationId, input.conversation.id))
		.limit(1);

	if (existing) {
		return existing;
	}

	const [brief] = await transaction
		.insert(runBriefs)
		.values({
			ownerType: input.conversation.ownerType,
			ownerId: input.conversation.ownerId,
			conversationId: input.conversation.id,
			createdByUserId: input.userId,
		})
		.returning();

	if (!brief) {
		throw new Error("Run Brief could not be created.");
	}
	return brief;
};

export const saveRunBriefDraft = async (input: SaveRunBriefDraftInput) => {
	if (
		input.runBriefState !== "draft" &&
		input.runBriefState !== "pending_approval"
	) {
		return invalidRequest("Draft save cannot directly approve a Run Brief.");
	}

	const conversation = await findConversationForUser(
		input.userId,
		input.conversationId,
	);
	if (!conversation) {
		return notFound("Conversation not found.");
	}

	const selectedToolIds = input.toolAuthorizations.map(
		(tool) => tool.mcpToolId,
	);
	const toolRows = await findToolRowsForUser(input.userId, selectedToolIds);
	const missingTool = toolRows.findIndex((row) => row === null);
	if (missingTool >= 0) {
		return invalidRequest("Every selected MCP tool must belong to the user.");
	}

	const now = new Date();
	return getDatabase().transaction(async (transaction) => {
		const brief = await getOrCreateRunBrief(transaction, {
			userId: input.userId,
			conversation,
		});

		const [versionInfo] = await transaction
			.select({ value: max(runBriefVersions.versionNumber) })
			.from(runBriefVersions)
			.where(eq(runBriefVersions.runBriefId, brief.id));
		const versionNumber = (versionInfo?.value ?? 0) + 1;

		await transaction
			.update(runBriefVersions)
			.set({
				state: "superseded",
				updatedAt: now,
			})
			.where(
				and(
					eq(runBriefVersions.runBriefId, brief.id),
					eq(runBriefVersions.state, "draft"),
				),
			);

		const [version] = await transaction
			.insert(runBriefVersions)
			.values({
				runBriefId: brief.id,
				versionNumber,
				mode: input.mode,
				state: input.runBriefState,
				schemaVersion: input.schemaVersion,
				structuredBrief: input.structuredBrief,
				evaluation: input.evaluation,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		if (!version) {
			throw new Error("Run Brief Version could not be created.");
		}

		const snapshotValues = input.toolAuthorizations.map((tool, index) => {
			const row = toolRows[index];
			if (!row) {
				throw new Error("Selected tool disappeared during Run Brief save.");
			}

			return {
				ownerType: conversation.ownerType,
				ownerId: conversation.ownerId,
				runBriefVersionId: version.id,
				state: tool.state,
				mcpConnectionId: row.connection.id,
				mcpToolId: row.tool.id,
				serverId: row.connection.serverName,
				toolName: row.tool.name,
				required: tool.required,
				writeCapable: tool.writeCapable,
				schemaHash: row.tool.schemaHash,
				annotationHash: row.tool.annotationHash,
				annotations: row.tool.annotations ?? tool.annotations,
				acknowledgedWriteCapability: tool.acknowledgedWriteCapability,
				allowedOutcomeBoundary: tool.allowedOutcomeBoundary,
				reason: tool.reason,
				approvedByUserId: tool.state === "approved" ? input.userId : null,
				approvedAt: tool.state === "approved" ? now : null,
				createdAt: now,
			};
		});

		if (snapshotValues.length > 0) {
			await transaction
				.insert(toolAuthorizationSnapshots)
				.values(snapshotValues);
		}

		const userMessage = input.userMessage?.trim();
		const assistantMessage = input.assistantMessage?.trim();
		if (userMessage) {
			await transaction.insert(conversationMessages).values({
				conversationId: conversation.id,
				role: "user",
				content: userMessage,
				contributedToRunBriefVersionId: version.id,
				createdAt: now,
			});
		}
		if (assistantMessage) {
			await transaction.insert(conversationMessages).values({
				conversationId: conversation.id,
				role: "assistant",
				content: assistantMessage,
				contributedToRunBriefVersionId: version.id,
				createdAt: now,
			});
		}

		await transaction
			.update(runBriefs)
			.set({
				currentVersionId: version.id,
				updatedAt: now,
			})
			.where(eq(runBriefs.id, brief.id));

		await transaction
			.update(conversations)
			.set({
				title:
					userMessage && conversation.title === "New automation"
						? conversationTitleFromFirstMessage(userMessage)
						: conversation.title,
				state:
					input.runBriefState === "pending_approval"
						? "run_brief_created"
						: input.conversationState,
				updatedAt: now,
			})
			.where(eq(conversations.id, conversation.id));

		return toRunBriefVersionView(version, brief);
	});
};

const findRunBriefVersionForUser = async (
	userId: string,
	runBriefVersionId: string,
) => {
	const [row] = await getDatabase()
		.select({ version: runBriefVersions, brief: runBriefs })
		.from(runBriefVersions)
		.innerJoin(runBriefs, eq(runBriefVersions.runBriefId, runBriefs.id))
		.innerJoin(
			workspaceMemberships,
			and(
				eq(runBriefs.ownerType, "workspace"),
				eq(runBriefs.ownerId, workspaceMemberships.workspaceId),
			),
		)
		.where(
			and(
				eq(runBriefVersions.id, runBriefVersionId),
				eq(workspaceMemberships.userId, userId),
			),
		)
		.limit(1);

	return row ?? null;
};

export const approveRunBriefVersion = async (input: {
	userId: string;
	runBriefVersionId: string;
}) => {
	const row = await findRunBriefVersionForUser(
		input.userId,
		input.runBriefVersionId,
	);
	if (!row) {
		return notFound("Run Brief Version not found.");
	}
	const decision = runBriefApprovalStateDecision(row.version.state);
	if (decision === "reuse") {
		return toRunBriefVersionView(row.version, row.brief);
	}
	if (decision === "conflict") {
		return conflict("Only pending Run Brief Versions can be approved.");
	}

	const now = new Date();
	const [version] = await getDatabase()
		.update(runBriefVersions)
		.set({
			state: "approved",
			approvedByUserId: input.userId,
			approvedAt: now,
			updatedAt: now,
		})
		.where(eq(runBriefVersions.id, row.version.id))
		.returning();

	if (!version) {
		throw new Error("Run Brief Version could not be approved.");
	}

	return toRunBriefVersionView(version, row.brief);
};

export const runBriefApprovalStateDecision = (
	state: typeof runBriefVersions.$inferSelect.state,
) => {
	if (state === "pending_approval") return "approve" as const;
	if (state === "approved") return "reuse" as const;
	return "conflict" as const;
};

export const createManualAgentRun = async (input: {
	userId: string;
	runBriefVersionId: string;
}) => {
	const row = await findRunBriefVersionForUser(
		input.userId,
		input.runBriefVersionId,
	);
	if (!row) {
		return notFound("Run Brief Version not found.");
	}
	if (row.version.state !== "approved") {
		return conflict("Approve the Run Brief before starting an Agent Run.");
	}
	if (row.version.mode !== "manual_agent_run") {
		return invalidRequest("Only manual Agent Run briefs can start Agent Runs.");
	}

	const brief = row.version.structuredBrief as {
		goal?: string | null;
	};
	const title = brief.goal?.trim() || "Manual Agent Run";
	const now = new Date();

	const [run] = await getDatabase()
		.insert(runs)
		.values({
			ownerType: row.brief.ownerType,
			ownerId: row.brief.ownerId,
			kind: "agent",
			state: "queued",
			title,
			conversationId: row.brief.conversationId,
			runBriefVersionId: row.version.id,
			startedByUserId: input.userId,
			queuedAt: now,
			createdAt: now,
			updatedAt: now,
		})
		.returning();

	if (!run) {
		throw new Error("Agent Run could not be created.");
	}

	await getDatabase()
		.insert(runSteps)
		.values({
			runId: run.id,
			ownerType: run.ownerType,
			ownerId: run.ownerId,
			type: "message",
			summary: "Manual Agent Run queued from approved Run Brief.",
			visibleToUser: true,
			redactedMetadata: {
				runBriefVersionId: row.version.id,
			},
			occurredAt: now,
			createdAt: now,
		});

	return toAgentRunView(run);
};

export const updateRunTemporalIdentity = async (input: {
	runId: string;
	temporalWorkflowId: string;
	temporalRunId: string;
}) => {
	const now = new Date();
	const [run] = await getDatabase()
		.update(runs)
		.set({
			temporalWorkflowId: input.temporalWorkflowId,
			temporalRunId: input.temporalRunId,
			updatedAt: now,
		})
		.where(eq(runs.id, input.runId))
		.returning();

	return run ? toAgentRunView(run) : null;
};

export const getApprovedRunBriefVersionForRunStart = async (
	userId: string,
	runBriefVersionId: string,
) => {
	const row = await findRunBriefVersionForUser(userId, runBriefVersionId);
	return row?.version.state === "approved" ? row : null;
};

export const getAgentRunDetailForUser = async (
	userId: string,
	runId: string,
) => {
	const [row] = await getDatabase()
		.select({ run: runs })
		.from(runs)
		.innerJoin(
			workspaceMemberships,
			and(
				eq(runs.ownerType, "workspace"),
				eq(runs.ownerId, workspaceMemberships.workspaceId),
			),
		)
		.where(and(eq(runs.id, runId), eq(workspaceMemberships.userId, userId)))
		.limit(1);

	if (!row) {
		return notFound("Agent Run not found.");
	}

	const stepRows = await getDatabase()
		.select()
		.from(runSteps)
		.where(and(eq(runSteps.runId, runId), eq(runSteps.visibleToUser, true)))
		.orderBy(runSteps.occurredAt);
	const relatedArtifactIds = [
		...new Set(stepRows.flatMap((step) => step.relatedArtifactIds)),
	];
	const artifactRows =
		relatedArtifactIds.length > 0
			? await getDatabase()
					.select()
					.from(artifacts)
					.where(inArray(artifacts.id, relatedArtifactIds))
			: [];
	const artifactsById = new Map(
		artifactRows.map((artifact) => [artifact.id, artifact]),
	);
	const finalOutputArtifactIds = row.run.finalArtifactIds;
	const finalOutputText =
		(
			await Promise.all(
				finalOutputArtifactIds.map((artifactId) =>
					readFinalOutputText(artifactId),
				),
			)
		).find((text): text is string => Boolean(text)) ?? null;

	return {
		run: toAgentRunView(row.run),
		steps: stepRows.map((step) =>
			toRunHistoryStepView(
				step,
				step.relatedArtifactIds
					.map((artifactId) => artifactsById.get(artifactId))
					.filter((artifact): artifact is ArtifactRow => Boolean(artifact)),
			),
		),
		finalOutputText,
		finalOutputArtifactIds,
	};
};

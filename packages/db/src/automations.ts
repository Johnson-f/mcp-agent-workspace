import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "./client";
import {
	automationVersions,
	automations,
	conversations,
	mcpConnections,
	mcpTools,
	runBriefs,
	runBriefVersions,
	runs,
	runSteps,
	toolAuthorizationSnapshots,
	workspaceMemberships,
} from "./schema";
import type { ProductFlowError } from "./product-flow";

type AutomationState = typeof automations.$inferSelect.state;
type RunBudgetPreset = "small" | "standard" | "deep";
type ScheduleDraft = {
	kind: "manual_only" | "recurring";
	timezone: string;
	rule: string | null;
	missedRunPolicy: "skip" | "backfill_if_enabled";
	overlapPolicy: "skip" | "queue_one" | "cancel_old" | "allow_overlap";
};

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

export const runBudgetForPreset = (preset: RunBudgetPreset) => {
	switch (preset) {
		case "small":
			return {
				preset,
				maxLlmSteps: 6,
				maxToolCalls: 8,
				maxRuntimeMs: 180_000,
				maxRetryAttempts: 2,
				maxOutputBytes: 12_000,
				maxSpendUsdCents: 100,
			};
		case "deep":
			return {
				preset,
				maxLlmSteps: 24,
				maxToolCalls: 40,
				maxRuntimeMs: 1_800_000,
				maxRetryAttempts: 5,
				maxOutputBytes: 64_000,
				maxSpendUsdCents: 750,
			};
		default:
			return {
				preset: "standard" as const,
				maxLlmSteps: 12,
				maxToolCalls: 20,
				maxRuntimeMs: 900_000,
				maxRetryAttempts: 3,
				maxOutputBytes: 24_000,
				maxSpendUsdCents: 250,
			};
	}
};

export const scheduleFieldsFromDraft = (schedule: ScheduleDraft | null) => {
	const normalized = schedule ?? {
		kind: "manual_only" as const,
		timezone: "UTC",
		rule: null,
		missedRunPolicy: "skip" as const,
		overlapPolicy: "skip" as const,
	};

	return {
		scheduleKind: normalized.kind,
		scheduleTimezone: normalized.timezone.trim() || "UTC",
		scheduleRule:
			normalized.kind === "recurring" ? normalized.rule?.trim() || null : null,
		missedRunPolicy: normalized.missedRunPolicy,
		overlapPolicy: normalized.overlapPolicy,
		scheduleConfig: normalized,
	};
};

export const automationRunNowBlocker = (
	state: AutomationState,
	hasActiveRun: boolean,
) => {
	if (state !== "live") {
		return `This Automation is ${state.replaceAll("_", " ")}.`;
	}
	if (hasActiveRun) {
		return "This Automation is already running.";
	}
	return null;
};

const scheduleLabel = (
	version: typeof automationVersions.$inferSelect | null,
) => {
	if (!version || version.scheduleKind === "manual_only") {
		return "No schedule";
	}
	return version.scheduleRule ?? "Recurring";
};

const needsAttentionReason = (state: AutomationState) => {
	if (state === "needs_reconfiguration") {
		return "Review changed tools, connections, or permissions.";
	}
	if (state === "paused") {
		return "Automation is paused.";
	}
	if (state === "pending_approval" || state === "draft") {
		return "Automation approval is incomplete.";
	}
	return null;
};

const automationSummary = async (
	automation: typeof automations.$inferSelect,
) => {
	const [version] = automation.currentVersionId
		? await getDatabase()
				.select()
				.from(automationVersions)
				.where(eq(automationVersions.id, automation.currentVersionId))
				.limit(1)
		: [];
	const [latestRun] = await getDatabase()
		.select()
		.from(runs)
		.where(eq(runs.automationId, automation.id))
		.orderBy(desc(runs.createdAt))
		.limit(1);

	return {
		id: automation.id,
		title: automation.title,
		state: automation.state,
		scheduleLabel: scheduleLabel(version ?? null),
		nextScheduledAt: null,
		latestRunState: latestRun?.state ?? null,
		latestRunAt: latestRun?.createdAt.toISOString() ?? null,
		needsAttentionReason: needsAttentionReason(automation.state),
		updatedAt: automation.updatedAt.toISOString(),
	};
};

const findAutomationForUser = async (userId: string, automationId: string) => {
	const [row] = await getDatabase()
		.select({ automation: automations })
		.from(automations)
		.innerJoin(
			workspaceMemberships,
			and(
				eq(automations.ownerType, "workspace"),
				eq(automations.ownerId, workspaceMemberships.workspaceId),
			),
		)
		.where(
			and(
				eq(automations.id, automationId),
				eq(workspaceMemberships.userId, userId),
			),
		)
		.limit(1);

	return row?.automation ?? null;
};

export const listAutomationsForUser = async (userId: string) => {
	const rows = await getDatabase()
		.select({ automation: automations })
		.from(automations)
		.innerJoin(
			workspaceMemberships,
			and(
				eq(automations.ownerType, "workspace"),
				eq(automations.ownerId, workspaceMemberships.workspaceId),
			),
		)
		.where(eq(workspaceMemberships.userId, userId))
		.orderBy(desc(automations.updatedAt));

	return Promise.all(
		rows.map(({ automation }) => automationSummary(automation)),
	);
};

export const getAutomationForUser = async (
	userId: string,
	automationId: string,
) => {
	const automation = await findAutomationForUser(userId, automationId);
	if (!automation || !automation.currentVersionId) {
		return notFound("Automation not found.");
	}

	const [version] = await getDatabase()
		.select()
		.from(automationVersions)
		.where(eq(automationVersions.id, automation.currentVersionId))
		.limit(1);
	if (!version) {
		return notFound("Automation Version not found.");
	}

	const [conversation] = await getDatabase()
		.select()
		.from(conversations)
		.where(eq(conversations.automationId, automation.id))
		.limit(1);
	if (!conversation) {
		return notFound("Automation Conversation not found.");
	}

	const recentRunRows = await getDatabase()
		.select()
		.from(runs)
		.where(eq(runs.automationId, automation.id))
		.orderBy(desc(runs.createdAt))
		.limit(20);
	const hasActiveRun = recentRunRows.some((run) =>
		["queued", "running"].includes(run.state),
	);
	const blocker = automationRunNowBlocker(automation.state, hasActiveRun);

	return {
		automation: await automationSummary(automation),
		conversationId: conversation.id,
		currentVersionId: version.id,
		runBriefVersionId: version.runBriefVersionId,
		schedule: version.scheduleConfig,
		runBudget: version.runBudget,
		outputDestination: version.outputDestination,
		toolAuthorizations: version.toolAuthorizationSnapshot,
		recentRuns: recentRunRows.map((run) => ({
			id: run.id,
			automationId: run.automationId ?? automation.id,
			automationVersionId: run.automationVersionId ?? version.id,
			state: run.state,
			title: run.title,
			triggerSource: run.triggerSource ?? "manual",
			temporalWorkflowId: run.temporalWorkflowId,
			temporalRunId: run.temporalRunId,
			createdAt: run.createdAt.toISOString(),
		})),
		canRunNow: blocker === null,
		runNowBlocker: blocker,
	};
};

export const approveAutomationProposal = async (input: {
	userId: string;
	runBriefVersionId: string;
}) => {
	const [row] = await getDatabase()
		.select({
			version: runBriefVersions,
			brief: runBriefs,
			conversation: conversations,
		})
		.from(runBriefVersions)
		.innerJoin(runBriefs, eq(runBriefVersions.runBriefId, runBriefs.id))
		.innerJoin(conversations, eq(runBriefs.conversationId, conversations.id))
		.innerJoin(
			workspaceMemberships,
			and(
				eq(conversations.ownerType, "workspace"),
				eq(conversations.ownerId, workspaceMemberships.workspaceId),
			),
		)
		.where(
			and(
				eq(runBriefVersions.id, input.runBriefVersionId),
				eq(workspaceMemberships.userId, input.userId),
			),
		)
		.limit(1);

	if (!row) {
		return notFound("Run Brief Version not found.");
	}
	if (row.version.state !== "approved" || row.version.mode !== "automation") {
		return conflict("Approve an Automation Run Brief before activation.");
	}
	if (row.conversation.automationId) {
		return getAutomationForUser(input.userId, row.conversation.automationId);
	}

	const draft = row.version.structuredBrief as {
		goal?: string | null;
		runBudgetPreset?: RunBudgetPreset | null;
		schedule?: ScheduleDraft | null;
		outputDestination?: Record<string, unknown> | null;
	};
	if (!draft.runBudgetPreset || !draft.outputDestination) {
		return invalidRequest(
			"Run Brief is missing its budget or output destination.",
		);
	}
	const runBudget = runBudgetForPreset(draft.runBudgetPreset);
	const outputDestination = draft.outputDestination;

	const authorizations = await getDatabase()
		.select()
		.from(toolAuthorizationSnapshots)
		.where(eq(toolAuthorizationSnapshots.runBriefVersionId, row.version.id));
	if (
		authorizations.length === 0 ||
		authorizations.some((auth) => auth.state !== "approved")
	) {
		return conflict("Every selected tool must be approved before activation.");
	}

	const connectionIds = authorizations
		.map((auth) => auth.mcpConnectionId)
		.filter((id): id is string => Boolean(id));
	const toolIds = authorizations
		.map((auth) => auth.mcpToolId)
		.filter((id): id is string => Boolean(id));
	const connectionRows = await getDatabase()
		.select()
		.from(mcpConnections)
		.where(inArray(mcpConnections.id, connectionIds));
	const toolRows = await getDatabase()
		.select()
		.from(mcpTools)
		.where(inArray(mcpTools.id, toolIds));
	const connectionById = new Map(connectionRows.map((item) => [item.id, item]));
	const toolById = new Map(toolRows.map((item) => [item.id, item]));

	for (const authorization of authorizations) {
		const connection = authorization.mcpConnectionId
			? connectionById.get(authorization.mcpConnectionId)
			: null;
		const tool = authorization.mcpToolId
			? toolById.get(authorization.mcpToolId)
			: null;
		if (!connection || connection.status !== "connected") {
			return conflict(`Reconnect ${authorization.toolName} before activation.`);
		}
		if (
			!tool ||
			!tool.available ||
			tool.schemaHash !== authorization.schemaHash ||
			tool.annotationHash !== authorization.annotationHash
		) {
			return conflict(
				`${authorization.toolName} changed and must be reviewed again.`,
			);
		}
		if (
			authorization.writeCapable &&
			(!authorization.acknowledgedWriteCapability ||
				!authorization.allowedOutcomeBoundary?.trim())
		) {
			return conflict(
				`${authorization.toolName} needs an allowed outcome boundary.`,
			);
		}
	}

	const schedule = scheduleFieldsFromDraft(draft.schedule ?? null);
	const now = new Date();
	const automationId = await getDatabase().transaction(async (transaction) => {
		const [automation] = await transaction
			.insert(automations)
			.values({
				ownerType: row.brief.ownerType,
				ownerId: row.brief.ownerId,
				title: draft.goal?.trim() || row.conversation.title,
				state: "pending_approval",
				createdByUserId: input.userId,
				approvedByUserId: input.userId,
				approvedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		if (!automation) {
			throw new Error("Automation could not be created.");
		}

		const frozenAuthorizations = authorizations.map((authorization) => ({
			id: authorization.id,
			state: authorization.state,
			mcpConnectionId: authorization.mcpConnectionId,
			mcpToolId: authorization.mcpToolId,
			toolName: authorization.toolName,
			required: authorization.required,
			writeCapable: authorization.writeCapable,
			schemaHash: authorization.schemaHash,
			annotationHash: authorization.annotationHash,
			annotations: authorization.annotations,
			acknowledgedWriteCapability: authorization.acknowledgedWriteCapability,
			allowedOutcomeBoundary: authorization.allowedOutcomeBoundary,
		}));
		const [version] = await transaction
			.insert(automationVersions)
			.values({
				automationId: automation.id,
				versionNumber: 1,
				state: "approved",
				runBriefVersionId: row.version.id,
				...schedule,
				runBudget,
				outputDestination,
				retentionPolicy: {
					rawLowDays: 30,
					rawSensitiveDays: 7,
					rawRestrictedDays: 1,
					summaryDays: 90,
				},
				toolAuthorizationSnapshot: frozenAuthorizations,
				activationPreflight: { canActivate: true, blockers: [] },
				approvedByUserId: input.userId,
				approvedAt: now,
				activatedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		if (!version) {
			throw new Error("Automation Version could not be created.");
		}

		await transaction
			.update(automations)
			.set({
				state: "live",
				currentVersionId: version.id,
				liveAt: now,
				updatedAt: now,
			})
			.where(eq(automations.id, automation.id));
		await transaction
			.update(conversations)
			.set({ automationId: automation.id, state: "closed", updatedAt: now })
			.where(eq(conversations.id, row.conversation.id));

		return automation.id;
	});

	return getAutomationForUser(input.userId, automationId);
};

const runBudgetFromVersion = (value: Record<string, unknown>) => {
	const required = [
		"maxLlmSteps",
		"maxToolCalls",
		"maxRuntimeMs",
		"maxRetryAttempts",
		"maxOutputBytes",
	] as const;
	if (required.some((key) => typeof value[key] !== "number")) {
		return null;
	}
	return {
		maxLlmSteps: value.maxLlmSteps as number,
		maxToolCalls: value.maxToolCalls as number,
		maxRuntimeMs: value.maxRuntimeMs as number,
		maxRetryAttempts: value.maxRetryAttempts as number,
		maxOutputBytes: value.maxOutputBytes as number,
		maxSpendUsdCents:
			typeof value.maxSpendUsdCents === "number"
				? value.maxSpendUsdCents
				: null,
	};
};

export const createAutomationRunNow = async (input: {
	userId: string;
	automationId: string;
	triggerSource?: "manual" | "scheduled";
	scheduledFireTime?: Date | null;
}) => {
	const ownedAutomation = await findAutomationForUser(
		input.userId,
		input.automationId,
	);
	if (!ownedAutomation || !ownedAutomation.currentVersionId) {
		return notFound("Automation not found.");
	}

	const result = await getDatabase().transaction(async (transaction) => {
		await transaction.execute(
			sql`select pg_advisory_xact_lock(hashtext(${ownedAutomation.id}))`,
		);

		const [automation] = await transaction
			.select()
			.from(automations)
			.where(eq(automations.id, ownedAutomation.id))
			.limit(1);
		if (!automation?.currentVersionId) {
			return notFound("Automation not found.");
		}

		const [activeRun] = await transaction
			.select({ id: runs.id })
			.from(runs)
			.where(
				and(
					eq(runs.automationId, automation.id),
					inArray(runs.state, ["queued", "running"]),
				),
			)
			.limit(1);
		const blocker = automationRunNowBlocker(
			automation.state,
			Boolean(activeRun),
		);
		if (blocker) {
			return conflict(blocker);
		}

		const [version] = await transaction
			.select()
			.from(automationVersions)
			.where(eq(automationVersions.id, automation.currentVersionId))
			.limit(1);
		if (!version || version.state !== "approved") {
			return conflict("Automation Version is not approved.");
		}

		const [briefRow] = await transaction
			.select({ version: runBriefVersions, brief: runBriefs })
			.from(runBriefVersions)
			.innerJoin(runBriefs, eq(runBriefVersions.runBriefId, runBriefs.id))
			.where(eq(runBriefVersions.id, version.runBriefVersionId))
			.limit(1);
		if (!briefRow || briefRow.version.state !== "approved") {
			return conflict("Run Brief Version is not approved.");
		}

		const runBudget = runBudgetFromVersion(version.runBudget);
		if (!runBudget) {
			return conflict("Automation Run Budget is invalid.");
		}
		const structuredBrief = briefRow.version.structuredBrief as {
			unavailableRequiredToolBehavior?:
				| "retry_then_fail"
				| "retry_then_partial";
		};
		const now = new Date();
		const triggerSource = input.triggerSource ?? "manual";
		const [run] = await transaction
			.insert(runs)
			.values({
				ownerType: automation.ownerType,
				ownerId: automation.ownerId,
				kind: "automation",
				state: "queued",
				title: automation.title,
				conversationId: briefRow.brief.conversationId,
				runBriefVersionId: briefRow.version.id,
				automationId: automation.id,
				automationVersionId: version.id,
				startedByUserId: triggerSource === "manual" ? input.userId : null,
				triggerSource,
				triggeredByUserId: triggerSource === "manual" ? input.userId : null,
				scheduledFireTime:
					triggerSource === "scheduled"
						? (input.scheduledFireTime ?? now)
						: null,
				queuedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		if (!run) {
			throw new Error("Automation Run could not be created.");
		}

		await transaction.insert(runSteps).values({
			runId: run.id,
			ownerType: run.ownerType,
			ownerId: run.ownerId,
			type: "message",
			summary:
				triggerSource === "manual"
					? "Automation Run queued from Run now."
					: "Automation Run queued from its schedule.",
			visibleToUser: true,
			redactedMetadata: {
				automationId: automation.id,
				automationVersionId: version.id,
				triggerSource,
			},
			occurredAt: now,
			createdAt: now,
		});

		return {
			run: {
				id: run.id,
				automationId: automation.id,
				automationVersionId: version.id,
				state: run.state,
				title: run.title,
				triggerSource,
				temporalWorkflowId: run.temporalWorkflowId,
				temporalRunId: run.temporalRunId,
				createdAt: run.createdAt.toISOString(),
			},
			workflow: {
				ownerScope: {
					ownerType: automation.ownerType,
					ownerId: automation.ownerId,
				},
				conversationId: briefRow.brief.conversationId,
				runBriefVersionId: briefRow.version.id,
				automationId: automation.id,
				automationVersionId: version.id,
				runBudget,
				requiredToolUnavailable:
					structuredBrief.unavailableRequiredToolBehavior ??
					"retry_then_partial",
			},
		};
	});

	return result;
};

export const createScheduledAutomationRun = async (input: {
	automationId: string;
	automationVersionId: string;
	scheduledFireTime?: Date | null;
}) => {
	const [automation] = await getDatabase()
		.select()
		.from(automations)
		.where(eq(automations.id, input.automationId))
		.limit(1);
	if (
		!automation ||
		automation.currentVersionId !== input.automationVersionId ||
		!automation.createdByUserId
	) {
		return conflict("Scheduled Automation Version is no longer current.");
	}

	return createAutomationRunNow({
		userId: automation.createdByUserId,
		automationId: automation.id,
		triggerSource: "scheduled",
		scheduledFireTime: input.scheduledFireTime,
	});
};

export const setAutomationTemporalScheduleId = async (input: {
	automationId: string;
	automationVersionId: string;
	temporalScheduleId: string | null;
	schedule: ScheduleDraft;
}) => {
	const now = new Date();
	await getDatabase().transaction(async (transaction) => {
		await transaction
			.update(automations)
			.set({
				temporalScheduleId: input.temporalScheduleId,
				updatedAt: now,
			})
			.where(eq(automations.id, input.automationId));
		await transaction
			.update(automationVersions)
			.set({
				scheduleRule: input.schedule.rule,
				scheduleTimezone: input.schedule.timezone,
				scheduleConfig: input.schedule,
				updatedAt: now,
			})
			.where(eq(automationVersions.id, input.automationVersionId));
	});
};

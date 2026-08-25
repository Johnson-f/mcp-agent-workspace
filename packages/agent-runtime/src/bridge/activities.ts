import {
	appendBridgeAuditEvent,
	appendBridgeRunStep,
	createScheduledAutomationRun,
	finishBridgeRun,
	getBridgeRun,
	getBridgeRunBriefVersion,
	getMcpGatewayToolCallContextForBridge,
	listApprovedBridgeToolAuthorizationDetails,
	markBridgeRunRunning,
	PostgresEncryptedArtifactStorage,
	updateRunTemporalIdentity,
	type ArtifactPurpose,
} from "@agents/db";
import {
	enforceMcpGatewayToolCall,
	executeRuntimeMcpTool,
} from "@agents/mcp-gateway";
import type {
	ArtifactWriteActivityInput,
	BudgetReachedActivityInput,
	BridgeFailure,
	BridgeFailureCode,
	BridgeStepResult,
	BudgetUsageDelta,
	CheckpointSaveActivityInput,
	GraphAdvanceActivityInput,
	GraphAdvanceActivityResult,
	McpToolCallActivityInput,
	ModelCallActivityInput,
	RunStepPersistActivityInput,
	RunWorkflowInput,
} from "./types";
import { zeroBudgetUsageDelta } from "./types";
import {
	decideNextAgentOperation,
	type AgentGraphPhase,
	type CompletedToolCallState,
	type ModelIntent,
	type PendingToolCallState,
} from "./agent-graph";
import { executeTextModel } from "./model-provider";

type JsonRecord = Record<string, unknown>;

export interface ScheduledAutomationTriggerInput {
	automationId: string;
	automationVersionId: string;
}

export type ScheduledAutomationPreparation =
	| { status: "skipped"; reason: string }
	| { status: "started"; workflowInput: RunWorkflowInput };

export async function prepareScheduledAutomationRun(
	input: ScheduledAutomationTriggerInput,
): Promise<ScheduledAutomationPreparation> {
	const created = await createScheduledAutomationRun({
		automationId: input.automationId,
		automationVersionId: input.automationVersionId,
		scheduledFireTime: new Date(),
	});
	if ("_tag" in created) {
		return { status: "skipped", reason: created.message };
	}

	return {
		status: "started",
		workflowInput: {
			schemaVersion: "run-workflow-input.v1",
			runId: created.run.id,
			kind: "automation",
			ownerScope: created.workflow.ownerScope,
			conversationId: created.workflow.conversationId,
			runBriefVersionId: created.workflow.runBriefVersionId,
			automationId: created.workflow.automationId,
			automationVersionId: created.workflow.automationVersionId,
			startedByUserId: null,
			triggerSource: "scheduled",
			runBudget: created.workflow.runBudget,
			executionPolicy: {
				allowWaitingForUser: false,
				allowUnapprovedTools: false,
				requiredToolUnavailable: created.workflow.requiredToolUnavailable,
				optionalToolUnavailable: "continue_degraded",
			},
			modelExecutionProfile: {
				provider: "openai",
				model: process.env.OPENAI_MODEL ?? "gpt-5.5",
				settingsArtifactId: null,
				toolPolicyVersion: "tool-policy.v1",
			},
			initialCheckpointId: null,
		},
	};
}

export async function persistScheduledRunTemporalIdentity(input: {
	runId: string;
	temporalWorkflowId: string;
	temporalRunId: string;
}) {
	await updateRunTemporalIdentity(input);
}

interface BridgeCheckpointState {
	schemaVersion: "agent-bridge-checkpoint.v1";
	phase: AgentGraphPhase;
	runId: string;
	runBriefVersionId: string;
	promptArtifactIds: string[];
	approvedToolAuthorizationSnapshotIds: string[];
	modelIntent: ModelIntent | null;
	pendingToolCall: PendingToolCallState | null;
	completedToolCalls: CompletedToolCallState[];
	modelOutputArtifactIds: string[];
	finalArtifactIds: string[];
	finalRunStepId: string | null;
	updatedAt: string;
}

const artifactStorage = new PostgresEncryptedArtifactStorage();
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const bridgeFailure = (
	code: BridgeFailureCode,
	message: string,
	retryable = false,
): BridgeFailure => ({
	code,
	message,
	retryable,
});

const bridgeResult = (
	input: { runId: string; checkpointId: string | null },
	overrides: Partial<Omit<BridgeStepResult, "schemaVersion" | "runId">> = {},
): BridgeStepResult => ({
	schemaVersion: "bridge-step-result.v1",
	status: "advanced",
	runId: input.runId,
	runStepId: null,
	artifactIds: [],
	checkpointId: input.checkpointId,
	budgetUsageDelta: zeroBudgetUsageDelta(),
	failure: null,
	...overrides,
});

const failedResult = (
	input: { runId: string; checkpointId: string | null },
	code: BridgeFailureCode,
	message: string,
	retryable = false,
): BridgeStepResult =>
	bridgeResult(input, {
		status: retryable ? "retryable_failed" : "non_retryable_failed",
		failure: bridgeFailure(code, message, retryable),
	});

const finishRunFailed = async (
	input: { runId: string },
	failure: BridgeFailure,
	finalRunStepId: string | null = null,
) => {
	await finishBridgeRun({
		runId: input.runId,
		state: "failed",
		finalRunStepId,
		finalArtifactIds: [],
		budgetUsage: { ...zeroBudgetUsageDelta() },
		failure: { ...failure },
	}).catch(() => undefined);
};

const toJsonPayload = (value: unknown) => JSON.stringify(value, null, 2);

const jsonByteLength = (value: string) => textEncoder.encode(value).byteLength;

const readArtifactText = async (artifactId: string) =>
	textDecoder.decode(await artifactStorage.readArtifactPayload(artifactId));

const readJsonArtifact = async <T>(artifactId: string): Promise<T> =>
	JSON.parse(await readArtifactText(artifactId)) as T;

const createArtifact = async (input: {
	ownerScope: { ownerType: "user" | "workspace"; ownerId: string };
	runId: string;
	purpose: ArtifactPurpose;
	payload: string;
	redactedSummary: JsonRecord;
	sensitivity?: "low" | "sensitive" | "restricted";
	contentType?: string;
}) =>
	artifactStorage.createArtifact({
		owner: input.ownerScope,
		runId: input.runId,
		purpose: input.purpose,
		sensitivity: input.sensitivity ?? "sensitive",
		payload: input.payload,
		redactedSummary: input.redactedSummary,
		contentType: input.contentType ?? "application/json",
	});

const saveCheckpointArtifact = async (input: {
	ownerScope: { ownerType: "user" | "workspace"; ownerId: string };
	runId: string;
	state: BridgeCheckpointState;
}) => {
	const artifact = await createArtifact({
		ownerScope: input.ownerScope,
		runId: input.runId,
		purpose: "checkpoint_state",
		payload: toJsonPayload(input.state),
		redactedSummary: {
			schemaVersion: input.state.schemaVersion,
			phase: input.state.phase,
			runBriefVersionId: input.state.runBriefVersionId,
			promptArtifactCount: input.state.promptArtifactIds.length,
			finalArtifactCount: input.state.finalArtifactIds.length,
		},
		sensitivity: "low",
	});

	return artifact.id;
};

const buildCheckpoint = (input: {
	phase: AgentGraphPhase;
	runId: string;
	runBriefVersionId: string;
	promptArtifactIds?: string[];
	approvedToolAuthorizationSnapshotIds?: string[];
	modelIntent?: ModelIntent | null;
	pendingToolCall?: PendingToolCallState | null;
	completedToolCalls?: CompletedToolCallState[];
	modelOutputArtifactIds?: string[];
	finalArtifactIds?: string[];
	finalRunStepId?: string | null;
}): BridgeCheckpointState => ({
	schemaVersion: "agent-bridge-checkpoint.v1",
	phase: input.phase,
	runId: input.runId,
	runBriefVersionId: input.runBriefVersionId,
	promptArtifactIds: input.promptArtifactIds ?? [],
	approvedToolAuthorizationSnapshotIds:
		input.approvedToolAuthorizationSnapshotIds ?? [],
	modelIntent: input.modelIntent ?? null,
	pendingToolCall: input.pendingToolCall ?? null,
	completedToolCalls: input.completedToolCalls ?? [],
	modelOutputArtifactIds: input.modelOutputArtifactIds ?? [],
	finalArtifactIds: input.finalArtifactIds ?? [],
	finalRunStepId: input.finalRunStepId ?? null,
	updatedAt: new Date().toISOString(),
});

const loadCheckpoint = async (
	checkpointId: string,
): Promise<BridgeCheckpointState> =>
	readJsonArtifact<BridgeCheckpointState>(checkpointId);

const loadApprovedBriefForRun = async (
	input: Pick<
		GraphAdvanceActivityInput,
		"runId" | "runBriefVersionId" | "ownerScope"
	>,
) => {
	const run = await getBridgeRun(input.runId);
	if (!run) {
		throw new Error("Run not found.");
	}
	if (
		run.ownerType !== input.ownerScope.ownerType ||
		run.ownerId !== input.ownerScope.ownerId
	) {
		throw new Error("Run owner scope does not match Workflow input.");
	}

	const row = await getBridgeRunBriefVersion(input.runBriefVersionId);
	if (!row) {
		throw new Error("Run Brief Version not found.");
	}
	if (row.version.state !== "approved") {
		throw new Error("Run Brief Version must be approved before execution.");
	}
	if (
		row.brief.ownerType !== input.ownerScope.ownerType ||
		row.brief.ownerId !== input.ownerScope.ownerId
	) {
		throw new Error("Run Brief owner scope does not match Workflow input.");
	}

	return row;
};

export const buildModelPrompt = (input: {
	runId: string;
	structuredBrief: JsonRecord;
	approvedTools: Array<{
		id: string;
		mcpConnectionId: string | null;
		mcpToolId: string | null;
		toolName: string;
		description: string | null;
		inputSchema: JsonRecord | null;
		required: boolean;
		reason: string;
		writeCapable: boolean;
		allowedOutcomeBoundary: string | null;
	}>;
	completedToolResults?: Array<{
		toolCallId: string;
		toolName: string;
		resultArtifactId: string;
		payload: string;
	}>;
	intent: ModelIntent;
}) =>
	[
		"You are executing an approved Agent Run.",
		"Use only the approved Run Brief and approved MCP tools represented below.",
		"Never invent tool results. If current evidence is required and a required approved tool has not been used, request that exact tool.",
		"Never include internal identifiers in finish_run output, including run, workflow, authorization, artifact, tool-call, account, watchlist, or raw UUID values.",
		"Choose exactly one provided decision function and return no extra prose.",
		input.intent === "tool_decision"
			? "Call call_approved_tool to gather required evidence, or finish_run only after every required tool has been used."
			: "Call finish_run with sections: Evidence, Summary, Interpretation, Follow-up.",
		"",
		"Approved Run Brief JSON:",
		toJsonPayload(input.structuredBrief),
		"",
		"Approved Tool Authorization Snapshots:",
		toJsonPayload(
			input.approvedTools.map((tool) => ({
				id: tool.id,
				mcpConnectionId: tool.mcpConnectionId,
				mcpToolId: tool.mcpToolId,
				toolName: tool.toolName,
				description: tool.description,
				inputSchema: tool.inputSchema,
				required: tool.required,
				writeCapable: tool.writeCapable,
				allowedOutcomeBoundary: tool.allowedOutcomeBoundary,
				reason: tool.reason,
			})),
		),
		"",
		"Completed Tool Result Artifacts:",
		toJsonPayload(input.completedToolResults ?? []),
	].join("\n");

type ModelDecision =
	| {
			action: "call_tool";
			toolAuthorizationSnapshotId: string;
			arguments: JsonRecord;
			reason: string;
	  }
	| {
			action: "final";
			finalAnswer: string;
	  };

const jsonFromModelText = (text: string): unknown => {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return JSON.parse(fenced?.[1] ?? trimmed);
};

const parseModelDecision = (text: string): ModelDecision => {
	const parsed = jsonFromModelText(text);

	if (!parsed || typeof parsed !== "object") {
		throw new Error("Model decision must be a JSON object.");
	}

	const value = parsed as Record<string, unknown>;
	if (
		value.action === "call_tool" &&
		typeof value.toolAuthorizationSnapshotId === "string" &&
		value.arguments &&
		typeof value.arguments === "object" &&
		!Array.isArray(value.arguments) &&
		typeof value.reason === "string"
	) {
		return {
			action: "call_tool",
			toolAuthorizationSnapshotId: value.toolAuthorizationSnapshotId,
			arguments: value.arguments as JsonRecord,
			reason: value.reason,
		};
	}

	if (value.action === "final" && typeof value.finalAnswer === "string") {
		return {
			action: "final",
			finalAnswer: value.finalAnswer,
		};
	}

	throw new Error(
		"Model decision must be either a call_tool action with arguments or a final action with finalAnswer.",
	);
};

const callApprovedToolDecision = {
	name: "call_approved_tool",
	description:
		"Select one approved MCP tool for the next step of this Run. Use only an authorization snapshot ID supplied in the prompt.",
	strict: false,
	parameters: {
		type: "object",
		additionalProperties: false,
		required: ["toolAuthorizationSnapshotId", "arguments", "reason"],
		properties: {
			toolAuthorizationSnapshotId: { type: "string" },
			arguments: { type: "object", additionalProperties: true },
			reason: { type: "string" },
		},
	},
};

const finishRunDecision = {
	name: "finish_run",
	description:
		"Finish the Run after all required approved tools have been used and provide the final user-facing answer.",
	strict: false,
	parameters: {
		type: "object",
		additionalProperties: false,
		required: ["finalAnswer"],
		properties: { finalAnswer: { type: "string" } },
	},
};

export const parseModelDecisionFromResult = (input: {
	text: string;
	functionCalls: Array<{
		name: string;
		callId?: string;
		arguments: Record<string, unknown>;
	}>;
}): ModelDecision => {
	const recognized = input.functionCalls.filter(
		(call) =>
			call.name === callApprovedToolDecision.name ||
			call.name === finishRunDecision.name,
	);
	if (recognized.length > 1) {
		throw new Error("Model must choose exactly one Run decision.");
	}
	const call = recognized[0];
	if (call?.name === callApprovedToolDecision.name) {
		return parseModelDecision(
			JSON.stringify({ action: "call_tool", ...call.arguments }),
		);
	}
	if (call?.name === finishRunDecision.name) {
		return parseModelDecision(
			JSON.stringify({ action: "final", ...call.arguments }),
		);
	}
	return parseModelDecision(input.text);
};

const decisionToolsForIntent = (intent: ModelIntent) =>
	intent === "tool_decision"
		? [callApprovedToolDecision, finishRunDecision]
		: [finishRunDecision];

const defaultValueForSchema = (schema: unknown): unknown => {
	if (!schema || typeof schema !== "object") {
		return undefined;
	}

	const record = schema as Record<string, unknown>;
	if ("default" in record) {
		return record.default;
	}
	if ("const" in record) {
		return record.const;
	}
	if (Array.isArray(record.enum) && record.enum.length > 0) {
		return record.enum[0];
	}

	switch (record.type) {
		case "string":
			return undefined;
		case "number":
		case "integer":
			return undefined;
		case "boolean":
			return undefined;
		case "array":
			return [];
		case "object":
			return {};
		default:
			return undefined;
	}
};

const synthesizeSafeToolArguments = (
	inputSchema: JsonRecord | null,
): JsonRecord | null => {
	if (!inputSchema) {
		return {};
	}

	if (inputSchema.type !== "object" && inputSchema.properties === undefined) {
		return {};
	}

	const required = Array.isArray(inputSchema.required)
		? inputSchema.required.filter(
				(item): item is string => typeof item === "string",
			)
		: [];
	const properties =
		inputSchema.properties &&
		typeof inputSchema.properties === "object" &&
		!Array.isArray(inputSchema.properties)
			? (inputSchema.properties as Record<string, unknown>)
			: {};
	const args: JsonRecord = {};

	for (const key of required) {
		const value = defaultValueForSchema(properties[key]);
		if (value === undefined) {
			return null;
		}
		args[key] = value;
	}

	return args;
};

const fallbackModelDecisionText = (input: {
	intent: ModelIntent;
	approvedTools: Array<{
		id: string;
		required: boolean;
		toolName: string;
		inputSchema: JsonRecord | null;
	}>;
	completedToolCalls: CompletedToolCallState[];
}) => {
	if (input.intent === "tool_decision") {
		const alreadyUsed = new Set(
			input.completedToolCalls.map((call) => call.toolAuthorizationSnapshotId),
		);
		const candidate =
			input.approvedTools.find(
				(tool) => tool.required && !alreadyUsed.has(tool.id),
			) ?? input.approvedTools.find((tool) => !alreadyUsed.has(tool.id));
		if (candidate) {
			const args = synthesizeSafeToolArguments(candidate.inputSchema);
			if (args) {
				return toJsonPayload({
					action: "call_tool",
					toolAuthorizationSnapshotId: candidate.id,
					arguments: args,
					reason:
						"OPENAI_API_KEY is not configured, so the deterministic fallback selected the first approved tool with safely derivable arguments.",
				});
			}
		}
	}

	return toJsonPayload({
		action: "final",
		finalAnswer:
			"Evidence\n- OPENAI_API_KEY is not configured for the Temporal worker.\n- The approved Run Brief was loaded and the LangGraph/Temporal loop executed with deterministic fallback behavior.\n\nSummary\nThe run completed without a live model-generated answer.\n\nInterpretation\nThis verifies durable graph routing, checkpointing, artifacts, and Run Steps, but not live model quality.\n\nFollow-up\nSet OPENAI_API_KEY and optionally OPENAI_MODEL, then rerun this Agent Run.",
	});
};

const requiredToolsSatisfied = (
	approvedTools: Array<{ id: string; required: boolean }>,
	completedToolCalls: Array<{ toolAuthorizationSnapshotId: string }>,
) => {
	if (!approvedTools.some((tool) => tool.required)) {
		return true;
	}

	const completedSnapshotIds = new Set(
		completedToolCalls.map((call) => call.toolAuthorizationSnapshotId),
	);
	return approvedTools
		.filter((tool) => tool.required)
		.every((tool) => completedSnapshotIds.has(tool.id));
};

export const nextModelIntentAfterTool = (
	approvedTools: Array<{ id: string; required: boolean }>,
	completedToolCalls: Array<{ toolAuthorizationSnapshotId: string }>,
): ModelIntent =>
	requiredToolsSatisfied(approvedTools, completedToolCalls)
		? "final_output"
		: "tool_decision";

const firstLine = (text: string) =>
	text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean)
		?.slice(0, 220) ?? "Agent Run produced a final output.";

const toApprovedToolDetails = (
	rows: Awaited<ReturnType<typeof listApprovedBridgeToolAuthorizationDetails>>,
) =>
	rows.map(({ authorization, tool }) => ({
		id: authorization.id,
		mcpConnectionId: authorization.mcpConnectionId,
		mcpToolId: authorization.mcpToolId,
		toolName: authorization.toolName,
		description: tool?.description ?? null,
		inputSchema: tool?.inputSchema ?? null,
		required: authorization.required,
		reason: authorization.reason,
		writeCapable: authorization.writeCapable,
		allowedOutcomeBoundary: authorization.allowedOutcomeBoundary,
	}));

const createModelPromptArtifact = async (input: {
	ownerScope: { ownerType: "user" | "workspace"; ownerId: string };
	runId: string;
	runBriefVersionId: string;
	structuredBrief: JsonRecord;
	approvedTools: ReturnType<typeof toApprovedToolDetails>;
	completedToolCalls: CompletedToolCallState[];
	intent: ModelIntent;
}) => {
	const completedToolResults = await Promise.all(
		input.completedToolCalls.map(async (toolCall) => ({
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			resultArtifactId: toolCall.resultArtifactId,
			payload: await readArtifactText(toolCall.resultArtifactId),
		})),
	);
	const prompt = buildModelPrompt({
		runId: input.runId,
		structuredBrief: input.structuredBrief,
		approvedTools: input.approvedTools,
		completedToolResults,
		intent: input.intent,
	});

	return createArtifact({
		ownerScope: input.ownerScope,
		runId: input.runId,
		purpose: "model_prompt",
		payload: prompt,
		contentType: "text/plain",
		redactedSummary: {
			runBriefVersionId: input.runBriefVersionId,
			approvedToolCount: input.approvedTools.length,
			completedToolCallCount: input.completedToolCalls.length,
			intent: input.intent,
			promptBytes: jsonByteLength(prompt),
		},
	});
};

export async function advanceGraph(
	input: GraphAdvanceActivityInput,
): Promise<GraphAdvanceActivityResult> {
	try {
		await markBridgeRunRunning(input.runId);
		const row = await loadApprovedBriefForRun(input);

		if (!input.checkpointId) {
			return {
				...bridgeResult(input),
				durableOperation: {
					kind: "run_step_persist",
					runStepType: "message",
					summary: "Agent Run started from approved Run Brief.",
					relatedArtifactIds: [],
					redactedMetadata: {
						runBriefVersionId: input.runBriefVersionId,
						runBriefVersionNumber: row.version.versionNumber,
					},
				},
			};
		}

		const checkpoint = await loadCheckpoint(input.checkpointId);
		if (checkpoint.phase === "intro_recorded") {
			const approvedToolRows = await listApprovedBridgeToolAuthorizationDetails(
				input.runBriefVersionId,
			);
			const approvedTools = toApprovedToolDetails(approvedToolRows);
			const promptArtifact = await createModelPromptArtifact({
				ownerScope: input.ownerScope,
				runId: input.runId,
				runBriefVersionId: input.runBriefVersionId,
				structuredBrief: row.version.structuredBrief,
				approvedTools,
				completedToolCalls: [],
				intent: "tool_decision",
			});
			const checkpointId = await saveCheckpointArtifact({
				ownerScope: input.ownerScope,
				runId: input.runId,
				state: buildCheckpoint({
					phase: "model_prompt_created",
					runId: input.runId,
					runBriefVersionId: input.runBriefVersionId,
					promptArtifactIds: [promptArtifact.id],
					approvedToolAuthorizationSnapshotIds: approvedTools.map(
						(tool) => tool.id,
					),
					modelIntent: "tool_decision",
				}),
			});
			const operation = await decideNextAgentOperation({
				phase: "model_prompt_created",
				runId: input.runId,
				promptArtifactIds: [promptArtifact.id],
				approvedToolAuthorizationSnapshotIds: approvedTools.map(
					(tool) => tool.id,
				),
				modelIntent: "tool_decision",
				pendingToolCall: null,
				completedToolCalls: [],
				finalArtifactIds: [],
				finalRunStepId: null,
			});

			return {
				...bridgeResult(input, {
					artifactIds: [promptArtifact.id],
					checkpointId,
				}),
				durableOperation: operation,
			};
		}

		if (checkpoint.phase === "model_prompt_created") {
			const operation = await decideNextAgentOperation({
				phase: checkpoint.phase,
				runId: input.runId,
				promptArtifactIds: checkpoint.promptArtifactIds,
				approvedToolAuthorizationSnapshotIds:
					checkpoint.approvedToolAuthorizationSnapshotIds,
				modelIntent: checkpoint.modelIntent,
				pendingToolCall: checkpoint.pendingToolCall,
				completedToolCalls: checkpoint.completedToolCalls,
				finalArtifactIds: checkpoint.finalArtifactIds,
				finalRunStepId: checkpoint.finalRunStepId,
			});
			return {
				...bridgeResult(input),
				durableOperation: operation,
			};
		}

		if (checkpoint.phase === "model_decision_recorded") {
			const operation = await decideNextAgentOperation({
				phase: checkpoint.phase,
				runId: input.runId,
				promptArtifactIds: checkpoint.promptArtifactIds,
				approvedToolAuthorizationSnapshotIds:
					checkpoint.approvedToolAuthorizationSnapshotIds,
				modelIntent: checkpoint.modelIntent,
				pendingToolCall: checkpoint.pendingToolCall,
				completedToolCalls: checkpoint.completedToolCalls,
				finalArtifactIds: checkpoint.finalArtifactIds,
				finalRunStepId: checkpoint.finalRunStepId,
			});
			return {
				...bridgeResult(input),
				durableOperation: operation,
			};
		}

		if (checkpoint.phase === "tool_completed") {
			const approvedToolRows = await listApprovedBridgeToolAuthorizationDetails(
				input.runBriefVersionId,
			);
			const approvedTools = toApprovedToolDetails(approvedToolRows);
			const nextIntent = nextModelIntentAfterTool(
				approvedTools,
				checkpoint.completedToolCalls,
			);
			const promptArtifact = await createModelPromptArtifact({
				ownerScope: input.ownerScope,
				runId: input.runId,
				runBriefVersionId: input.runBriefVersionId,
				structuredBrief: row.version.structuredBrief,
				approvedTools,
				completedToolCalls: checkpoint.completedToolCalls,
				intent: nextIntent,
			});
			const checkpointId = await saveCheckpointArtifact({
				ownerScope: input.ownerScope,
				runId: input.runId,
				state: buildCheckpoint({
					phase: "model_prompt_created",
					runId: input.runId,
					runBriefVersionId: input.runBriefVersionId,
					promptArtifactIds: [promptArtifact.id],
					approvedToolAuthorizationSnapshotIds:
						checkpoint.approvedToolAuthorizationSnapshotIds,
					modelIntent: nextIntent,
					completedToolCalls: checkpoint.completedToolCalls,
					modelOutputArtifactIds: checkpoint.modelOutputArtifactIds,
				}),
			});
			const operation = await decideNextAgentOperation({
				phase: "model_prompt_created",
				runId: input.runId,
				promptArtifactIds: [promptArtifact.id],
				approvedToolAuthorizationSnapshotIds:
					checkpoint.approvedToolAuthorizationSnapshotIds,
				modelIntent: nextIntent,
				pendingToolCall: null,
				completedToolCalls: checkpoint.completedToolCalls,
				finalArtifactIds: [],
				finalRunStepId: null,
			});

			return {
				...bridgeResult(input, {
					artifactIds: [promptArtifact.id],
					checkpointId,
				}),
				durableOperation: operation,
			};
		}

		return {
			...bridgeResult(input, {
				status: "completed",
				runStepId: checkpoint.finalRunStepId,
				artifactIds: checkpoint.finalArtifactIds,
			}),
			durableOperation: null,
		};
	} catch (error) {
		const failure = bridgeFailure(
			"checkpoint_unavailable",
			error instanceof Error
				? error.message
				: "Graph advancement could not load required execution state.",
		);
		await finishRunFailed(input, failure);
		return {
			...failedResult(input, "checkpoint_unavailable", failure.message),
			durableOperation: null,
		};
	}
}

export async function executeModelCall(
	input: ModelCallActivityInput,
): Promise<BridgeStepResult> {
	const startedAt = performance.now();
	try {
		if (!input.checkpointId) {
			throw new Error("Model call requires a checkpoint.");
		}

		const checkpoint = await loadCheckpoint(input.checkpointId);
		const approvedToolRows = await listApprovedBridgeToolAuthorizationDetails(
			checkpoint.runBriefVersionId,
		);
		const approvedTools = toApprovedToolDetails(approvedToolRows).filter(
			(tool) => input.allowedToolAuthorizationSnapshotIds.includes(tool.id),
		);
		const prompt = (
			await Promise.all(input.promptArtifactIds.map(readArtifactText))
		).join("\n\n");
		const modelOutput = await executeTextModel({
			provider: input.modelExecutionProfile.provider,
			model: input.modelExecutionProfile.model,
			prompt,
			fallbackText: fallbackModelDecisionText({
				intent: checkpoint.modelIntent ?? "final_output",
				approvedTools,
				completedToolCalls: checkpoint.completedToolCalls,
			}),
			instructions:
				"Choose exactly one supplied decision function. Never select an unapproved tool authorization snapshot ID.",
			tools: decisionToolsForIntent(
				checkpoint.modelIntent ?? "final_output",
			),
		});
		const decision = parseModelDecisionFromResult(modelOutput);
		const modelOutputPayload = {
			schemaVersion: "model-output-artifact.v1",
			provider: input.modelExecutionProfile.provider,
			model: process.env.OPENAI_MODEL ?? input.modelExecutionProfile.model,
			providerResponseId: modelOutput.providerResponseId,
			fallback: modelOutput.fallback,
			authMode: modelOutput.authMode,
			decision,
		};
		const modelOutputArtifact = await createArtifact({
			ownerScope: input.ownerScope,
			runId: input.runId,
			purpose: "model_output",
			payload: toJsonPayload(modelOutputPayload),
			redactedSummary: {
				provider: input.modelExecutionProfile.provider,
				model: process.env.OPENAI_MODEL ?? input.modelExecutionProfile.model,
				providerResponseId: modelOutput.providerResponseId,
				fallback: modelOutput.fallback,
				authMode: modelOutput.authMode,
				action: decision.action,
				outputBytes: jsonByteLength(modelOutput.text),
			},
		});
		const delta: BudgetUsageDelta = {
			...zeroBudgetUsageDelta(),
			llmSteps: 1,
			runtimeMs: Math.max(0, Math.round(performance.now() - startedAt)),
			outputBytes: jsonByteLength(modelOutput.text),
			promptTokens: modelOutput.promptTokens,
			completionTokens: modelOutput.completionTokens,
		};

		if (decision.action === "call_tool") {
			const selectedTool = approvedTools.find(
				(tool) => tool.id === decision.toolAuthorizationSnapshotId,
			);
			if (!selectedTool?.mcpConnectionId || !selectedTool.mcpToolId) {
				throw new Error(
					"Model selected a tool that is not approved for this Run.",
				);
			}

			const argumentsArtifact = await createArtifact({
				ownerScope: input.ownerScope,
				runId: input.runId,
				purpose: "tool_arguments",
				payload: toJsonPayload(decision.arguments),
				redactedSummary: {
					toolAuthorizationSnapshotId: selectedTool.id,
					toolName: selectedTool.toolName,
					argumentKeys: Object.keys(decision.arguments).sort(),
				},
			});
			const runStep = await appendBridgeRunStep({
				runId: input.runId,
				ownerScope: input.ownerScope,
				type: "tool_selected",
				summary: `Model selected approved MCP tool ${selectedTool.toolName}.`,
				relatedArtifactIds: [modelOutputArtifact.id, argumentsArtifact.id],
				redactedMetadata: {
					modelCallId: input.modelCallId,
					toolAuthorizationSnapshotId: selectedTool.id,
					toolName: selectedTool.toolName,
					reason: decision.reason,
					fallback: modelOutput.fallback,
					authMode: modelOutput.authMode,
				},
			});
			const pendingToolCall: PendingToolCallState = {
				toolCallId: `${input.runId}:tool:${selectedTool.id}:${checkpoint.completedToolCalls.length}`,
				mcpConnectionId: selectedTool.mcpConnectionId,
				mcpToolId: selectedTool.mcpToolId,
				toolAuthorizationSnapshotId: selectedTool.id,
				argumentsArtifactId: argumentsArtifact.id,
				toolName: selectedTool.toolName,
			};
			const checkpointId = await saveCheckpointArtifact({
				ownerScope: input.ownerScope,
				runId: input.runId,
				state: buildCheckpoint({
					phase: "model_decision_recorded",
					runId: input.runId,
					runBriefVersionId: checkpoint.runBriefVersionId,
					promptArtifactIds: input.promptArtifactIds,
					approvedToolAuthorizationSnapshotIds:
						checkpoint.approvedToolAuthorizationSnapshotIds,
					modelIntent: checkpoint.modelIntent,
					pendingToolCall,
					completedToolCalls: checkpoint.completedToolCalls,
					modelOutputArtifactIds: [
						...checkpoint.modelOutputArtifactIds,
						modelOutputArtifact.id,
					],
				}),
			});

			return bridgeResult(input, {
				runStepId: runStep.id,
				artifactIds: [modelOutputArtifact.id, argumentsArtifact.id],
				checkpointId,
				budgetUsageDelta: delta,
			});
		}

		if (
			checkpoint.modelIntent === "tool_decision" &&
			!requiredToolsSatisfied(approvedTools, checkpoint.completedToolCalls)
		) {
			throw new Error(
				"Model attempted to finalize before required approved tools were used.",
			);
		}

		const finalPayload = {
			schemaVersion: "final-output-artifact.v1",
			provider: input.modelExecutionProfile.provider,
			model: process.env.OPENAI_MODEL ?? input.modelExecutionProfile.model,
			providerResponseId: modelOutput.providerResponseId,
			fallback: modelOutput.fallback,
			authMode: modelOutput.authMode,
			text: decision.finalAnswer,
			modelOutputArtifactId: modelOutputArtifact.id,
		};
		const outputArtifact = await createArtifact({
			ownerScope: input.ownerScope,
			runId: input.runId,
			purpose: "final_output",
			payload: toJsonPayload(finalPayload),
			redactedSummary: {
				provider: input.modelExecutionProfile.provider,
				model: process.env.OPENAI_MODEL ?? input.modelExecutionProfile.model,
				providerResponseId: modelOutput.providerResponseId,
				fallback: modelOutput.fallback,
				authMode: modelOutput.authMode,
				outputBytes: jsonByteLength(decision.finalAnswer),
				modelOutputArtifactId: modelOutputArtifact.id,
			},
		});
		const runStep = await appendBridgeRunStep({
			runId: input.runId,
			ownerScope: input.ownerScope,
			type: "final_output",
			summary: firstLine(decision.finalAnswer),
			relatedArtifactIds: [modelOutputArtifact.id, outputArtifact.id],
			redactedMetadata: {
				modelCallId: input.modelCallId,
				promptArtifactIds: input.promptArtifactIds,
				completedToolCallCount: checkpoint.completedToolCalls.length,
				fallback: modelOutput.fallback,
				authMode: modelOutput.authMode,
			},
		});
		const checkpointId = await saveCheckpointArtifact({
			ownerScope: input.ownerScope,
			runId: input.runId,
			state: buildCheckpoint({
				phase: "completed",
				runId: input.runId,
				runBriefVersionId: checkpoint.runBriefVersionId,
				promptArtifactIds: input.promptArtifactIds,
				approvedToolAuthorizationSnapshotIds:
					checkpoint.approvedToolAuthorizationSnapshotIds,
				modelIntent: "final_output",
				completedToolCalls: checkpoint.completedToolCalls,
				modelOutputArtifactIds: [
					...checkpoint.modelOutputArtifactIds,
					modelOutputArtifact.id,
				],
				finalArtifactIds: [outputArtifact.id],
				finalRunStepId: runStep.id,
			}),
		});

		await finishBridgeRun({
			runId: input.runId,
			state: "completed",
			finalRunStepId: runStep.id,
			finalArtifactIds: [outputArtifact.id],
			budgetUsage: { ...delta },
			failure: null,
		});

		return bridgeResult(input, {
			status: "completed",
			runStepId: runStep.id,
			artifactIds: [outputArtifact.id],
			checkpointId,
			budgetUsageDelta: delta,
		});
	} catch (error) {
		const failure = bridgeFailure(
			"model_call_failed",
			error instanceof Error ? error.message : "Model call failed.",
			false,
		);
		await appendBridgeRunStep({
			runId: input.runId,
			ownerScope: input.ownerScope,
			type: "run_failed",
			summary: failure.message,
			redactedMetadata: {
				modelCallId: input.modelCallId,
				code: failure.code,
			},
		}).catch(() => undefined);
		await finishRunFailed(input, failure);

		return failedResult(input, "model_call_failed", failure.message);
	}
}

export async function executeMcpToolCall(
	input: McpToolCallActivityInput,
): Promise<BridgeStepResult> {
	const startedAt = performance.now();
	try {
		const toolArguments = await readJsonArtifact<JsonRecord>(
			input.argumentsArtifactId,
		);
		const context = await getMcpGatewayToolCallContextForBridge({
			ownerScope: input.ownerScope,
			mcpConnectionId: input.mcpConnectionId,
			mcpToolId: input.mcpToolId,
			toolAuthorizationSnapshotId: input.toolAuthorizationSnapshotId,
			idempotencyKey: input.idempotencyKey,
		});
		const decision = await enforceMcpGatewayToolCall(
			{
				schemaVersion: "mcp-gateway-tool-call-request.v1",
				runId: input.runId,
				ownerScope: input.ownerScope,
				toolCallId: input.toolCallId,
				idempotencyKey: input.idempotencyKey,
				mcpConnectionId: input.mcpConnectionId,
				mcpToolId: input.mcpToolId,
				toolAuthorizationSnapshotId: input.toolAuthorizationSnapshotId,
				argumentsArtifactId: input.argumentsArtifactId,
				arguments: toolArguments,
			},
			context,
		);

		await appendBridgeAuditEvent({
			ownerScope: decision.auditEvent.ownerScope,
			actorType: "system",
			eventName: decision.auditEvent.eventName,
			targetType: decision.auditEvent.targetType,
			targetId: decision.auditEvent.targetId,
			runId: input.runId,
			redactedMetadata: decision.auditEvent.redactedMetadata,
		});

		if (decision.status === "denied") {
			const step = decision.runStep
				? await appendBridgeRunStep({
						runId: input.runId,
						ownerScope: input.ownerScope,
						type: decision.runStep.type,
						summary: decision.runStep.summary,
						redactedMetadata: decision.runStep.redactedMetadata,
					})
				: null;
			await finishBridgeRun({
				runId: input.runId,
				state: "failed",
				finalRunStepId: step?.id ?? null,
				finalArtifactIds: [],
				budgetUsage: { ...zeroBudgetUsageDelta() },
				failure: {
					code: "tool_call_denied",
					message: decision.denial.message,
					retryable: false,
				},
			});

			return failedResult(input, "tool_call_denied", decision.denial.message);
		}

		if (decision.status === "replayed") {
			return bridgeResult(input, {
				artifactIds: decision.resultArtifactId
					? [decision.resultArtifactId]
					: [],
			});
		}

		const startedStep = decision.runStep
			? await appendBridgeRunStep({
					runId: input.runId,
					ownerScope: input.ownerScope,
					type: decision.runStep.type,
					summary: decision.runStep.summary,
					redactedMetadata: decision.runStep.redactedMetadata,
				})
			: null;
		const execution = await executeRuntimeMcpTool({
			mcpConnectionId: input.mcpConnectionId,
			mcpToolId: input.mcpToolId,
			arguments: toolArguments,
		});

		if (execution.status === "failed") {
			const step = await appendBridgeRunStep({
				runId: input.runId,
				ownerScope: input.ownerScope,
				type: "tool_call_failed",
				summary: execution.errorMessage,
				relatedArtifactIds: [input.argumentsArtifactId],
				redactedMetadata: {
					toolCallId: input.toolCallId,
					errorCode: execution.errorCode,
					startedRunStepId: startedStep?.id ?? null,
					...execution.redactedSummary,
				},
			});
			const failure = bridgeFailure("tool_call_failed", execution.errorMessage);
			await finishRunFailed(input, failure, step.id);

			return bridgeResult(input, {
				status: "non_retryable_failed",
				runStepId: step.id,
				budgetUsageDelta: {
					...zeroBudgetUsageDelta(),
					toolCalls: 1,
					runtimeMs: execution.durationMs,
				},
				failure,
			});
		}

		const resultArtifact = await createArtifact({
			ownerScope: input.ownerScope,
			runId: input.runId,
			purpose: "tool_result",
			payload: toJsonPayload({
				schemaVersion: "mcp-tool-result-artifact.v1",
				toolCallId: input.toolCallId,
				result: execution.result,
			}),
			redactedSummary: {
				toolCallId: input.toolCallId,
				toolName: decision.toolName,
				...execution.redactedSummary,
			},
		});
		const completedStep = await appendBridgeRunStep({
			runId: input.runId,
			ownerScope: input.ownerScope,
			type: "tool_call_completed",
			summary: `MCP tool ${decision.toolName} completed.`,
			relatedArtifactIds: [resultArtifact.id],
			redactedMetadata: {
				toolCallId: input.toolCallId,
				startedRunStepId: startedStep?.id ?? null,
				durationMs: execution.durationMs,
				resultArtifactId: resultArtifact.id,
			},
		});
		const checkpoint = input.checkpointId
			? await loadCheckpoint(input.checkpointId)
			: null;
		const completedToolCall: CompletedToolCallState = {
			toolCallId: input.toolCallId,
			toolName: decision.toolName,
			toolAuthorizationSnapshotId: input.toolAuthorizationSnapshotId,
			resultArtifactId: resultArtifact.id,
			completedRunStepId: completedStep.id,
		};
		const completedToolCalls = checkpoint
			? [...checkpoint.completedToolCalls, completedToolCall]
			: [completedToolCall];
		const approvedTools = checkpoint
			? toApprovedToolDetails(
					await listApprovedBridgeToolAuthorizationDetails(
						checkpoint.runBriefVersionId,
					),
				).filter((tool) =>
					checkpoint.approvedToolAuthorizationSnapshotIds.includes(tool.id),
				)
			: [];
		const nextIntent = nextModelIntentAfterTool(
			approvedTools,
			completedToolCalls,
		);
		const checkpointId = checkpoint
			? await saveCheckpointArtifact({
					ownerScope: input.ownerScope,
					runId: input.runId,
					state: buildCheckpoint({
						phase: "tool_completed",
						runId: input.runId,
						runBriefVersionId: checkpoint.runBriefVersionId,
						promptArtifactIds: checkpoint.promptArtifactIds,
						approvedToolAuthorizationSnapshotIds:
							checkpoint.approvedToolAuthorizationSnapshotIds,
						modelIntent: nextIntent,
						pendingToolCall: null,
						completedToolCalls,
						modelOutputArtifactIds: checkpoint.modelOutputArtifactIds,
					}),
				})
			: input.checkpointId;

		return bridgeResult(input, {
			runStepId: completedStep.id,
			artifactIds: [resultArtifact.id],
			checkpointId,
			budgetUsageDelta: {
				...zeroBudgetUsageDelta(),
				toolCalls: 1,
				runtimeMs: Math.max(
					execution.durationMs,
					Math.round(performance.now() - startedAt),
				),
			},
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "MCP tool call failed.";
		const failure = bridgeFailure("tool_call_failed", message);
		await finishRunFailed(input, failure);
		return failedResult(input, "tool_call_failed", message);
	}
}

export async function writeArtifact(
	input: ArtifactWriteActivityInput,
): Promise<BridgeStepResult> {
	try {
		const sources = await Promise.all(
			input.sourceArtifactIds.map(async (artifactId) => ({
				artifactId,
				payload: await readArtifactText(artifactId),
			})),
		);
		const artifact = await createArtifact({
			ownerScope: input.ownerScope,
			runId: input.runId,
			purpose: input.purpose,
			payload: toJsonPayload({
				schemaVersion: "derived-artifact.v1",
				artifactIntentId: input.artifactIntentId,
				sources,
			}),
			redactedSummary: {
				artifactIntentId: input.artifactIntentId,
				sourceArtifactIds: input.sourceArtifactIds,
				purpose: input.purpose,
			},
		});

		return bridgeResult(input, {
			artifactIds: [artifact.id],
		});
	} catch (error) {
		const failure = bridgeFailure(
			"artifact_write_failed",
			error instanceof Error ? error.message : "Artifact write failed.",
		);
		await finishRunFailed(input, failure);
		return failedResult(input, "artifact_write_failed", failure.message);
	}
}

export async function saveCheckpoint(
	input: CheckpointSaveActivityInput,
): Promise<BridgeStepResult> {
	try {
		await readArtifactText(input.stateArtifactId);
		return bridgeResult(input, {
			checkpointId: input.stateArtifactId,
			artifactIds: [input.stateArtifactId],
		});
	} catch (error) {
		const failure = bridgeFailure(
			"checkpoint_unavailable",
			error instanceof Error ? error.message : "Checkpoint could not be saved.",
		);
		await finishRunFailed(input, failure);
		return failedResult(input, "checkpoint_unavailable", failure.message);
	}
}

export async function persistRunStep(
	input: RunStepPersistActivityInput,
): Promise<BridgeStepResult> {
	try {
		const step = await appendBridgeRunStep({
			runId: input.runId,
			ownerScope: input.ownerScope,
			type: input.runStepType,
			summary: input.summary,
			relatedArtifactIds: input.relatedArtifactIds,
			redactedMetadata: {
				...input.redactedMetadata,
				idempotencyKey: input.idempotencyKey,
			},
		});
		const checkpointId =
			input.checkpointId ??
			(await saveCheckpointArtifact({
				ownerScope: input.ownerScope,
				runId: input.runId,
				state: buildCheckpoint({
					phase: "intro_recorded",
					runId: input.runId,
					runBriefVersionId: String(
						input.redactedMetadata.runBriefVersionId ?? "",
					),
				}),
			}));

		return bridgeResult(input, {
			runStepId: step.id,
			artifactIds: input.relatedArtifactIds,
			checkpointId,
		});
	} catch (error) {
		const failure = bridgeFailure(
			"persistence_failed",
			error instanceof Error ? error.message : "Run Step persistence failed.",
		);
		await finishRunFailed(input, failure);
		return failedResult(input, "persistence_failed", failure.message);
	}
}

export async function markRunBudgetReached(
	input: BudgetReachedActivityInput,
): Promise<BridgeStepResult> {
	try {
		const step = await appendBridgeRunStep({
			runId: input.runId,
			ownerScope: input.ownerScope,
			type: "budget_reached",
			summary: input.reason,
			relatedArtifactIds: input.finalArtifactIds,
			redactedMetadata: {
				budgetUsage: input.budgetUsage,
				idempotencyKey: input.idempotencyKey,
			},
		});
		await finishBridgeRun({
			runId: input.runId,
			state: "completed_partial",
			finalRunStepId: step.id,
			finalArtifactIds: input.finalArtifactIds,
			budgetUsage: { ...input.budgetUsage },
			failure: {
				code: "budget_exhausted",
				message: input.reason,
				retryable: false,
			},
		});

		return bridgeResult(input, {
			status: "budget_exhausted",
			runStepId: step.id,
			artifactIds: input.finalArtifactIds,
			budgetUsageDelta: zeroBudgetUsageDelta(),
			failure: bridgeFailure("budget_exhausted", input.reason),
		});
	} catch (error) {
		return failedResult(
			input,
			"persistence_failed",
			error instanceof Error
				? error.message
				: "Budget state could not be persisted.",
		);
	}
}

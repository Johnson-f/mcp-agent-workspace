export type ConversationState =
	| "drafting"
	| "awaiting_user_input"
	| "ready_for_run_brief"
	| "run_brief_created"
	| "closed";

export type RunBriefVersionState =
	| "draft"
	| "pending_approval"
	| "approved"
	| "rejected"
	| "superseded";

export type RunBriefMode = "manual_agent_run" | "automation";

export type ToolAuthorizationState =
	| "proposed"
	| "approved"
	| "rejected"
	| "revoked"
	| "stale";

export type RunBudgetPreset = "small" | "standard" | "deep";

export interface McpToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
	[key: string]: unknown;
}

export interface McpToolCapability {
	readOnly: boolean;
	destructive: boolean;
	idempotent: boolean;
	openWorld: boolean;
	writeCapable: boolean;
}

export interface ProposedToolAuthorization {
	id: string;
	mcpConnectionId: string;
	mcpToolId: string;
	toolName: string;
	displayName: string | null;
	description: string | null;
	required: boolean;
	reason: string;
	annotations: McpToolAnnotations | null;
	state: ToolAuthorizationState;
	acknowledgedWriteCapability: boolean;
	allowedOutcomeBoundary: string | null;
}

export interface EvidenceStandardDraft {
	freshEvidenceRequired: boolean;
	timeWindow: string | null;
	requiredSources: string[];
}

export interface OutputDestinationDraft {
	kind: "in_app" | "email" | "slack" | "webhook";
	destinationRef: string | null;
	authorized: boolean;
}

export interface AutomationScheduleDraft {
	kind: "manual_only" | "recurring";
	timezone: string;
	rule: string | null;
	missedRunPolicy: "skip" | "backfill_if_enabled";
	overlapPolicy: "skip" | "queue_one" | "cancel_old" | "allow_overlap";
}

export interface RunBriefDraft {
	schemaVersion: "run-brief-draft.v1";
	mode: RunBriefMode;
	goal: string | null;
	successCriteria: string[];
	expectedOutput: string | null;
	evidenceStandard: EvidenceStandardDraft;
	forbiddenActions: string[];
	requiredTools: ProposedToolAuthorization[];
	optionalTools: ProposedToolAuthorization[];
	outputDestination: OutputDestinationDraft | null;
	runBudgetPreset: RunBudgetPreset | null;
	unavailableRequiredToolBehavior:
		| "retry_then_fail"
		| "retry_then_partial"
		| null;
	unavailableOptionalToolBehavior: "continue_degraded" | null;
	schedule: AutomationScheduleDraft | null;
	userApprovedFinalBrief: boolean;
}

export interface MissingRunBriefField {
	path: string;
	label: string;
	prompt: string;
}

export interface WriteToolAcknowledgementRequirement {
	toolAuthorizationId: string;
	toolName: string;
	reason: string;
}

export interface RunBriefFlowEvaluation {
	conversationState: ConversationState;
	runBriefVersionState: RunBriefVersionState;
	canCreateRunBriefVersion: boolean;
	canApproveRunBriefVersion: boolean;
	missingFields: MissingRunBriefField[];
	writeToolAcknowledgementsRequired: WriteToolAcknowledgementRequirement[];
	rejectedToolIds: string[];
	staleToolIds: string[];
}

const present = (value: string | null | undefined) =>
	typeof value === "string" && value.trim().length > 0;

const missingField = (
	path: string,
	label: string,
	prompt: string,
): MissingRunBriefField => ({
	path,
	label,
	prompt,
});

export const getMcpToolCapability = (
	annotations: McpToolAnnotations | null,
): McpToolCapability => {
	const readOnly = annotations?.readOnlyHint === true;
	const destructive = annotations?.destructiveHint ?? true;
	const idempotent = annotations?.idempotentHint === true;
	const openWorld = annotations?.openWorldHint ?? true;

	return {
		readOnly,
		destructive,
		idempotent,
		openWorld,
		writeCapable: !readOnly || destructive,
	};
};

export const allSelectedTools = (draft: RunBriefDraft) => [
	...draft.requiredTools,
	...draft.optionalTools,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

const isProposedToolAuthorization = (
	value: unknown,
): value is ProposedToolAuthorization => {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value.id === "string" &&
		typeof value.mcpConnectionId === "string" &&
		typeof value.mcpToolId === "string" &&
		typeof value.toolName === "string" &&
		typeof value.required === "boolean" &&
		typeof value.reason === "string" &&
		["proposed", "approved", "rejected", "revoked", "stale"].includes(
			String(value.state),
		) &&
		typeof value.acknowledgedWriteCapability === "boolean" &&
		(value.allowedOutcomeBoundary === null ||
			typeof value.allowedOutcomeBoundary === "string")
	);
};

export const isRunBriefDraft = (value: unknown): value is RunBriefDraft => {
	if (!isRecord(value)) {
		return false;
	}

	const evidenceStandard = value.evidenceStandard;
	const outputDestination = value.outputDestination;
	const schedule = value.schedule;

	return (
		value.schemaVersion === "run-brief-draft.v1" &&
		(value.mode === "manual_agent_run" || value.mode === "automation") &&
		(value.goal === null || typeof value.goal === "string") &&
		isStringArray(value.successCriteria) &&
		(value.expectedOutput === null ||
			typeof value.expectedOutput === "string") &&
		isRecord(evidenceStandard) &&
		typeof evidenceStandard.freshEvidenceRequired === "boolean" &&
		(evidenceStandard.timeWindow === null ||
			typeof evidenceStandard.timeWindow === "string") &&
		isStringArray(evidenceStandard.requiredSources) &&
		isStringArray(value.forbiddenActions) &&
		Array.isArray(value.requiredTools) &&
		value.requiredTools.every(isProposedToolAuthorization) &&
		Array.isArray(value.optionalTools) &&
		value.optionalTools.every(isProposedToolAuthorization) &&
		(outputDestination === null ||
			(isRecord(outputDestination) &&
				["in_app", "email", "slack", "webhook"].includes(
					String(outputDestination.kind),
				) &&
				(outputDestination.destinationRef === null ||
					typeof outputDestination.destinationRef === "string") &&
				typeof outputDestination.authorized === "boolean")) &&
		(value.runBudgetPreset === null ||
			["small", "standard", "deep"].includes(String(value.runBudgetPreset))) &&
		(value.unavailableRequiredToolBehavior === null ||
			value.unavailableRequiredToolBehavior === "retry_then_fail" ||
			value.unavailableRequiredToolBehavior === "retry_then_partial") &&
		(value.unavailableOptionalToolBehavior === null ||
			value.unavailableOptionalToolBehavior === "continue_degraded") &&
		(schedule === null ||
			(isRecord(schedule) &&
				(schedule.kind === "manual_only" || schedule.kind === "recurring") &&
				typeof schedule.timezone === "string" &&
				(schedule.rule === null || typeof schedule.rule === "string") &&
				(schedule.missedRunPolicy === "skip" ||
					schedule.missedRunPolicy === "backfill_if_enabled") &&
				["skip", "queue_one", "cancel_old", "allow_overlap"].includes(
					String(schedule.overlapPolicy),
				))) &&
		typeof value.userApprovedFinalBrief === "boolean"
	);
};

export const evaluateRunBriefDraft = (
	draft: RunBriefDraft,
): RunBriefFlowEvaluation => {
	const missingFields: MissingRunBriefField[] = [];

	if (!present(draft.goal)) {
		missingFields.push(
			missingField(
				"goal",
				"Goal",
				"What exact outcome should this Agent produce?",
			),
		);
	}

	if (draft.successCriteria.length === 0) {
		missingFields.push(
			missingField(
				"successCriteria",
				"Success criteria",
				"How should the Agent know the work is complete and correct?",
			),
		);
	}

	if (!present(draft.expectedOutput)) {
		missingFields.push(
			missingField(
				"expectedOutput",
				"Expected output",
				"What should the final answer or delivered output include?",
			),
		);
	}

	if (!draft.evidenceStandard.freshEvidenceRequired) {
		missingFields.push(
			missingField(
				"evidenceStandard.freshEvidenceRequired",
				"Fresh evidence",
				"Should the Agent re-check current data during every run?",
			),
		);
	}

	if (allSelectedTools(draft).length === 0) {
		missingFields.push(
			missingField(
				"tools",
				"Approved tools",
				"Which connected MCP tools may the Agent use?",
			),
		);
	}

	if (!draft.outputDestination) {
		missingFields.push(
			missingField(
				"outputDestination",
				"Output destination",
				"Where should the result be delivered?",
			),
		);
	} else if (
		draft.outputDestination.kind !== "in_app" &&
		!draft.outputDestination.authorized
	) {
		missingFields.push(
			missingField(
				"outputDestination.authorized",
				"Output destination authorization",
				"Please authorize this external output destination.",
			),
		);
	}

	if (!draft.runBudgetPreset) {
		missingFields.push(
			missingField(
				"runBudgetPreset",
				"Run Budget",
				"Choose a Run Budget preset: Small, Standard, or Deep.",
			),
		);
	}

	if (!draft.unavailableRequiredToolBehavior) {
		missingFields.push(
			missingField(
				"unavailableRequiredToolBehavior",
				"Required tool fallback",
				"What should happen if a required tool is unavailable after retries?",
			),
		);
	}

	if (!draft.unavailableOptionalToolBehavior) {
		missingFields.push(
			missingField(
				"unavailableOptionalToolBehavior",
				"Optional tool fallback",
				"What should happen if an optional tool is unavailable?",
			),
		);
	}

	if (draft.mode === "automation") {
		if (!draft.schedule) {
			missingFields.push(
				missingField(
					"schedule",
					"Automation schedule",
					"When should this Automation run?",
				),
			);
		} else {
			if (!present(draft.schedule.timezone)) {
				missingFields.push(
					missingField(
						"schedule.timezone",
						"Schedule timezone",
						"Which timezone owns this schedule?",
					),
				);
			}
			if (
				draft.schedule.kind === "recurring" &&
				!present(draft.schedule.rule)
			) {
				missingFields.push(
					missingField(
						"schedule.rule",
						"Schedule rule",
						"What recurrence should trigger this Automation?",
					),
				);
			}
		}
	}

	const selectedTools = allSelectedTools(draft);
	const rejectedToolIds = selectedTools
		.filter((tool) => tool.state === "rejected" || tool.state === "revoked")
		.map((tool) => tool.id);
	const staleToolIds = selectedTools
		.filter((tool) => tool.state === "stale")
		.map((tool) => tool.id);

	for (const tool of selectedTools) {
		if (tool.state !== "approved") {
			missingFields.push(
				missingField(
					`tools.${tool.id}.state`,
					`Approve ${tool.toolName}`,
					`Approve or remove the ${tool.toolName} MCP tool before creating the Run Brief.`,
				),
			);
		}
	}

	const writeToolAcknowledgementsRequired = selectedTools
		.filter((tool) => {
			const capability = getMcpToolCapability(tool.annotations);
			return (
				tool.state === "approved" &&
				capability.writeCapable &&
				(!tool.acknowledgedWriteCapability ||
					!present(tool.allowedOutcomeBoundary))
			);
		})
		.map((tool) => ({
			toolAuthorizationId: tool.id,
			toolName: tool.toolName,
			reason:
				"This MCP tool is not declared read-only by its annotations, so it needs explicit acknowledgement and an allowed outcome boundary.",
		}));

	const canCreateRunBriefVersion =
		missingFields.length === 0 &&
		writeToolAcknowledgementsRequired.length === 0 &&
		rejectedToolIds.length === 0 &&
		staleToolIds.length === 0;

	return {
		conversationState: canCreateRunBriefVersion
			? "ready_for_run_brief"
			: "awaiting_user_input",
		runBriefVersionState: draft.userApprovedFinalBrief
			? "approved"
			: canCreateRunBriefVersion
				? "pending_approval"
				: "draft",
		canCreateRunBriefVersion,
		canApproveRunBriefVersion:
			canCreateRunBriefVersion && draft.userApprovedFinalBrief,
		missingFields,
		writeToolAcknowledgementsRequired,
		rejectedToolIds,
		staleToolIds,
	};
};

export const defaultAutomationSchedule = (): AutomationScheduleDraft => ({
	kind: "manual_only",
	timezone: "UTC",
	rule: null,
	missedRunPolicy: "skip",
	overlapPolicy: "skip",
});

export const createEmptyRunBriefDraft = (
	mode: RunBriefMode,
): RunBriefDraft => ({
	schemaVersion: "run-brief-draft.v1",
	mode,
	goal: null,
	successCriteria: [],
	expectedOutput: null,
	evidenceStandard: {
		freshEvidenceRequired: true,
		timeWindow: null,
		requiredSources: [],
	},
	forbiddenActions: [],
	requiredTools: [],
	optionalTools: [],
	outputDestination: null,
	runBudgetPreset: "standard",
	unavailableRequiredToolBehavior: "retry_then_partial",
	unavailableOptionalToolBehavior: "continue_degraded",
	schedule: null,
	userApprovedFinalBrief: false,
});

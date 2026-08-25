import { Schema } from "effect";

export const ProductOwnerType = Schema.Literal("user", "workspace");

export const ProductConversationState = Schema.Literal(
	"drafting",
	"awaiting_user_input",
	"ready_for_run_brief",
	"run_brief_created",
	"closed",
);

export const ProductConversationMessageRole = Schema.Literal(
	"user",
	"assistant",
	"system",
);

export const ProductRunBriefVersionState = Schema.Literal(
	"draft",
	"pending_approval",
	"approved",
	"rejected",
	"superseded",
);

export const ProductRunBriefMode = Schema.Literal(
	"manual_agent_run",
	"automation",
);

export const ProductRunState = Schema.Literal(
	"queued",
	"running",
	"waiting_for_user",
	"completed",
	"completed_partial",
	"failed",
	"cancelled",
	"expired",
	"skipped",
);

export const Conversation = Schema.Struct({
	id: Schema.String,
	ownerType: ProductOwnerType,
	ownerId: Schema.String,
	title: Schema.String,
	state: ProductConversationState,
	pinnedAt: Schema.NullOr(Schema.String),
	automationId: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
	updatedAt: Schema.String,
});
export type Conversation = typeof Conversation.Type;

export const ConversationMessage = Schema.Struct({
	id: Schema.String,
	conversationId: Schema.String,
	role: ProductConversationMessageRole,
	content: Schema.String,
	metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
	createdAt: Schema.String,
});
export type ConversationMessage = typeof ConversationMessage.Type;

export const ConversationCreateResult = Schema.Struct({
	conversation: Conversation,
	message: Schema.NullOr(ConversationMessage),
});
export type ConversationCreateResult = typeof ConversationCreateResult.Type;

export const RunBriefVersion = Schema.Struct({
	id: Schema.String,
	runBriefId: Schema.String,
	conversationId: Schema.String,
	versionNumber: Schema.Number,
	mode: ProductRunBriefMode,
	state: ProductRunBriefVersionState,
	schemaVersion: Schema.String,
	structuredBrief: Schema.Unknown,
	evaluation: Schema.Unknown,
	approvedAt: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
	updatedAt: Schema.String,
});
export type RunBriefVersion = typeof RunBriefVersion.Type;

export const AgentRun = Schema.Struct({
	id: Schema.String,
	state: ProductRunState,
	title: Schema.String,
	conversationId: Schema.NullOr(Schema.String),
	runBriefVersionId: Schema.String,
	temporalWorkflowId: Schema.NullOr(Schema.String),
	temporalRunId: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
});
export type AgentRun = typeof AgentRun.Type;

export const RunHistoryArtifact = Schema.Struct({
	id: Schema.String,
	purpose: Schema.String,
	sensitivity: Schema.String,
	retentionState: Schema.String,
	rawAvailable: Schema.Boolean,
	redactedSummary: Schema.Record({
		key: Schema.String,
		value: Schema.Unknown,
	}),
});
export type RunHistoryArtifact = typeof RunHistoryArtifact.Type;

export const RunHistoryStep = Schema.Struct({
	id: Schema.String,
	type: Schema.String,
	summary: Schema.String,
	occurredAt: Schema.String,
	publicMetadata: Schema.Record({
		key: Schema.String,
		value: Schema.Unknown,
	}),
	artifacts: Schema.Array(RunHistoryArtifact),
});
export type RunHistoryStep = typeof RunHistoryStep.Type;

export const AgentRunDetail = Schema.Struct({
	run: AgentRun,
	steps: Schema.Array(RunHistoryStep),
	finalOutputText: Schema.NullOr(Schema.String),
	finalOutputArtifactIds: Schema.Array(Schema.String),
});
export type AgentRunDetail = typeof AgentRunDetail.Type;

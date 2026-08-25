import { Schema } from "effect";
import {
	ProductConversationMessageRole,
	ProductConversationState,
	ProductRunState,
} from "./product-flow";

export const ProductAutomationState = Schema.Literal(
	"draft",
	"pending_approval",
	"live",
	"paused",
	"needs_reconfiguration",
	"archived",
);
export type ProductAutomationState = typeof ProductAutomationState.Type;

export const AutomationRunTriggerSource = Schema.Literal("manual", "scheduled");
export type AutomationRunTriggerSource = typeof AutomationRunTriggerSource.Type;

export const ConversationSummary = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	state: ProductConversationState,
	pinnedAt: Schema.NullOr(Schema.String),
	archivedAt: Schema.NullOr(Schema.String),
	automationId: Schema.NullOr(Schema.String),
	updatedAt: Schema.String,
});
export type ConversationSummary = typeof ConversationSummary.Type;

export const ConversationHistoryMessage = Schema.Struct({
	id: Schema.String,
	conversationId: Schema.String,
	role: ProductConversationMessageRole,
	content: Schema.String,
	metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
	createdAt: Schema.String,
});

export const ConversationActivityKind = Schema.Literal(
  "reasoning_summary",
  "tool",
  "automation",
  "status",
);
export type ConversationActivityKind = typeof ConversationActivityKind.Type;

export const ConversationActivityStatus = Schema.Literal(
  "running",
  "waiting",
  "completed",
  "failed",
  "incomplete",
);
export type ConversationActivityStatus = typeof ConversationActivityStatus.Type;

export const ConversationActivity = Schema.Struct({
  id: Schema.String,
  turnId: Schema.String,
  sequence: Schema.Number,
  kind: ConversationActivityKind,
  status: ConversationActivityStatus,
  title: Schema.String,
  content: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
});
export type ConversationActivity = typeof ConversationActivity.Type;

export const ConversationTurnActivityGroup = Schema.Struct({
  turnId: Schema.String,
  assistantMessageId: Schema.NullOr(Schema.String),
  status: ConversationActivityStatus,
  activities: Schema.Array(ConversationActivity),
});
export type ConversationTurnActivityGroup =
  typeof ConversationTurnActivityGroup.Type;

export const ConversationDetail = Schema.Struct({
  conversation: ConversationSummary,
  messages: Schema.Array(ConversationHistoryMessage),
  currentRunBriefVersion: Schema.NullOr(Schema.Unknown),
  activities: Schema.Array(ConversationTurnActivityGroup),
});
export type ConversationDetail = typeof ConversationDetail.Type;

export const AutomationRunView = Schema.Struct({
	id: Schema.String,
	automationId: Schema.String,
	automationVersionId: Schema.String,
	state: ProductRunState,
	title: Schema.String,
	triggerSource: AutomationRunTriggerSource,
	temporalWorkflowId: Schema.NullOr(Schema.String),
	temporalRunId: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
});
export type AutomationRunView = typeof AutomationRunView.Type;

export const AutomationSummary = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	state: ProductAutomationState,
	scheduleLabel: Schema.String,
	nextScheduledAt: Schema.NullOr(Schema.String),
	latestRunState: Schema.NullOr(ProductRunState),
	latestRunAt: Schema.NullOr(Schema.String),
	needsAttentionReason: Schema.NullOr(Schema.String),
	updatedAt: Schema.String,
});
export type AutomationSummary = typeof AutomationSummary.Type;

export const AutomationDetail = Schema.Struct({
	automation: AutomationSummary,
	conversationId: Schema.String,
	currentVersionId: Schema.String,
	runBriefVersionId: Schema.String,
	schedule: Schema.Unknown,
	runBudget: Schema.Unknown,
	outputDestination: Schema.Unknown,
	toolAuthorizations: Schema.Array(Schema.Unknown),
	recentRuns: Schema.Array(AutomationRunView),
	canRunNow: Schema.Boolean,
	runNowBlocker: Schema.NullOr(Schema.String),
});
export type AutomationDetail = typeof AutomationDetail.Type;

export const canRunAutomationNow = (input: {
	state: ProductAutomationState;
	hasActiveRun: boolean;
}) => input.state === "live" && !input.hasActiveRun;

export const conversationHistorySections = <
	T extends { pinnedAt: string | null; archivedAt?: string | null; updatedAt: string },
>(
	items: T[],
): { pinned: T[]; recent: T[] } => ({
	pinned: [...items.filter((item) => item.archivedAt == null && item.pinnedAt !== null)].sort(
		(left, right) => (right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? ""),
	),
	recent: [...items.filter((item) => item.archivedAt == null && item.pinnedAt === null)].sort(
		(left, right) => right.updatedAt.localeCompare(left.updatedAt),
	),
});

export const automationRunWorkflowInput = (input: {
	automationId: string;
	automationVersionId: string;
	runId: string;
	triggeredByUserId: string;
}) => ({
	runId: input.runId,
	kind: "automation" as const,
	automationId: input.automationId,
	automationVersionId: input.automationVersionId,
	triggerSource: "manual" as const,
	triggeredByUserId: input.triggeredByUserId,
});

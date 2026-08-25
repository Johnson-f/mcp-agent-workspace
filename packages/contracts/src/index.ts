import { Rpc, RpcGroup, RpcMiddleware } from "@effect/rpc";
import { Context, Schema } from "effect";
import {
	AgentRun,
	AgentRunDetail,
	ConversationCreateResult,
	ConversationMessage,
	RunBriefVersion,
} from "./product-flow";
import {
	AutomationDetail,
	AutomationRunView,
	AutomationSummary,
	ConversationDetail,
	ConversationSummary,
} from "./unified-automation";

export * from "./conversation-run-brief";
export * from "./conversation-stream";
export * from "./run-history-visibility";
export * from "./automation-activation";
export * from "./eval-route";
export * from "./product-flow";
export * from "./unified-automation";

export const McpTransport = Schema.Literal("streamable_http", "sse");
export type McpTransport = typeof McpTransport.Type;

export const McpAuthType = Schema.Literal(
	"none",
	"bearer",
	"oauth2",
	"custom_headers",
);
export type McpAuthType = typeof McpAuthType.Type;

export const McpConnectionAuthType = Schema.Union(
	McpAuthType,
	Schema.Literal("auto"),
);
export type McpConnectionAuthType = typeof McpConnectionAuthType.Type;

export const McpConnectionStatus = Schema.Literal(
	"pending",
	"auth_required",
	"connected",
	"error",
	"disabled",
);
export type McpConnectionStatus = typeof McpConnectionStatus.Type;

export const McpApprovalMode = Schema.Literal("always", "risky", "never");
export type McpApprovalMode = typeof McpApprovalMode.Type;

export const InteractiveAgentApprovalPolicy = Schema.Literal(
	"always_ask",
	"tool_policy",
	"auto_approve_eligible",
);
export type InteractiveAgentApprovalPolicy =
	typeof InteractiveAgentApprovalPolicy.Type;

export const InteractiveAgentPreferences = Schema.Struct({
	approvalPolicy: InteractiveAgentApprovalPolicy,
	updatedAt: Schema.String,
});
export type InteractiveAgentPreferences =
	typeof InteractiveAgentPreferences.Type;

export const Viewer = Schema.Struct({
	id: Schema.String,
	stytchUserId: Schema.String,
	primaryEmail: Schema.NullOr(Schema.String),
	displayName: Schema.NullOr(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
});
export type Viewer = typeof Viewer.Type;

export const McpConnection = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	transport: McpTransport,
	endpointUrl: Schema.String,
	authType: McpAuthType,
	status: McpConnectionStatus,
	serverName: Schema.NullOr(Schema.String),
	serverVersion: Schema.NullOr(Schema.String),
	protocolVersion: Schema.NullOr(Schema.String),
	lastErrorCode: Schema.NullOr(Schema.String),
	lastErrorMessage: Schema.NullOr(Schema.String),
	lastConnectedAt: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
	updatedAt: Schema.String,
});
export type McpConnection = typeof McpConnection.Type;

export const McpConnectionResult = Schema.Struct({
	connection: McpConnection,
	authorizationUrl: Schema.NullOr(Schema.String),
});
export type McpConnectionResult = typeof McpConnectionResult.Type;

export const McpDirectoryEntry = Schema.Struct({
	authType: Schema.Literal("auto", "custom_headers"),
	authHeaderNames: Schema.Array(Schema.String),
	name: Schema.String,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	version: Schema.NullOr(Schema.String),
	websiteUrl: Schema.NullOr(Schema.String),
	icons: Schema.Array(
		Schema.Struct({
			src: Schema.String,
			mimeType: Schema.NullOr(Schema.String),
			sizes: Schema.Array(Schema.String),
			theme: Schema.NullOr(Schema.Literal("light", "dark")),
		}),
	),
	endpointUrl: Schema.String,
	transport: McpTransport,
});
export type McpDirectoryEntry = typeof McpDirectoryEntry.Type;

export const McpDirectoryPage = Schema.Struct({
	entries: Schema.Array(McpDirectoryEntry),
	nextCursor: Schema.NullOr(Schema.String),
});
export type McpDirectoryPage = typeof McpDirectoryPage.Type;

export const McpTool = Schema.Struct({
	id: Schema.String,
	connectionId: Schema.String,
	name: Schema.String,
	title: Schema.NullOr(Schema.String),
	description: Schema.NullOr(Schema.String),
	inputSchema: Schema.Unknown,
	outputSchema: Schema.NullOr(Schema.Unknown),
	annotations: Schema.NullOr(Schema.Unknown),
	enabled: Schema.Boolean,
	available: Schema.Boolean,
	approvalMode: McpApprovalMode,
	discoveredAt: Schema.String,
	lastSeenAt: Schema.String,
});
export type McpTool = typeof McpTool.Type;

export const McpToolCallStatus = Schema.Literal(
	"awaiting_approval",
	"succeeded",
	"failed",
);
export type McpToolCallStatus = typeof McpToolCallStatus.Type;

export const McpToolCallResult = Schema.Struct({
	callId: Schema.String,
	status: McpToolCallStatus,
	approvalRequired: Schema.Boolean,
	isError: Schema.Boolean,
	result: Schema.NullOr(Schema.Unknown),
	errorMessage: Schema.NullOr(Schema.String),
	durationMs: Schema.NullOr(Schema.Number),
});
export type McpToolCallResult = typeof McpToolCallResult.Type;

export const Unauthorized = Schema.TaggedStruct("Unauthorized", {
	message: Schema.String,
});
export type Unauthorized = typeof Unauthorized.Type;

export const ServiceUnavailable = Schema.TaggedStruct("ServiceUnavailable", {
	message: Schema.String,
});

export const InvalidRequest = Schema.TaggedStruct("InvalidRequest", {
	message: Schema.String,
});

export const NotFound = Schema.TaggedStruct("NotFound", {
	message: Schema.String,
});

export const Conflict = Schema.TaggedStruct("Conflict", {
	message: Schema.String,
});

export const McpConnectionFailed = Schema.TaggedStruct("McpConnectionFailed", {
	message: Schema.String,
	code: Schema.String,
});

export const CredentialsNotConfigured = Schema.TaggedStruct(
	"CredentialsNotConfigured",
	{
		message: Schema.String,
	},
);

export const ApiError = Schema.Union(
	InvalidRequest,
	NotFound,
	Conflict,
	McpConnectionFailed,
	CredentialsNotConfigured,
	ServiceUnavailable,
);
export type ApiError = typeof ApiError.Type;

export interface CurrentUserValue {
	readonly id: string;
	readonly stytchUserId: string;
	readonly primaryEmail: string | null;
	readonly displayName: string | null;
	readonly avatarUrl: string | null;
}

export class CurrentUser extends Context.Tag("@agents/CurrentUser")<
	CurrentUser,
	CurrentUserValue
>() {}

export class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
	"@agents/AuthMiddleware",
	{
		failure: Schema.Union(Unauthorized, ServiceUnavailable),
		provides: CurrentUser,
	},
) {}

export class AgentsRpcs extends RpcGroup.make(
	Rpc.make("ViewerGet", {
		success: Viewer,
	}).middleware(AuthMiddleware),
	Rpc.make("McpConnectionsList", {
		success: Schema.Array(McpConnection),
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("McpDirectoryList", {
		payload: {
			search: Schema.optional(Schema.String),
			cursor: Schema.optional(Schema.String),
		},
		success: McpDirectoryPage,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("McpConnectionCreate", {
		payload: {
			name: Schema.String,
			endpointUrl: Schema.String,
			transport: McpTransport,
			authType: McpConnectionAuthType,
			bearerToken: Schema.optional(Schema.String),
			customHeaders: Schema.optional(
				Schema.Record({ key: Schema.String, value: Schema.String }),
			),
		},
		success: McpConnectionResult,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("McpOAuthComplete", {
		payload: {
			state: Schema.String,
			code: Schema.String,
			iss: Schema.optional(Schema.String),
		},
		success: McpConnection,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("McpConnectionRefresh", {
		payload: { connectionId: Schema.String },
		success: McpConnectionResult,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("McpConnectionDelete", {
		payload: { connectionId: Schema.String },
		success: Schema.Void,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("McpToolsList", {
		payload: { connectionId: Schema.String },
		success: Schema.Array(McpTool),
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("McpToolPolicyUpdate", {
		payload: {
			toolId: Schema.String,
			enabled: Schema.Boolean,
			approvalMode: McpApprovalMode,
		},
		success: McpTool,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("McpToolPoliciesBulkUpdate", {
		payload: {
			connectionId: Schema.String,
			toolIds: Schema.Array(Schema.String),
			enabled: Schema.optional(Schema.Boolean),
			approvalMode: Schema.optional(McpApprovalMode),
		},
		success: Schema.Array(McpTool),
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("McpToolCallPrepare", {
		payload: {
			toolId: Schema.String,
			arguments: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
			idempotencyKey: Schema.String,
		},
		success: McpToolCallResult,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("McpToolCallApprove", {
		payload: {
			callId: Schema.String,
			arguments: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
		},
		success: McpToolCallResult,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("InteractiveAgentPreferencesGet", {
		success: InteractiveAgentPreferences,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("InteractiveAgentPreferencesUpdate", {
		payload: { approvalPolicy: InteractiveAgentApprovalPolicy },
		success: InteractiveAgentPreferences,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ConversationCreate", {
		payload: {
			title: Schema.optional(Schema.String),
			initialMessage: Schema.optional(Schema.String),
		},
		success: ConversationCreateResult,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ConversationMessageAppend", {
		payload: {
			conversationId: Schema.String,
			content: Schema.String,
		},
		success: ConversationMessage,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ConversationsList", {
		success: Schema.Array(ConversationSummary),
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ConversationGet", {
		payload: { conversationId: Schema.String },
		success: ConversationDetail,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ConversationRename", {
		payload: { conversationId: Schema.String, title: Schema.String },
		success: ConversationSummary,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ConversationPinUpdate", {
		payload: { conversationId: Schema.String, pinned: Schema.Boolean },
		success: ConversationSummary,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ConversationArchiveUpdate", {
		payload: { conversationId: Schema.String, archived: Schema.Boolean },
		success: ConversationSummary,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ArchivedConversationsList", {
		success: Schema.Array(ConversationSummary),
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ConversationDelete", {
		payload: { conversationId: Schema.String, confirmationTitle: Schema.String },
		success: Schema.Void,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ConversationInterviewAnswer", {
		payload: {
			conversationId: Schema.String,
			content: Schema.String,
			draft: Schema.Unknown,
		},
		success: RunBriefVersion,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ConversationModelTurn", {
		payload: {
			conversationId: Schema.String,
			content: Schema.String,
		},
		success: ConversationDetail,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("RunBriefDraftSave", {
		payload: {
			conversationId: Schema.String,
			draft: Schema.Unknown,
		},
		success: RunBriefVersion,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("RunBriefApprove", {
		payload: {
			runBriefVersionId: Schema.String,
		},
		success: RunBriefVersion,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("ManualAgentRunStart", {
		payload: {
			runBriefVersionId: Schema.String,
		},
		success: AgentRun,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("AgentRunGet", {
		payload: {
			runId: Schema.String,
		},
		success: AgentRunDetail,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("AutomationsList", {
		success: Schema.Array(AutomationSummary),
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("AutomationGet", {
		payload: { automationId: Schema.String },
		success: AutomationDetail,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("AutomationApprove", {
		payload: { runBriefVersionId: Schema.String },
		success: AutomationDetail,
		error: ApiError,
	}).middleware(AuthMiddleware),
	Rpc.make("AutomationRunNow", {
		payload: { automationId: Schema.String },
		success: AutomationRunView,
		error: ApiError,
	}).middleware(AuthMiddleware),
) {}

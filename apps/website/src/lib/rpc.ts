import type { RunBriefDraft } from "@agents/contracts";
import { AgentsRpcs } from "@agents/contracts";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import { RpcClient, RpcSerialization } from "@effect/rpc";
import { Effect, Either, Layer } from "effect";
import { isDevAuthEnabled } from "./auth-session";

const ProtocolLive = RpcClient.layerProtocolHttp({
  url: "/api/rpc",
  transformClient: (client) => {
    if (!isDevAuthEnabled()) {
      return client;
    }

    return HttpClient.mapRequest(client, (request) =>
      HttpClientRequest.setHeader(
        request,
        "x-agents-dev-user-id",
        process.env.NEXT_PUBLIC_DEV_AUTH_USER_ID ?? "local",
      ),
    );
  },
}).pipe(Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson]));

export class RpcRequestError extends Error {
  readonly tag: string;

  constructor(error: unknown) {
    const record =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : undefined;
    super(
      typeof record?.message === "string"
        ? record.message
        : "The request could not be completed.",
    );
    this.name = "RpcRequestError";
    this.tag = typeof record?._tag === "string" ? record._tag : "UnknownError";
  }
}

const run = async <Value, Failure>(
  operation: (
    client: RpcClient.FromGroup<typeof AgentsRpcs, unknown>,
  ) => Effect.Effect<Value, Failure>,
) => {
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(AgentsRpcs);
        return yield* Effect.either(operation(client));
      }),
    ).pipe(Effect.provide(ProtocolLive)),
  );

  if (Either.isLeft(result)) {
    throw new RpcRequestError(result.left);
  }

  return result.right;
};

export const agentsRpc = {
  viewer: () => run((client) => client.ViewerGet()),
  listConnections: () => run((client) => client.McpConnectionsList()),
  listMcpDirectory: (input: { search?: string; cursor?: string } = {}) =>
    run((client) => client.McpDirectoryList(input)),
  createConnection: (input: {
    name: string;
    endpointUrl: string;
    transport: "streamable_http" | "sse";
    authType: "auto" | "none" | "bearer" | "oauth2" | "custom_headers";
    bearerToken?: string;
    customHeaders?: Record<string, string>;
  }) => run((client) => client.McpConnectionCreate(input)),
  refreshConnection: (connectionId: string) =>
    run((client) => client.McpConnectionRefresh({ connectionId })),
  completeOAuth: (input: { state: string; code: string; iss?: string }) =>
    run((client) => client.McpOAuthComplete(input)),
  deleteConnection: (connectionId: string) =>
    run((client) => client.McpConnectionDelete({ connectionId })),
  listTools: (connectionId: string) =>
    run((client) => client.McpToolsList({ connectionId })),
  updateToolPolicy: (input: {
    toolId: string;
    enabled: boolean;
    approvalMode: "always" | "risky" | "never";
  }) => run((client) => client.McpToolPolicyUpdate(input)),
  updateToolPolicies: (input: {
    connectionId: string;
    toolIds: string[];
    enabled?: boolean;
    approvalMode?: "always" | "risky" | "never";
  }) => run((client) => client.McpToolPoliciesBulkUpdate(input)),
  prepareToolCall: (input: {
    toolId: string;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
  }) => run((client) => client.McpToolCallPrepare(input)),
  approveToolCall: (input: {
    callId: string;
    arguments: Record<string, unknown>;
  }) => run((client) => client.McpToolCallApprove(input)),
  getInteractiveAgentPreferences: () =>
    run((client) => client.InteractiveAgentPreferencesGet()),
  updateInteractiveAgentPreferences: (
    approvalPolicy: "always_ask" | "tool_policy" | "auto_approve_eligible",
  ) =>
    run((client) =>
      client.InteractiveAgentPreferencesUpdate({ approvalPolicy }),
    ),
  createConversation: (input: { title?: string; initialMessage?: string }) =>
    run((client) => client.ConversationCreate(input)),
  appendConversationMessage: (input: {
    conversationId: string;
    content: string;
  }) => run((client) => client.ConversationMessageAppend(input)),
  listConversations: () => run((client) => client.ConversationsList()),
  getConversation: (conversationId: string) =>
    run((client) => client.ConversationGet({ conversationId })),
  renameConversation: (conversationId: string, title: string) =>
    run((client) => client.ConversationRename({ conversationId, title })),
  setConversationPinned: (conversationId: string, pinned: boolean) =>
    run((client) => client.ConversationPinUpdate({ conversationId, pinned })),
  listArchivedConversations: () =>
    run((client) => client.ArchivedConversationsList()),
  setConversationArchived: (conversationId: string, archived: boolean) =>
    run((client) =>
      client.ConversationArchiveUpdate({ conversationId, archived }),
    ),
  deleteConversation: (conversationId: string, confirmationTitle: string) =>
    run((client) =>
      client.ConversationDelete({ conversationId, confirmationTitle }),
    ),
  answerConversation: (input: {
    conversationId: string;
    content: string;
    draft: RunBriefDraft;
  }) => run((client) => client.ConversationInterviewAnswer(input)),
  sendConversationMessage: (conversationId: string, content: string) =>
    run((client) => client.ConversationModelTurn({ conversationId, content })),
  saveRunBriefDraft: (input: {
    conversationId: string;
    draft: RunBriefDraft;
  }) => run((client) => client.RunBriefDraftSave(input)),
  approveRunBrief: (runBriefVersionId: string) =>
    run((client) => client.RunBriefApprove({ runBriefVersionId })),
  startManualAgentRun: (runBriefVersionId: string) =>
    run((client) => client.ManualAgentRunStart({ runBriefVersionId })),
  getAgentRun: (runId: string) =>
    run((client) => client.AgentRunGet({ runId })),
  listAutomations: () => run((client) => client.AutomationsList()),
  getAutomation: (automationId: string) =>
    run((client) => client.AutomationGet({ automationId })),
  approveAutomation: (runBriefVersionId: string) =>
    run((client) => client.AutomationApprove({ runBriefVersionId })),
  runAutomationNow: (automationId: string) =>
    run((client) => client.AutomationRunNow({ automationId })),
};

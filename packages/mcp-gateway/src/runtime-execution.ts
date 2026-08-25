import {
  auth,
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type Tool,
} from "@modelcontextprotocol/client";
import { and, eq, getDatabase } from "@agents/db";
import { mcpConnections, mcpTools } from "@agents/db/schema";
import { decryptCredential, toMcpAuthentication } from "./credentials";
import { PersistentOAuthProvider } from "./oauth-provider";
import {
  getEncryptedCredential,
  markConnectionAuthRequired,
} from "./repository";
import { createMcpFetch, validateMcpEndpoint } from "./url-safety";
import {
  classifyMcpExecutionFailure,
  shouldAttemptOAuthRefresh,
} from "./execution-failure";

export type RuntimeMcpToolExecutionResult =
  | {
      status: "succeeded";
      result: unknown;
      durationMs: number;
      redactedSummary: Record<string, unknown>;
    }
  | {
      status: "failed";
      errorCode: string;
      errorMessage: string;
      durationMs: number;
      redactedSummary: Record<string, unknown>;
    };

const summarizeMcpResult = (result: {
  isError?: boolean;
  content?: readonly { type?: unknown }[];
  structuredContent?: unknown;
}) => ({
  isError: result.isError === true,
  contentTypes: (result.content ?? []).reduce<Record<string, number>>(
    (counts, item) => {
      const type = typeof item.type === "string" ? item.type : "unknown";
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    },
    {},
  ),
  structuredContentPresent: result.structuredContent !== undefined,
});

const durationSince = (startedAt: number) =>
  Math.max(0, Math.round(performance.now() - startedAt));

export const executeRuntimeMcpTool = async (input: {
  mcpConnectionId: string;
  mcpToolId: string;
  arguments: Record<string, unknown>;
  oauthRefreshAttempted?: boolean;
}): Promise<RuntimeMcpToolExecutionResult> => {
  const startedAt = performance.now();
  let client: Client | undefined;
  const [row] = await getDatabase()
    .select({ connection: mcpConnections, tool: mcpTools })
    .from(mcpTools)
    .innerJoin(mcpConnections, eq(mcpTools.connectionId, mcpConnections.id))
    .where(
      and(
        eq(mcpConnections.id, input.mcpConnectionId),
        eq(mcpTools.id, input.mcpToolId),
      ),
    )
    .limit(1);

  if (!row?.connection.endpointUrl || row.connection.transport === "stdio") {
    return {
      status: "failed",
      errorCode: "MCP_CONNECTION_UNAVAILABLE",
      errorMessage: "The approved MCP connection is unavailable.",
      durationMs: durationSince(startedAt),
      redactedSummary: { reason: "connection_unavailable" },
    };
  }

  try {
    const endpoint = await validateMcpEndpoint(row.connection.endpointUrl);
    const encrypted = await getEncryptedCredential(row.connection.id);
    const credential = encrypted ? await decryptCredential(encrypted) : undefined;
    const authentication = toMcpAuthentication(credential);
    const oauthProvider =
      credential?.type === "oauth2"
        ? await PersistentOAuthProvider.load(
            row.connection.id,
            process.env.APP_URL ?? "http://localhost:3040",
          )
        : undefined;
    const safeFetch = createMcpFetch(
      endpoint,
      "customHeaders" in authentication ? authentication.customHeaders : {},
    );
    const authProvider =
      oauthProvider ??
      ("authProvider" in authentication ? authentication.authProvider : undefined);

    client = new Client(
      { name: "agents", version: "0.1.0" },
      {
        cachePartition: row.connection.userId,
        listMaxPages: 64,
        versionNegotiation: {
          mode: "auto",
          probe: { timeoutMs: 5_000, maxRetries: 0 },
        },
      },
    );

    const transport =
      row.connection.transport === "sse"
        ? new SSEClientTransport(endpoint, { authProvider, fetch: safeFetch })
        : new StreamableHTTPClientTransport(endpoint, {
            authProvider,
            fetch: safeFetch,
          });

    await client.connect(transport, {
      timeout: 10_000,
      maxTotalTimeout: 15_000,
    });

    const toolDefinition: Tool = {
      name: row.tool.name,
      inputSchema: row.tool.inputSchema as Tool["inputSchema"],
      ...(row.tool.title ? { title: row.tool.title } : {}),
      ...(row.tool.description ? { description: row.tool.description } : {}),
      ...(row.tool.outputSchema
        ? {
            outputSchema: row.tool.outputSchema as NonNullable<
              Tool["outputSchema"]
            >,
          }
        : {}),
      ...(row.tool.annotations
        ? {
            annotations: row.tool.annotations as NonNullable<
              Tool["annotations"]
            >,
          }
        : {}),
    };

    const result = await client.callTool(
      {
        name: row.tool.name,
        arguments: input.arguments,
      },
      {
        timeout: 30_000,
        maxTotalTimeout: 45_000,
        toolDefinition,
      },
    );
    const redactedSummary = summarizeMcpResult(result);
    const durationMs = durationSince(startedAt);

    if (result.isError === true) {
      return {
        status: "failed",
        errorCode: "MCP_TOOL_ERROR",
        errorMessage: "The MCP tool reported an error.",
        durationMs,
        redactedSummary,
      };
    }

    return {
      status: "succeeded",
      result,
      durationMs,
      redactedSummary,
    };
  } catch (error) {
    const failure = classifyMcpExecutionFailure(error);
    if (
      row.connection.authType === "oauth2" &&
      failure.authRequired &&
      !input.oauthRefreshAttempted
    ) {
      try {
        const endpoint = await validateMcpEndpoint(row.connection.endpointUrl);
        const provider = await PersistentOAuthProvider.load(
          row.connection.id,
          process.env.APP_URL ?? "http://localhost:3040",
        );
        const tokens = provider.tokens();
        if (
          shouldAttemptOAuthRefresh({
            authRequired: true,
            hasRefreshToken: Boolean(tokens?.refresh_token),
            refreshAttempted: false,
          }) &&
          (await auth(provider, {
            serverUrl: endpoint,
            fetchFn: createMcpFetch(endpoint, {}),
          })) === "AUTHORIZED"
        ) {
          return executeRuntimeMcpTool({
            ...input,
            oauthRefreshAttempted: true,
          });
        }
      } catch {
        // The stable failure below keeps credentials and provider details private.
      }
    }
    if (failure.authRequired) {
      await markConnectionAuthRequired(row.connection.id).catch(() => undefined);
    }
    return {
      status: "failed",
      errorCode: failure.errorCode,
      errorMessage: failure.userMessage,
      durationMs: durationSince(startedAt),
      redactedSummary: {
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      },
    };
  } finally {
    await client?.close().catch(() => undefined);
  }
};

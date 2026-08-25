import type {
	AgentToolRisk,
	InteractiveAgentApprovalPolicy,
	McpConnection,
	McpConnectionResult,
	McpToolCallResult,
} from "@agents/contracts";
import {
	getInteractiveAgentPreferences,
	PostgresEncryptedArtifactStorage,
} from "@agents/db";
import {
	auth,
	Client,
	fromJsonSchema,
	type JsonSchemaType,
	OAuthClientFlowError,
	OAuthError,
	OAuthErrorCode,
	SdkError,
	SSEClientTransport,
	StreamableHTTPClientTransport,
	UnauthorizedError,
	type Tool,
} from "@modelcontextprotocol/client";
import {
	CredentialEncryptionConfigurationError,
	decryptCredential,
	encryptCredential,
	toMcpAuthentication,
	type StoredMcpCredential,
} from "./credentials";
import {
	createConnection,
	createToolCall,
	completeToolCall,
	denyToolCall,
	deleteConnection,
	findConnection,
	findToolCall,
	findToolCallByIdempotency,
	findPendingToolCallForAgentTurn,
	findToolForExecution,
	getEncryptedCredential,
	listConnections,
	listTools,
	markConnectionConnected,
	markConnectionAuthRequired,
	markConnectionFailed,
	markToolCallApprovedAndRunning,
	replaceDiscoveredTools,
	saveEncryptedCredential,
	setConnectionOAuthCredential,
	toConnectionView,
	updateToolPolicy,
	updateToolPolicies,
} from "./repository";
import { validateBulkToolPolicyUpdate } from "./bulk-tool-policy";
import { decideInteractiveAgentToolCall } from "./interactive-agent-policy";
import {
	classifyMcpExecutionFailure,
	shouldAttemptOAuthRefresh,
} from "./execution-failure";
import { PersistentOAuthProvider } from "./oauth-provider";
import {
	oauthReconnectStrategy,
	resetOAuthCredentialForReauthorization,
} from "./oauth-reauthorization";
import {
	consumeOAuthState,
	deleteOAuthState,
	saveOAuthState,
} from "./oauth-state";
import { createMcpFetch, validateMcpEndpoint } from "./url-safety";
import {
	hashToolArguments,
	redactToolArguments,
	summarizeToolResult,
	toolCallNeedsApproval,
} from "./tool-call-policy";

export type ServiceError =
	| { _tag: "InvalidRequest"; message: string }
	| { _tag: "NotFound"; message: string }
	| { _tag: "Conflict"; message: string }
	| { _tag: "ServiceUnavailable"; message: string }
	| { _tag: "McpConnectionFailed"; message: string; code: string }
	| { _tag: "CredentialsNotConfigured"; message: string };

interface CreateConnectionInput {
	name: string;
	endpointUrl: string;
	transport: "streamable_http" | "sse";
	authType: "auto" | "none" | "bearer" | "oauth2" | "custom_headers";
	bearerToken?: string;
	customHeaders?: Record<string, string>;
}

interface PrepareToolCallInput {
	toolId: string;
	arguments: Record<string, unknown>;
	idempotencyKey: string;
}

interface PrepareInteractiveAgentToolCallInput extends PrepareToolCallInput {
	conversationId: string;
	agentTurnId: string;
	stepNumber: number;
	reason: string;
}

interface ApproveToolCallInput {
	callId: string;
	arguments: Record<string, unknown>;
}

const awaitingApprovalResult = (callId: string): McpToolCallResult => ({
	callId,
	status: "awaiting_approval",
	approvalRequired: true,
	isError: false,
	result: null,
	errorMessage: null,
	durationMs: null,
});

const artifactStorage = new PostgresEncryptedArtifactStorage();

const readJsonArtifact = async (artifactId: string) => {
	const payload = await artifactStorage.readArtifactPayload(artifactId);
	const value = JSON.parse(new TextDecoder().decode(payload)) as unknown;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Encrypted tool arguments are invalid.");
	}
	return value as Record<string, unknown>;
};

const invalidRequest = (message: string): ServiceError => ({
	_tag: "InvalidRequest",
	message,
});

const safeDiagnosticMessage = (error: unknown) =>
	(error instanceof Error ? error.message : String(error))
		.replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
		.replace(/(token|secret|password)=([^&\s]+)/gi, "$1=<redacted>")
		.slice(0, 500);

const notFound = (message: string): ServiceError => ({
	_tag: "NotFound",
	message,
});

export const normalizeDatabaseError = (error: unknown): ServiceError | null => {
	let candidate = error;
	let isDatabaseError = false;

	for (let depth = 0; depth < 4; depth += 1) {
		if (!candidate || typeof candidate !== "object") {
			break;
		}

		if (
			("code" in candidate && candidate.code === "23505") ||
			("errno" in candidate && candidate.errno === "23505")
		) {
			return {
				_tag: "Conflict",
				message: "You already have an MCP connection with this name.",
			};
		}

		isDatabaseError ||=
			candidate.constructor?.name === "DrizzleQueryError" ||
			("code" in candidate && candidate.code === "ERR_POSTGRES_SERVER_ERROR");

		candidate = "cause" in candidate ? candidate.cause : undefined;
	}

	return isDatabaseError
		? {
				_tag: "ServiceUnavailable",
				message: "The database request could not be completed.",
			}
		: null;
};

const validateHeaders = (headers: Record<string, string>) => {
	const prohibited = new Set([
		"authorization",
		"connection",
		"content-length",
		"cookie",
		"host",
		"proxy-authorization",
		"transfer-encoding",
	]);
	const normalized: Record<string, string> = {};

	for (const [rawName, rawValue] of Object.entries(headers)) {
		const name = rawName.trim().toLowerCase();
		const value = rawValue.trim();

		if (!name || !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
			throw new Error(`Invalid custom header name: ${rawName}`);
		}

		if (prohibited.has(name)) {
			throw new Error(`The ${name} header cannot be configured manually.`);
		}

		if (!value || value.length > 8_192 || /[\r\n]/.test(value)) {
			throw new Error(`Invalid value for the ${name} header.`);
		}

		normalized[name] = value;
	}

	if (Object.keys(normalized).length === 0) {
		throw new Error("Add at least one custom authentication header.");
	}

	return normalized;
};

const generateOAuthState = () =>
	Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

const prepareCredential = async (
	input: CreateConnectionInput,
): Promise<StoredMcpCredential | undefined> => {
	if (input.authType === "auto" || input.authType === "none") {
		return undefined;
	}

	if (input.authType === "oauth2") {
		return {
			type: "oauth2",
			state: generateOAuthState(),
		};
	}

	if (input.authType === "bearer") {
		const token = input.bearerToken?.trim();
		if (!token || token.length > 8_192) {
			throw new Error("Enter a valid bearer token.");
		}
		return { type: "bearer", token };
	}

	return {
		type: "custom_headers",
		headers: validateHeaders(input.customHeaders ?? {}),
	};
};

export const shouldRetryAutomaticAuthWithOAuth = (error: unknown) =>
	UnauthorizedError.isInstance(error);

const connectionFailure = (error: unknown): ServiceError => {
	if (error instanceof CredentialEncryptionConfigurationError) {
		return { _tag: "CredentialsNotConfigured", message: error.message };
	}

	const code =
		error instanceof UnauthorizedError
			? "MCP_UNAUTHORIZED"
			: error instanceof SdkError
				? String(error.code)
				: "MCP_CONNECTION_FAILED";
	const message =
		error instanceof Error
			? error.message.slice(0, 500)
			: "The MCP server connection failed.";

	return { _tag: "McpConnectionFailed", code, message };
};

export const oauthCompletionFailure = (
	error: unknown,
): ServiceError | null => {
	if (error instanceof OAuthError) {
		return error.code === OAuthErrorCode.InvalidGrant
			? invalidRequest(
					"This authorization attempt expired or was replaced by a newer attempt. Return to connections and try again.",
				)
			: invalidRequest(
					"The authorization server rejected this request. Return to connections and try again.",
				);
	}

	if (error instanceof OAuthClientFlowError) {
		return invalidRequest(
			"The authorization response could not be verified. Return to connections and try again.",
		);
	}

	return null;
};

const connectUsing = async (input: {
	userId: string;
	connectionId: string;
	endpoint: URL;
	transport: "streamable_http" | "sse";
	credential?: StoredMcpCredential;
}) => {
	const authentication = toMcpAuthentication(input.credential);
	const oauthProvider =
		input.credential?.type === "oauth2"
			? await PersistentOAuthProvider.load(
					input.connectionId,
					process.env.APP_URL ?? "http://localhost:3040",
				)
			: undefined;
	const safeFetch = createMcpFetch(
		input.endpoint,
		"customHeaders" in authentication ? authentication.customHeaders : {},
	);
	const authProvider =
		oauthProvider ??
		("authProvider" in authentication
			? authentication.authProvider
			: undefined);
	const client = new Client(
		{ name: "agents", version: "0.1.0" },
		{
			cachePartition: input.userId,
			listMaxPages: 64,
			versionNegotiation: {
				mode: "auto",
				probe: { timeoutMs: 5_000, maxRetries: 0 },
			},
		},
	);
	const transport =
		input.transport === "sse"
			? new SSEClientTransport(input.endpoint, {
					authProvider,
					fetch: safeFetch,
				})
			: new StreamableHTTPClientTransport(input.endpoint, {
					authProvider,
					fetch: safeFetch,
				});

	try {
		try {
			await client.connect(transport, {
				timeout: 10_000,
				maxTotalTimeout: 15_000,
			});
		} catch (error) {
			if (oauthProvider?.authorizationUrl) {
				return {
					kind: "auth_required" as const,
					authorizationUrl: oauthProvider.authorizationUrl,
				};
			}
			if (oauthProvider?.clientInformation()) {
				return { kind: "oauth_retry" as const };
			}
			throw error;
		}
		const { tools } = await client.listTools(undefined, {
			timeout: 10_000,
			maxTotalTimeout: 15_000,
			cacheMode: "refresh",
		});
		const server = client.getServerVersion();

		return {
			kind: "connected" as const,
			transport: input.transport,
			tools: tools as Tool[],
			serverName: server?.name ?? null,
			serverVersion: server?.version ?? null,
			protocolVersion: client.getNegotiatedProtocolVersion() ?? null,
			capabilities: (client.getServerCapabilities() ?? {}) as Record<
				string,
				unknown
			>,
		};
	} finally {
		await client.close().catch(() => undefined);
	}
};

const discoverConnection = async (input: {
	userId: string;
	connectionId: string;
	endpointUrl: string;
	transport: "streamable_http" | "sse";
	credential?: StoredMcpCredential;
}) => {
	const endpoint = await validateMcpEndpoint(input.endpointUrl);
	let discovery: Awaited<ReturnType<typeof connectUsing>>;

	try {
		discovery = await connectUsing({
			userId: input.userId,
			connectionId: input.connectionId,
			endpoint,
			transport: input.transport,
			credential: input.credential,
		});
	} catch (streamableError) {
		if (
			input.transport === "sse" ||
			(streamableError &&
				typeof streamableError === "object" &&
				"kind" in streamableError)
		) {
			throw streamableError;
		}

		discovery = await connectUsing({
			userId: input.userId,
			connectionId: input.connectionId,
			endpoint,
			transport: "sse",
			credential: input.credential,
		});
	}

	if (discovery.kind === "oauth_retry") {
		discovery = await connectUsing({
			userId: input.userId,
			connectionId: input.connectionId,
			endpoint,
			transport: input.transport,
			credential: input.credential,
		});
	}

	if (discovery.kind === "oauth_retry") {
		throw new Error("OAuth authorization discovery did not complete.");
	}

	if (discovery.kind === "auth_required") {
		const row = await markConnectionAuthRequired(input.connectionId);
		return {
			connection: row,
			authorizationUrl: discovery.authorizationUrl,
		};
	}

	await replaceDiscoveredTools(input.connectionId, discovery.tools);
	const row = await markConnectionConnected({
		connectionId: input.connectionId,
		transport: discovery.transport,
		serverName: discovery.serverName,
		serverVersion: discovery.serverVersion,
		protocolVersion: discovery.protocolVersion,
		capabilities: discovery.capabilities,
	});
	return { connection: row, authorizationUrl: null };
};

type ToolExecutionContext = NonNullable<
	Awaited<ReturnType<typeof findToolForExecution>>
>;

const validateToolReady = (
	context: ToolExecutionContext,
): ServiceError | null => {
	if (context.connection.status !== "connected") {
		return {
			_tag: "Conflict",
			message: "Reconnect this MCP server before calling its tools.",
		};
	}
	if (!context.tool.available) {
		return {
			_tag: "Conflict",
			message: "This MCP tool is no longer advertised by the server.",
		};
	}
	if (!context.tool.enabled) {
		return {
			_tag: "Conflict",
			message: "Enable this MCP tool before calling it.",
		};
	}
	if (!context.connection.endpointUrl || context.connection.transport === "stdio") {
		return notFound("MCP connection not found.");
	}
	return null;
};

const validateToolArguments = async (
	context: ToolExecutionContext,
	argumentsValue: Record<string, unknown>,
): Promise<ServiceError | null> => {
	const encoded = JSON.stringify(argumentsValue);
	if (encoded.length > 65_536) {
		return invalidRequest("Tool arguments must be 64 KB or smaller.");
	}

	try {
		const schema = fromJsonSchema(
			context.tool.inputSchema as JsonSchemaType,
		);
		const validation = await schema["~standard"].validate(argumentsValue);
		if (validation.issues) {
			return invalidRequest(
				`Tool arguments do not match the advertised schema: ${validation.issues[0]?.message.slice(0, 200) ?? "invalid arguments"}`,
			);
		}
	} catch {
		return invalidRequest(
			"This server advertised an invalid input schema for the tool.",
		);
	}

	return null;
};

const executeToolCall = async (input: {
	callId: string;
	userId: string;
	context: ToolExecutionContext;
	arguments: Record<string, unknown>;
	approvalRequired: boolean;
	persistResultArtifact?: boolean;
	oauthRefreshAttempted?: boolean;
}): Promise<McpToolCallResult> => {
	const startedAt = performance.now();
	const duration = () => Math.max(0, Math.round(performance.now() - startedAt));
	let client: Client | undefined;

	try {
		const endpoint = await validateMcpEndpoint(
			input.context.connection.endpointUrl ?? "",
		);
		const encrypted = await getEncryptedCredential(input.context.connection.id);
		const credential = encrypted
			? await decryptCredential(encrypted)
			: undefined;
		const authentication = toMcpAuthentication(credential);
		const oauthProvider =
			credential?.type === "oauth2"
				? await PersistentOAuthProvider.load(
						input.context.connection.id,
						process.env.APP_URL ?? "http://localhost:3040",
					)
				: undefined;
		const safeFetch = createMcpFetch(
			endpoint,
			"customHeaders" in authentication ? authentication.customHeaders : {},
		);
		const authProvider =
			oauthProvider ??
			("authProvider" in authentication
				? authentication.authProvider
				: undefined);

		client = new Client(
			{ name: "agents", version: "0.1.0" },
			{
				cachePartition: input.userId,
				listMaxPages: 64,
				versionNegotiation: {
					mode: "auto",
					probe: { timeoutMs: 5_000, maxRetries: 0 },
				},
			},
		);
		const transport =
			input.context.connection.transport === "sse"
				? new SSEClientTransport(endpoint, {
						authProvider,
						fetch: safeFetch,
					})
				: new StreamableHTTPClientTransport(endpoint, {
						authProvider,
						fetch: safeFetch,
					});

		await client.connect(transport, {
			timeout: 10_000,
			maxTotalTimeout: 15_000,
		});
		const toolDefinition: Tool = {
			name: input.context.tool.name,
			inputSchema: input.context.tool.inputSchema as Tool["inputSchema"],
			...(input.context.tool.title
				? { title: input.context.tool.title }
				: {}),
			...(input.context.tool.description
				? { description: input.context.tool.description }
				: {}),
			...(input.context.tool.outputSchema
				? {
						outputSchema: input.context.tool.outputSchema as NonNullable<
							Tool["outputSchema"]
						>,
					}
				: {}),
			...(input.context.tool.annotations
				? {
						annotations: input.context.tool.annotations as NonNullable<
							Tool["annotations"]
						>,
					}
				: {}),
		};
		const result = await client.callTool(
			{
				name: input.context.tool.name,
				arguments: input.arguments,
			},
			{
				timeout: 30_000,
				maxTotalTimeout: 45_000,
				toolDefinition,
			},
		);
		const durationMs = duration();
		const failed = result.isError === true;
		const resultArtifact = input.persistResultArtifact
			? await artifactStorage.createArtifact({
					owner: { ownerType: "user", ownerId: input.userId },
					purpose: "tool_result",
					sensitivity: "restricted",
					payload: JSON.stringify(result),
					contentType: "application/json",
					createdByUserId: input.userId,
					redactedSummary: summarizeToolResult(result),
				})
			: null;
		await completeToolCall({
			callId: input.callId,
			status: failed ? "failed" : "succeeded",
			resultRedacted: summarizeToolResult(result),
			errorCode: failed ? "MCP_TOOL_ERROR" : undefined,
			errorMessage: failed ? "The MCP tool reported an error." : undefined,
			durationMs,
			resultArtifactId: resultArtifact?.id,
		});

		return {
			callId: input.callId,
			status: failed ? "failed" : "succeeded",
			approvalRequired: input.approvalRequired,
			isError: failed,
			result,
			errorMessage: failed ? "The MCP tool reported an error." : null,
			durationMs,
		};
	} catch (error) {
		const durationMs = duration();
		const failure = classifyMcpExecutionFailure(error);
		if (
			input.context.connection.authType === "oauth2" &&
			shouldAttemptOAuthRefresh({
				authRequired: failure.authRequired,
				hasRefreshToken: true,
				refreshAttempted: input.oauthRefreshAttempted === true,
			})
		) {
			try {
				const endpoint = await validateMcpEndpoint(
					input.context.connection.endpointUrl ?? "",
				);
				const provider = await PersistentOAuthProvider.load(
					input.context.connection.id,
					process.env.APP_URL ?? "http://localhost:3040",
				);
				const tokens = provider.tokens();
				if (
					shouldAttemptOAuthRefresh({
						authRequired: failure.authRequired,
						hasRefreshToken: Boolean(tokens?.refresh_token),
						refreshAttempted: input.oauthRefreshAttempted === true,
					})
				) {
					const refreshResult = await auth(provider, {
						serverUrl: endpoint,
						fetchFn: createMcpFetch(endpoint, {}),
					});
					if (refreshResult === "AUTHORIZED") {
						return executeToolCall({
							...input,
							oauthRefreshAttempted: true,
						});
					}
				}
			} catch (refreshError) {
				console.error("[mcp.oauth.refresh] failed", {
					connectionId: input.context.connection.id,
					message: safeDiagnosticMessage(refreshError),
				});
			}
		}
		console.error("[mcp.tool_call.execute] failed", {
			callId: input.callId,
			toolName: input.context.tool.name,
			errorName: error instanceof Error ? error.name : typeof error,
			message: safeDiagnosticMessage(error),
		});
		if (failure.authRequired) {
			await markConnectionAuthRequired(input.context.connection.id).catch(
				() => undefined,
			);
		}
		await completeToolCall({
			callId: input.callId,
			status: "failed",
			errorCode: failure.errorCode,
			errorMessage: failure.userMessage,
			durationMs,
		});
		return {
			callId: input.callId,
			status: "failed",
			approvalRequired: input.approvalRequired,
			isError: true,
			result: null,
			errorMessage: failure.userMessage,
			durationMs,
		};
	} finally {
		await client?.close().catch(() => undefined);
	}
};

export const mcpService = {
	listConnections,

	async listInteractiveAgentTools(userId: string) {
		const connections = await listConnections(userId);
		const groups = await Promise.all(
			connections
				.filter((connection) => connection.status === "connected")
				.map(async (connection) => ({
					connection,
					tools: (await listTools(userId, connection.id)) ?? [],
				})),
		);
		return groups.flatMap(({ connection, tools }) =>
			tools
				.filter((tool) => tool.enabled && tool.available)
				.map((tool) => ({ ...tool, connectionName: connection.name })),
		);
	},

	async createConnection(
		userId: string,
		input: CreateConnectionInput,
	): Promise<
		| { connection: McpConnection; authorizationUrl: string | null }
		| ServiceError
	> {
		const name = input.name.trim();
		if (!name || name.length > 80) {
			return invalidRequest(
				"Connection names must contain 1 to 80 characters.",
			);
		}

		let endpoint: URL;
		let credential: StoredMcpCredential | undefined;
		try {
			endpoint = await validateMcpEndpoint(input.endpointUrl.trim());
			credential = await prepareCredential(input);
		} catch (error) {
			return invalidRequest(
				error instanceof Error ? error.message : "Invalid MCP connection.",
			);
		}

		try {
			const row = await createConnection({
				userId,
				name,
				endpointUrl: endpoint.toString(),
				transport: input.transport,
				authType: input.authType === "auto" ? "none" : input.authType,
				encryptedCredential: credential
					? await encryptCredential(credential)
					: undefined,
			});

			if (credential?.type === "oauth2") {
				await saveOAuthState(credential.state, {
					userId,
					connectionId: row.id,
				});
			}

			try {
				let activeCredential = credential;
				let discovered: Awaited<ReturnType<typeof discoverConnection>>;
				try {
					discovered = await discoverConnection({
						userId,
						connectionId: row.id,
						endpointUrl: endpoint.toString(),
						transport: input.transport,
						credential: activeCredential,
					});
				} catch (error) {
					if (
						input.authType !== "auto" ||
						!shouldRetryAutomaticAuthWithOAuth(error)
					) {
						throw error;
					}
					activeCredential = {
						type: "oauth2",
						state: generateOAuthState(),
					};
					await setConnectionOAuthCredential(
						row.id,
						await encryptCredential(activeCredential),
					);
					await saveOAuthState(activeCredential.state, {
						userId,
						connectionId: row.id,
					});
					discovered = await discoverConnection({
						userId,
						connectionId: row.id,
						endpointUrl: endpoint.toString(),
						transport: input.transport,
						credential: activeCredential,
					});
				}
				return {
					connection: toConnectionView(discovered.connection),
					authorizationUrl: discovered.authorizationUrl,
				};
			} catch (error) {
				const failure = connectionFailure(error);
				if (failure._tag === "McpConnectionFailed") {
					const failedRow = await markConnectionFailed(
						row.id,
						failure.code,
						failure.message,
					);
					if (failedRow) {
						return {
							connection: toConnectionView(failedRow),
							authorizationUrl: null,
						};
					}
				}
				return failure;
			}
		} catch (error) {
			return normalizeDatabaseError(error) ?? connectionFailure(error);
		}
	},

	async refreshConnection(
		userId: string,
		connectionId: string,
	): Promise<McpConnectionResult | ServiceError> {
		const row = await findConnection(userId, connectionId);
		if (!row?.endpointUrl || row.transport === "stdio") {
			return notFound("MCP connection not found.");
		}

		try {
			const encrypted = await getEncryptedCredential(row.id);
			const credential = encrypted
				? await decryptCredential(encrypted)
				: undefined;
			let refreshCredential = credential;
			let requireFreshAuthorization =
				credential?.type === "oauth2" &&
				oauthReconnectStrategy(credential) === "reauthorize";

			if (
				credential?.type === "oauth2" &&
				oauthReconnectStrategy(credential) === "refresh"
			) {
				const endpoint = await validateMcpEndpoint(row.endpointUrl);
				const provider = await PersistentOAuthProvider.load(
					row.id,
					process.env.APP_URL ?? "http://localhost:3040",
				);
				try {
					const refreshResult = await auth(provider, {
						serverUrl: endpoint,
						fetchFn: createMcpFetch(endpoint, {}),
					});
					if (refreshResult === "AUTHORIZED") {
						const refreshed = await getEncryptedCredential(row.id);
						refreshCredential = refreshed
							? await decryptCredential(refreshed)
							: undefined;
					} else if (provider.authorizationUrl) {
						await saveOAuthState(credential.state, {
							userId,
							connectionId: row.id,
						});
						const authRow = await markConnectionAuthRequired(row.id);
						return {
							connection: toConnectionView(authRow),
							authorizationUrl: provider.authorizationUrl,
						};
					}
				} catch (error) {
					if (
						!(error instanceof OAuthError) ||
						error.code !== OAuthErrorCode.InvalidGrant
					) {
						throw error;
					}
					requireFreshAuthorization = true;
				}
			}

			if (credential?.type === "oauth2" && requireFreshAuthorization) {
				refreshCredential = resetOAuthCredentialForReauthorization(
					credential,
					generateOAuthState(),
				);
				const previousState = credential.state;
				await saveEncryptedCredential(
					row.id,
					await encryptCredential(refreshCredential),
				);
				await deleteOAuthState(previousState);
			}
			const discovered = await discoverConnection({
				userId,
				connectionId: row.id,
				endpointUrl: row.endpointUrl,
				transport: row.transport,
				credential: refreshCredential,
			});
			if (
				discovered.authorizationUrl &&
				refreshCredential?.type === "oauth2"
			) {
				await saveOAuthState(refreshCredential.state, {
					userId,
					connectionId: row.id,
				});
			}
			return {
				connection: toConnectionView(discovered.connection),
				authorizationUrl: discovered.authorizationUrl,
			};
		} catch (error) {
			const failure = connectionFailure(error);
			if (failure._tag === "McpConnectionFailed") {
				await markConnectionFailed(row.id, failure.code, failure.message);
			}
			return failure;
		}
	},

	async completeOAuth(
		userId: string,
		input: { state: string; code: string; iss?: string },
	): Promise<McpConnection | ServiceError> {
		const oauthState = await consumeOAuthState(input.state);
		if (!oauthState || oauthState.userId !== userId) {
			return invalidRequest("The OAuth request is invalid or has expired.");
		}

		const row = await findConnection(userId, oauthState.connectionId);
		if (
			!row?.endpointUrl ||
			row.authType !== "oauth2" ||
			row.transport === "stdio"
		) {
			return notFound("MCP connection not found.");
		}

		try {
			const encrypted = await getEncryptedCredential(row.id);
			const credential = encrypted
				? await decryptCredential(encrypted)
				: undefined;
			if (credential?.type !== "oauth2") {
				return invalidRequest("OAuth connection credentials are missing.");
			}
			if (credential.state !== input.state) {
				return invalidRequest(
					"This authorization attempt was replaced by a newer attempt. Return to connections and try again.",
				);
			}

			const endpoint = await validateMcpEndpoint(row.endpointUrl);
			const provider = await PersistentOAuthProvider.load(
				row.id,
				process.env.APP_URL ?? "http://localhost:3040",
			);
			const safeFetch = createMcpFetch(endpoint);
			const client = new Client(
				{ name: "agents", version: "0.1.0" },
				{ cachePartition: userId, listMaxPages: 64 },
			);
			const transport =
				row.transport === "sse"
					? new SSEClientTransport(endpoint, {
							authProvider: provider,
							fetch: safeFetch,
						})
					: new StreamableHTTPClientTransport(endpoint, {
							authProvider: provider,
							fetch: safeFetch,
						});

			try {
				const params = new URLSearchParams({ code: input.code });
				if (input.iss) {
					params.set("iss", input.iss);
				}
				await transport.finishAuth(params);
			} finally {
				await transport.close().catch(() => undefined);
			}

			const refreshedEncrypted = await getEncryptedCredential(row.id);
			const refreshedCredential = refreshedEncrypted
				? await decryptCredential(refreshedEncrypted)
				: undefined;
			const discovered = await discoverConnection({
				userId,
				connectionId: row.id,
				endpointUrl: row.endpointUrl,
				transport: row.transport,
				credential: refreshedCredential,
			});
			if (discovered.authorizationUrl) {
				return invalidRequest("OAuth authorization did not complete.");
			}
			return toConnectionView(discovered.connection);
		} catch (error) {
			const failure =
				oauthCompletionFailure(error) ??
				normalizeDatabaseError(error) ??
				connectionFailure(error);
			if (failure._tag === "McpConnectionFailed") {
				await markConnectionFailed(row.id, failure.code, failure.message);
			}
			return failure;
		}
	},

	async prepareToolCall(
		userId: string,
		input: PrepareToolCallInput,
	): Promise<McpToolCallResult | ServiceError> {
		if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey)) {
			return invalidRequest("The tool request identifier is invalid.");
		}

		try {
			const context = await findToolForExecution(userId, input.toolId);
			if (!context) {
				return notFound("MCP tool not found.");
			}
			const readinessError = validateToolReady(context);
			if (readinessError) {
				return readinessError;
			}
			const argumentError = await validateToolArguments(context, input.arguments);
			if (argumentError) {
				return argumentError;
			}

			const argumentsHash = await hashToolArguments(input.arguments);
			const approvalRequired = toolCallNeedsApproval(
				context.tool.approvalMode,
				context.tool.annotations,
			);
			const call = await createToolCall({
				userId,
				connectionId: context.connection.id,
				toolId: context.tool.id,
				idempotencyKey: input.idempotencyKey,
				connectionName: context.connection.name,
				toolName: context.tool.name,
				argumentsRedacted: redactToolArguments(input.arguments),
				argumentsHash,
				requiresApproval: approvalRequired,
			});

			if (!call) {
				const existing = await findToolCallByIdempotency(
					userId,
					input.idempotencyKey,
				);
				if (
					existing?.toolId === context.tool.id &&
					existing.argumentsHash === argumentsHash &&
					existing.status === "awaiting_approval"
				) {
					return awaitingApprovalResult(existing.id);
				}
				return {
					_tag: "Conflict",
					message: "This tool request identifier has already been used.",
				};
			}

			if (approvalRequired) {
				return awaitingApprovalResult(call.id);
			}

			return executeToolCall({
				callId: call.id,
				userId,
				context,
				arguments: input.arguments,
				approvalRequired: false,
			});
		} catch (error) {
			return (
				normalizeDatabaseError(error) ?? {
					_tag: "ServiceUnavailable",
					message: "The tool request could not be prepared.",
				}
			);
		}
	},

	async prepareInteractiveAgentToolCall(
		userId: string,
		input: PrepareInteractiveAgentToolCallInput,
	) {
		if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey)) {
			return invalidRequest("The tool request identifier is invalid.");
		}
		try {
			const context = await findToolForExecution(userId, input.toolId);
			if (!context) return notFound("MCP tool not found.");
			const readinessError = validateToolReady(context);
			if (readinessError) return readinessError;
			const argumentError = await validateToolArguments(context, input.arguments);
			if (argumentError) return argumentError;

			const argumentsHash = await hashToolArguments(input.arguments);
			const existing = await findToolCallByIdempotency(
				userId,
				input.idempotencyKey,
			);
			if (existing) {
				if (
					existing.toolId !== context.tool.id ||
					existing.argumentsHash !== argumentsHash
				) {
					return { _tag: "Conflict" as const, message: "Tool call replay mismatch." };
				}
				return {
					call: existing.status === "awaiting_approval"
						? awaitingApprovalResult(existing.id)
						: {
								callId: existing.id,
								status: existing.status === "succeeded" ? "succeeded" as const : "failed" as const,
								approvalRequired: existing.approvalStatus !== "not_required",
								isError: existing.status !== "succeeded",
								result: existing.resultRedacted,
								errorMessage: existing.errorMessage,
								durationMs: existing.durationMs,
							},
					tool: {
						id: context.tool.id,
						name: context.tool.name,
						connectionName: context.connection.name,
					},
					risk: (existing.riskClassification ?? "unknown") as AgentToolRisk,
					reason: existing.agentReason ?? input.reason,
					argumentsPreview: existing.argumentsRedacted,
				};
			}

			const preferences = await getInteractiveAgentPreferences(userId);
			const policy = decideInteractiveAgentToolCall({
				preference: preferences.approvalPolicy,
				tool: {
					name: context.tool.name,
					description: context.tool.description,
					approvalMode: context.tool.approvalMode,
					annotations: context.tool.annotations,
				},
			});
			const argumentsPreview = redactToolArguments(input.arguments);
			const artifact = await artifactStorage.createArtifact({
				owner: { ownerType: "user", ownerId: userId },
				purpose: "tool_arguments",
				sensitivity: "restricted",
				payload: JSON.stringify(input.arguments),
				contentType: "application/json",
				createdByUserId: userId,
				redactedSummary: argumentsPreview,
			});
			const approvalRequired = policy.decision === "ask";
			const call = await createToolCall({
				userId,
				connectionId: context.connection.id,
				toolId: context.tool.id,
				idempotencyKey: input.idempotencyKey,
				connectionName: context.connection.name,
				toolName: context.tool.name,
				argumentsRedacted: argumentsPreview,
				argumentsHash,
				requiresApproval: approvalRequired,
				conversationId: input.conversationId,
				agentTurnId: input.agentTurnId,
				stepNumber: input.stepNumber,
				argumentsArtifactId: artifact.id,
				agentReason: input.reason,
				riskClassification: policy.risk,
			});
			if (!call) {
				return { _tag: "Conflict" as const, message: "Tool call already exists." };
			}
			const callResult = approvalRequired
				? awaitingApprovalResult(call.id)
				: await executeToolCall({
						callId: call.id,
						userId,
						context,
						arguments: input.arguments,
						approvalRequired: false,
						persistResultArtifact: true,
					});
			return {
				call: callResult,
				tool: {
					id: context.tool.id,
					name: context.tool.name,
					connectionName: context.connection.name,
				},
				risk: policy.risk,
				reason: input.reason,
				argumentsPreview,
			};
		} catch (error) {
			return normalizeDatabaseError(error) ?? {
				_tag: "ServiceUnavailable" as const,
				message: "The interactive tool request could not be prepared.",
			};
		}
	},

	async approveInteractiveAgentToolCall(
		userId: string,
		input: { callId: string; agentTurnId: string },
	) {
		try {
			const call = await findToolCall(userId, input.callId);
			if (!call?.toolId || call.agentTurnId !== input.agentTurnId) {
				return notFound("Interactive MCP tool call not found.");
			}
			if (
				call.status !== "awaiting_approval" ||
				call.approvalStatus !== "pending" ||
				!call.argumentsArtifactId
			) {
				return { _tag: "Conflict" as const, message: "This tool call is no longer awaiting approval." };
			}
			const argumentsValue = await readJsonArtifact(call.argumentsArtifactId);
			if ((await hashToolArguments(argumentsValue)) !== call.argumentsHash) {
				return { _tag: "Conflict" as const, message: "Sealed tool arguments failed integrity verification." };
			}
			const context = await findToolForExecution(userId, call.toolId);
			if (!context) return notFound("MCP tool not found.");
			const readinessError = validateToolReady(context);
			if (readinessError) return readinessError;
			const argumentError = await validateToolArguments(context, argumentsValue);
			if (argumentError) return argumentError;
			const claimed = await markToolCallApprovedAndRunning(userId, call.id);
			if (!claimed) return { _tag: "Conflict" as const, message: "Tool call approval was already decided." };
			return executeToolCall({
				callId: call.id,
				userId,
				context,
				arguments: argumentsValue,
				approvalRequired: true,
				persistResultArtifact: true,
			});
		} catch (error) {
			return normalizeDatabaseError(error) ?? {
				_tag: "ServiceUnavailable" as const,
				message: "The interactive tool approval could not be completed.",
			};
		}
	},

	async denyInteractiveAgentToolCall(
		userId: string,
		input: { callId: string; agentTurnId: string },
	) {
		const call = await findToolCall(userId, input.callId);
		if (!call || call.agentTurnId !== input.agentTurnId) {
			return notFound("Interactive MCP tool call not found.");
		}
		const denied = await denyToolCall(userId, input.callId);
		return denied
			? { callId: denied.id, toolName: denied.toolName }
			: { _tag: "Conflict" as const, message: "Tool call approval was already decided." };
	},

	async getPendingInteractiveAgentToolCall(userId: string, agentTurnId: string) {
		const call = await findPendingToolCallForAgentTurn(userId, agentTurnId);
		return call
			? {
					callId: call.id,
					turnId: agentTurnId,
					toolId: call.toolId,
					toolName: call.toolName,
					connectionName: call.connectionName,
					reason: call.agentReason ?? "Use this tool to continue the task.",
					argumentsPreview: call.argumentsRedacted,
					risk: (call.riskClassification ?? "unknown") as AgentToolRisk,
				}
			: null;
	},

	async approveToolCall(
		userId: string,
		input: ApproveToolCallInput,
	): Promise<McpToolCallResult | ServiceError> {
		try {
			const call = await findToolCall(userId, input.callId);
			if (!call?.toolId) {
				return notFound("MCP tool call not found.");
			}
			if (
				call.status !== "awaiting_approval" ||
				call.approvalStatus !== "pending"
			) {
				return {
					_tag: "Conflict",
					message: "This MCP tool call is no longer awaiting approval.",
				};
			}

			const argumentsHash = await hashToolArguments(input.arguments);
			if (argumentsHash !== call.argumentsHash) {
				return {
					_tag: "Conflict",
					message: "The tool arguments changed after the approval request.",
				};
			}

			const context = await findToolForExecution(userId, call.toolId);
			if (!context) {
				return notFound("MCP tool not found.");
			}
			const readinessError = validateToolReady(context);
			if (readinessError) {
				return readinessError;
			}
			const argumentError = await validateToolArguments(context, input.arguments);
			if (argumentError) {
				return argumentError;
			}

			const claimed = await markToolCallApprovedAndRunning(userId, call.id);
			if (!claimed) {
				return {
					_tag: "Conflict",
					message: "This MCP tool call was already approved elsewhere.",
				};
			}

			return executeToolCall({
				callId: call.id,
				userId,
				context,
				arguments: input.arguments,
				approvalRequired: true,
			});
		} catch (error) {
			return (
				normalizeDatabaseError(error) ?? {
					_tag: "ServiceUnavailable",
					message: "The tool approval could not be completed.",
				}
			);
		}
	},

	listTools,
	updateToolPolicy,

	async updateToolPolicies(input: {
		userId: string;
		connectionId: string;
		toolIds: string[];
		enabled?: boolean;
		approvalMode?: "always" | "risky" | "never";
	}) {
		const tools = await listTools(input.userId, input.connectionId);
		if (!tools) return notFound("MCP connection not found.");
		const validationError = validateBulkToolPolicyUpdate(input, tools);
		if (validationError) return invalidRequest(validationError);
		const toolIds = [...new Set(input.toolIds)];
		const updated = await updateToolPolicies({ ...input, toolIds });
		if (updated.length !== toolIds.length) {
			return {
				_tag: "Conflict" as const,
				message: "One or more selected tools changed. Refresh and try again.",
			};
		}
		return updated;
	},
	deleteConnection,
};

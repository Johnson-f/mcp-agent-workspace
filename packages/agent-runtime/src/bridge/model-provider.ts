import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ModelAuthMode =
	| "api_key"
	| "codex_subscription"
	| "fallback"
	| "auto";

export interface TextModelRequest {
	provider: string;
	model: string;
	prompt: string;
	fallbackText: string;
	instructions?: string;
	tools?: ModelFunctionTool[];
}

export interface ModelFunctionTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	strict?: boolean;
}

export interface ModelFunctionCall {
	name: string;
	callId: string;
	arguments: Record<string, unknown>;
}

export interface TextModelResult {
	text: string;
	providerResponseId: string | null;
	promptTokens: number;
	completionTokens: number;
	fallback: boolean;
	authMode: Exclude<ModelAuthMode, "auto">;
	functionCalls: ModelFunctionCall[];
}

export type ModelReasoningSummaryEvent =
  | { type: "started"; providerItemId: string; summaryIndex: number }
  | {
      type: "delta";
      providerItemId: string;
      summaryIndex: number;
      delta: string;
    }
  | {
      type: "completed";
      providerItemId: string;
      summaryIndex: number;
      text: string;
    };

export interface StreamingTextModelOptions {
  signal?: AbortSignal;
  onTextDelta: (delta: string) => void | Promise<void>;
  onReasoningSummaryEvent?: (
    event: ModelReasoningSummaryEvent,
  ) => void | Promise<void>;
}

export interface CodexAuthTokens {
	access_token?: string;
	refresh_token?: string;
	account_id?: string;
	expires_at?: number | string;
}

export interface CodexAuthFile {
	auth_mode?: string;
	tokens?: CodexAuthTokens;
	OPENAI_API_KEY?: string;
}

export class ModelProviderConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelProviderConfigurationError";
	}
}

export class ModelProviderRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelProviderRequestError";
	}
}

const defaultCodexBaseUrl = "https://chatgpt.com/backend-api/codex";
const defaultCodexInstructions =
	"You are Codex, a concise automation agent. Follow the user's approved run brief, obey tool authorization boundaries, and respond with the requested JSON shape.";

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

export const codexAuthPath = (codexHome = process.env.CODEX_HOME) =>
	join(resolve(codexHome || join(homedir(), ".codex")), "auth.json");

const decodeBase64UrlJson = (value: string): Record<string, unknown> | null => {
	try {
		return JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		) as Record<string, unknown>;
	} catch {
		return null;
	}
};

export const decodeJwtPayload = (
	token: string,
): Record<string, unknown> | null => {
	const [, payload] = token.split(".");
	return payload ? decodeBase64UrlJson(payload) : null;
};

const jwtExpirySeconds = (token: string) => {
	const payload = decodeJwtPayload(token);
	return typeof payload?.exp === "number" ? payload.exp : null;
};

const tokenExpired = (token: string, expiresAt?: number | string) => {
	const explicit =
		typeof expiresAt === "number"
			? expiresAt
			: typeof expiresAt === "string" && expiresAt.trim()
				? Number(expiresAt)
				: null;
	const seconds = Number.isFinite(explicit)
		? Number(explicit)
		: jwtExpirySeconds(token);

	return seconds !== null && Date.now() >= (seconds - 60) * 1000;
};

const accountIdFromToken = (token: string) => {
	const payload = decodeJwtPayload(token);
	for (const key of [
		"chatgpt_account_id",
		"account_id",
		"https://api.openai.com/account_id",
	]) {
		const value = payload?.[key];
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}

	return null;
};

export const parseCodexAuthFile = (content: string): CodexAuthFile => {
	const parsed = JSON.parse(content) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new ModelProviderConfigurationError(
			"Codex auth file must be a JSON object.",
		);
	}

	return parsed as CodexAuthFile;
};

export const readCodexAuthFile = (path = codexAuthPath()) => {
	try {
		return parseCodexAuthFile(readFileSync(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new ModelProviderConfigurationError(
				`Codex auth file was not found at ${path}. Run \`codex login\` with ChatGPT sign-in first.`,
			);
		}
		if (error instanceof ModelProviderConfigurationError) {
			throw error;
		}
		throw new ModelProviderConfigurationError(
			`Codex auth file at ${path} could not be read or parsed.`,
		);
	}
};

export const resolveModelAuthMode = (
	mode = process.env.MODEL_AUTH_MODE,
): Exclude<ModelAuthMode, "auto"> => {
	const normalized = (mode ?? "auto").trim() as ModelAuthMode;
	if (
		normalized !== "api_key" &&
		normalized !== "codex_subscription" &&
		normalized !== "fallback" &&
		normalized !== "auto"
	) {
		throw new ModelProviderConfigurationError(
			"MODEL_AUTH_MODE must be api_key, codex_subscription, fallback, or auto.",
		);
	}

	if (normalized !== "auto") {
		return normalized;
	}

	if (process.env.OPENAI_API_KEY) {
		return "api_key";
	}
	if (existsSync(codexAuthPath())) {
		return "codex_subscription";
	}
	return "fallback";
};

export const resolveCodexSubscriptionAuth = (auth = readCodexAuthFile()) => {
	if (auth.auth_mode && auth.auth_mode !== "chatgpt") {
		throw new ModelProviderConfigurationError(
			"Codex auth is not ChatGPT subscription auth. Run `codex logout`, then `codex login` and choose ChatGPT sign-in.",
		);
	}

	const accessToken = auth.tokens?.access_token;
	if (!accessToken) {
		throw new ModelProviderConfigurationError(
			"Codex auth does not contain an access token. Run `codex login` with ChatGPT sign-in first.",
		);
	}
	if (tokenExpired(accessToken, auth.tokens?.expires_at)) {
		throw new ModelProviderConfigurationError(
			'Codex ChatGPT access token is expired. Run `codex exec "ping"` or `codex login` to refresh it.',
		);
	}

	const accountId = auth.tokens?.account_id ?? accountIdFromToken(accessToken);
	if (!accountId) {
		throw new ModelProviderConfigurationError(
			"Codex auth does not expose a ChatGPT account id. Refresh with `codex login` and try again.",
		);
	}

	return { accessToken, accountId };
};

export const extractOpenAiOutputText = (payload: unknown) => {
	if (
		payload &&
		typeof payload === "object" &&
		"output_text" in payload &&
		typeof payload.output_text === "string"
	) {
		return payload.output_text;
	}

	if (
		payload &&
		typeof payload === "object" &&
		Array.isArray((payload as { output?: unknown }).output)
	) {
		const parts: string[] = [];
		for (const item of (payload as { output: unknown[] }).output) {
			if (
				item &&
				typeof item === "object" &&
				Array.isArray((item as { content?: unknown }).content)
			) {
				for (const content of (item as { content: unknown[] }).content) {
					if (
						content &&
						typeof content === "object" &&
						"text" in content &&
						typeof content.text === "string"
					) {
						parts.push(content.text);
					}
				}
			}
		}
		if (parts.length > 0) {
			return parts.join("\n");
		}
	}

	return null;
};

export const extractOpenAiFunctionCalls = (
	payload: unknown,
): ModelFunctionCall[] => {
	if (
		!payload ||
		typeof payload !== "object" ||
		!Array.isArray((payload as { output?: unknown }).output)
	) {
		return [];
	}

	return (payload as { output: unknown[] }).output.flatMap((item) => {
		if (!item || typeof item !== "object") {
			return [];
		}
		const value = item as Record<string, unknown>;
		if (
			value.type !== "function_call" ||
			typeof value.name !== "string" ||
			typeof value.call_id !== "string" ||
			typeof value.arguments !== "string"
		) {
			return [];
		}
		try {
			const args = JSON.parse(value.arguments) as unknown;
			if (!args || typeof args !== "object" || Array.isArray(args)) {
				return [];
			}
			return [
				{
					name: value.name,
					callId: value.call_id,
					arguments: args as Record<string, unknown>,
				},
			];
		} catch {
			return [];
		}
	});
};

const usageFromResponse = (payload: unknown) =>
	payload && typeof payload === "object" && "usage" in payload
		? (payload.usage as {
				input_tokens?: number;
				output_tokens?: number;
			})
		: {};

const responseId = (payload: unknown) =>
	payload && typeof payload === "object" && "id" in payload
		? String(payload.id)
		: null;

export const extractOpenAiStreamingResponse = (body: string) => {
	const textParts: string[] = [];
	const outputItems: unknown[] = [];
	let completedResponse: unknown = null;

	for (const line of body.split(/\r?\n/)) {
		if (!line.startsWith("data:")) {
			continue;
		}
		const data = line.slice("data:".length).trim();
		if (!data || data === "[DONE]") {
			continue;
		}

		const event = JSON.parse(data) as unknown;
		if (!event || typeof event !== "object") {
			continue;
		}

		const record = event as Record<string, unknown>;
		if (
			record.type === "response.output_text.delta" &&
			typeof record.delta === "string"
		) {
			textParts.push(record.delta);
		}
		if (record.type === "response.completed" && "response" in record) {
			completedResponse = record.response;
		}
		if (record.type === "response.output_item.done" && "item" in record) {
			outputItems.push(record.item);
		}
	}

	const fallbackText = extractOpenAiOutputText(completedResponse);
	const text = textParts.join("") || fallbackText || "";
	const usage = usageFromResponse(completedResponse);

	return {
		text,
		functionCalls: extractOpenAiFunctionCalls(
			outputItems.length > 0 ? { output: outputItems } : completedResponse,
		),
		providerResponseId: responseId(completedResponse),
		promptTokens: usage.input_tokens ?? 0,
		completionTokens: usage.output_tokens ?? 0,
	};
};

export const consumeOpenAiSseStream = async (
  response: Response,
  onTextDelta: (delta: string) => void | Promise<void>,
  onReasoningSummaryEvent?: (
    event: ModelReasoningSummaryEvent,
  ) => void | Promise<void>,
) => {
  if (!response.body) {
    throw new ModelProviderRequestError("Streaming model response had no body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const textParts: string[] = [];
  const outputItems: unknown[] = [];
  let completedResponse: unknown = null;
  let buffer = "";

  const processEvent = async (eventBlock: string) => {
    for (const line of eventBlock.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data) as Record<string, unknown>;
      if (
        event.type === "response.output_text.delta" &&
        typeof event.delta === "string"
      ) {
        textParts.push(event.delta);
        await onTextDelta(event.delta);
      }
      const providerItemId =
        typeof event.item_id === "string" ? event.item_id : null;
      const summaryIndex =
        typeof event.summary_index === "number" ? event.summary_index : null;
      if (
        event.type === "response.reasoning_summary_part.added" &&
        providerItemId &&
        summaryIndex !== null
      ) {
        await onReasoningSummaryEvent?.({
          type: "started",
          providerItemId,
          summaryIndex,
        });
      }
      if (
        event.type === "response.reasoning_summary_text.delta" &&
        providerItemId &&
        summaryIndex !== null &&
        typeof event.delta === "string"
      ) {
        await onReasoningSummaryEvent?.({
          type: "delta",
          providerItemId,
          summaryIndex,
          delta: event.delta,
        });
      }
      if (
        event.type === "response.reasoning_summary_text.done" &&
        providerItemId &&
        summaryIndex !== null &&
        typeof event.text === "string"
      ) {
        await onReasoningSummaryEvent?.({
          type: "completed",
          providerItemId,
          summaryIndex,
          text: event.text,
        });
      }
      if (event.type === "response.output_item.done" && "item" in event) {
        outputItems.push(event.item);
      }
      if (event.type === "response.completed" && "response" in event) {
        completedResponse = event.response;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) await processEvent(block);
    if (done) break;
  }
  if (buffer.trim()) await processEvent(buffer);

  const fallbackText = extractOpenAiOutputText(completedResponse);
  const usage = usageFromResponse(completedResponse);
  return {
    text: textParts.join("") || fallbackText || "",
    functionCalls: extractOpenAiFunctionCalls(
      outputItems.length > 0 ? { output: outputItems } : completedResponse,
    ),
    providerResponseId: responseId(completedResponse),
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
  };
};

const postResponses = async (input: {
	url: string;
	headers: Record<string, string>;
	model: string;
	prompt: string;
	instructions?: string;
	codexStreaming?: boolean;
	tools?: ModelFunctionTool[];
}) => {
	const response = await fetch(input.url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...input.headers,
		},
		body: JSON.stringify(
			input.codexStreaming
				? {
						model: input.model,
						instructions: input.instructions ?? defaultCodexInstructions,
						input: [
							{
								type: "message",
								role: "user",
								content: [{ type: "input_text", text: input.prompt }],
							},
						],
						store: false,
						stream: true,
						...(input.tools?.length
							? {
									tools: input.tools.map((tool) => ({
										type: "function",
										name: tool.name,
										description: tool.description,
										parameters: tool.parameters,
										strict: tool.strict ?? false,
									})),
								}
							: {}),
					}
				: {
						model: input.model,
						input: input.prompt,
						...(input.instructions ? { instructions: input.instructions } : {}),
						...(input.tools?.length
							? {
									tools: input.tools.map((tool) => ({
										type: "function",
										name: tool.name,
										description: tool.description,
										parameters: tool.parameters,
										strict: tool.strict ?? false,
									})),
								}
							: {}),
					},
		),
	});
	const body = await response.text();
	const payload = (() => {
		try {
			return JSON.parse(body) as unknown;
		} catch {
			return null;
		}
	})();

	if (!response.ok) {
		throw new ModelProviderRequestError(
			`Model call failed with HTTP ${response.status}: ${
				payload && typeof payload === "object" && "error" in payload
					? JSON.stringify(payload.error).slice(0, 500)
					: payload && typeof payload === "object" && "detail" in payload
						? JSON.stringify(payload.detail).slice(0, 500)
						: response.statusText
			}`,
		);
	}

	if (input.codexStreaming) {
		const result = extractOpenAiStreamingResponse(body);
		if (!result.text && result.functionCalls.length === 0) {
			throw new ModelProviderRequestError(
				"Streaming model response did not include output text.",
			);
		}

		return result;
	}

	const text = extractOpenAiOutputText(payload);
	const functionCalls = extractOpenAiFunctionCalls(payload);
	if (!text && functionCalls.length === 0) {
		throw new ModelProviderRequestError(
			"Model response did not include output text.",
		);
	}

	const usage = usageFromResponse(payload);
	return {
		text: text ?? "",
		functionCalls,
		providerResponseId: responseId(payload),
		promptTokens: usage.input_tokens ?? 0,
		completionTokens: usage.output_tokens ?? 0,
	};
};

const postStreamingResponses = async (input: {
  url: string;
  headers: Record<string, string>;
  model: string;
  prompt: string;
  instructions?: string;
  codexStreaming?: boolean;
  tools?: ModelFunctionTool[];
  signal?: AbortSignal;
  onTextDelta: (delta: string) => void | Promise<void>;
  onReasoningSummaryEvent?: (
    event: ModelReasoningSummaryEvent,
  ) => void | Promise<void>;
  requestReasoningSummary?: boolean;
}) => {
  const tools = input.tools?.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: tool.strict ?? false,
  }));
  const response = await fetch(input.url, {
    method: "POST",
    signal: input.signal,
    headers: { "Content-Type": "application/json", ...input.headers },
    body: JSON.stringify(
      input.codexStreaming
        ? {
            model: input.model,
            instructions: input.instructions ?? defaultCodexInstructions,
            input: [
              {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: input.prompt }],
              },
            ],
            store: false,
            stream: true,
            ...(input.requestReasoningSummary === false
              ? {}
              : { reasoning: { summary: "auto" } }),
            ...(tools?.length ? { tools } : {}),
          }
        : {
            model: input.model,
            input: input.prompt,
            stream: true,
            ...(input.requestReasoningSummary === false
              ? {}
              : { reasoning: { summary: "auto" } }),
            ...(input.instructions ? { instructions: input.instructions } : {}),
            ...(tools?.length ? { tools } : {}),
          },
    ),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    if (
      response.status === 400 &&
      input.requestReasoningSummary !== false &&
      /reasoning|summary/i.test(errorBody)
    ) {
      return postStreamingResponses({
        ...input,
        requestReasoningSummary: false,
      });
    }
    throw new ModelProviderRequestError(
      `Model call failed with HTTP ${response.status}: ${response.statusText}`,
    );
  }
  return consumeOpenAiSseStream(
    response,
    input.onTextDelta,
    input.onReasoningSummaryEvent,
  );
};

const executeApiKeyModel = async (
	input: TextModelRequest,
): Promise<TextModelResult> => {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new ModelProviderConfigurationError(
			"OPENAI_API_KEY is not configured. Set MODEL_AUTH_MODE=codex_subscription to use local Codex ChatGPT auth, or MODEL_AUTH_MODE=fallback for deterministic local output.",
		);
	}

	const result = await postResponses({
		url: "https://api.openai.com/v1/responses",
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
		model: process.env.OPENAI_MODEL ?? input.model,
		prompt: input.prompt,
		instructions: input.instructions,
		tools: input.tools,
	});

	return { ...result, fallback: false, authMode: "api_key" };
};

const executeCodexSubscriptionModel = async (
	input: TextModelRequest,
): Promise<TextModelResult> => {
	const { accessToken, accountId } = resolveCodexSubscriptionAuth();
	const baseUrl = normalizeBaseUrl(
		process.env.OPENAI_CODEX_BASE_URL ?? defaultCodexBaseUrl,
	);
	const result = await postResponses({
		url: `${baseUrl}/responses`,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"ChatGPT-Account-ID": accountId,
			"OpenAI-Beta": "responses=v1",
			originator: process.env.OPENAI_CODEX_ORIGINATOR ?? "codex_cli_rs",
			"User-Agent":
				process.env.OPENAI_CODEX_USER_AGENT ?? "codex_cli_rs/0.144.0",
			version: process.env.OPENAI_CODEX_CLIENT_VERSION ?? "0.144.0",
		},
		model: process.env.OPENAI_MODEL ?? input.model,
		prompt: input.prompt,
		instructions: input.instructions,
		codexStreaming: true,
		tools: input.tools,
	});

	return { ...result, fallback: false, authMode: "codex_subscription" };
};

const executeFallbackModel = (input: TextModelRequest): TextModelResult => ({
	text: input.fallbackText,
	providerResponseId: null,
	promptTokens: 0,
	completionTokens: 0,
	fallback: true,
	authMode: "fallback",
	functionCalls: [],
});

export const executeTextModel = async (
	input: TextModelRequest,
): Promise<TextModelResult> => {
	if (input.provider !== "openai") {
		return executeFallbackModel(input);
	}

	const mode = resolveModelAuthMode();
	if (mode === "api_key") {
		return executeApiKeyModel(input);
	}
	if (mode === "codex_subscription") {
		return executeCodexSubscriptionModel(input);
	}

  return executeFallbackModel(input);
};

export const executeStreamingTextModel = async (
  input: TextModelRequest,
  options: StreamingTextModelOptions,
): Promise<TextModelResult> => {
  if (input.provider !== "openai") {
    const fallback = executeFallbackModel(input);
    await options.onTextDelta(fallback.text);
    return fallback;
  }

  const mode = resolveModelAuthMode();
  if (mode === "fallback") {
    const fallback = executeFallbackModel(input);
    await options.onTextDelta(fallback.text);
    return fallback;
  }

  if (mode === "api_key") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ModelProviderConfigurationError("OPENAI_API_KEY is not configured.");
    }
    const result = await postStreamingResponses({
      url: "https://api.openai.com/v1/responses",
      headers: { Authorization: `Bearer ${apiKey}` },
      model: process.env.OPENAI_MODEL ?? input.model,
      prompt: input.prompt,
      instructions: input.instructions,
      tools: input.tools,
      signal: options.signal,
      onTextDelta: options.onTextDelta,
      onReasoningSummaryEvent: options.onReasoningSummaryEvent,
    });
    return { ...result, fallback: false, authMode: "api_key" };
  }

  const { accessToken, accountId } = resolveCodexSubscriptionAuth();
  const baseUrl = normalizeBaseUrl(
    process.env.OPENAI_CODEX_BASE_URL ?? defaultCodexBaseUrl,
  );
  const result = await postStreamingResponses({
    url: `${baseUrl}/responses`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "ChatGPT-Account-ID": accountId,
      "OpenAI-Beta": "responses=v1",
      originator: process.env.OPENAI_CODEX_ORIGINATOR ?? "codex_cli_rs",
      "User-Agent": process.env.OPENAI_CODEX_USER_AGENT ?? "codex_cli_rs/0.144.0",
      version: process.env.OPENAI_CODEX_CLIENT_VERSION ?? "0.144.0",
    },
    model: process.env.OPENAI_MODEL ?? input.model,
    prompt: input.prompt,
    instructions: input.instructions,
    tools: input.tools,
    codexStreaming: true,
    signal: options.signal,
    onTextDelta: options.onTextDelta,
    onReasoningSummaryEvent: options.onReasoningSummaryEvent,
  });
  return { ...result, fallback: false, authMode: "codex_subscription" };
};

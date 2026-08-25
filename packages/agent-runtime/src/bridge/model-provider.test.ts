import { afterEach, describe, expect, test, vi } from "vitest";
import {
  consumeOpenAiSseStream,
	extractOpenAiOutputText,
	extractOpenAiFunctionCalls,
	extractOpenAiStreamingResponse,
	ModelProviderConfigurationError,
	resolveCodexSubscriptionAuth,
	resolveModelAuthMode,
} from "./model-provider";

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
	vi.restoreAllMocks();
});

const unsignedJwt = (payload: Record<string, unknown>) =>
	[
		Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
		Buffer.from(JSON.stringify(payload)).toString("base64url"),
		"signature",
	].join(".");

describe("model provider auth", () => {
	test("resolves ChatGPT subscription auth from a Codex auth file", () => {
		const accessToken = unsignedJwt({
			exp: Math.floor(Date.now() / 1000) + 3600,
			chatgpt_account_id: "account_123",
		});

		expect(
			resolveCodexSubscriptionAuth({
				auth_mode: "chatgpt",
				tokens: { access_token: accessToken },
			}),
		).toEqual({ accessToken, accountId: "account_123" });
	});

	test("rejects non-ChatGPT Codex auth", () => {
		expect(() =>
			resolveCodexSubscriptionAuth({
				auth_mode: "apikey",
				tokens: {
					access_token: unsignedJwt({
						exp: Math.floor(Date.now() / 1000) + 3600,
						chatgpt_account_id: "account_123",
					}),
				},
			}),
		).toThrow(ModelProviderConfigurationError);
	});

	test("rejects expired ChatGPT subscription tokens", () => {
		expect(() =>
			resolveCodexSubscriptionAuth({
				auth_mode: "chatgpt",
				tokens: {
					access_token: unsignedJwt({
						exp: Math.floor(Date.now() / 1000) - 3600,
						chatgpt_account_id: "account_123",
					}),
				},
			}),
		).toThrow(ModelProviderConfigurationError);
	});

	test("rejects missing ChatGPT account id", () => {
		expect(() =>
			resolveCodexSubscriptionAuth({
				auth_mode: "chatgpt",
				tokens: {
					access_token: unsignedJwt({
						exp: Math.floor(Date.now() / 1000) + 3600,
					}),
				},
			}),
		).toThrow(ModelProviderConfigurationError);
	});

	test("resolves explicit model auth modes", () => {
		expect(resolveModelAuthMode("api_key")).toBe("api_key");
		expect(resolveModelAuthMode("codex_subscription")).toBe(
			"codex_subscription",
		);
		expect(resolveModelAuthMode("fallback")).toBe("fallback");
	});

	test("rejects invalid model auth mode", () => {
		expect(() => resolveModelAuthMode("invalid")).toThrow(
			ModelProviderConfigurationError,
		);
	});
});

describe("OpenAI response parsing", () => {
  test("streams text deltas as provider events arrive", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"response.output_text.delta","delta":"hel',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'lo"}\n\ndata: {"type":"response.output_text.delta","delta":" world"}\n\ndata: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":2,"output_tokens":2}}}\n\n',
          ),
        );
        controller.close();
      },
    });
    const deltas: string[] = [];

    const result = await consumeOpenAiSseStream(
      new Response(stream),
      (delta) => {
        deltas.push(delta);
      },
    );

    expect(deltas).toEqual(["hello", " world"]);
    expect(result.text).toBe("hello world");
  });

  test("streams reasoning summaries and ignores raw reasoning text", async () => {
    const body = [
      'data: {"type":"response.reasoning_summary_part.added","item_id":"reasoning-1","summary_index":0,"part":{"type":"summary_text","text":""}}',
      'data: {"type":"response.reasoning_summary_text.delta","item_id":"reasoning-1","summary_index":0,"delta":"Checking "}',
      'data: {"type":"response.reasoning_text.delta","item_id":"reasoning-1","delta":"hidden chain"}',
      'data: {"type":"response.reasoning_summary_text.done","item_id":"reasoning-1","summary_index":0,"text":"Checking evidence"}',
      'data: {"type":"response.output_text.delta","delta":"Answer"}',
      'data: {"type":"response.completed","response":{"id":"resp_reasoning","usage":{"input_tokens":3,"output_tokens":2}}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const summaries: unknown[] = [];
    const result = await consumeOpenAiSseStream(
      new Response(body),
      () => undefined,
      (event) => {
        summaries.push(event);
      },
    );

    expect(summaries).toEqual([
      {
        type: "started",
        providerItemId: "reasoning-1",
        summaryIndex: 0,
      },
      {
        type: "delta",
        providerItemId: "reasoning-1",
        summaryIndex: 0,
        delta: "Checking ",
      },
      {
        type: "completed",
        providerItemId: "reasoning-1",
        summaryIndex: 0,
        text: "Checking evidence",
      },
    ]);
    expect(result.text).toBe("Answer");
    expect(JSON.stringify(summaries)).not.toContain("hidden chain");
  });

	test("extracts structured function calls", () => {
		expect(
			extractOpenAiFunctionCalls({
				output: [
					{
						type: "function_call",
						name: "propose_automation",
						call_id: "call_123",
						arguments: '{"goal":"Daily brief"}',
					},
				],
			}),
		).toEqual([
			{
				name: "propose_automation",
				callId: "call_123",
				arguments: { goal: "Daily brief" },
			},
		]);
	});

	test("extracts output_text", () => {
		expect(extractOpenAiOutputText({ output_text: "hello" })).toBe("hello");
	});

	test("extracts nested response text parts", () => {
		expect(
			extractOpenAiOutputText({
				output: [
					{
						content: [
							{ type: "output_text", text: "first" },
							{ type: "output_text", text: "second" },
						],
					},
				],
			}),
		).toBe("first\nsecond");
	});

	test("extracts streaming response text and usage", () => {
		const body = [
			'data: {"type":"response.created","response":{"id":"resp_123"}}',
			'data: {"type":"response.output_text.delta","delta":"hello "}',
			'data: {"type":"response.output_text.delta","delta":"world"}',
			'data: {"type":"response.completed","response":{"id":"resp_123","usage":{"input_tokens":3,"output_tokens":2}}}',
			"data: [DONE]",
		].join("\n");

		expect(extractOpenAiStreamingResponse(body)).toEqual({
			text: "hello world",
			functionCalls: [],
			providerResponseId: "resp_123",
			promptTokens: 3,
			completionTokens: 2,
		});
	});

	test("extracts streaming function-call output items", () => {
		const body = [
			'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"propose_automation","call_id":"call_123","arguments":"{\\"goal\\":\\"Daily brief\\"}"}}',
			'data: {"type":"response.completed","response":{"id":"resp_123","usage":{"input_tokens":4,"output_tokens":3}}}',
			"data: [DONE]",
		].join("\n");

		expect(extractOpenAiStreamingResponse(body).functionCalls).toEqual([
			{
				name: "propose_automation",
				callId: "call_123",
				arguments: { goal: "Daily brief" },
			},
		]);
	});
});

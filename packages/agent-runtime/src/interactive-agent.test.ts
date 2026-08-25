import { describe, expect, it } from "vitest";
import {
  buildInteractiveAgentToolDefinitions,
  interactiveAgentToolResultDisposition,
  resolveInteractiveAgentToolCall,
} from "./interactive-agent";

const tools = [
  {
    id: "01a00000-0000-7000-8000-000000000001",
    connectionId: "connection-1",
    connectionName: "Market data",
    name: "get_news",
    title: "Get news",
    description: "Read current market news",
    inputSchema: {
      type: "object",
      properties: { symbols: { type: "array", items: { type: "string" } } },
    },
    annotations: { readOnlyHint: true },
    approvalMode: "risky" as const,
  },
];

describe("interactive Agent tool registry", () => {
  it("uses collision-safe aliases and preserves the advertised schema", () => {
    expect(buildInteractiveAgentToolDefinitions(tools)).toEqual([
      {
        name: "mcp_01a00000000070008000000000000001",
        description: "Market data — Get news: Read current market news",
        parameters: tools[0]?.inputSchema,
        strict: false,
      },
    ]);
  });

  it("resolves only a currently registered alias", () => {
    expect(
      resolveInteractiveAgentToolCall(
        {
          name: "mcp_01a00000000070008000000000000001",
          callId: "provider-call-1",
          arguments: { symbols: ["AAPL"] },
        },
        tools,
      ),
    ).toEqual({
      tool: tools[0],
      providerCallId: "provider-call-1",
      arguments: { symbols: ["AAPL"] },
    });
    expect(
      resolveInteractiveAgentToolCall(
        { name: "invented", callId: "x", arguments: {} },
        tools,
      ),
    ).toBeNull();
  });
});

describe("interactive Agent failure handling", () => {
  it("finishes with an explanation after a failed tool execution", () => {
    expect(interactiveAgentToolResultDisposition({ isError: true })).toBe(
      "finish_with_error",
    );
    expect(interactiveAgentToolResultDisposition({ isError: false })).toBe(
      "continue",
    );
  });
});

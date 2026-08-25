import { describe, expect, test } from "vitest";
import {
  buildModelPrompt,
  nextModelIntentAfterTool,
  parseModelDecisionFromResult,
} from "./activities";

describe("Bridge Activity prompt construction", () => {
  test("keeps the Run Brief and approved tool snapshots explicit", () => {
    const prompt = buildModelPrompt({
      runId: "run_123",
      structuredBrief: {
        goal: "Summarize my watchlist news",
        expectedOutput: "Concise summary",
      },
      approvedTools: [
        {
          id: "tool_auth_123",
          mcpConnectionId: "mcp_connection_123",
          mcpToolId: "mcp_tool_123",
          toolName: "watchlist.read",
          description: "Read the current watchlist.",
          inputSchema: { type: "object", properties: {} },
          required: true,
          reason: "Needed to read the current watchlist.",
          writeCapable: false,
          allowedOutcomeBoundary: null,
        },
      ],
      intent: "tool_decision",
    });

    expect(prompt).not.toContain("Run ID: run_123");
    expect(prompt).toContain("Never include internal identifiers");
    expect(prompt).toContain("Summarize my watchlist news");
    expect(prompt).toContain("watchlist.read");
    expect(prompt).toContain("Never invent tool results");
  });
});

describe("Bridge model decision parsing", () => {
  test("uses a structured approved-tool function call", () => {
    expect(
      parseModelDecisionFromResult({
        text: "",
        functionCalls: [
          {
            name: "call_approved_tool",
            callId: "call_1",
            arguments: {
              toolAuthorizationSnapshotId: "tool_auth_123",
              arguments: { watchlistId: "watchlist_123" },
              reason: "Read the selected watchlist.",
            },
          },
        ],
      }),
    ).toEqual({
      action: "call_tool",
      toolAuthorizationSnapshotId: "tool_auth_123",
      arguments: { watchlistId: "watchlist_123" },
      reason: "Read the selected watchlist.",
    });
  });

  test("uses a structured final-answer function call", () => {
    expect(
      parseModelDecisionFromResult({
        text: "",
        functionCalls: [
          {
            name: "finish_run",
            callId: "call_2",
            arguments: { finalAnswer: "Evidence\nComplete." },
          },
        ],
      }),
    ).toEqual({ action: "final", finalAnswer: "Evidence\nComplete." });
  });

  test("keeps deterministic fallback JSON support", () => {
    expect(
      parseModelDecisionFromResult({
        text: JSON.stringify({
          action: "final",
          finalAnswer: "Fallback result",
        }),
        functionCalls: [],
      }),
    ).toEqual({ action: "final", finalAnswer: "Fallback result" });
  });
});

describe("Bridge required-tool routing", () => {
  test("continues tool selection until every required tool is complete", () => {
    const tools = [
      { id: "watchlists", required: true },
      { id: "instruments", required: true },
      { id: "news", required: true },
    ];

    expect(
      nextModelIntentAfterTool(tools, [
        { toolAuthorizationSnapshotId: "watchlists" },
      ]),
    ).toBe("tool_decision");
    expect(
      nextModelIntentAfterTool(tools, [
        { toolAuthorizationSnapshotId: "watchlists" },
        { toolAuthorizationSnapshotId: "instruments" },
        { toolAuthorizationSnapshotId: "news" },
      ]),
    ).toBe("final_output");
  });
});

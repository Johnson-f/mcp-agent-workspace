import assert from "node:assert/strict";
import test from "node:test";
import * as presentation from "./run-detail-presentation";
import {
  formatStepSummary,
  formatToolName,
  sanitizeTechnicalIds,
} from "./run-detail-presentation";

test("formats MCP tool names as readable UI copy", () => {
  assert.equal(formatToolName("get_watchlist_news"), "Get watchlist news tool");
  assert.equal(formatToolName("get_watchlists"), "Get watchlists tool");
});

test("formats tool execution summaries without raw MCP names", () => {
  const publicMetadata = { toolName: "get_watchlist_news" };

  assert.equal(
    formatStepSummary({
      type: "tool_selected",
      summary: "Model selected approved MCP tool get_watchlist_news.",
      publicMetadata,
    }),
    "Get watchlist news tool selected.",
  );
  assert.equal(
    formatStepSummary({
      type: "tool_call_started",
      summary: "Calling MCP tool get_watchlist_news.",
      publicMetadata,
    }),
    "Calling Get watchlist news tool.",
  );
  assert.equal(
    formatStepSummary({
      type: "tool_call_completed",
      summary: "MCP tool get_watchlist_news completed.",
      publicMetadata,
    }),
    "Get watchlist news tool completed.",
  );
});

test("removes UUID-bearing fields and opaque internal identifiers", () => {
  assert.deepEqual(
    sanitizeTechnicalIds({
      providerResponseId: "01a020b8-4db3-7027-8f36-ef96d92086ea",
      nested: {
        model: "gpt-5.5",
        toolAuthorizationSnapshotId: "01a02053-10c6-78ee-8553-ca4ed6b60a1a",
      },
      toolName: "get_watchlist_news",
      watchlist_id: "757fa9998dc94f18ba284e24d1080ec6",
      callRef: "run:01a020b8-4db3-7027-8f36-ef96d92086ea:tool:get_watchlists",
    }),
    {
      nested: { model: "gpt-5.5" },
      toolName: "Get watchlist news tool",
    },
  );
});

test("removes internal identifiers from historical final-output Markdown", () => {
  const sanitizer = (presentation as unknown as Record<string, unknown>)
    .sanitizeRunOutputMarkdown;
  assert.equal(typeof sanitizer, "function");

  const content = [
    "## Evidence",
    "- Run ID: 01a02104-4bd0-792d-8f7e-1d20fc56edde",
    "- Watchlist found: Webull watchlist named “Tracking List” with watchlist_id `757fa9998dc94f18ba284e24d1080ec6`.",
    "- Current instruments: MRVL, QNST.",
  ].join("\n");

  assert.equal(
    (sanitizer as (markdown: string) => string)(content),
    [
      "## Evidence",
      "- Watchlist found: Webull watchlist named “Tracking List”.",
      "- Current instruments: MRVL, QNST.",
    ].join("\n"),
  );
});

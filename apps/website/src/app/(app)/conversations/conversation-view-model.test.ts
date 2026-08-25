import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyRunBriefDraft } from "@agents/contracts";
import {
  automationApprovalDestination,
  conversationAutomationSurface,
  conversationNextAction,
  resolveSuggestedAutomationTools,
  shouldApproveRunBriefBeforeAutomation,
} from "./conversation-view-model";

test("asks for the first missing deterministic field", () => {
  assert.deepEqual(
    conversationNextAction(createEmptyRunBriefDraft("automation")),
    {
      kind: "ask_missing_field",
      field: "goal",
      prompt: "What exact outcome should this Agent produce?",
    },
  );
});

test("routes an approved proposal to its Automation", () => {
  assert.equal(
    automationApprovalDestination("automation-1"),
    "/automations/automation-1",
  );
});

test("keeps automation configuration hidden during ordinary conversation", () => {
  assert.equal(
    conversationAutomationSurface({
      hasAutomationProposal: false,
      hasRunBrief: false,
    }),
    "hidden",
  );
});

test("reveals a proposal before starting deterministic configuration", () => {
  assert.equal(
    conversationAutomationSurface({
      hasAutomationProposal: true,
      hasRunBrief: false,
    }),
    "proposal",
  );
  assert.equal(
    conversationAutomationSurface({
      hasAutomationProposal: true,
      hasRunBrief: true,
    }),
    "configuration",
  );
});

test("resolves only the AI-suggested enabled tools in proposal order", () => {
  const tools = [
    {
      id: "news",
      name: "get_watchlist_news",
      enabled: true,
      available: true,
    },
    {
      id: "delete",
      name: "delete_watchlist",
      enabled: true,
      available: true,
    },
    {
      id: "watchlists",
      name: "get_watchlists",
      enabled: true,
      available: true,
    },
    {
      id: "instruments",
      name: "get_watchlist_instruments",
      enabled: true,
      available: true,
    },
  ];

  const result = resolveSuggestedAutomationTools(tools, [
    "get_watchlists",
    "get_watchlist_instruments",
    "get_watchlist_news",
  ]);

  assert.deepEqual(
    result.selected.map((tool) => tool.id),
    ["watchlists", "instruments", "news"],
  );
  assert.deepEqual(result.unresolvedNames, []);
});

test("does not guess when a suggested tool is unavailable or ambiguous", () => {
  const tools = [
    {
      id: "disabled",
      name: "get_watchlists",
      enabled: false,
      available: true,
    },
    {
      id: "news-a",
      name: "get_watchlist_news",
      enabled: true,
      available: true,
    },
    {
      id: "news-b",
      name: "get_watchlist_news",
      enabled: true,
      available: true,
    },
  ];

  const result = resolveSuggestedAutomationTools(tools, [
    "get_watchlists",
    "get_watchlist_news",
  ]);

  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.unresolvedNames, [
    "get_watchlists",
    "get_watchlist_news",
  ]);
});

test("does not resubmit approval for an already-approved Automation brief", () => {
  assert.equal(shouldApproveRunBriefBeforeAutomation("pending_approval"), true);
  assert.equal(shouldApproveRunBriefBeforeAutomation("approved"), false);
});

import { describe, expect, it } from "vitest";
import { decideInteractiveAgentToolCall } from "./interactive-agent-policy";

describe("interactive Agent tool policy", () => {
  const readTool = {
    name: "get_watchlist_news",
    description: "Read current watchlist news",
    approvalMode: "risky" as const,
    annotations: { readOnlyHint: true, destructiveHint: false },
  };

  it("asks for every call by default", () => {
    expect(
      decideInteractiveAgentToolCall({
        preference: "always_ask",
        tool: readTool,
      }),
    ).toEqual({ decision: "ask", risk: "read", reason: "user_preference" });
  });

  it("auto-approves an eligible read-only call", () => {
    expect(
      decideInteractiveAgentToolCall({
        preference: "auto_approve_eligible",
        tool: readTool,
      }),
    ).toEqual({ decision: "allow", risk: "read", reason: "eligible" });
  });

  it("never bypasses a per-tool always policy", () => {
    expect(
      decideInteractiveAgentToolCall({
        preference: "auto_approve_eligible",
        tool: { ...readTool, approvalMode: "always" },
      }).decision,
    ).toBe("ask");
  });

  it("requires confirmation for destructive and unknown-risk tools", () => {
    for (const annotations of [
      { readOnlyHint: false, destructiveHint: true },
      null,
    ]) {
      expect(
        decideInteractiveAgentToolCall({
          preference: "auto_approve_eligible",
          tool: {
            name: "change_account",
            description: "Change account state",
            approvalMode: "never",
            annotations,
          },
        }).decision,
      ).toBe("ask");
    }
  });
});

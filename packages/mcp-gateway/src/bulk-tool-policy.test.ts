import { describe, expect, it } from "vitest";
import { validateBulkToolPolicyUpdate } from "./bulk-tool-policy";

const tools = [
  { id: "read", available: true },
  { id: "write", available: true },
  { id: "offline", available: false },
];

describe("bulk MCP tool policy validation", () => {
  it("accepts one bounded update for available tools", () => {
    expect(
      validateBulkToolPolicyUpdate(
        { toolIds: ["read", "write"], enabled: true },
        tools,
      ),
    ).toBeNull();
  });

  it("rejects empty, no-op, and unavailable enable requests", () => {
    expect(
      validateBulkToolPolicyUpdate({ toolIds: [], enabled: true }, tools),
    ).toContain("Select");
    expect(validateBulkToolPolicyUpdate({ toolIds: ["read"] }, tools)).toContain(
      "change",
    );
    expect(
      validateBulkToolPolicyUpdate(
        { toolIds: ["offline"], enabled: true },
        tools,
      ),
    ).toMatch(/unavailable/i);
  });
});

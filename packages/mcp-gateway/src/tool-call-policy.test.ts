import { describe, expect, test } from "vitest";
import {
	hashToolArguments,
	redactToolArguments,
	toolCallNeedsApproval,
} from "./tool-call-policy";

describe("MCP tool approval policy", () => {
	test("always requires explicit approval", () => {
		expect(toolCallNeedsApproval("always", { readOnlyHint: true })).toBe(true);
	});

	test("risky permits only explicitly read-only tools", () => {
		expect(toolCallNeedsApproval("risky", { readOnlyHint: true })).toBe(false);
		expect(
			toolCallNeedsApproval("risky", {
				readOnlyHint: true,
				destructiveHint: true,
			}),
		).toBe(true);
		expect(toolCallNeedsApproval("risky", null)).toBe(true);
	});

	test("never skips approval", () => {
		expect(toolCallNeedsApproval("never", null)).toBe(false);
	});
});

describe("MCP tool call audit data", () => {
	test("stores argument shape without argument values", () => {
		expect(
			redactToolArguments({
				query: "private research request",
				apiKey: "super-secret",
				nested: { count: 42, enabled: true },
			}),
		).toEqual({
			query: "[string:24]",
			apiKey: "[REDACTED]",
			nested: { count: "[number]", enabled: "[boolean]" },
		});
	});

	test("hashes equivalent object key orders identically", async () => {
		expect(await hashToolArguments({ query: "docs", limit: 5 })).toBe(
			await hashToolArguments({ limit: 5, query: "docs" }),
		);
	});
});

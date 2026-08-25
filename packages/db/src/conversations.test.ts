import { describe, expect, it } from "vitest";
import {
	conversationTitleFromFirstMessage,
	normalizeConversationTitle,
} from "./conversations";

describe("Conversation history helpers", () => {
	it("normalizes user-authored titles", () => {
		expect(normalizeConversationTitle("  Weekly market brief  ")).toBe(
			"Weekly market brief",
		);
		expect(normalizeConversationTitle("   ")).toBeNull();
	});

	it("derives a bounded title from the first user message", () => {
		expect(
			conversationTitleFromFirstMessage("  Check my watchlist today  "),
		).toBe("Check my watchlist today");
		expect(conversationTitleFromFirstMessage("x".repeat(100))).toHaveLength(80);
	});
});

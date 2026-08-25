import { describe, expect, it } from "vitest";
import {
  normalizeAutomationProposal,
  normalizeConversationTitle,
  runConversationModel,
} from "./conversation-model";

describe("Automation proposal normalization", () => {
	it("keeps model suggestions separate from approved configuration", () => {
		expect(
			normalizeAutomationProposal({
				goal: "Send a market brief each morning",
				successCriteria: ["Use current news"],
				expectedOutput: "A concise brief",
				schedule: {
					kind: "recurring",
					timezone: "Africa/Lagos",
					rule: "0 8 * * 1-5",
				},
				suggestedToolNames: ["get_watchlist_news"],
			}),
		).toEqual({
			goal: "Send a market brief each morning",
			successCriteria: ["Use current news"],
			expectedOutput: "A concise brief",
			schedule: {
				kind: "recurring",
				timezone: "Africa/Lagos",
				rule: "0 8 * * 1-5",
			},
			suggestedToolNames: ["get_watchlist_news"],
		});
	});

	it("rejects proposals without a concrete goal", () => {
		expect(normalizeAutomationProposal({ goal: " " })).toBeNull();
	});

	it("converts a daily natural-language schedule into canonical cron", () => {
		expect(
			normalizeAutomationProposal({
				goal: "Send a daily watchlist brief",
				schedule: {
					kind: "recurring",
					timezone: "America/New_York",
					rule: "Daily at 9:00 AM",
				},
			}),
		).toMatchObject({
			schedule: {
				kind: "recurring",
				timezone: "America/New_York",
				rule: "0 9 * * *",
			},
		});
	});
});

describe("Explicit conversation mode", () => {
  it("keeps a vague Automation request conversational", async () => {
    const previousMode = process.env.MODEL_AUTH_MODE;
    process.env.MODEL_AUTH_MODE = "fallback";
    try {
      const result = await runConversationModel({
        mode: "automation",
        messages: [
          {
            role: "user",
            content: "What automation could I build with Webull?",
          },
        ],
        availableToolNames: ["get_company_profile"],
      });
      expect(result.automationProposal).toBeNull();
      expect(result.assistantMessage).toContain("outcome");
    } finally {
      if (previousMode === undefined) delete process.env.MODEL_AUTH_MODE;
      else process.env.MODEL_AUTH_MODE = previousMode;
    }
  });
});

describe("Conversation title normalization", () => {
  it("removes model labels and bounds titles to 80 characters", () => {
    expect(normalizeConversationTitle('Title: "Morning watchlist brief."')).toBe(
      "Morning watchlist brief",
    );
    expect(normalizeConversationTitle("x".repeat(120))).toHaveLength(80);
  });
});

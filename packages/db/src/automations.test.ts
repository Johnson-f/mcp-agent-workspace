import { describe, expect, it } from "vitest";
import {
	automationRunNowBlocker,
	runBudgetForPreset,
	scheduleFieldsFromDraft,
} from "./automations";
import { runBriefApprovalStateDecision } from "./product-flow";

describe("Automation repository decisions", () => {
	it("maps no-schedule Automations to manual_only persistence", () => {
		expect(scheduleFieldsFromDraft(null)).toMatchObject({
			scheduleKind: "manual_only",
			scheduleRule: null,
		});
	});

	it("maps recurring schedules without removing Run now", () => {
		expect(
			scheduleFieldsFromDraft({
				kind: "recurring",
				timezone: "Africa/Lagos",
				rule: "0 8 * * 1-5",
				missedRunPolicy: "skip",
				overlapPolicy: "skip",
			}),
		).toMatchObject({
			scheduleKind: "recurring",
			scheduleTimezone: "Africa/Lagos",
			scheduleRule: "0 8 * * 1-5",
		});
	});

	it("blocks Run now for active and non-live Automations", () => {
		expect(automationRunNowBlocker("live", false)).toBeNull();
		expect(automationRunNowBlocker("live", true)).toContain("already running");
		expect(automationRunNowBlocker("paused", false)).toContain("paused");
	});

	it("maps the small Run Budget deterministically", () => {
		expect(runBudgetForPreset("small")).toMatchObject({
			maxLlmSteps: 6,
			maxToolCalls: 8,
			maxSpendUsdCents: 100,
		});
	});

	it("treats an already-approved Run Brief retry as idempotent", () => {
		expect(runBriefApprovalStateDecision("pending_approval")).toBe("approve");
		expect(runBriefApprovalStateDecision("approved")).toBe("reuse");
		expect(runBriefApprovalStateDecision("superseded")).toBe("conflict");
	});
});

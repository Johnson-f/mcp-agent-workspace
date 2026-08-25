import { describe, expect, it } from "vitest";
import { conversations, runs } from "./schema";

describe("unified Automation schema", () => {
	it("persists Conversation history metadata", () => {
		expect(conversations.pinnedAt.name).toBe("pinned_at");
		expect(conversations.automationId.name).toBe("automation_id");
	});

	it("persists Automation Run trigger metadata", () => {
		expect(runs.triggerSource.name).toBe("trigger_source");
		expect(runs.triggeredByUserId.name).toBe("triggered_by_user_id");
		expect(runs.scheduledFireTime.name).toBe("scheduled_fire_time");
	});
});

import { describe, expect, it } from "vitest";
import { normalizeRecurringScheduleRule } from "./schedule-rule";

describe("recurring schedule normalization", () => {
	it.each([
		["Daily at 9:00 AM", "0 9 * * *"],
		["every day at 4:30 pm", "30 16 * * *"],
		["Weekdays at 8 AM", "0 8 * * 1-5"],
		["0 9 * * *", "0 9 * * *"],
	])("normalizes %s", (input, expected) => {
		expect(normalizeRecurringScheduleRule(input)).toBe(expected);
	});

	it("rejects unsupported prose instead of sending it to Temporal", () => {
		expect(normalizeRecurringScheduleRule("sometime tomorrow morning")).toBeNull();
	});
});

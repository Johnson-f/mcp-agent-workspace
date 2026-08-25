import {
	ScheduleAlreadyRunning,
	ScheduleNotFoundError,
	ScheduleOverlapPolicy,
} from "@temporalio/client";
import { getTemporalClient } from "./client";
import { temporalConfig } from "./config";
import { scheduledAutomationWorkflow } from "./workflows";

export interface AutomationScheduleInput {
	automationId: string;
	automationVersionId: string;
	kind: "manual_only" | "recurring";
	timezone: string;
	rule: string | null;
	missedRunPolicy: "skip" | "backfill_if_enabled";
	overlapPolicy: "skip" | "queue_one" | "cancel_old" | "allow_overlap";
}

const temporalOverlap = (policy: AutomationScheduleInput["overlapPolicy"]) => {
	switch (policy) {
		case "queue_one":
			return ScheduleOverlapPolicy.BUFFER_ONE;
		case "cancel_old":
			return ScheduleOverlapPolicy.CANCEL_OTHER;
		case "allow_overlap":
			return ScheduleOverlapPolicy.ALLOW_ALL;
		default:
			return ScheduleOverlapPolicy.SKIP;
	}
};

export const temporalScheduleId = (automationId: string) =>
	`automation:${automationId}`;

export const syncAutomationSchedule = async (
	input: AutomationScheduleInput,
) => {
	const client = await getTemporalClient();
	const scheduleId = temporalScheduleId(input.automationId);
	const handle = client.schedule.getHandle(scheduleId);

	if (input.kind === "manual_only") {
		try {
			await handle.delete();
		} catch (error) {
			if (!(error instanceof ScheduleNotFoundError)) {
				throw error;
			}
		}
		return null;
	}
	if (!input.rule?.trim()) {
		throw new Error("Recurring Automation requires a schedule rule.");
	}

	const options = {
		scheduleId,
		spec: {
			cronExpressions: [input.rule.trim()],
			timezone: input.timezone,
		},
		action: {
			type: "startWorkflow" as const,
			workflowType: scheduledAutomationWorkflow,
			taskQueue: temporalConfig.taskQueue,
			args: [
				{
					automationId: input.automationId,
					automationVersionId: input.automationVersionId,
				},
			] as [
				{
					automationId: string;
					automationVersionId: string;
				},
			],
			workflowId: `${scheduleId}:trigger`,
		},
		policies: {
			overlap: temporalOverlap(input.overlapPolicy),
			catchupWindow:
				input.missedRunPolicy === "skip"
					? ("1m" as const)
					: ("1 year" as const),
			pauseOnFailure: true,
		},
		state: {
			paused: false,
			note: `Automation Version ${input.automationVersionId}`,
		},
	};

	try {
		await client.schedule.create(options);
	} catch (error) {
		if (!(error instanceof ScheduleAlreadyRunning)) {
			throw error;
		}
		await handle.update(() => ({
			spec: options.spec,
			action: options.action,
			policies: options.policies,
			state: options.state,
		}));
	}

	return scheduleId;
};

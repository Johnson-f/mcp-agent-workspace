import { proxyActivities, startChild } from "@temporalio/workflow";
import type * as activities from "./activities";
import { runWorkflow } from "./bridge/workflow";
import type { ScheduledAutomationTriggerInput } from "./bridge/activities";

const { createGreeting } = proxyActivities<typeof activities>({
	startToCloseTimeout: "30 seconds",
	retry: {
		maximumAttempts: 3,
	},
});

const { prepareScheduledAutomationRun, persistScheduledRunTemporalIdentity } =
	proxyActivities<typeof activities>({
		startToCloseTimeout: "30 seconds",
		retry: { maximumAttempts: 3 },
	});

export async function greetingWorkflow(name: string): Promise<string> {
	return createGreeting(name);
}

export async function scheduledAutomationWorkflow(
	input: ScheduledAutomationTriggerInput,
) {
	const prepared = await prepareScheduledAutomationRun(input);
	if (prepared.status === "skipped") {
		return prepared;
	}

	const handle = await startChild(runWorkflow, {
		args: [prepared.workflowInput],
		workflowId: `run:${prepared.workflowInput.runId}`,
	});
	await persistScheduledRunTemporalIdentity({
		runId: prepared.workflowInput.runId,
		temporalWorkflowId: handle.workflowId,
		temporalRunId: handle.firstExecutionRunId,
	});
	const result = await handle.result();
	return {
		status: "started" as const,
		runId: prepared.workflowInput.runId,
		result,
	};
}

export { runWorkflow };

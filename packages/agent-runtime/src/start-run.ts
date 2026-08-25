import { getTemporalClient } from "./client";
import { temporalConfig } from "./config";
import { runWorkflow } from "./workflows";
import type { RunWorkflowInput } from "./bridge/types";

export async function startRunWorkflow(input: RunWorkflowInput) {
  const client = await getTemporalClient();
  const handle = await client.workflow.start(runWorkflow, {
    args: [input],
    taskQueue: temporalConfig.taskQueue,
    workflowId: `run:${input.runId}`,
  });

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

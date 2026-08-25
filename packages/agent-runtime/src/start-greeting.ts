import { randomUUID } from "node:crypto";
import { getTemporalClient } from "./client";
import { temporalConfig } from "./config";
import { greetingWorkflow } from "./workflows";

export async function startGreetingWorkflow(name: string) {
  const client = await getTemporalClient();
  const handle = await client.workflow.start(greetingWorkflow, {
    args: [name],
    taskQueue: temporalConfig.taskQueue,
    workflowId: `greeting-${randomUUID()}`,
  });

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

export async function getGreetingResult(workflowId: string) {
  const client = await getTemporalClient();
  return client.workflow.getHandle(workflowId).result();
}

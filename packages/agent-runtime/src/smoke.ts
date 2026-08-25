import { getTemporalClient } from "./client";
import { startGreetingWorkflow } from "./start-greeting";

async function run() {
  const { workflowId } = await startGreetingWorkflow("Temporal");
  const client = await getTemporalClient();
  const result = await client.workflow.getHandle(workflowId).result();

  console.log({ workflowId, result });
}

run().catch((error) => {
  console.error("Temporal smoke test failed:", error);
  process.exitCode = 1;
});

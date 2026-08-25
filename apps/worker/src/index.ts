import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "@agents/agent-runtime/activities";
import { temporalConfig } from "@agents/agent-runtime";

const workflowsPath = fileURLToPath(
  new URL("../../../packages/agent-runtime/src/workflows.ts", import.meta.url),
);

async function run() {
  const connection = await NativeConnection.connect({
    address: temporalConfig.address,
  });

  const worker = await Worker.create({
    activities,
    connection,
    namespace: temporalConfig.namespace,
    taskQueue: temporalConfig.taskQueue,
    workflowsPath,
  });

  console.log(
    `Temporal worker listening on task queue "${temporalConfig.taskQueue}"`,
  );

  const shutdown = () => worker.shutdown();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await worker.run();
  } finally {
    await connection.close();
  }
}

run().catch((error) => {
  console.error("Temporal worker failed:", error);
  process.exitCode = 1;
});

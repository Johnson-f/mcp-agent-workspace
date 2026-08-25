import { Client, Connection } from "@temporalio/client";
import { temporalConfig } from "./config";

let clientPromise: Promise<Client> | undefined;

export function getTemporalClient(): Promise<Client> {
  clientPromise ??= Connection.connect({
    address: temporalConfig.address,
  }).then(
    (connection) =>
      new Client({
        connection,
        namespace: temporalConfig.namespace,
      }),
  );

  return clientPromise;
}

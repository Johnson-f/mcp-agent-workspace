import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

let client: postgres.Sql | undefined;
let database: ReturnType<typeof createDatabase> | undefined;

const createDatabase = () => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new DatabaseConfigurationError("DATABASE_URL must be configured.");
  }

  client = postgres(databaseUrl, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: 30,
    connect_timeout: 5,
  });

  return drizzle(client, { schema });
};

export const getDatabase = () => {
  database ??= createDatabase();
  return database;
};

export const closeDatabase = async () => {
  await client?.end();
  client = undefined;
  database = undefined;
};

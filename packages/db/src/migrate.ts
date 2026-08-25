import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDatabase, getDatabase } from "./client";

try {
  await migrate(getDatabase(), { migrationsFolder: "drizzle" });
  console.log("Database migrations are up to date.");
} finally {
  await closeDatabase();
}

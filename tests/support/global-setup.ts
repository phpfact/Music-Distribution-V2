/**
 * Creates the scratch database for one test run and applies the project's
 * real migrations to it; drops it again when the run ends.
 */
import { testDatabaseName } from "./database-name";
import { createTestDatabase, dropTestDatabase } from "./postgres";
import { redactConnectionStrings, runProcess } from "./process";

export default async function setup(): Promise<() => Promise<void>> {
  const database = testDatabaseName(process.env.POSTGRES_DB);

  // Left behind if an earlier run was killed before its teardown.
  await dropTestDatabase(database);
  await createTestDatabase(database);

  // prisma/control.config.ts picks the database from POSTGRES_DB.
  const migrate = await runProcess(
    "node_modules/.bin/prisma",
    ["migrate", "deploy", "--config", "prisma/control.config.ts"],
    { ...process.env, POSTGRES_DB: database },
  );
  if (migrate.code !== 0) {
    await dropTestDatabase(database);
    throw new Error(
      `could not apply the migrations to the test database (exit ${migrate.code}):\n` +
        redactConnectionStrings(migrate.output),
    );
  }

  return async () => {
    await dropTestDatabase(database);
  };
}

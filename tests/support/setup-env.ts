/**
 * Runs in the test process before each test file, so before any application
 * module is imported: src/lib/env.ts caches the environment on first use and
 * the pg pool lives on globalThis.
 */
import { assertTestDatabaseName } from "./database-name";

const testDatabase = process.env.PLATFORM_TEST_DATABASE ?? "";
assertTestDatabaseName(testDatabase);

const env: Record<string, string | undefined> = process.env;
env.POSTGRES_DB = testDatabase;
env.NODE_ENV = "test";

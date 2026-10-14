import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testDatabaseName } from "./tests/support/database-name";

// The tests run inside the app container (`make test`), next to the dev stack.
// They get a scratch database of their own; the name is derived here, in the
// main process, where POSTGRES_DB still names the development database.
const devDatabase = process.env.POSTGRES_DB?.trim() ?? "";
const testDatabase = testDatabaseName(devDatabase);

const path = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path("./src"),
      // The real package throws outside Next's bundler.
      "server-only": path("./tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    setupFiles: ["tests/support/setup-env.ts"],
    // One database and one Redis are shared by every file and every test.
    fileParallelism: false,
    sequence: { concurrent: false },
    // An Argon2 verification takes 50 to 150 ms; some tests make a dozen.
    testTimeout: 15_000,
    hookTimeout: 60_000,
    // Read by tests/support/setup-env.ts, which points the app modules at the
    // scratch database before any of them is imported.
    env: {
      PLATFORM_TEST_DATABASE: testDatabase,
      PLATFORM_TEST_DEV_DATABASE: devDatabase,
      PLATFORM_TEST_ORIGINAL_NODE_ENV: process.env.NODE_ENV ?? "",
    },
  },
});

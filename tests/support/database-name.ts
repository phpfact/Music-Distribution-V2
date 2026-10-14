/**
 * The name of the scratch database the tests create and drop. Kept free of
 * imports: vitest.config.ts loads this file.
 */
export const TEST_DATABASE_SUFFIX = "_test";

// PostgreSQL silently truncates longer identifiers, which could turn the
// scratch name into the name of another database.
const POSTGRES_IDENTIFIER_MAX_BYTES = 63;

/** Throws unless `name` can only be a scratch database of these tests. */
export function assertTestDatabaseName(name: string): void {
  if (!name.endsWith(TEST_DATABASE_SUFFIX) || name.length <= TEST_DATABASE_SUFFIX.length) {
    throw new Error(`refusing to use a database whose name does not end in "${TEST_DATABASE_SUFFIX}"`);
  }
  if (Buffer.byteLength(name, "utf8") > POSTGRES_IDENTIFIER_MAX_BYTES) {
    throw new Error(
      `the test database name is longer than ${POSTGRES_IDENTIFIER_MAX_BYTES} bytes; use a shorter POSTGRES_DB`,
    );
  }
}

export function testDatabaseName(devDatabase: string | undefined): string {
  const base = devDatabase?.trim();
  if (!base) {
    throw new Error(
      "POSTGRES_DB is not set. The tests run inside the app container: use `make test`.",
    );
  }
  const name = `${base}${TEST_DATABASE_SUFFIX}`;
  assertTestDatabaseName(name);
  return name;
}

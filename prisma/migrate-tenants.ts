/**
 * Applies the pending tenant migrations (prisma/tenant/migrations) to every
 * provisioned tenant database, one at a time, and records the outcome per
 * tenant in the control plane.
 *
 *   npm run db:tenants:deploy
 *
 * Safe to run again: a database that is already current is left untouched. A
 * tenant whose migration fails is marked `failed` and the run continues with
 * the next one; the exit code is 1 if any tenant failed.
 *
 * Tenants still being provisioned are skipped: provisioning applies the
 * migrations to a new database itself, before the tenant is activated.
 */
import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/control/client";
import { migrationDatabaseUrl } from "./connection";

const run = promisify(execFile);

const PRISMA_CLI = path.join("node_modules", ".bin", "prisma");
const TENANT_CONFIG = path.join("prisma", "tenant.config.ts");
const TENANT_MIGRATIONS = path.join("prisma", "tenant", "migrations");

/** Name of the newest tenant migration, which is what a current database is at. */
function latestMigration(): string {
  const names = readdirSync(TENANT_MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const latest = names.at(-1);
  if (!latest) throw new Error(`no migrations found in ${TENANT_MIGRATIONS}`);
  return latest;
}

async function deploy(database: string): Promise<void> {
  await run(PRISMA_CLI, ["migrate", "deploy", "--config", TENANT_CONFIG], {
    env: { ...process.env, TENANT_DATABASE: database },
  });
}

/** The CLI's own explanation. It names the host and database, never the password. */
function failureDetail(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String(error.stderr).trim();
    if (stderr) return stderr;
  }
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<number> {
  const url = migrationDatabaseUrl(process.env.POSTGRES_DB);
  if (!url) {
    console.error(
      "[migrate-tenants] POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB must be set.",
    );
    return 1;
  }

  const version = latestMigration();
  const control = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });

  try {
    const tenants = await control.tenant.findMany({
      where: { status: { in: ["active", "suspended"] }, databaseName: { not: null } },
      select: { id: true, slug: true, databaseName: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`[migrate-tenants] ${tenants.length} tenant database(s), target ${version}`);

    // `prisma migrate deploy` creates a database that does not exist. A missing
    // tenant database is a fault to report, not something to recreate empty.
    const existing = new Set(
      (await control.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database`).map(
        (row) => row.datname,
      ),
    );

    let failed = 0;
    for (const tenant of tenants) {
      if (!tenant.databaseName) continue;
      try {
        if (!existing.has(tenant.databaseName)) {
          throw new Error(`database "${tenant.databaseName}" does not exist`);
        }
        await deploy(tenant.databaseName);
        await control.tenant.update({
          where: { id: tenant.id },
          data: { schemaStatus: "current", schemaVersion: version, schemaMigratedAt: new Date() },
        });
        console.log(`[migrate-tenants] ok      ${tenant.slug}`);
      } catch (error) {
        failed += 1;
        await control.tenant.update({ where: { id: tenant.id }, data: { schemaStatus: "failed" } });
        console.error(`[migrate-tenants] FAILED  ${tenant.slug}\n${failureDetail(error)}`);
      }
    }

    if (failed > 0) {
      console.error(
        `[migrate-tenants] ${failed} of ${tenants.length} failed. Fix the cause and run this again.`,
      );
    }
    return failed > 0 ? 1 : 0;
  } finally {
    await control.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`[migrate-tenants] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);

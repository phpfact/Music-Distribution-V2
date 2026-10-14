import { defineConfig } from "prisma/config";
import { migrationDatabaseUrl } from "./connection";

// Prisma CLI configuration for ONE tenant database, named by TENANT_DATABASE.
// Use with: TENANT_DATABASE=<name> prisma <command> --config prisma/tenant.config.ts
// TENANT_DATABASE_PORT (optional) is the port of the PostgreSQL server that
// holds it; POSTGRES_PORT when unset.
//
// prisma/migrate-tenants.ts sets both for each tenant in turn.
const url = migrationDatabaseUrl(process.env.TENANT_DATABASE, process.env.TENANT_DATABASE_PORT);

export default defineConfig({
  schema: "tenant/schema.prisma",
  migrations: { path: "tenant/migrations" },
  ...(url ? { datasource: { url } } : {}),
});

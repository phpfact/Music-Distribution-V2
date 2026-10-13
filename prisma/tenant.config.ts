import { defineConfig } from "prisma/config";
import { migrationDatabaseUrl } from "./connection";

// Prisma CLI configuration for ONE tenant database, named by TENANT_DATABASE.
// Use with: TENANT_DATABASE=<name> prisma <command> --config prisma/tenant.config.ts
//
// prisma/migrate-tenants.ts sets TENANT_DATABASE for each tenant in turn.
const url = migrationDatabaseUrl(process.env.TENANT_DATABASE);

export default defineConfig({
  schema: "tenant/schema.prisma",
  migrations: { path: "tenant/migrations" },
  ...(url ? { datasource: { url } } : {}),
});

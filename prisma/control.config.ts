import { defineConfig } from "prisma/config";
import { migrationDatabaseUrl } from "./connection";

// Prisma CLI configuration for the control-plane database (POSTGRES_DB).
// Use with: prisma <command> --config prisma/control.config.ts
const url = migrationDatabaseUrl(process.env.POSTGRES_DB);

export default defineConfig({
  schema: "control/schema.prisma",
  migrations: { path: "control/migrations" },
  ...(url ? { datasource: { url } } : {}),
});

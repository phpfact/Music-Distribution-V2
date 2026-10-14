import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/control/client";
import { getPool } from "../postgres";

export type ControlDb = PrismaClient;

// Kept on globalThis so dev hot reloads reuse one client instead of creating one per reload.
const globalForControlDb = globalThis as typeof globalThis & { __controlDb?: ControlDb };

/**
 * Prisma client for the control-plane database (tenants, domains, plans,
 * provisioning runs, audit events, platform owners and their sessions). It
 * runs on the bounded pool from postgres.ts, so the ORM adds no connections
 * of its own.
 */
export function getControlDb(): ControlDb {
  globalForControlDb.__controlDb ??= new PrismaClient({ adapter: new PrismaPg(getPool()) });
  return globalForControlDb.__controlDb;
}

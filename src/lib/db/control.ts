import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/control/client";
import { getPool } from "../postgres";

export type ControlDb = PrismaClient;

// Kept on globalThis so dev hot reloads reuse one client instead of creating one per reload.
const globalForControlDb = globalThis as typeof globalThis & { __controlDb?: ControlDb };

/**
 * Description: Return the shared Prisma client of the control-plane database.
 * Input: None.
 * Output: The client (one per process), running on the bounded pg pool.
 * Use case: Every control-plane read and write.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export function getControlDb(): ControlDb {
  globalForControlDb.__controlDb ??= new PrismaClient({ adapter: new PrismaPg(getPool()) });
  return globalForControlDb.__controlDb;
}

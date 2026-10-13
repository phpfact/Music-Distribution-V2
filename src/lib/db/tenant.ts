import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/tenant/client";
import { getEnv } from "../env";

export type TenantDb = PrismaClient;

/**
 * Where one tenant's data lives and the login to reach it. Build this on the
 * server from the tenant resolved for the request (control plane plus secret
 * storage). Never fill any of it from a request body, query string or header.
 */
export type TenantDatabase = {
  tenantId: string;
  database: string;
  user: string;
  password: string;
};

type Entry = { db: TenantDb; target: TenantDatabase; lastUsedAt: number };

// A client evicted while a request still holds it would fail that request's
// next query, so only clients unused for this long are closed.
const EVICTION_GRACE_MS = 30_000;

// Kept on globalThis so dev hot reloads reuse the clients instead of leaking their pools.
// Map order is least recently used first.
const globalForTenantDb = globalThis as typeof globalThis & { __tenantDbs?: Map<string, Entry> };

function createTenantDb(target: TenantDatabase): TenantDb {
  const { postgres } = getEnv();
  const adapter = new PrismaPg(
    {
      host: postgres.host,
      port: postgres.port,
      database: target.database,
      user: target.user,
      password: target.password,
      // Small and short-lived: an inactive tenant holds no connections at all.
      max: postgres.tenantPoolMax,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    },
    {
      // The message names the tenant only; it never includes credentials.
      onPoolError: (error) => {
        console.error(`[postgres] tenant ${target.tenantId} idle client error: ${error.message}`);
      },
    },
  );
  return new PrismaClient({ adapter });
}

function close(entry: Entry): void {
  entry.db.$disconnect().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[postgres] tenant ${entry.target.tenantId} disconnect failed: ${message}`);
  });
}

function sameTarget(a: TenantDatabase, b: TenantDatabase): boolean {
  return a.database === b.database && a.user === b.user && a.password === b.password;
}

/**
 * Prisma client for one tenant's database.
 *
 * Clients are reused across requests and capped at POSTGRES_TENANT_CLIENTS_MAX;
 * beyond that the least recently used one is closed. Each holds at most
 * POSTGRES_TENANT_POOL_MAX connections and releases them when idle, so the
 * connections in use scale with the tenants active right now, not with the
 * number of tenants.
 */
export function getTenantDb(target: TenantDatabase): TenantDb {
  const entries = (globalForTenantDb.__tenantDbs ??= new Map<string, Entry>());
  const now = Date.now();

  const existing = entries.get(target.tenantId);
  if (existing) {
    entries.delete(target.tenantId);
    if (sameTarget(existing.target, target)) {
      existing.lastUsedAt = now;
      entries.set(target.tenantId, existing);
      return existing.db;
    }
    // The login was rotated or the database moved: drop the stale client.
    close(existing);
  }

  const entry: Entry = { db: createTenantDb(target), target, lastUsedAt: now };
  entries.set(target.tenantId, entry);

  const { tenantClientsMax } = getEnv().postgres;
  for (const [tenantId, candidate] of entries) {
    if (entries.size <= tenantClientsMax) break;
    if (now - candidate.lastUsedAt < EVICTION_GRACE_MS) break;
    entries.delete(tenantId);
    close(candidate);
  }

  return entry.db;
}

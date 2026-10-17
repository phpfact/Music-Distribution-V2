import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/tenant/client";
import { getEnv } from "../env";
import { sanitizeLogMessage } from "../log-sanitizer";

export type TenantDb = PrismaClient;

/**
 * Where one tenant's data lives and the login to reach it. Build this on the
 * server from the tenant resolved for the request (control plane plus secret
 * storage, see src/lib/tenants/database-target.ts). Never fill any of it from
 * a request body, query string or header.
 */
export type TenantDatabase = {
  tenantId: string;
  database: string;
  user: string;
  password: string;
  /** Port on POSTGRES_HOST; a tenant's database may sit on another port than the control plane. */
  port: number;
};

type Entry = { db: TenantDb; target: TenantDatabase; lastUsedAt: number };

// A client evicted while a request still holds it would fail that request's
// next query, so only clients unused for this long are closed.
const EVICTION_GRACE_MS = 30_000;

// Kept on globalThis so dev hot reloads reuse the clients instead of leaking their pools.
// Map order is least recently used first.
const globalForTenantDb = globalThis as typeof globalThis & {
  __tenantDbs?: Map<string, Entry>;
  __tenantDbTrimTimer?: ReturnType<typeof setTimeout>;
};

/**
 * Description: Create a Prisma client for one tenant's database.
 * Input: The tenant's database target (decrypted login).
 * Output: A client on its own small pool that releases idle connections.
 * Use case: getTenantDb.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
function createTenantDb(target: TenantDatabase): TenantDb {
  const { postgres } = getEnv();
  const adapter = new PrismaPg(
    {
      host: postgres.host,
      port: target.port,
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
        console.error(`[postgres] tenant ${target.tenantId} idle client error: ${sanitizeLogMessage(error.message)}`);
      },
    },
  );
  return new PrismaClient({ adapter });
}

/**
 * Description: Disconnect a cached tenant client in the background.
 * Input: The cache entry.
 * Output: Nothing; a failure is logged.
 * Use case: LRU eviction and evictTenantDb.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
function close(entry: Entry): void {
  entry.db.$disconnect().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[postgres] tenant ${entry.target.tenantId} disconnect failed: ${sanitizeLogMessage(message)}`);
  });
}

/**
 * Description: Tell whether two tenant database targets are identical.
 * Input: Two targets.
 * Output: True when database, user, password and port all match.
 * Use case: getTenantDb (a changed password replaces the cached client).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
function sameTarget(a: TenantDatabase, b: TenantDatabase): boolean {
  return (
    a.database === b.database &&
    a.user === b.user &&
    a.password === b.password &&
    a.port === b.port
  );
}

/**
 * Description: Drain idle cache overflow and arrange cleanup after the safety grace.
 * Input: The current timestamp, injectable for straightforward timer tests.
 * Output: Nothing; idle clients close and any remaining overflow gets one timer.
 * Use case: Cache hits, insertion, explicit eviction and scheduled idle cleanup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function trimTenantClients(now = Date.now()): void {
  // One shared timer survives development hot reloads without accumulating jobs.
  if (globalForTenantDb.__tenantDbTrimTimer) {
    clearTimeout(globalForTenantDb.__tenantDbTrimTimer);
    globalForTenantDb.__tenantDbTrimTimer = undefined;
  }
  const entries = globalForTenantDb.__tenantDbs;
  if (!entries) return;
  const { tenantClientsMax } = getEnv().postgres;
  let nextDelay = EVICTION_GRACE_MS;
  for (const [tenantId, entry] of entries) {
    if (entries.size <= tenantClientsMax) break;
    const remaining = EVICTION_GRACE_MS - (now - entry.lastUsedAt);
    if (remaining > 0) {
      nextDelay = Math.min(nextDelay, remaining);
      continue;
    }
    entries.delete(tenantId);
    close(entry);
  }
  if (entries.size > tenantClientsMax) {
    globalForTenantDb.__tenantDbTrimTimer = setTimeout(trimTenantClients, Math.max(1, nextDelay));
    // A soft cache target must not keep an otherwise finished process alive.
    globalForTenantDb.__tenantDbTrimTimer.unref();
  }
}

/**
 * Description: Return the Prisma client for one tenant's database.
 * Input: The tenant's database target.
 * Output: A cached client. POSTGRES_TENANT_CLIENTS_MAX is a soft retention target:
 *   idle LRU overflow closes after 30 seconds, including without new requests.
 *   Individual pool limits bound connections; this is not hard admission control.
 * Use case: Tenant-facing data access.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export function getTenantDb(target: TenantDatabase): TenantDb {
  const entries = (globalForTenantDb.__tenantDbs ??= new Map<string, Entry>());
  const now     = Date.now();

  const existing = entries.get(target.tenantId);
  if (existing) {
    entries.delete(target.tenantId);
    if (sameTarget(existing.target, target)) {
      existing.lastUsedAt = now;
      entries.set(target.tenantId, existing);
      trimTenantClients(now);
      return existing.db;
    }
    // The login was rotated or the database moved: drop the stale client.
    close(existing);
  }

  const entry: Entry = { db: createTenantDb(target), target, lastUsedAt: now };
  entries.set(target.tenantId, entry);

  trimTenantClients(now);

  return entry.db;
}

/**
 * Description: Close the cached client of one tenant right away.
 * Input: The tenant id.
 * Output: Nothing. Unlike LRU eviction this does not wait for idleness: a request
 *   still holding it fails, which is the point after a suspension or password change.
 * Use case: Suspension and database password changes.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export function evictTenantDb(tenantId: string): void {
  const entries = globalForTenantDb.__tenantDbs;
  const entry   = entries?.get(tenantId);
  if (!entries || !entry) return;
  entries.delete(tenantId);
  close(entry);
  trimTenantClients();
}

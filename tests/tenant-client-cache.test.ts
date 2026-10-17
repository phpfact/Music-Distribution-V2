import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantDatabase } from "@/lib/db/tenant";

const mocks = vi.hoisted(() => ({ limit: 2, disconnects: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ postgres: { tenantClientsMax: mocks.limit } }) }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
vi.mock("@/generated/prisma/tenant/client", () => ({
  PrismaClient: class {
    $disconnect = vi.fn(async () => undefined);
    constructor() { mocks.disconnects.push(this.$disconnect); }
  },
}));
import { evictTenantDb, getTenantDb } from "@/lib/db/tenant";

/**
 * Description: Build a synthetic server-trusted cache target with no real database.
 * Input: A unique tenant label.
 * Output: A target used only with mocked clients.
 * Use case: Deterministic cache/timer regression tests.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function target(tenantId: string): TenantDatabase {
  return { tenantId, database: "fixture", user: "fixture", password: "fixture", port: 5432 };
}

beforeEach(() => { vi.useFakeTimers(); mocks.disconnects.length = 0; });
afterEach(() => {
  for (const id of ["a", "b", "c", "d"]) evictTenantDb(id);
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("AUD-008 tenant client soft-target cleanup", () => {
  it("drains burst overflow after the grace without another request", async () => {
    getTenantDb(target("a")); getTenantDb(target("b")); getTenantDb(target("c"));
    expect(mocks.disconnects.every((disconnect) => disconnect.mock.calls.length === 0)).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.disconnects[0]).toHaveBeenCalledOnce();
    expect(mocks.disconnects[1]).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cache hits extend that client's grace while old overflow still drains", async () => {
    const first = getTenantDb(target("a"));
    getTenantDb(target("b")); getTenantDb(target("c"));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(getTenantDb(target("a"))).toBe(first);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.disconnects[0]).not.toHaveBeenCalled();
    expect(mocks.disconnects[1]).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("explicit eviction removes a scheduled overflow cleanup when back within target", () => {
    getTenantDb(target("a")); getTenantDb(target("b")); getTenantDb(target("c"));
    expect(vi.getTimerCount()).toBe(1);
    evictTenantDb("c");
    expect(vi.getTimerCount()).toBe(0);
    expect(getTenantDb(target("a"))).toBeDefined();
  });
});

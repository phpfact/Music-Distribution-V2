/** src/lib/rate-limit.ts against the real Redis. */
import { randomBytes } from "node:crypto";
import { createClient } from "redis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";
import { closeAppRedis } from "./support/app-connections";
import { captureConsole } from "./support/console";

// The real client, unless a test replaces one call to simulate an outage.
vi.mock("@/lib/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/redis")>();
  return { ...actual, getRedis: vi.fn(actual.getRedis) };
});

// The same Redis the dev app uses: every key is unique to this run, registered
// here and deleted afterwards, and nothing else is touched.
function connect() {
  const host = process.env.REDIS_HOST?.trim();
  const password = process.env.REDIS_PASSWORD?.trim();
  if (!host || !password) throw new Error("REDIS_HOST and REDIS_PASSWORD must be set");
  return createClient({
    socket: { host, port: Number(process.env.REDIS_PORT?.trim() || "6379"), connectTimeout: 5_000 },
    password,
  });
}

let redis: ReturnType<typeof connect>;
const used = new Set<string>();

/** A limiter key no other test uses; returns it and its Redis key. */
function newKey(): { key: string; redisKey: string } {
  const key = `vt-test:${randomBytes(8).toString("hex")}`;
  const redisKey = `rl:${key}`;
  used.add(redisKey);
  return { key, redisKey };
}

async function consume(count: number, key: string, limit: number, windowSeconds = 60) {
  const outcomes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    outcomes.push(await consumeRateLimit({ key, limit, windowSeconds }));
  }
  return outcomes;
}

beforeAll(async () => {
  redis = connect();
  redis.on("error", () => undefined);
  await redis.connect();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(getRedis).mockReset();
  for (const key of used) await redis.del(key);
  used.clear();
});

afterAll(async () => {
  redis.destroy();
  await closeAppRedis();
});

describe("consumeRateLimit", () => {
  it("allows `limit` calls in a window and limits the next ones", async () => {
    const { key, redisKey } = newKey();
    expect(await consume(5, key, 3)).toStrictEqual([
      "allowed",
      "allowed",
      "allowed",
      "limited",
      "limited",
    ]);
    expect(Number(await redis.get(redisKey))).toBe(5);
  });

  it("counts each key separately", async () => {
    const first = newKey();
    const second = newKey();
    expect(await consume(2, first.key, 1)).toStrictEqual(["allowed", "limited"]);
    expect(await consume(1, second.key, 1)).toStrictEqual(["allowed"]);
  });

  it("stores the counter under rl: with the window as expiry", async () => {
    const { key, redisKey } = newKey();
    await consumeRateLimit({ key, limit: 10, windowSeconds: 300 });
    const ttl = await redis.ttl(redisKey);
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("does not extend the window when a call is limited", async () => {
    const { key, redisKey } = newKey();
    expect((await consume(2, key, 1, 300)).at(-1)).toBe("limited");
    await redis.expire(redisKey, 50);

    expect(await consumeRateLimit({ key, limit: 1, windowSeconds: 300 })).toBe("limited");
    const ttl = await redis.ttl(redisKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(50);
  });

  it("starts a new window once the counter has expired", async () => {
    const { key, redisKey } = newKey();
    expect((await consume(2, key, 1)).at(-1)).toBe("limited");
    await redis.del(redisKey);
    expect(await consumeRateLimit({ key, limit: 1, windowSeconds: 60 })).toBe("allowed");
  });

  it.each([
    ["an empty key", { key: "", limit: 1, windowSeconds: 60 }],
    ["a zero limit", { key: "vt-test:x", limit: 0, windowSeconds: 60 }],
    ["a fractional limit", { key: "vt-test:x", limit: 1.5, windowSeconds: 60 }],
    ["a zero window", { key: "vt-test:x", limit: 1, windowSeconds: 0 }],
  ])("throws for %s", async (_description, rule) => {
    await expect(consumeRateLimit(rule)).rejects.toBeInstanceOf(RangeError);
  });
});

describe("when Redis cannot be reached", () => {
  it("answers `unavailable` at once when the connection fails", async () => {
    const logged = captureConsole();
    const { key, redisKey } = newKey();
    vi.mocked(getRedis).mockRejectedValueOnce(new Error("connect ECONNREFUSED password=AUDIT_REDIS_CANARY"));

    const started = Date.now();
    expect(await consumeRateLimit({ key, limit: 5, windowSeconds: 60 })).toBe("unavailable");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await redis.get(redisKey)).toBeNull();
    expect(logged.text()).toContain("limiter unavailable");
    expect(logged.text()).not.toContain("AUDIT_REDIS_CANARY");
  });

  it("answers `unavailable` after about 2 seconds when Redis never answers", async () => {
    captureConsole();
    const { key } = newKey();
    vi.mocked(getRedis).mockReturnValueOnce(new Promise<never>(() => undefined));

    const started = Date.now();
    const outcome = await consumeRateLimit({ key, limit: 5, windowSeconds: 60 });
    const elapsed = Date.now() - started;

    expect(outcome).toBe("unavailable");
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    expect(elapsed).toBeLessThan(3_500);
  });
});

/** src/lib/platform-auth/rate-limit.ts against the real Redis. */
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  clearLoginAttempts,
  clientIpFromForwardedFor,
  countLoginAttempt,
} from "@/lib/platform-auth/rate-limit";
import { getRedis } from "@/lib/redis";
import { closeAppRedis } from "./support/app-connections";
import { captureConsole } from "./support/console";
import { LoginKeys } from "./support/login-keys";

// The real client, unless a test replaces one call to simulate an outage.
vi.mock("@/lib/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/redis")>();
  return { ...actual, getRedis: vi.fn(actual.getRedis) };
});

const WINDOW_SECONDS = 900;

let keys: LoginKeys;

beforeAll(async () => {
  keys = await LoginKeys.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(getRedis).mockReset();
  await keys.cleanup();
});

afterAll(async () => {
  await keys.close();
  await closeAppRedis();
});

/** A user name no other test uses, with its counter key registered for cleanup. */
async function newUsername(): Promise<{ username: string; key: string }> {
  const username = `vt-rl-${randomBytes(6).toString("hex")}`;
  return { username, key: await keys.claimUsername(username) };
}

async function useIp(ip: string): Promise<{ ip: string; key: string }> {
  return { ip, key: await keys.claimIp(ip) };
}

async function attempts(count: number, username: string, ip: string): Promise<string[]> {
  const outcomes: string[] = [];
  for (let i = 0; i < count; i += 1) outcomes.push(await countLoginAttempt(username, ip));
  return outcomes;
}

describe("clientIpFromForwardedFor", () => {
  it.each([
    ["a single address", "203.0.113.7", "203.0.113.7"],
    ["the last of several", "198.51.100.1, 203.0.113.7", "203.0.113.7"],
    ["the last of several, without spaces", "198.51.100.1,198.51.100.2,203.0.113.9", "203.0.113.9"],
    ["an address with white space around it", "  203.0.113.7\t", "203.0.113.7"],
    ["an IPv6 address, lower-cased", "2001:DB8::1", "2001:db8::1"],
    ["an IPv4-mapped IPv6 address", "::ffff:203.0.113.7", "::ffff:203.0.113.7"],
    ["a spoofed first entry, ignored", "<script>alert(1)</script>, 203.0.113.7", "203.0.113.7"],
  ])("returns %s", (_description, header, expected) => {
    expect(clientIpFromForwardedFor(header)).toBe(expected);
  });

  it.each([
    ["no header", null],
    ["an empty header", ""],
    ["white space", "   "],
    ["garbage", "not an address"],
    ["a host name", "client.example.com"],
    ["garbage in the last entry", "203.0.113.7, evil\r\nSET x y"],
    ["an empty last entry", "203.0.113.7,"],
    ["a value longer than any address", "1".repeat(46)],
    ["a very long value", "a:".repeat(5_000)],
  ])("returns `unknown` for %s", (_description, header) => {
    expect(clientIpFromForwardedFor(header)).toBe("unknown");
  });
});

describe("countLoginAttempt", () => {
  it("allows attempts 1 to 5 for a username and limits the 6th", async () => {
    const { username, key } = await newUsername();
    const { ip } = await useIp("203.0.113.10");

    expect(await attempts(6, username, ip)).toStrictEqual([
      "allowed",
      "allowed",
      "allowed",
      "allowed",
      "allowed",
      "limited",
    ]);
    expect(await keys.count(key)).toBe(6);
    // Still limited on the next one.
    expect(await countLoginAttempt(username, ip)).toBe("limited");
  });

  it("counts a username across client addresses", async () => {
    const { username } = await newUsername();
    const first = await useIp("203.0.113.11");
    const second = await useIp("198.51.100.11");

    expect(await attempts(3, username, first.ip)).toStrictEqual(["allowed", "allowed", "allowed"]);
    expect(await attempts(3, username, second.ip)).toStrictEqual(["allowed", "allowed", "limited"]);
  });

  it("keeps allowing other usernames from one address until its total passes 20", async () => {
    const { ip, key: ipKey } = await useIp("203.0.113.12");
    const blocked = await newUsername();
    expect((await attempts(6, blocked.username, ip)).at(-1)).toBe("limited");

    // Attempts 7 to 20 from the same address, at most 5 per username.
    for (const count of [5, 5, 4]) {
      const { username } = await newUsername();
      expect(await attempts(count, username, ip)).toStrictEqual(Array(count).fill("allowed"));
    }
    expect(await keys.count(ipKey)).toBe(20);

    // The 21st is refused although this username has never been tried.
    const fresh = await newUsername();
    expect(await countLoginAttempt(fresh.username, ip)).toBe("limited");

    // The same username from another address is not affected.
    const elsewhere = await useIp("198.51.100.12");
    const unaffected = await newUsername();
    expect(await countLoginAttempt(unaffected.username, elsewhere.ip)).toBe("allowed");
  });

  it("stores the username hashed, never in the clear", async () => {
    const { username, key } = await newUsername();
    const { ip } = await useIp("203.0.113.13");

    await countLoginAttempt(username, ip);

    expect(key).toMatch(/^platform-login:user:[0-9a-f]{64}$/);
    expect(key).not.toContain(username);
    expect(await keys.count(key)).toBe(1);
  });

  it("gives both counters a 15-minute expiry", async () => {
    const { username, key: userKey } = await newUsername();
    const { ip, key: ipKey } = await useIp("203.0.113.14");

    await countLoginAttempt(username, ip);

    for (const key of [userKey, ipKey]) {
      const ttl = await keys.ttl(key);
      expect(ttl).toBeGreaterThan(WINDOW_SECONDS - 30);
      expect(ttl).toBeLessThanOrEqual(WINDOW_SECONDS);
    }
  });

  it("does not extend the window when an attempt is blocked", async () => {
    const { username, key: userKey } = await newUsername();
    const { ip, key: ipKey } = await useIp("203.0.113.15");
    expect((await attempts(6, username, ip)).at(-1)).toBe("limited");
    // As if most of the window had passed.
    await keys.expireIn(userKey, 100);
    await keys.expireIn(ipKey, 100);

    expect(await countLoginAttempt(username, ip)).toBe("limited");

    for (const key of [userKey, ipKey]) {
      const ttl = await keys.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(100);
    }
  });

  it("starts a new window once the counters have expired", async () => {
    const { username, key: userKey } = await newUsername();
    const { ip } = await useIp("203.0.113.16");
    expect((await attempts(6, username, ip)).at(-1)).toBe("limited");

    // The window ends: Redis drops the key.
    await keys.claimUsername(username);

    expect(await countLoginAttempt(username, ip)).toBe("allowed");
    expect(await keys.count(userKey)).toBe(1);
  });
});

describe("clearLoginAttempts", () => {
  it("resets the username counter and keeps the address counter", async () => {
    const { username, key: userKey } = await newUsername();
    const { ip, key: ipKey } = await useIp("203.0.113.17");
    await attempts(3, username, ip);

    await clearLoginAttempts(username);

    expect(await keys.count(userKey)).toBeNull();
    expect(await keys.count(ipKey)).toBe(3);
    // Five more attempts are possible again.
    expect(await attempts(6, username, ip)).toStrictEqual([
      "allowed",
      "allowed",
      "allowed",
      "allowed",
      "allowed",
      "limited",
    ]);
  });

  it("leaves other usernames alone", async () => {
    const cleared = await newUsername();
    const other = await newUsername();
    const { ip } = await useIp("203.0.113.18");
    await attempts(2, cleared.username, ip);
    await attempts(2, other.username, ip);

    await clearLoginAttempts(cleared.username);

    expect(await keys.count(other.key)).toBe(2);
  });
});

describe("when Redis cannot be reached", () => {
  it("answers `unavailable` at once when the connection fails", async () => {
    const logged = captureConsole();
    const { username, key: userKey } = await newUsername();
    const { ip, key: ipKey } = await useIp("203.0.113.19");
    vi.mocked(getRedis).mockRejectedValueOnce(new Error("connect ECONNREFUSED token=AUDIT_REDIS_CANARY"));

    const started = Date.now();
    const outcome = await countLoginAttempt(username, ip);

    expect(outcome).toBe("unavailable");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await keys.count(userKey)).toBeNull();
    expect(await keys.count(ipKey)).toBeNull();
    expect(logged.text()).toContain("rate limiter unavailable");
    expect(logged.text()).not.toContain("AUDIT_REDIS_CANARY");
    expect(logged.text()).not.toContain(username);
  });

  it("answers `unavailable` after about 2 seconds when Redis never answers", async () => {
    captureConsole();
    const { username } = await newUsername();
    const { ip } = await useIp("203.0.113.20");
    vi.mocked(getRedis).mockReturnValueOnce(new Promise<never>(() => undefined));

    const started = Date.now();
    const outcome = await countLoginAttempt(username, ip);
    const elapsed = Date.now() - started;

    expect(outcome).toBe("unavailable");
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    expect(elapsed).toBeLessThan(3_500);
  });

  it("clearLoginAttempts does not throw, whether Redis fails or never answers", async () => {
    captureConsole();
    const { username } = await newUsername();

    vi.mocked(getRedis).mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    await expect(clearLoginAttempts(username)).resolves.toBeUndefined();

    vi.mocked(getRedis).mockReturnValueOnce(new Promise<never>(() => undefined));
    const started = Date.now();
    await expect(clearLoginAttempts(username)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(3_500);
  });
});

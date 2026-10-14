import { createHash } from "node:crypto";
import { createClient } from "redis";

/**
 * The rate limiter's counters live in the same Redis the dev app uses. Tests
 * therefore only use recognisable user names and documentation addresses,
 * register every key they can cause here, and delete exactly those keys.
 */
const USERNAME_KEY_PREFIX = "platform-login:user:";
const IP_KEY_PREFIX = "platform-login:ip:";

/** What a test user name must start with once normalized. */
const TEST_USERNAME_PREFIXES = ["vt-", "e2e-"];
// TEST-NET-3 and TEST-NET-2 (RFC 5737): never a real client.
const TEST_IP_PATTERN = /^(203\.0\.113|198\.51\.100)\.(25[0-5]|2[0-4]\d|1?\d?\d)$/;

function connect() {
  const host = process.env.REDIS_HOST?.trim();
  const password = process.env.REDIS_PASSWORD?.trim();
  if (!host || !password) throw new Error("REDIS_HOST and REDIS_PASSWORD must be set");
  return createClient({
    socket: { host, port: Number(process.env.REDIS_PORT?.trim() || "6379"), connectTimeout: 5_000 },
    password,
  });
}

type RedisClient = ReturnType<typeof connect>;

export class LoginKeys {
  private readonly tracked = new Set<string>();

  private constructor(private readonly redis: RedisClient) {}

  static async open(): Promise<LoginKeys> {
    const redis = connect();
    redis.on("error", () => undefined);
    await redis.connect();
    return new LoginKeys(redis);
  }

  /** The counter key of a submitted user name, as the limiter derives it. */
  static usernameKey(username: string): string {
    const normalized = username.trim().toLowerCase();
    return `${USERNAME_KEY_PREFIX}${createHash("sha256").update(normalized).digest("hex")}`;
  }

  static ipKey(ip: string): string {
    return `${IP_KEY_PREFIX}${ip}`;
  }

  /** Registers the counter of a test user name, removing what an aborted run left. */
  async claimUsername(username: string): Promise<string> {
    const normalized = username.trim().toLowerCase();
    if (!TEST_USERNAME_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      throw new Error("tests may only count sign-in attempts for vt-... and e2e-... user names");
    }
    return this.claim(LoginKeys.usernameKey(username));
  }

  /** Registers the counter of a documentation address, removing what an aborted run left. */
  async claimIp(ip: string): Promise<string> {
    if (!TEST_IP_PATTERN.test(ip)) {
      throw new Error("tests may only use client addresses from 203.0.113.0/24 or 198.51.100.0/24");
    }
    return this.claim(LoginKeys.ipKey(ip));
  }

  private async claim(key: string): Promise<string> {
    this.tracked.add(key);
    await this.redis.del(key);
    return key;
  }

  /** The counter's value, or null when the key does not exist. */
  async count(key: string): Promise<number | null> {
    const value = await this.redis.get(key);
    return value === null ? null : Number(value);
  }

  /** Seconds to live; -2 when the key does not exist, -1 when it has no expiry. */
  ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  /** Only for keys this instance has claimed. */
  async expireIn(key: string, seconds: number): Promise<void> {
    if (!this.tracked.has(key)) throw new Error("not a key claimed by this test");
    await this.redis.expire(key, seconds);
  }

  /** Deletes every key claimed so far, and nothing else. */
  async cleanup(): Promise<void> {
    for (const key of this.tracked) await this.redis.del(key);
    this.tracked.clear();
  }

  async close(): Promise<void> {
    await this.cleanup();
    this.redis.destroy();
  }
}

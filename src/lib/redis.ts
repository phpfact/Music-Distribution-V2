import "server-only";
import { createClient } from "redis";
import { getEnv } from "./env";

function createRedisClient() {
  const { redis } = getEnv();
  return createClient({
    socket: {
      host: redis.host,
      port: redis.port,
      connectTimeout: 5_000,
      // Keep retrying with a capped backoff rather than giving up for good.
      reconnectStrategy: (retries) => Math.min(retries * 100, 3_000),
    },
    password: redis.password,
    // Once connected, fail commands immediately during an outage instead of
    // queueing them without bound.
    disableOfflineQueue: true,
  });
}

type RedisClient = ReturnType<typeof createRedisClient>;
type RedisState = { client: RedisClient; firstConnection: Promise<void> };

// Kept on globalThis so dev hot reloads reuse one connection instead of leaking one per reload.
const globalForRedis = globalThis as typeof globalThis & { __redis?: RedisState };

function getState(): RedisState {
  let state = globalForRedis.__redis;
  if (!state) {
    const client = createRedisClient();
    client.on("error", (error: Error) => {
      console.error(`[redis] ${error.message}`);
    });
    // Resolves once the first connection is established. While Redis is
    // unreachable it stays pending (the client keeps retrying), so callers
    // must apply their own timeout.
    const firstConnection = client.connect().then(
      () => undefined,
      () => undefined, // Already reported by the "error" listener above.
    );
    state = { client, firstConnection };
    globalForRedis.__redis = state;
  }
  return state;
}

/** The shared client, after its first connection attempt has completed. */
export async function getRedis(): Promise<RedisClient> {
  const { client, firstConnection } = getState();
  await firstConnection;
  return client;
}

export async function pingRedis(): Promise<void> {
  const client = await getRedis();
  await client.ping();
}

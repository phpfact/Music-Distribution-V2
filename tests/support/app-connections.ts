import { getPool } from "@/lib/postgres";
import { getRedis } from "@/lib/redis";

/**
 * The application keeps its pg pool and its Redis client on globalThis. Test
 * files that used them close them at the end, so no connection to the scratch
 * database outlives the file.
 */
export async function closeAppDatabase(): Promise<void> {
  await getPool().end();
}

export async function closeAppRedis(): Promise<void> {
  (await getRedis()).destroy();
}

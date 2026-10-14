/**
 * Platform owner password hashing (Argon2id).
 *
 * Shared by the login code and by prisma/seed.ts, which runs under plain tsx.
 * So this module must not import `server-only` or anything that does.
 */
import { randomBytes } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

/** Longer inputs are rejected before hashing, to bound the work one request can cause. */
export const PASSWORD_MAX_LENGTH = 256;

// Algorithm.Argon2id. The package declares it as a const enum, which cannot be
// imported under `isolatedModules`.
const ARGON2ID = 2;
// The OWASP minimum recommendation for Argon2id: 19 MiB of memory, 2 passes, 1 thread.
const MEMORY_COST_KIB = 19456;
const TIME_COST = 2;
const PARALLELISM = 1;

/** Returns the hash in PHC format (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`). */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length > PASSWORD_MAX_LENGTH) {
    throw new RangeError(`password is longer than ${PASSWORD_MAX_LENGTH} characters`);
  }
  return argon2Hash(plain, {
    algorithm: ARGON2ID,
    memoryCost: MEMORY_COST_KIB,
    timeCost: TIME_COST,
    parallelism: PARALLELISM,
  });
}

/** Never throws: a malformed hash or an over-long input is simply not a match. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (plain.length > PASSWORD_MAX_LENGTH) return false;
  try {
    return await argon2Verify(hash, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the time a real verification takes, for a login attempt whose user
 * name does not exist, so the response time does not reveal which names do.
 * The hash is of a random value nobody knows, created on first use.
 */
export async function verifyAgainstDummy(plain: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  try {
    await verifyPassword(await dummyHash, plain);
  } catch {
    // Creating the hash failed; try again on the next call.
    dummyHash = undefined;
  }
}

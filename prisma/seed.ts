/**
 * Creates the first platform owner account in the control-plane database,
 * from PLATFORM_OWNER_INITIAL_USERNAME and PLATFORM_OWNER_INITIAL_PASSWORD.
 *
 *   npm run db:seed
 *
 * Safe to run again: it only bootstraps an empty `platform_owners` table. Once
 * any platform owner exists it changes nothing, whatever the two variables say.
 * The bootstrapped owner is the primary account and holds the Master Platform
 * role (.vibe/memory/role-privilege-management.md).
 *
 *   npm run db:seed:rotate-password
 *
 * Deliberate credential rotation: sets the password of the existing account
 * named by PLATFORM_OWNER_INITIAL_USERNAME to PLATFORM_OWNER_INITIAL_PASSWORD
 * and revokes all of that account's sessions. It never creates an account and
 * never changes a user name or status.
 *
 * The password is hashed here and never logged or written anywhere else.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/control/client";
import { hashPassword, PASSWORD_MAX_LENGTH } from "../src/lib/platform-auth/password";
import {
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../src/lib/platform-auth/username";
import { migrationDatabaseUrl } from "./connection";

const USERNAME_VARIABLE = "PLATFORM_OWNER_INITIAL_USERNAME";
const PASSWORD_VARIABLE = "PLATFORM_OWNER_INITIAL_PASSWORD";
const ROTATE_FLAG = "--rotate-password";

const PASSWORD_MIN_LENGTH = 12;
/** What `make init` replaces; a value that still starts with it was never set. */
const PLACEHOLDER_PREFIX = "change-me";

/** Arbitrary, fixed: seed runs take this advisory lock so that they serialize. */
const SEED_LOCK_KEY = 1886353262;

type Config = { url: string; username: string; password: string };

function usage(): string {
  return [
    "Usage: tsx prisma/seed.ts [--rotate-password]",
    "  (no flag)          create the initial platform owner if none exists",
    `  ${ROTATE_FLAG}  set the existing owner's password and revoke its sessions`,
  ].join("\n");
}

/** Problems name the variable only. Values are never included, so this is safe to log. */
function readConfig(env: NodeJS.ProcessEnv): Config | { problems: string[] } {
  const problems: string[] = [];

  const url = migrationDatabaseUrl(env.POSTGRES_DB);
  if (!url) {
    problems.push("POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB must be set");
  }

  const username = normalizeUsername(env[USERNAME_VARIABLE] ?? "");
  if (!username) {
    problems.push(`${USERNAME_VARIABLE} is required but is not set`);
  } else if (!isValidUsername(username)) {
    problems.push(
      `${USERNAME_VARIABLE} must be ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters: ` +
        'letters, digits, ".", "_" or "-", starting and ending with a letter or digit',
    );
  }

  // Used exactly as given: a password is never trimmed or otherwise altered.
  const password = env[PASSWORD_VARIABLE] ?? "";
  if (!password) {
    problems.push(`${PASSWORD_VARIABLE} is required but is not set`);
  } else if (password.startsWith(PLACEHOLDER_PREFIX)) {
    problems.push(`${PASSWORD_VARIABLE} is still a placeholder ("${PLACEHOLDER_PREFIX}...")`);
  } else if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    problems.push(
      `${PASSWORD_VARIABLE} must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`,
    );
  }

  if (problems.length > 0 || !url) return { problems };
  return { url, username, password };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * One line for the log. Prisma puts the cause on the last line of its message;
 * anything that looks like a connection string is removed. The password is
 * never passed to the database client, so it cannot appear here.
 */
function failureDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  const detail = (code ? lines.at(-1) : lines[0]) ?? "unknown error";
  const safe = detail.replace(/postgres(ql)?:\/\/\S+/gi, "<connection string>");
  return code ? `${code}: ${safe}` : safe;
}

async function lockSeed(tx: Pick<PrismaClient, "$executeRaw">): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY}::bigint)`;
}

function reportExisting(username: string, matches: boolean): void {
  const unchanged = "[seed] a platform owner already exists; it was not recreated or modified.";
  if (matches) {
    console.log(
      `${unchanged} The configured username "${username}" matches an existing account, whose ` +
        `password was left as it is. To change it, run the seed with ${ROTATE_FLAG}.`,
    );
  } else {
    console.log(
      `${unchanged} The configured username "${username}" was ignored: it matches no existing ` +
        "account, and the seed only bootstraps an empty table.",
    );
  }
}

/**
 * Description: Bootstrap the first platform owner when the table is empty.
 * Input: The control-plane client, the normalized username and the password hash.
 * Output: Exit code 0 (created, or an owner already exists and nothing changed).
 *   The new owner is the primary account and holds the Master Platform role
 *   (.vibe/memory/role-privilege-management.md); the role is found by its
 *   protected system key, never by its name.
 * Use case: `npm run db:seed`.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-16
 */
async function seed(
  control: PrismaClient,
  username: string,
  passwordHash: string,
): Promise<number> {
  try {
    const outcome = await control.$transaction(async (tx) => {
      // Step 1: serialize concurrent seed runs.
      await lockSeed(tx);

      // Step 2: only an empty table is bootstrapped.
      if ((await tx.platformOwner.count()) > 0) {
        const match = await tx.platformOwner.findUnique({
          where: { username },
          select: { id: true },
        });
        return { created: false, matches: match !== null };
      }

      // Step 3: the master role written by the rbac migration.
      const master = await tx.platformRole.findUnique({
        where: { systemKey: "master_platform" },
        select: { id: true },
      });
      if (!master) {
        throw new Error("the Master Platform role is missing: apply the control-plane migrations first");
      }

      // Step 4: the first owner — primary account, Master Platform.
      await tx.platformOwner.create({
        data: { username, passwordHash, isPrimary: true, roleId: master.id },
      });
      return { created: true, matches: true };
    });

    if (outcome.created) console.log(`[seed] created platform owner "${username}"`);
    else reportExisting(username, outcome.matches);
    return 0;
  } catch (error) {
    // Only possible if something else inserted the same name without the lock.
    if (isUniqueViolation(error)) {
      reportExisting(username, true);
      return 0;
    }
    throw error;
  }
}

async function rotatePassword(
  control: PrismaClient,
  username: string,
  passwordHash: string,
): Promise<number> {
  const revoked = await control.$transaction(async (tx) => {
    await lockSeed(tx);
    const owner = await tx.platformOwner.findUnique({ where: { username }, select: { id: true } });
    if (!owner) return null;
    await tx.platformOwner.update({ where: { id: owner.id }, data: { passwordHash } });
    const sessions = await tx.platformOwnerSession.deleteMany({ where: { ownerId: owner.id } });
    return sessions.count;
  });

  if (revoked === null) {
    console.error(
      `[seed] no platform owner named "${username}" exists; nothing was changed. ` +
        `${ROTATE_FLAG} only changes the password of an existing account: ` +
        `set ${USERNAME_VARIABLE} to its username.`,
    );
    return 1;
  }
  console.log(
    `[seed] changed the password of platform owner "${username}"; ${revoked} session(s) revoked`,
  );
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  // The arguments are not echoed: a secret typed here by mistake stays out of the log.
  if (args.some((arg) => arg !== ROTATE_FLAG)) {
    console.error(`[seed] unknown argument.\n${usage()}`);
    return 1;
  }
  const run = args.includes(ROTATE_FLAG) ? rotatePassword : seed;

  const config = readConfig(process.env);
  if ("problems" in config) {
    console.error(
      [
        "[seed] invalid configuration:",
        ...config.problems.map((problem) => `  - ${problem}`),
        "Set these in your env file (see .env.example). Nothing was changed.",
      ].join("\n"),
    );
    return 1;
  }

  // Hashed before any transaction opens, so the lock is held only briefly.
  const passwordHash = await hashPassword(config.password);

  const control = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.url, max: 1 }),
  });
  try {
    return await run(control, config.username, passwordHash);
  } catch (error) {
    console.error(`[seed] database error, nothing was changed. ${failureDetail(error)}`);
    return 1;
  } finally {
    await control.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`[seed] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);

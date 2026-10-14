import "server-only";
import { getControlDb } from "../db/control";
import { PASSWORD_MAX_LENGTH, verifyAgainstDummy, verifyPassword } from "./password";
import { clearLoginAttempts, countLoginAttempt } from "./rate-limit";
import { createSession, describeError } from "./session";
import { isValidUsername, normalizeUsername } from "./username";

/** As read from the submitted form: anything that is not a string counts as empty. */
export type LoginInput = { username: unknown; password: unknown };

export type LoginFieldErrors = { username?: string; password?: string };

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; reason: "validation"; fieldErrors: LoginFieldErrors }
  | { ok: false; reason: "invalid_credentials" | "rate_limited" | "unavailable" };

type VerifiedOwner = { id: string; username: string; passwordHash: string };

/**
 * The owner these credentials belong to, or null. Every way of being wrong
 * (malformed name, unknown name, wrong password, disabled account) costs one
 * password verification, so the response time does not tell them apart.
 */
async function verifyCredentials(
  username: string,
  password: string,
): Promise<VerifiedOwner | null> {
  // No such account can exist, so the database is not asked. The format rules
  // are not revealed: the caller reports this like any other wrong credential.
  if (!isValidUsername(username) || password.length > PASSWORD_MAX_LENGTH) {
    await verifyAgainstDummy(password);
    return null;
  }

  const owner = await getControlDb().platformOwner.findUnique({
    where: { username },
    select: { id: true, passwordHash: true, status: true },
  });
  if (!owner) {
    await verifyAgainstDummy(password);
    return null;
  }

  // Verified before the status is looked at, so a disabled account takes as
  // long as an active one.
  const passwordMatches = await verifyPassword(owner.passwordHash, password);
  if (!passwordMatches || owner.status !== "active") return null;

  return { id: owner.id, username, passwordHash: owner.passwordHash };
}

/**
 * Checks a sign-in attempt and, if it succeeds, starts a session and returns
 * its token. This is the whole decision: callers add nothing to it, so it is
 * safe behind a Server Action, which is a public HTTP endpoint.
 */
export async function authenticatePlatformOwner(
  input: LoginInput,
  clientIp: string,
): Promise<LoginResult> {
  const username = normalizeUsername(typeof input.username === "string" ? input.username : "");
  // Used exactly as given: a password is never trimmed or otherwise altered.
  const password = typeof input.password === "string" ? input.password : "";

  const fieldErrors: LoginFieldErrors = {};
  if (!username) fieldErrors.username = "Enter your username.";
  if (!password) fieldErrors.password = "Enter your password.";
  if (fieldErrors.username || fieldErrors.password) {
    return { ok: false, reason: "validation", fieldErrors };
  }

  // Counted before anything else is checked. While blocked, even the correct
  // password is refused, and neither the database nor the hash is touched.
  const attempt = await countLoginAttempt(username, clientIp);
  if (attempt === "unavailable") return { ok: false, reason: "unavailable" };
  if (attempt === "limited") {
    console.warn("[platform-auth] login rejected (rate limited)");
    return { ok: false, reason: "rate_limited" };
  }

  try {
    const owner = await verifyCredentials(username, password);
    const token = owner ? await createSession(owner.id, owner.passwordHash) : null;
    if (!owner || !token) {
      // The submitted name is not logged: people sometimes type their
      // password into the user name field.
      console.warn("[platform-auth] login rejected (invalid credentials)");
      return { ok: false, reason: "invalid_credentials" };
    }

    await clearLoginAttempts(owner.username);
    console.log(`[platform-auth] login succeeded for "${owner.username}"`);
    return { ok: true, token };
  } catch (error) {
    console.error(`[platform-auth] login failed: ${describeError(error)}`);
    return { ok: false, reason: "unavailable" };
  }
}

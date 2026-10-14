/**
 * Platform owner user names.
 *
 * Shared by the login code and by prisma/seed.ts, which runs under plain tsx.
 * So this module must not import `server-only` or anything that does.
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 64;

// The same rule as the check constraint on platform_owners.username.
const USERNAME_PATTERN = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

/** The form a user name is stored and looked up in. */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** Expects an already normalized name; anything else is simply not valid. */
export function isValidUsername(normalized: string): boolean {
  return (
    normalized.length >= USERNAME_MIN_LENGTH &&
    normalized.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(normalized)
  );
}

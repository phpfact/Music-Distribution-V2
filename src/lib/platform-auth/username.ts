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

/**
 * Description: Bring a user name into the form it is stored and looked up in.
 * Input: The raw text.
 * Output: The text trimmed and lower-cased.
 * Use case: Sign-in, the seed script and tenant admin user names.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Description: Check a normalized user name against the stored-name rule.
 * Input: An already normalized name (anything else is simply not valid).
 * Output: True for 3–64 characters of lower-case letters, digits, dots,
 *   hyphens or underscores, starting and ending with a letter or digit (the
 *   same rule as the database check constraint).
 * Use case: Sign-in (before asking the database), the seed script and tenant admin names.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function isValidUsername(normalized: string): boolean {
  return (
    normalized.length >= USERNAME_MIN_LENGTH &&
    normalized.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(normalized)
  );
}

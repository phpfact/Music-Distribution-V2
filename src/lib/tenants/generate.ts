import "server-only";
/**
 * Generated tenant values (docs/tenant-management.md §4, "Generators").
 *
 * Only node:crypto's CSPRNG is used: several of these values are passwords or
 * tokens, and the others become names an attacker should not be able to predict.
 * Whether a candidate is already taken is the caller's lookup (`pickAvailable`).
 */
import { randomBytes, randomInt } from "node:crypto";
import { checkMasterPassword } from "@/lib/tenants/rules";

const SLUG_MAX_LENGTH = 40;
const SLUG_FALLBACK   = "tenant";
/** Subdomain labels and DB identifiers: 63. Tenant user names: 64. */
const DEFAULT_MAX_LENGTH        = 63;
const DATABASE_SUFFIX_LENGTH    = 6;
export const NAME_SUFFIX_LENGTH = 4;

const LOWER_ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Description: Build the readable base for generated user names, subdomains and database names.
 * Input: The tenant's full name.
 * Output: Lower-case [a-z0-9-] text of at most 40 characters (accents removed, other
 *   scripts dropped), or "tenant" when nothing usable is left.
 * Use case: Every generator of the create preview.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function slugBase(fullName: string): string {
  const slug = fullName
    .normalize("NFKD")
    // Drops the accents NFKD split off ("é" → "e"); other scripts drop out below.
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : SLUG_FALLBACK;
}

/**
 * Description: Draw random characters from an alphabet with the CSPRNG.
 * Input: The alphabet and the number of characters.
 * Output: The random text.
 * Use case: randomSuffix and generateMasterPassword.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function randomFrom(alphabet: string, length: number): string {
  let text = "";
  for (let i = 0; i < length; i += 1) text += alphabet[randomInt(alphabet.length)];
  return text;
}

/**
 * Description: Draw a random [a-z0-9] suffix.
 * Input: The length.
 * Output: `length` random lower-case letters and digits.
 * Use case: withSuffix and generateDatabaseIdentifiers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function randomSuffix(length: number): string {
  return randomFrom(LOWER_ALNUM, length);
}

/**
 * Description: Append a random suffix to a base, shortening the base to fit.
 * Input: The base, the suffix length and the maximum total length.
 * Output: `<base>-<suffix>` (or only the suffix when no base is left).
 * Use case: nameCandidates (taken or unacceptable plain names).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function withSuffix(
  base: string,
  length: number = NAME_SUFFIX_LENGTH,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  const room = Math.max(0, maxLength - length - 1);
  const head = base.slice(0, room).replace(/-+$/, "");
  return head.length > 0 ? `${head}-${randomSuffix(length)}` : randomSuffix(length);
}

/**
 * Description: Produce candidates for a user name or subdomain.
 * Input: The slug base, the caller's acceptance rule and the maximum length.
 * Output: A function returning the next candidate: the base itself first (if the
 *   rule accepts it: it may be reserved or too short), then suffixed ones.
 * Use case: previewGeneratedValues with pickAvailable.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function nameCandidates(
  base: string,
  isAcceptable: (value: string) => boolean,
  maxLength: number = DEFAULT_MAX_LENGTH,
): () => string {
  let first = true;
  return () => {
    const plain = first && isAcceptable(base);
    first = false;
    return plain ? base : withSuffix(base, NAME_SUFFIX_LENGTH, maxLength);
  };
}

/**
 * Description: Generate a tenant database name and its runtime user name.
 * Input: The slug base.
 * Output: `t_<slug>_<6 random>` and `<that>_app`: at most 53 characters, inside
 *   PostgreSQL's 63-byte limit; the `t_` prefix never starts with a digit.
 * Use case: previewGeneratedValues.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function generateDatabaseIdentifiers(base: string): {
  databaseName: string;
  databaseUser: string;
} {
  const middle       = base.replace(/[^a-z0-9]+/g, "_").slice(0, SLUG_MAX_LENGTH).replace(/^_+|_+$/g, "");
  const databaseName = `t_${middle.length > 0 ? middle : SLUG_FALLBACK}_${randomSuffix(DATABASE_SUFFIX_LENGTH)}`;
  return { databaseName, databaseUser: `${databaseName}_app` };
}

// No look-alikes (i/l/1/I, o/O/0) so the password can be read out or copied by hand.
const PASSWORD_CLASSES = [
  "abcdefghjkmnpqrstuvwxyz",
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "23456789",
  // No quotes, backslash, space or `$`: safe to paste into a shell or a .env file.
  "!#%*+-=?@^_~",
];
const PASSWORD_ALPHABET      = PASSWORD_CLASSES.join("");
const MASTER_PASSWORD_LENGTH = 20;

/**
 * Description: Shuffle characters in place (Fisher–Yates, CSPRNG).
 * Input: The characters.
 * Output: The same array, shuffled.
 * Use case: generateMasterPassword, so the guaranteed classes are not always in front.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function shuffle(characters: string[]): string[] {
  for (let i = characters.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j] as string, characters[i] as string];
  }
  return characters;
}

/**
 * Description: Generate a tenant admin master password on the server.
 * Input: The user name it must not contain (optional).
 * Output: 20 characters with at least one of each class (no look-alikes, no
 *   shell-unsafe symbols); redrawn in the astronomically unlikely case it fails the policy.
 * Use case: Auto login section on create and Reset master password (Auto).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function generateMasterPassword(username = ""): string {
  for (;;) {
    const characters = [
      ...PASSWORD_CLASSES.map((alphabet) => randomFrom(alphabet, 1)),
      ...randomFrom(PASSWORD_ALPHABET, MASTER_PASSWORD_LENGTH - PASSWORD_CLASSES.length),
    ];
    const password = shuffle(characters).join("");
    if (checkMasterPassword(password, username).valid) return password;
  }
}

/**
 * Description: Generate a database password.
 * Input: None.
 * Output: 32 random bytes as base64url: 43 printable ASCII characters.
 * Use case: Auto database section on create and Rotate database password.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function generateDatabasePassword(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Description: Generate a custom-domain verification token.
 * Input: None.
 * Output: 16 random bytes as 32 hex characters.
 * Use case: The TXT record of a new or changed custom domain.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function generateVerificationToken(): string {
  return randomBytes(16).toString("hex");
}

export class GenerationExhaustedError extends Error {
  constructor(readonly tries: number) {
    super(`no available value after ${tries} tries`);
    this.name = "GenerationExhaustedError";
  }
}

/**
 * Description: Return the first candidate that is not taken.
 * Input: The candidate generator, the async "is taken" lookup and the maximum tries.
 * Output: The free candidate; throws GenerationExhaustedError after `maxTries`, so a
 *   broken lookup (always "taken") cannot loop forever.
 * Use case: previewGeneratedValues.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function pickAvailable(
  candidates: () => string,
  isTaken: (value: string) => Promise<boolean>,
  maxTries = 5,
): Promise<string> {
  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const candidate = candidates();
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new GenerationExhaustedError(maxTries);
}

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
const SLUG_FALLBACK = "tenant";
/** Subdomain labels and DB identifiers: 63. Tenant user names: 64. */
const DEFAULT_MAX_LENGTH = 63;
const DATABASE_SUFFIX_LENGTH = 6;
export const NAME_SUFFIX_LENGTH = 4;

const LOWER_ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

/** The readable base for user names, subdomains and database names. */
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

function randomFrom(alphabet: string, length: number): string {
  let text = "";
  for (let i = 0; i < length; i += 1) text += alphabet[randomInt(alphabet.length)];
  return text;
}

/** `length` characters of [a-z0-9]. */
export function randomSuffix(length: number): string {
  return randomFrom(LOWER_ALNUM, length);
}

/** `<base>-<suffix>`, with the base shortened so the result fits `maxLength`. */
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
 * Candidates for a user name or subdomain: the slug base itself first, if the
 * caller's rule accepts it (it may be reserved or too short), then suffixed ones.
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
 * `t_<slug>_<6 random>` and `<that>_app`: at most 2 + 40 + 1 + 6 + 4 = 53
 * characters, inside PostgreSQL's 63-byte identifier limit. The fixed `t_`
 * prefix keeps every tenant's objects recognizable and never starts with a digit.
 */
export function generateDatabaseIdentifiers(base: string): {
  databaseName: string;
  databaseUser: string;
} {
  const middle = base.replace(/[^a-z0-9]+/g, "_").slice(0, SLUG_MAX_LENGTH).replace(/^_+|_+$/g, "");
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
const PASSWORD_ALPHABET = PASSWORD_CLASSES.join("");
const MASTER_PASSWORD_LENGTH = 20;

function shuffle(characters: string[]): string[] {
  for (let i = characters.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j] as string, characters[i] as string];
  }
  return characters;
}

/**
 * 20 characters with at least one of each class. Redrawn in the (astronomically
 * unlikely) case it contains `username`, so it always passes the policy.
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

/** 32 random bytes as base64url: 43 printable ASCII characters. */
export function generateDatabasePassword(): string {
  return randomBytes(32).toString("base64url");
}

/** For the custom-domain TXT record: 16 random bytes as 32 hex characters. */
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
 * The first candidate `isTaken` says is free. Gives up after `maxTries` so a
 * broken lookup (always "taken") cannot loop forever.
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

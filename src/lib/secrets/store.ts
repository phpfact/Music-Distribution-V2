import "server-only";
import { randomUUID } from "node:crypto";
import { getControlDb, type ControlDb } from "../db/control";
import { decryptSecret, encryptSecret, SecretDecryptionError } from "./crypto";

/**
 * Encrypted secrets in the control plane's `secrets` table.
 *
 * Plaintext exists only in server memory for the duration of a call. Callers
 * must never return it from a service, log it, put it in an error message, a
 * URL, browser storage or an audit row. Other tables keep only the id.
 */
export type SecretPurpose = "tenant_database_password";

/** The application's client or an interactive transaction on it. */
type SecretsDb = Pick<ControlDb, "secret">;

// The column is a uuid: anything else would make the query itself fail.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SecretNotFoundError extends Error {
  constructor(readonly secretId: string) {
    super(`secret ${secretId} does not exist or has another purpose`);
    this.name = "SecretNotFoundError";
  }
}

/**
 * Binds a ciphertext to its row and purpose: decrypting it under another id or
 * purpose fails, so a copied value cannot be reused elsewhere.
 */
function secretAad(id: string, purpose: SecretPurpose): string {
  return `secret:${id}:${purpose}`;
}

/** Encrypts and stores a new secret; returns its id. */
export async function createSecret(
  tx: SecretsDb,
  purpose: SecretPurpose,
  plaintext: string,
): Promise<string> {
  // Generated here, not by the database: the id is part of the AAD, so it must
  // be known before encrypting.
  const id = randomUUID();
  const encrypted = encryptSecret(plaintext, secretAad(id, purpose));
  await tx.secret.create({ data: { id, purpose, ...encrypted } });
  return id;
}

/**
 * Decrypts a stored secret. Throws SecretNotFoundError, or
 * SecretDecryptionError when the key is wrong or the row was altered.
 */
export async function readSecret(
  id: string,
  purpose: SecretPurpose,
  db: SecretsDb = getControlDb(),
): Promise<string> {
  if (!UUID_PATTERN.test(id)) throw new SecretNotFoundError(id);
  const record = await db.secret.findFirst({
    where: { id, purpose },
    select: { keyVersion: true, nonce: true, ciphertext: true, authTag: true },
  });
  if (!record) throw new SecretNotFoundError(id);
  try {
    return decryptSecret(record, secretAad(id, purpose));
  } catch (error) {
    if (error instanceof SecretDecryptionError) throw new SecretDecryptionError(id);
    throw error;
  }
}

/** Re-encrypts an existing secret with a new value (fresh nonce). */
export async function replaceSecret(
  tx: SecretsDb,
  id: string,
  purpose: SecretPurpose,
  plaintext: string,
): Promise<void> {
  if (!UUID_PATTERN.test(id)) throw new SecretNotFoundError(id);
  const encrypted = encryptSecret(plaintext, secretAad(id, purpose));
  const { count } = await tx.secret.updateMany({ where: { id, purpose }, data: encrypted });
  if (count !== 1) throw new SecretNotFoundError(id);
}

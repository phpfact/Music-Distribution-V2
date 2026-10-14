import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { getEnv } from "../env";

/**
 * AES-256-GCM encryption for secrets kept in the control plane.
 *
 * The 32-byte key is derived from TENANT_SECRETS_KEY with HKDF-SHA256, so the
 * configured value can be any long random string. The caller supplies
 * additional authenticated data (AAD) that names what the ciphertext belongs
 * to; decrypting with different AAD fails, so a ciphertext copied to another
 * row or purpose is useless.
 */
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
// 96-bit nonces are what GCM is specified for; a random one per encryption.
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HKDF_SALT = "md-tenant-secrets";
const HKDF_INFO = "aes-256-gcm v1";

/** Stored with each record, so the key can be rotated later without guessing. */
export const SECRET_KEY_VERSION = 1;

// ArrayBuffer-backed, which is what Prisma's Bytes columns accept.
export type EncryptedSecret = {
  keyVersion: number;
  nonce: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
};

/**
 * The value could not be decrypted: wrong key, wrong AAD, or tampered data.
 * The message never contains the secret or the key.
 */
export class SecretDecryptionError extends Error {
  constructor(readonly secretId?: string) {
    super(
      `the secret${secretId ? ` ${secretId}` : ""} could not be decrypted ` +
        "(wrong TENANT_SECRETS_KEY, or the stored data was altered)",
    );
    this.name = "SecretDecryptionError";
  }
}

/** Derives the AES key from a master secret. Exported for tests. */
export function deriveSecretsKey(masterSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterSecret, HKDF_SALT, HKDF_INFO, KEY_LENGTH));
}

// HKDF is cheap, but there is no reason to repeat it on every call. Keyed on
// the master secret so a changed environment (tests) never reuses a stale key.
let cachedKey: { masterSecret: string; key: Buffer } | undefined;

function currentKey(): Buffer {
  const masterSecret = getEnv().tenantSecretsKey;
  if (cachedKey?.masterSecret !== masterSecret) {
    cachedKey = { masterSecret, key: deriveSecretsKey(masterSecret) };
  }
  return cachedKey.key;
}

export function encryptSecret(
  plaintext: string,
  aad: string,
  key: Buffer = currentKey(),
): EncryptedSecret {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    keyVersion: SECRET_KEY_VERSION,
    nonce,
    ciphertext,
    authTag: cipher.getAuthTag(),
  };
}

export function decryptSecret(
  record: EncryptedSecret,
  aad: string,
  key: Buffer = currentKey(),
): string {
  // Checked up front: GCM would otherwise accept a truncated tag, which
  // weakens the authentication.
  if (
    record.keyVersion !== SECRET_KEY_VERSION ||
    record.nonce.length !== NONCE_LENGTH ||
    record.authTag.length !== AUTH_TAG_LENGTH
  ) {
    throw new SecretDecryptionError();
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, record.nonce, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(record.authTag);
    return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // The original error is dropped on purpose: nothing about the data or key
    // should travel further than "it did not authenticate".
    throw new SecretDecryptionError();
  }
}

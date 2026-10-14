/** src/lib/secrets: the AES-256-GCM primitives and the store in the scratch database. */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getControlDb } from "@/lib/db/control";
import {
  decryptSecret,
  deriveSecretsKey,
  encryptSecret,
  SecretDecryptionError,
  type EncryptedSecret,
} from "@/lib/secrets/crypto";
import {
  createSecret,
  readSecret,
  replaceSecret,
  SecretNotFoundError,
  type SecretPurpose,
} from "@/lib/secrets/store";
import { closeAppDatabase } from "./support/app-connections";
import { clearTenantTables, connectToTestDatabase } from "./support/postgres";

const PLAINTEXT = "vt-plaintext-Ünïcødé-0123456789";
const AAD = `secret:${randomUUID()}:tenant_database_password`;

/** A copy with one byte of one field flipped. */
function tampered(record: EncryptedSecret, field: "nonce" | "ciphertext" | "authTag"): EncryptedSecret {
  const bytes = new Uint8Array(record[field]);
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  return { ...record, [field]: bytes };
}

/** The error thrown by `run`, which must be a SecretDecryptionError. */
function decryptionError(run: () => unknown): SecretDecryptionError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SecretDecryptionError);
    return error as SecretDecryptionError;
  }
  throw new Error("expected decryption to fail");
}

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value with the configured key", () => {
    const record = encryptSecret(PLAINTEXT, AAD);
    expect(decryptSecret(record, AAD)).toBe(PLAINTEXT);
    expect(record.keyVersion).toBe(1);
    expect(record.nonce).toHaveLength(12);
    expect(record.authTag).toHaveLength(16);
  });

  it("round-trips an explicit key and an empty value", () => {
    const key = deriveSecretsKey("vt-explicit-master-secret");
    expect(decryptSecret(encryptSecret("", AAD, key), AAD, key)).toBe("");
  });

  it("never stores the plaintext and uses a fresh nonce every time", () => {
    const first = encryptSecret(PLAINTEXT, AAD);
    const second = encryptSecret(PLAINTEXT, AAD);
    expect(Buffer.from(first.ciphertext).toString("utf8")).not.toContain("vt-plaintext");
    expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
  });

  it("derives a 32-byte key deterministically", () => {
    const key = deriveSecretsKey("vt-master");
    expect(key).toHaveLength(32);
    expect(key.equals(deriveSecretsKey("vt-master"))).toBe(true);
    expect(key.equals(deriveSecretsKey("vt-master-2"))).toBe(false);
  });

  it.each(["nonce", "ciphertext", "authTag"] as const)(
    "rejects a tampered %s with a typed error that does not contain the value",
    (field) => {
      const record = encryptSecret(PLAINTEXT, AAD);
      const error = decryptionError(() => decryptSecret(tampered(record, field), AAD));
      expect(error.message).not.toContain(PLAINTEXT);
      expect(String(error.stack)).not.toContain(PLAINTEXT);
    },
  );

  it.each([
    ["another id", `secret:${randomUUID()}:tenant_database_password`],
    ["another purpose", AAD.replace("tenant_database_password", "other_purpose")],
    ["no AAD", ""],
  ])("rejects decryption with %s as AAD", (_description, aad) => {
    const record = encryptSecret(PLAINTEXT, AAD);
    const error = decryptionError(() => decryptSecret(record, aad));
    expect(error.message).not.toContain(PLAINTEXT);
  });

  it("rejects decryption with another key", () => {
    const record = encryptSecret(PLAINTEXT, AAD, deriveSecretsKey("vt-key-one"));
    const error = decryptionError(() => decryptSecret(record, AAD, deriveSecretsKey("vt-key-two")));
    expect(error.message).not.toContain(PLAINTEXT);
    expect(error.message).not.toContain("vt-key");
  });

  it("rejects a truncated authentication tag and an unknown key version", () => {
    const record = encryptSecret(PLAINTEXT, AAD);
    decryptionError(() => decryptSecret({ ...record, authTag: record.authTag.slice(0, 4) }, AAD));
    decryptionError(() => decryptSecret({ ...record, keyVersion: 2 }, AAD));
  });
});

describe("the secret store", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connectToTestDatabase();
  });

  beforeEach(async () => {
    await clearTenantTables(db);
  });

  afterAll(async () => {
    await clearTenantTables(db);
    await db.end();
    await closeAppDatabase();
  });

  type SecretRow = { purpose: string; key_version: number; ciphertext: Buffer; nonce: Buffer };

  async function rowOf(id: string): Promise<SecretRow | undefined> {
    const result = await db.query<SecretRow>(
      "SELECT purpose, key_version, ciphertext, nonce FROM secrets WHERE id = $1",
      [id],
    );
    return result.rows[0];
  }

  it("stores a new secret encrypted and reads it back", async () => {
    const id = await createSecret(getControlDb(), "tenant_database_password", PLAINTEXT);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const row = await rowOf(id);
    expect(row).toMatchObject({ purpose: "tenant_database_password", key_version: 1 });
    expect(row?.ciphertext.toString("utf8")).not.toContain("vt-plaintext");
    expect(await readSecret(id, "tenant_database_password")).toBe(PLAINTEXT);
  });

  it("creates the secret inside the caller's transaction", async () => {
    let id = "";
    await expect(
      getControlDb().$transaction(async (tx) => {
        id = await createSecret(tx, "tenant_database_password", PLAINTEXT);
        throw new Error("vt-rollback");
      }),
    ).rejects.toThrow("vt-rollback");
    expect(await rowOf(id)).toBeUndefined();
  });

  it("replaces a secret with a new value and a new nonce", async () => {
    const id = await createSecret(getControlDb(), "tenant_database_password", PLAINTEXT);
    const before = await rowOf(id);

    await replaceSecret(getControlDb(), id, "tenant_database_password", "vt-new-value");

    const after = await rowOf(id);
    expect(after?.nonce.equals(before?.nonce ?? Buffer.alloc(0))).toBe(false);
    expect(await readSecret(id, "tenant_database_password")).toBe("vt-new-value");
  });

  it("reports a missing secret, a malformed id or another purpose as not found", async () => {
    const id = await createSecret(getControlDb(), "tenant_database_password", PLAINTEXT);
    const otherPurpose = "other_purpose" as SecretPurpose;

    await expect(readSecret(randomUUID(), "tenant_database_password")).rejects.toBeInstanceOf(
      SecretNotFoundError,
    );
    await expect(readSecret("not-a-uuid", "tenant_database_password")).rejects.toBeInstanceOf(
      SecretNotFoundError,
    );
    await expect(readSecret(id, otherPurpose)).rejects.toBeInstanceOf(SecretNotFoundError);
    await expect(
      replaceSecret(getControlDb(), randomUUID(), "tenant_database_password", "vt-x"),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it("refuses a row whose ciphertext was altered, without revealing the value", async () => {
    const id = await createSecret(getControlDb(), "tenant_database_password", PLAINTEXT);
    await db.query(
      "UPDATE secrets SET ciphertext = set_byte(ciphertext, 0, get_byte(ciphertext, 0) # 1) WHERE id = $1",
      [id],
    );

    const error = await readSecret(id, "tenant_database_password").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecretDecryptionError);
    expect((error as Error).message).toContain(id);
    expect((error as Error).message).not.toContain(PLAINTEXT);
  });

  it("refuses a ciphertext copied into another row (the id is authenticated)", async () => {
    const source = await createSecret(getControlDb(), "tenant_database_password", PLAINTEXT);
    const target = await createSecret(getControlDb(), "tenant_database_password", "vt-other");
    await db.query(
      `UPDATE secrets t SET nonce = s.nonce, ciphertext = s.ciphertext, auth_tag = s.auth_tag
       FROM secrets s WHERE s.id = $1 AND t.id = $2`,
      [source, target],
    );

    await expect(readSecret(target, "tenant_database_password")).rejects.toBeInstanceOf(
      SecretDecryptionError,
    );
  });
});

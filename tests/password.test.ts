import { describe, expect, it } from "vitest";
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  verifyAgainstDummy,
  verifyPassword,
} from "@/lib/platform-auth/password";

const PASSWORD = "vt correct horse battery staple";

describe("hashPassword", () => {
  it("returns an Argon2id hash in PHC format with m=19456, t=2, p=1", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(hash).not.toContain(PASSWORD);
    // Must fit platform_owners.password_hash, a VARCHAR(255).
    expect(hash.length).toBeLessThanOrEqual(255);
  });

  it("salts: two hashes of the same password differ, and both verify", async () => {
    const [first, second] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);

    expect(first).not.toBe(second);
    expect(await verifyPassword(first, PASSWORD)).toBe(true);
    expect(await verifyPassword(second, PASSWORD)).toBe(true);
  });

  it("accepts the longest allowed password (256 characters)", async () => {
    expect(PASSWORD_MAX_LENGTH).toBe(256);
    const longest = "p".repeat(PASSWORD_MAX_LENGTH);

    const hash = await hashPassword(longest);

    expect(await verifyPassword(hash, longest)).toBe(true);
    expect(await verifyPassword(hash, longest.slice(1))).toBe(false);
  });

  it("rejects a 257-character password instead of hashing it", async () => {
    await expect(hashPassword("p".repeat(257))).rejects.toBeInstanceOf(RangeError);
  });
});

describe("verifyPassword", () => {
  it("is true for the password and false for anything else", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, `${PASSWORD} `)).toBe(false);
    expect(await verifyPassword(hash, ` ${PASSWORD}`)).toBe(false);
    expect(await verifyPassword(hash, PASSWORD.toUpperCase())).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it.each([
    ["an empty string", ""],
    ["plain text", "not-a-hash"],
    ["the password itself", PASSWORD],
    ["a truncated hash", "$argon2id$v=19$m=19456,t=2,p=1$"],
    ["another algorithm's format", "$2b$12$abcdefghijklmnopqrstuuJ3bX0sYq6Y8k1b9c3d5e7f9g1h3i5k7"],
  ])("is false, without throwing, for a malformed hash: %s", async (_description, hash) => {
    await expect(verifyPassword(hash, PASSWORD)).resolves.toBe(false);
  });

  it("is false for a 257-character input", async () => {
    const hash = await hashPassword(PASSWORD);

    await expect(verifyPassword(hash, "p".repeat(257))).resolves.toBe(false);
  });
});

describe("verifyAgainstDummy", () => {
  it("resolves to nothing, whatever the input", async () => {
    await expect(verifyAgainstDummy(PASSWORD)).resolves.toBeUndefined();
    await expect(verifyAgainstDummy("")).resolves.toBeUndefined();
    await expect(verifyAgainstDummy("p".repeat(257))).resolves.toBeUndefined();
  });
});

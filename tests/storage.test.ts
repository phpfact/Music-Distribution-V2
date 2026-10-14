/** src/lib/storage/files.ts, under a temporary STORAGE_ROOT. */
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteStoredFile,
  InvalidStorageKeyError,
  profileImageKey,
  readStoredFile,
  resolveStorageKey,
  saveFile,
} from "@/lib/storage/files";

let root: string;

beforeAll(async () => {
  // src/lib/env.ts reads the environment on first use, which is after this.
  root = await mkdtemp(path.join(os.tmpdir(), "vt-storage-"));
  process.env.STORAGE_ROOT = root;
});

afterAll(async () => {
  // Only the directory this file created.
  if (root?.startsWith(path.join(os.tmpdir(), "vt-storage-"))) {
    await rm(root, { recursive: true, force: true });
  }
});

const TENANT_ID = randomUUID();

describe("profileImageKey", () => {
  it.each(["png", "jpg", "webp"] as const)("builds a unique .%s key under the tenant", (extension) => {
    const key = profileImageKey(TENANT_ID, extension);
    expect(key).toMatch(
      new RegExp(`^tenants/${TENANT_ID}/profile/[0-9a-f-]{36}\\.${extension}$`),
    );
    expect(profileImageKey(TENANT_ID, extension)).not.toBe(key);
  });

  it.each(["", "not-a-uuid", "../x", TENANT_ID.toUpperCase()])(
    "refuses the tenant id %j",
    (tenantId) => {
      expect(() => profileImageKey(tenantId, "png")).toThrow(InvalidStorageKeyError);
    },
  );
});

describe("resolveStorageKey", () => {
  it("resolves a generated key inside STORAGE_ROOT", () => {
    const key = profileImageKey(TENANT_ID, "png");
    expect(resolveStorageKey(key)).toBe(path.join(root, key));
  });

  const valid = `tenants/${TENANT_ID}/profile/${randomUUID()}.png`;
  it.each([
    ["an empty key", ""],
    ["a parent directory", "../outside.png"],
    ["a traversal inside a valid-looking key", `tenants/${TENANT_ID}/profile/../../../../etc/passwd`],
    ["traversal after the tenant", `tenants/${TENANT_ID}/../${randomUUID()}/profile/x.png`],
    ["an absolute path", `/${valid}`],
    ["an absolute system path", "/etc/passwd"],
    ["backslashes", valid.replaceAll("/", "\\")],
    ["a NUL byte", `${valid}\0.png`],
    ["upper case", valid.toUpperCase()],
    ["another extension", valid.replace(/\.png$/, ".svg")],
    ["no extension", valid.replace(/\.png$/, "")],
    ["another folder", valid.replace("/profile/", "/files/")],
    ["a non-uuid file name", `tenants/${TENANT_ID}/profile/avatar.png`],
    ["a trailing slash", `${valid}/`],
    ["a leading ./", `./${valid}`],
  ])("rejects %s", (_description, key) => {
    expect(() => resolveStorageKey(key)).toThrow(InvalidStorageKeyError);
  });

  it("does not repeat the rejected key in the error", () => {
    expect(() => resolveStorageKey("../secret-name")).toThrow(/^invalid storage key$/);
  });
});

describe("saveFile / readStoredFile / deleteStoredFile", () => {
  it("writes, reads and deletes a file, creating its directories", async () => {
    const key = profileImageKey(TENANT_ID, "png");
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

    await saveFile(key, bytes);
    expect(await readStoredFile(key)).toStrictEqual(Buffer.from(bytes));

    await deleteStoredFile(key);
    expect(await readStoredFile(key)).toBeNull();
  });

  it("replaces an existing file and leaves no temporary file behind", async () => {
    const key = profileImageKey(TENANT_ID, "webp");
    await saveFile(key, new Uint8Array([1]));
    await saveFile(key, new Uint8Array([2, 2]));

    expect(await readStoredFile(key)).toStrictEqual(Buffer.from([2, 2]));
    const names = await readdir(path.dirname(resolveStorageKey(key)));
    expect(names.filter((name) => name.endsWith(".tmp"))).toStrictEqual([]);
  });

  it("returns null for a missing file and ignores deleting it", async () => {
    const key = profileImageKey(TENANT_ID, "jpg");
    expect(await readStoredFile(key)).toBeNull();
    await expect(deleteStoredFile(key)).resolves.toBeUndefined();
  });

  it("refuses an invalid key before touching the filesystem", async () => {
    await expect(saveFile("../escape.png", new Uint8Array([1]))).rejects.toThrow(
      InvalidStorageKeyError,
    );
    await expect(readStoredFile("/etc/passwd")).rejects.toThrow(InvalidStorageKeyError);
    await expect(deleteStoredFile("../escape.png")).rejects.toThrow(InvalidStorageKeyError);
    expect(await readdir(path.dirname(root))).not.toContain("escape.png");
  });
});

import { describe, expect, it } from "vitest";
import { validateSubdomainLabel } from "@/lib/domains/rules";
import {
  generateDatabaseIdentifiers,
  generateDatabasePassword,
  generateMasterPassword,
  generateVerificationToken,
  GenerationExhaustedError,
  nameCandidates,
  pickAvailable,
  randomSuffix,
  slugBase,
  withSuffix,
} from "@/lib/tenants/generate";
import {
  checkMasterPassword,
  validateDatabaseIdentifier,
  validateNewDatabasePassword,
  validateTenantUsername,
} from "@/lib/tenants/rules";

const DRAWS = 1_000;

describe("slugBase", () => {
  it.each([
    ["Acme Records", "acme-records"],
    ["  Björk & Sigur Rós  ", "bjork-sigur-ros"],
    ["Ünïcödé--Nämé!!", "unicode-name"],
    ["DJ_Shadow.2024", "dj-shadow-2024"],
    ["東京", "tenant"],
    ["", "tenant"],
    ["!!!", "tenant"],
    ["ﬁve", "five"],
  ])("%j → %j", (name, expected) => {
    expect(slugBase(name)).toBe(expected);
  });

  it("keeps at most 40 characters and no trailing hyphen", () => {
    const slug = slugBase(`${"a".repeat(39)} bcd`);
    expect(slug).toBe("a".repeat(39));
    expect(slugBase("x".repeat(100))).toHaveLength(40);
  });
});

describe("suffixes", () => {
  it("draws [a-z0-9]", () => {
    for (let i = 0; i < DRAWS; i += 1) expect(randomSuffix(6)).toMatch(/^[a-z0-9]{6}$/);
  });

  it("appends -<4 characters>", () => {
    expect(withSuffix("acme")).toMatch(/^acme-[a-z0-9]{4}$/);
  });

  it("shortens the base to respect the limit", () => {
    const value = withSuffix("a".repeat(70), 4, 63);
    expect(value).toHaveLength(63);
    expect(value).toMatch(/^a{58}-[a-z0-9]{4}$/);
    expect(withSuffix("b".repeat(70), 4, 64)).toHaveLength(64);
  });

  it("does not leave a double hyphen when the cut ends on one", () => {
    expect(withSuffix(`${"a".repeat(57)}-bbb`, 4, 63)).toMatch(/^a{57}-[a-z0-9]{4}$/);
  });
});

describe("nameCandidates", () => {
  it("offers the base first when it is acceptable", () => {
    const next = nameCandidates("acme", (v) => validateSubdomainLabel(v).ok);
    expect(next()).toBe("acme");
    expect(next()).toMatch(/^acme-[a-z0-9]{4}$/);
  });

  it("starts with a suffix when the base is reserved or too short", () => {
    expect(nameCandidates("admin", (v) => validateSubdomainLabel(v).ok)()).toMatch(/^admin-[a-z0-9]{4}$/);
    const short = nameCandidates("al", (v) => validateTenantUsername(v).ok)();
    expect(validateTenantUsername(short).ok).toBe(true);
  });
});

describe("generateDatabaseIdentifiers", () => {
  const ctx = { reservedNames: [] };

  it("builds t_<slug>_<6> and <name>_app", () => {
    const { databaseName, databaseUser } = generateDatabaseIdentifiers("acme-records");
    expect(databaseName).toMatch(/^t_acme_records_[a-z0-9]{6}$/);
    expect(databaseUser).toBe(`${databaseName}_app`);
  });

  it("stays valid for the longest slug and for odd input", () => {
    for (const base of ["x".repeat(40), "tenant", "1-digit-first", "test-label", "-"]) {
      const { databaseName, databaseUser } = generateDatabaseIdentifiers(base);
      expect(databaseUser.length).toBeLessThanOrEqual(63);
      expect(validateDatabaseIdentifier(databaseName, "database", ctx).ok, databaseName).toBe(true);
      expect(validateDatabaseIdentifier(databaseUser, "user", ctx).ok, databaseUser).toBe(true);
    }
  });

  it("gives test tenants the t_test_ prefix the teardown relies on", () => {
    expect(generateDatabaseIdentifiers(slugBase("Test Label")).databaseName).toMatch(/^t_test_/);
  });

  it("does not repeat over many draws", () => {
    const names = new Set<string>();
    for (let i = 0; i < DRAWS; i += 1) names.add(generateDatabaseIdentifiers("acme").databaseName);
    expect(names.size).toBe(DRAWS);
  });
});

describe("generateMasterPassword", () => {
  it("is 20 characters without look-alikes, with every class, and passes the policy", () => {
    const seen = new Set<string>();
    for (let i = 0; i < DRAWS; i += 1) {
      const password = generateMasterPassword("owner");
      expect(password).toHaveLength(20);
      expect(password).not.toMatch(/[lIO01oi"'`\\$ ]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^a-zA-Z0-9]/);
      expect(checkMasterPassword(password, "owner").valid).toBe(true);
      seen.add(password);
    }
    expect(seen.size).toBe(DRAWS);
  });
});

describe("generateDatabasePassword", () => {
  it("is 43 base64url characters that pass the new-database rule", () => {
    const seen = new Set<string>();
    for (let i = 0; i < DRAWS; i += 1) {
      const password = generateDatabasePassword();
      expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(validateNewDatabasePassword(password).ok).toBe(true);
      seen.add(password);
    }
    expect(seen.size).toBe(DRAWS);
  });
});

describe("generateVerificationToken", () => {
  it("is 32 hex characters", () => {
    const seen = new Set<string>();
    for (let i = 0; i < DRAWS; i += 1) {
      const token = generateVerificationToken();
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(DRAWS);
  });
});

describe("pickAvailable", () => {
  it("returns the first free candidate", async () => {
    const values = ["a", "b", "c"];
    let index = 0;
    const taken = new Set(["a", "b"]);
    const picked = await pickAvailable(
      () => values[index++] ?? "z",
      async (v) => taken.has(v),
    );
    expect(picked).toBe("c");
  });

  it("gives up after maxTries with a typed error", async () => {
    let calls = 0;
    const attempt = pickAvailable(
      () => `v${calls++}`,
      async () => true,
    );
    await expect(attempt).rejects.toBeInstanceOf(GenerationExhaustedError);
    await expect(attempt).rejects.toMatchObject({ tries: 5 });
    expect(calls).toBe(5);
  });

  it("honours a custom maxTries", async () => {
    let calls = 0;
    await expect(
      pickAvailable(() => `v${calls++}`, async () => true, 2),
    ).rejects.toBeInstanceOf(GenerationExhaustedError);
    expect(calls).toBe(2);
  });
});

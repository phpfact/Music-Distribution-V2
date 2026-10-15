import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH } from "@/lib/platform-auth/password";
import {
  checkMasterPassword,
  escapeLikePattern,
  MASTER_PASSWORD_MAX_LENGTH,
  normalizeFullName,
  parsePort,
  parseTenantCountPage,
  parseTenantCountSource,
  parseTenantListQuery,
  sanitizeIndianMobileInput,
  TENANT_LIST_MAX_PAGE,
  TENANT_LIST_PAGE_SIZE,
  validateDatabaseIdentifier,
  validateEmail,
  validateExistingDatabasePassword,
  validateFullName,
  validateMasterPassword,
  validateNewDatabasePassword,
  validatePhone,
  validateSuspensionReason,
  validateTenantUsername,
  type RuleResult,
} from "@/lib/tenants/rules";

function valueOf<T>(result: RuleResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}

function errorOf<T>(result: RuleResult<T>): string {
  if (result.ok) throw new Error(`expected an error, got: ${JSON.stringify(result.value)}`);
  return result.error;
}

describe("full name", () => {
  it("trims and collapses inner white space", () => {
    expect(normalizeFullName("  Ada \t\n Lovelace  ")).toBe("Ada Lovelace");
    expect(valueOf(validateFullName("  Ada   Lovelace "))).toBe("Ada Lovelace");
  });

  // Business rule (owner, 2026-10-15): letters of any script, spaces and . ' - & only.
  it.each([
    ["2 characters (the minimum)", "Al"],
    ["200 characters (the maximum)", "a".repeat(200)],
    ["non-Latin letters", "Björk Guðmundsdóttir"],
    ["Hindi (letters with combining marks)", "सचिन शर्मा"],
    ["the allowed separators", "O'Brien-Smith & Co. Records"],
  ])("accepts %s", (_, name) => {
    expect(validateFullName(name).ok).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["white space only", "   "],
    ["1 character", "A"],
    ["201 characters", "a".repeat(201)],
    ["a NUL character", "Ada\0Lovelace"],
    ["a DEL character", "Ada\x7fLovelace"],
    ["a C1 control character", "Ada\u0085Lovelace"],
    ["digits", "Studio 54 Records"],
    ["Devanagari digits", "स्टूडियो ५४"],
    ["other symbols", "Acme @ Music"],
    ["an underscore", "Acme_Music"],
    ["a percent sign", "100% Music"],
  ])("rejects %s", (_, name) => {
    expect(errorOf(validateFullName(name))).toMatch(/\.$/);
  });

  it("names the allowed characters when a digit is used", () => {
    expect(errorOf(validateFullName("Acme 2"))).toBe("Use only letters, spaces and . ' - & (no digits) in the name.");
  });
});

describe("phone", () => {
  it("is optional", () => {
    expect(valueOf(validatePhone(""))).toBeNull();
    expect(valueOf(validatePhone("   "))).toBeNull();
  });

  // Business rule (owner, 2026-10-15): an Indian mobile number, exactly 10
  // digits starting with 6–9, stored as those digits.
  it.each([
    ["9876543210", "9876543210"],
    ["6000000000", "6000000000"],
    ["  7012345678  ", "7012345678"],
  ])("accepts %j as %j", (input, expected) => {
    expect(valueOf(validatePhone(input))).toBe(expected);
  });

  it.each([
    ["9 digits", "987654321"],
    ["11 digits", "98765432101"],
    ["a first digit below 6", "5876543210"],
    ["a country code", "+919876543210"],
    ["spaces inside", "98765 43210"],
    ["dashes", "98765-43210"],
    ["letters", "98765ABCDE"],
    ["international", "+442079460958"],
  ])("rejects %s", (_, phone) => {
    expect(errorOf(validatePhone(phone))).toBe(
      "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.",
    );
  });
});

describe("sanitizeIndianMobileInput", () => {
  it.each([
    ["typed digits", "98765", "98765"],
    ["letters and symbols are dropped", "98a7-6 5(4)", "987654"],
    ["a pasted +91 number", "+91 98765 43210", "9876543210"],
    ["a pasted 91 prefix", "919876543210", "9876543210"],
    ["a pasted trunk 0", "098765 43210", "9876543210"],
    ["never more than 10 digits", "98765432109999", "9876543210"],
    ["empty", "", ""],
  ])("%s", (_, input, expected) => {
    expect(sanitizeIndianMobileInput(input)).toBe(expected);
  });
});

describe("email", () => {
  it("trims and lower-cases", () => {
    expect(valueOf(validateEmail("  Owner@Example.COM "))).toBe("owner@example.com");
  });

  it.each([
    ["a plus address", "a+tag@example.com"],
    ["a sub-domain", "a@mail.example.co.uk"],
    ["a 64-character local part", `${"a".repeat(64)}@example.com`],
    ["a 253-character domain", `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.${"e".repeat(61)}`],
  ])("accepts %s", (_, email) => {
    expect(validateEmail(email).ok).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["no @", "owner.example.com"],
    ["two @", "a@b@example.com"],
    ["an empty local part", "@example.com"],
    ["a 65-character local part", `${"a".repeat(65)}@example.com`],
    ["a domain without a dot", "owner@localhost"],
    ["an empty domain label", "owner@example..com"],
    ["a label starting with a hyphen", "owner@-example.com"],
    ["a space", "own er@example.com"],
    ["a leading dot", ".owner@example.com"],
    ["consecutive dots", "ow..ner@example.com"],
    ["a 254-character domain", `a@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.${"e".repeat(62)}`],
    ["over 320 characters", `${"a".repeat(64)}@${"b".repeat(300)}.com`],
  ])("rejects %s", (_, email) => {
    expect(validateEmail(email).ok).toBe(false);
  });
});

describe("tenant user name", () => {
  it("normalizes like the platform owner names", () => {
    expect(valueOf(validateTenantUsername("  Label.Admin "))).toBe("label.admin");
  });

  it.each([
    ["3 characters", "abc", true],
    ["64 characters", "a".repeat(64), true],
    ["2 characters", "ab", false],
    ["65 characters", "a".repeat(65), false],
    ["a trailing dot", "abc.", false],
    ["a space inside", "ab c", false],
    ["empty", "", false],
  ])("%s → %s", (_, name, valid) => {
    expect(validateTenantUsername(name).ok).toBe(valid);
  });

  it("explains the allowed characters", () => {
    expect(errorOf(validateTenantUsername("a b"))).toContain(
      "lower-case letters, digits, dots, hyphens or underscores",
    );
  });
});

describe("master password", () => {
  it("allows as many characters as the password hasher accepts", () => {
    expect(MASTER_PASSWORD_MAX_LENGTH).toBe(PASSWORD_MAX_LENGTH);
  });

  it.each([
    ["12 characters, 2 classes", "abcdefghijk1"],
    ["256 characters", `A${"b".repeat(255)}`],
    ["a symbol and lower-case only", "correct horse battery"],
    ["leading and trailing spaces (never trimmed)", "  abcdefghij "],
  ])("accepts %s", (_, password) => {
    expect(valueOf(validateMasterPassword(password, "owner"))).toBe(password);
  });

  it.each([
    ["empty", "", /Enter/],
    ["11 characters", "abcdefghij1", /12–256/],
    ["257 characters", `A${"b".repeat(256)}`, /12–256/],
    ["one class only", "abcdefghijklmnop", /at least 2/],
    ["digits only", "123456789012345", /at least 2/],
    ["the user name inside", "xxOWNERxx123", /user name/],
  ])("rejects %s", (_, password, message) => {
    expect(errorOf(validateMasterPassword(password, "owner"))).toMatch(message);
  });

  it("reports every requirement for a live checklist", () => {
    const check = checkMasterPassword("short", "owner");
    expect(check.valid).toBe(false);
    expect(check.requirements.map((r) => [r.id, r.met])).toEqual([
      ["length", false],
      ["variety", false],
      ["username", true],
    ]);
    expect(check.requirements.every((r) => r.label.length > 0)).toBe(true);
  });

  it("compares the user name case-insensitively after normalizing it", () => {
    expect(checkMasterPassword("My-Owner-Secret-1", " OWNER ").valid).toBe(false);
  });

  it("has nothing to compare against without a user name", () => {
    expect(checkMasterPassword("abcdefghijk1", "").valid).toBe(true);
  });
});

describe("database identifiers", () => {
  const ctx = { reservedNames: ["music_control", "md_admin"] };

  it.each([
    ["a generated name", "t_acme_records_ab12cd"],
    ["a leading underscore", "_tenant"],
    ["1 character", "a"],
    ["63 characters", `t${"a".repeat(62)}`],
  ])("accepts %s", (_, name) => {
    expect(valueOf(validateDatabaseIdentifier(name, "database", ctx))).toBe(name);
  });

  it("trims but does not fold case", () => {
    expect(valueOf(validateDatabaseIdentifier("  tenant_db ", "user", ctx))).toBe("tenant_db");
    expect(errorOf(validateDatabaseIdentifier("Tenant", "user", ctx))).toContain("lower-case");
  });

  it.each([
    ["empty", ""],
    ["64 characters", `t${"a".repeat(63)}`],
    ["a leading digit", "1tenant"],
    ["a hyphen", "tenant-db"],
    ["a quote", 'tenant"db'],
    ["non-ASCII", "tenänt"],
    ["the pg_ prefix", "pg_tenant"],
    ["postgres", "postgres"],
    ["template0", "template0"],
    ["template1", "template1"],
    ["public", "public"],
    ["none", "none"],
    ["current_user", "current_user"],
    ["session_user", "session_user"],
    ["current_role", "current_role"],
    ["the control-plane database", "music_control"],
    ["the administrative login", "md_admin"],
  ])("rejects %s", (_, name) => {
    expect(validateDatabaseIdentifier(name, "database", ctx).ok).toBe(false);
    expect(validateDatabaseIdentifier(name, "user", ctx).ok).toBe(false);
  });

  it("names the field in the message", () => {
    expect(errorOf(validateDatabaseIdentifier("", "database", ctx))).toContain("database name");
    expect(errorOf(validateDatabaseIdentifier("", "user", ctx))).toContain("database user");
  });

  it("compares the caller's reserved names case-insensitively", () => {
    const upper = { reservedNames: ["MD_ADMIN"] };
    expect(validateDatabaseIdentifier("md_admin", "user", upper).ok).toBe(false);
  });
});

describe("database passwords", () => {
  it.each([
    ["16 characters", "a".repeat(16), true],
    ["128 characters", "a".repeat(128), true],
    ["every printable symbol", "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", true],
    ["15 characters", "a".repeat(15), false],
    ["129 characters", "a".repeat(129), false],
    ["a space", `${"a".repeat(10)} ${"b".repeat(10)}`, false],
    ["non-ASCII", `${"a".repeat(16)}é`, false],
    ["a tab", `${"a".repeat(16)}\t`, false],
  ])("new database: %s → %s", (_, password, valid) => {
    expect(validateNewDatabasePassword(password).ok).toBe(valid);
  });

  it.each([
    ["1 character", "x", true],
    ["128 characters", "x".repeat(128), true],
    ["spaces and non-ASCII", " pässwörd ", true],
    ["empty", "", false],
    ["129 characters", "x".repeat(129), false],
    ["a NUL", "pass\0word", false],
  ])("existing database: %s → %s", (_, password, valid) => {
    expect(validateExistingDatabasePassword(password).ok).toBe(valid);
  });
});

describe("parsePort", () => {
  it.each([
    ["", 5432],
    ["  ", 5432],
    [undefined, 5432],
    [null, 5432],
    ["1", 1],
    ["65535", 65535],
    [" 6543 ", 6543],
    [5433, 5433],
  ])("%j → %j", (input, expected) => {
    expect(valueOf(parsePort(input, 5432))).toBe(expected);
  });

  it.each(["0", "65536", "-1", "1e3", "0x50", "54.32", "abc", "999999"])("rejects %j", (input) => {
    expect(errorOf(parsePort(input, 5432))).toContain("1 to 65535");
  });

  it("rejects a non-integer number", () => {
    expect(parsePort(54.5, 5432).ok).toBe(false);
  });
});

describe("suspension reason", () => {
  it.each([
    ["trimmed", "  Unpaid invoice ", "Unpaid invoice"],
    ["1 character", "x", "x"],
    ["500 characters", "r".repeat(500), "r".repeat(500)],
    ["500 characters after trimming", ` ${"r".repeat(500)} `, "r".repeat(500)],
  ])("accepts %s", (_, input, expected) => {
    expect(valueOf(validateSuspensionReason(input))).toBe(expected);
  });

  it.each([
    ["empty", ""],
    ["white space only", " \t\n "],
    ["501 characters", "r".repeat(501)],
  ])("rejects %s", (_, input) => {
    expect(validateSuspensionReason(input).ok).toBe(false);
  });
});

describe("parseTenantListQuery", () => {
  it("has a page size of 20", () => {
    expect(TENANT_LIST_PAGE_SIZE).toBe(20);
  });

  it("defaults everything", () => {
    expect(parseTenantListQuery({})).toEqual({ q: "", status: "all", page: 1 });
  });

  it("reads valid values", () => {
    expect(parseTenantListQuery({ q: "  acme ", status: "suspended", page: "3" })).toEqual({
      q: "acme",
      status: "suspended",
      page: 3,
    });
  });

  it.each(["all", "active", "suspended", "pending", "failed"])("accepts status %j", (status) => {
    expect(parseTenantListQuery({ status }).status).toBe(status);
  });

  it.each(["provisioning", "ACTIVE", "", "active "])("falls back to all for status %j", (status) => {
    expect(parseTenantListQuery({ status }).status).toBe("all");
  });

  it.each([
    ["1", 1],
    ["10000", 10000],
    ["0", 1],
    ["10001", 1],
    ["-2", 1],
    ["2.5", 1],
    ["abc", 1],
    ["1e3", 1],
    ["99999999999999999999", 1],
  ])("page %j → %j", (page, expected) => {
    expect(parseTenantListQuery({ page }).page).toBe(expected);
  });

  it("uses the first of repeated parameters", () => {
    expect(parseTenantListQuery({ q: ["one", "two"], status: ["failed", "active"], page: ["4", "5"] })).toEqual({
      q: "one",
      status: "failed",
      page: 4,
    });
  });

  it("limits the search text to 100 characters", () => {
    expect(parseTenantListQuery({ q: "x".repeat(150) }).q).toBe("x".repeat(100));
    expect(parseTenantListQuery({ q: `${"x".repeat(99)}   y` }).q).toBe("x".repeat(99));
  });
});

describe("escapeLikePattern", () => {
  it.each([
    ["plain", "plain"],
    ["100%", "100\\%"],
    ["a_b", "a\\_b"],
    ["back\\slash", "back\\\\slash"],
    ["%_\\", "\\%\\_\\\\"],
  ])("escapes %j as %j", (input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });
});

describe("parseTenantCountSource", () => {
  it.each([
    [{ kind: "summary", category: "all" }],
    [{ kind: "summary", category: "active" }],
    [{ kind: "summary", category: "suspended" }],
    [{ kind: "summary", category: "setup" }],
    [{ kind: "summary", category: "failed" }],
  ])("accepts the summary figure %j", (source) => {
    expect(parseTenantCountSource(source)).toEqual(source);
  });

  it("accepts the directory total with its bounded search and status", () => {
    expect(parseTenantCountSource({ kind: "list", q: "  acme  ", status: "pending" })).toEqual({
      kind: "list",
      q: "acme",
      status: "pending",
    });
    expect(parseTenantCountSource({ kind: "list", q: "x".repeat(150), status: "all" })).toEqual({
      kind: "list",
      q: "x".repeat(100),
      status: "all",
    });
  });

  it.each([
    [null],
    [undefined],
    ["summary"],
    [[]],
    [{}],
    [{ kind: "summary" }],
    [{ kind: "summary", category: "deprovisioning" }],
    [{ kind: "summary", category: "__proto__" }],
    [{ kind: "list", status: "all" }],
    [{ kind: "list", q: 1, status: "all" }],
    [{ kind: "list", q: "", status: "setup" }],
    [{ kind: "other", q: "", status: "all" }],
  ])("rejects %j", (value) => {
    expect(parseTenantCountSource(value)).toBeNull();
  });
});

describe("parseTenantCountPage", () => {
  it("keeps a whole page number within the bounds", () => {
    expect(parseTenantCountPage(1)).toBe(1);
    expect(parseTenantCountPage(7)).toBe(7);
    expect(parseTenantCountPage(TENANT_LIST_MAX_PAGE)).toBe(TENANT_LIST_MAX_PAGE);
  });

  it.each([[0], [-1], [1.5], [TENANT_LIST_MAX_PAGE + 1], ["2"], [null], [Number.NaN]])(
    "falls back to 1 for %j",
    (value) => {
      expect(parseTenantCountPage(value)).toBe(1);
    },
  );
});

import { describe, expect, it } from "vitest";
import { normalizeCustomDomainInput } from "@/lib/domains/idn";
import {
  classifyHost,
  isIpAddress,
  parseHostHeader,
  RESERVED_SUBDOMAINS,
  subdomainHost,
  validateCustomDomain,
  validateSubdomainLabel,
  verificationRecord,
} from "@/lib/domains/rules";

describe("validateSubdomainLabel", () => {
  it("trims and lower-cases", () => {
    expect(validateSubdomainLabel("  Acme-Records ")).toEqual({ ok: true, value: "acme-records" });
  });

  it.each([
    ["3 characters", "abc"],
    ["63 characters", "a".repeat(63)],
    ["digits", "123"],
    ["inner hyphens", "a--b"],
  ])("accepts %s", (_, label) => {
    expect(validateSubdomainLabel(label).ok).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["2 characters", "ab"],
    ["64 characters", "a".repeat(64)],
    ["a leading hyphen", "-abc"],
    ["a trailing hyphen", "abc-"],
    ["a dot", "a.bc"],
    ["an underscore", "a_bc"],
    ["punycode", "xn--bcher-kva"],
    ["non-ASCII", "büch"],
  ])("rejects %s", (_, label) => {
    expect(validateSubdomainLabel(label).ok).toBe(false);
  });

  it("rejects every reserved label, in any case", () => {
    expect(RESERVED_SUBDOMAINS).toHaveLength(53);
    for (const label of RESERVED_SUBDOMAINS) {
      // The 2-character ones are already too short; the rest must say "reserved".
      const result = validateSubdomainLabel(label.toUpperCase());
      expect(result.ok, label).toBe(false);
      if (!result.ok && label.length >= 3) expect(result.error).toContain("reserved");
    }
  });

  it("includes the documented names", () => {
    for (const label of ["www", "api", "admin", "platform", "mail", "ns1", "localhost", "demo"]) {
      expect(RESERVED_SUBDOMAINS).toContain(label);
    }
  });
});

describe("validateCustomDomain", () => {
  const base = "musicdist.com";

  it.each([
    ["two labels", "acme.org", "acme.org"],
    ["upper case and a trailing dot", " Music.Acme.ORG. ", "music.acme.org"],
    ["a punycode label", "xn--bcher-kva.de", "xn--bcher-kva.de"],
    ["a digit-led label", "1password.dev", "1password.dev"],
    ["a 253-character name", `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`, undefined],
  ])("accepts %s", (_, input, expected) => {
    const result = validateCustomDomain(input, base);
    expect(result.ok).toBe(true);
    if (result.ok && expected) expect(result.value).toBe(expected);
  });

  it.each([
    ["empty", ""],
    ["one label", "acme"],
    ["254 characters", `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`],
    ["a 64-character label", `${"a".repeat(64)}.com`],
    ["an empty label", "acme..org"],
    ["a leading hyphen", "-acme.org"],
    ["an underscore", "ac_me.org"],
    ["a numeric top-level domain", "acme.123"],
    ["an IPv4 address", "192.168.1.10"],
    ["an IPv6 address", "::1"],
    ["localhost", "localhost"],
    [".local", "printer.local"],
    [".localhost", "acme.localhost"],
    [".test", "acme.test"],
    [".example", "acme.example"],
    [".invalid", "acme.invalid"],
    [".internal", "acme.internal"],
    [".onion", "acme.onion"],
    ["the base domain", "musicdist.com"],
    ["a subdomain of the base", "acme.musicdist.com"],
    ["deep under the base", "a.b.musicdist.com"],
    ["non-ASCII", "bücher.de"],
  ])("rejects %s", (_, input) => {
    expect(validateCustomDomain(input, base).ok).toBe(false);
  });

  it("does not treat a look-alike suffix as under the base", () => {
    expect(validateCustomDomain("notmusicdist.com", base).ok).toBe(true);
  });
});

describe("normalizeCustomDomainInput (server)", () => {
  it("converts an internationalized name to punycode", () => {
    expect(normalizeCustomDomainInput(" Bücher.DE. ", "localhost")).toEqual({
      ok: true,
      value: "xn--bcher-kva.de",
    });
  });

  it.each(["", "   ", "exa mple.com", "a..b", "bücher.localhost", "musik.localhost"])(
    "rejects %j",
    (input) => {
      expect(normalizeCustomDomainInput(input, "localhost").ok).toBe(false);
    },
  );
});

describe("parseHostHeader", () => {
  it.each([
    ["example.com", "example.com"],
    ["Example.COM", "example.com"],
    ["example.com:3000", "example.com"],
    ["example.com.", "example.com"],
    ["example.com.:443", "example.com"],
    ["  acme.localhost:3000 ", "acme.localhost"],
    ["localhost", "localhost"],
    ["127.0.0.1:3000", "127.0.0.1"],
    ["[::1]", "::1"],
    ["[::1]:3000", "::1"],
    ["[2001:DB8::1]:8080", "2001:db8::1"],
    ["[::ffff:192.0.2.1]", "::ffff:192.0.2.1"],
    ["under_score.internal", "under_score.internal"],
  ])("%j → %j", (input, expected) => {
    expect(parseHostHeader(input)).toBe(expected);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["a port only", ":3000"],
    ["a non-numeric port", "example.com:http"],
    ["a port over 65535", "example.com:65536"],
    ["two ports", "example.com:80:81"],
    ["unbracketed IPv6", "::1"],
    ["an unclosed bracket", "[::1"],
    ["a bracketed name", "[example.com]"],
    ["an invalid IPv6", "[1:2:3:4:5:6:7:8:9]"],
    ["two trailing dots", "example.com.."],
    ["an empty label", "a..b"],
    ["a space inside", "exa mple.com"],
    ["a slash", "example.com/path"],
    ["user info", "user@example.com"],
    ["non-ASCII", "bücher.de"],
    ["a 64-character label", `${"a".repeat(64)}.com`],
  ])("rejects %s", (_, input) => {
    expect(parseHostHeader(input)).toBeNull();
  });
});

describe("isIpAddress", () => {
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "::",
    "::1",
    "[::1]",
    "2001:db8::1",
    "fe80:0:0:0:0:0:0:1",
    "::ffff:192.0.2.1",
    "1:2:3:4:5:6:7::",
  ])("%j is an IP address", (host) => {
    expect(isIpAddress(host)).toBe(true);
  });

  it.each([
    "256.0.0.1",
    "1.2.3",
    "01.2.3.4",
    "example.com",
    "1:2:3:4:5:6:7:8:9",
    "1::2::3",
    ":1",
    "12345::1",
    "::ffff:300.0.0.1",
    "",
  ])("%j is not an IP address", (host) => {
    expect(isIpAddress(host)).toBe(false);
  });
});

describe("classifyHost", () => {
  it.each([
    ["127.0.0.1", "localhost", { kind: "ip" }],
    ["::1", "localhost", { kind: "ip" }],
    ["localhost", "localhost", { kind: "base" }],
    ["acme.localhost", "localhost", { kind: "subdomain", label: "acme" }],
    ["a.b.localhost", "localhost", { kind: "other" }],
    ["musicdist.com", "musicdist.com", { kind: "base" }],
    ["acme.musicdist.com", "musicdist.com", { kind: "subdomain", label: "acme" }],
    ["acme.musicdist.com", "MusicDist.com.", { kind: "subdomain", label: "acme" }],
    ["deep.acme.musicdist.com", "musicdist.com", { kind: "other" }],
    ["notmusicdist.com", "musicdist.com", { kind: "other" }],
    ["music.acme.org", "musicdist.com", { kind: "other" }],
  ])("%j with base %j", (host, base, expected) => {
    expect(classifyHost(host, base)).toEqual(expected);
  });

  it("classifies what parseHostHeader returns", () => {
    const host = parseHostHeader("Acme.Localhost.:3000");
    expect(host && classifyHost(host, "localhost")).toEqual({ kind: "subdomain", label: "acme" });
  });
});

describe("subdomainHost and verificationRecord", () => {
  it("builds the tenant host", () => {
    expect(subdomainHost("acme", "musicdist.com")).toBe("acme.musicdist.com");
  });

  it("builds the TXT record", () => {
    expect(verificationRecord("music.acme.org", "abc123")).toEqual({
      name: "_md-verify.music.acme.org",
      value: "md-verify=abc123",
    });
  });
});

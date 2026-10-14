import { describe, expect, it } from "vitest";
import { checkCustomDomainDns, checkSubdomainDns, type DnsResolver } from "@/lib/domains/dns";

function dnsError(code: string): Error {
  return Object.assign(new Error(`queryTxt ${code} internal-dns.corp.example`), { code });
}

/** Answers from the given tables; a missing entry behaves like NXDOMAIN. */
function fakeResolver(answers: {
  addresses?: Record<string, string[] | Error>;
  txt?: Record<string, string[][] | Error>;
}): DnsResolver & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    async lookup(host) {
      lookups.push(host);
      const answer = answers.addresses?.[host];
      if (answer instanceof Error) throw answer;
      if (!answer) throw dnsError("ENOTFOUND");
      return answer;
    },
    async resolveTxt(name) {
      lookups.push(`TXT ${name}`);
      const answer = answers.txt?.[name];
      if (answer instanceof Error) throw answer;
      if (!answer) throw dnsError("ENOTFOUND");
      return answer;
    },
  };
}

describe("checkSubdomainDns", () => {
  it.each(["localhost", "dev.localhost"])("passes without a lookup for base %j", async (base) => {
    const resolver = fakeResolver({});
    expect(await checkSubdomainDns("acme", base, resolver)).toEqual({ ok: true });
    expect(resolver.lookups).toEqual([]);
  });

  it("passes when the host resolves", async () => {
    const resolver = fakeResolver({ addresses: { "acme.musicdist.com": ["203.0.113.5"] } });
    expect(await checkSubdomainDns("acme", "musicdist.com", resolver)).toEqual({ ok: true });
  });

  it.each([
    ["no such name", dnsError("ENOTFOUND")],
    ["no address record", dnsError("ENODATA")],
    ["an empty answer", []],
  ])("asks for a wildcard record on %s", async (_, answer) => {
    const resolver = fakeResolver({ addresses: { "acme.musicdist.com": answer } });
    expect(await checkSubdomainDns("acme", "musicdist.com", resolver)).toEqual({
      ok: false,
      message:
        "acme.musicdist.com does not resolve. Add a wildcard DNS record *.musicdist.com pointing to the application, then retry.",
    });
  });

  it("reports a timeout without the resolver's own text", async () => {
    const resolver = fakeResolver({ addresses: { "acme.musicdist.com": dnsError("ETIMEOUT") } });
    const result = await checkSubdomainDns("acme", "musicdist.com", resolver);
    expect(result).toEqual({
      ok: false,
      message: "The DNS lookup for acme.musicdist.com timed out. Try again in a few minutes.",
    });
  });

  it("reports other failures generically", async () => {
    const resolver = fakeResolver({ addresses: { "acme.musicdist.com": dnsError("ESERVFAIL") } });
    const result = await checkSubdomainDns("acme", "musicdist.com", resolver);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("failed. Try again");
      expect(result.message).not.toContain("internal-dns");
    }
  });
});

describe("checkCustomDomainDns", () => {
  const host = "music.acme.org";
  const token = "0123456789abcdef0123456789abcdef";
  const recordName = `_md-verify.${host}`;
  const recordValue = `md-verify=${token}`;

  it("passes with the TXT record and an address", async () => {
    const resolver = fakeResolver({
      txt: { [recordName]: [["v=spf1 -all"], [recordValue]] },
      addresses: { [host]: ["203.0.113.5"] },
    });
    expect(await checkCustomDomainDns(host, token, resolver)).toEqual({ ok: true });
  });

  it("joins a record split into several strings", async () => {
    const resolver = fakeResolver({
      txt: { [recordName]: [["md-verify=", token.slice(0, 10), token.slice(10)]] },
      addresses: { [host]: ["2001:db8::1"] },
    });
    expect(await checkCustomDomainDns(host, token, resolver)).toEqual({ ok: true });
  });

  it("does not combine separate records", async () => {
    const resolver = fakeResolver({
      txt: { [recordName]: [["md-verify="], [token]] },
      addresses: { [host]: ["203.0.113.5"] },
    });
    expect((await checkCustomDomainDns(host, token, resolver)).ok).toBe(false);
  });

  it("names the exact record when it is missing", async () => {
    const resolver = fakeResolver({ addresses: { [host]: ["203.0.113.5"] } });
    expect(await checkCustomDomainDns(host, token, resolver)).toEqual({
      ok: false,
      message: `No TXT record was found at ${recordName}. Add a TXT record named ${recordName} with the value ${recordValue}, then retry.`,
    });
  });

  it("names the exact record when the value is wrong", async () => {
    const resolver = fakeResolver({
      txt: { [recordName]: [["md-verify=someone-elses-token"]] },
      addresses: { [host]: ["203.0.113.5"] },
    });
    const result = await checkCustomDomainDns(host, token, resolver);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(`do not contain ${recordValue}`);
      expect(result.message).toContain(`Add a TXT record named ${recordName} with the value ${recordValue}`);
    }
  });

  it("fails when the TXT record is right but the host does not resolve", async () => {
    const resolver = fakeResolver({ txt: { [recordName]: [[recordValue]] } });
    expect(await checkCustomDomainDns(host, token, resolver)).toEqual({
      ok: false,
      message: `${host} does not resolve. Point it to the application with an A, AAAA or CNAME record, then retry.`,
    });
  });

  it("reports a TXT timeout", async () => {
    const resolver = fakeResolver({ txt: { [recordName]: dnsError("ETIMEOUT") } });
    expect(await checkCustomDomainDns(host, token, resolver)).toEqual({
      ok: false,
      message: `The DNS lookup for ${recordName} timed out. Try again in a few minutes.`,
    });
  });
});

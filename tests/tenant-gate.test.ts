/**
 * The tenant gate (docs/tenant-management.md §7.3): which tenant a Host
 * header names, whether it may be served, and the proxy's decision for
 * `/platform/**`. Runs against the scratch control database only.
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTenantAccess, resolveHost } from "@/lib/domains/resolve";
import { isPlatformHost } from "@/proxy";
import { closeAppDatabase } from "./support/app-connections";
import { clearTenantTables, connectToTestDatabase, insertTenant } from "./support/postgres";
import { randomLabel } from "./support/tenant-resources";

const BASE_DOMAIN = process.env.PLATFORM_BASE_DOMAIN?.trim() || "localhost";

let db: Client;

beforeAll(async () => {
  db = await connectToTestDatabase();
  await clearTenantTables(db);
});

afterAll(async () => {
  await clearTenantTables(db);
  await db.end();
  await closeAppDatabase();
});

type Setup = {
  status: "pending" | "provisioning" | "active" | "failed" | "suspended";
  schemaStatus?: "pending" | "current" | "failed";
  custom?: { host: string; status: "pending" | "active" };
};

/** A tenant with a subdomain row (label = slug) and optionally a custom domain. */
async function tenantWith(setup: Setup): Promise<{ id: string; label: string; name: string }> {
  const label = `gate-${randomLabel(8)}`;
  const id = await insertTenant(db, { slug: label });
  await db.query(
    "UPDATE tenants SET status = $2::tenant_status, schema_status = $3::tenant_schema_status WHERE id = $1",
    [id, setup.status, setup.schemaStatus ?? "pending"],
  );
  await db.query(
    "INSERT INTO tenant_domains (id, tenant_id, type, hostname, status) VALUES ($1, $2, 'subdomain', $3, 'active')",
    [randomUUID(), id, label],
  );
  if (setup.custom) {
    await db.query(
      `INSERT INTO tenant_domains (id, tenant_id, type, hostname, status, verification_token)
       VALUES ($1, $2, 'custom', $3, $4::tenant_domain_status, 'abc')`,
      [randomUUID(), id, setup.custom.host, setup.custom.status],
    );
  }
  return { id, label, name: `Test ${label}` };
}

describe("resolveHost", () => {
  it("treats the base domain and IP addresses as the platform, with or without a port", async () => {
    for (const host of [
      BASE_DOMAIN,
      `${BASE_DOMAIN}:3000`,
      `${BASE_DOMAIN.toUpperCase()}.`,
      "127.0.0.1:3000",
      "10.1.2.3",
      "[::1]:3000",
    ]) {
      expect(await resolveHost(host), host).toBe("platform");
    }
  });

  it("does not know a missing, malformed or unregistered host", async () => {
    for (const host of [
      null,
      undefined,
      "",
      "a b",
      "host:port",
      `nosuch-${randomLabel(8)}.${BASE_DOMAIN}`,
      `deep.nosuch-${randomLabel(8)}.${BASE_DOMAIN}`,
      `nosuch-${randomLabel(8)}.example.com`,
    ]) {
      expect(await resolveHost(host), String(host)).toBe("unknown");
    }
  });

  it("resolves a subdomain host to its tenant, ignoring case, port and the root dot", async () => {
    const tenant = await tenantWith({ status: "active", schemaStatus: "current" });
    const expected = { tenant: { id: tenant.id, name: tenant.name, status: "active", schemaStatus: "current" } };
    expect(await resolveHost(`${tenant.label}.${BASE_DOMAIN}`)).toStrictEqual(expected);
    expect(await resolveHost(`${tenant.label.toUpperCase()}.${BASE_DOMAIN}.:3000`)).toStrictEqual(expected);
    // Only exactly one label in front of the base domain is a subdomain.
    expect(await resolveHost(`www.${tenant.label}.${BASE_DOMAIN}`)).toBe("unknown");
  });

  it("resolves a custom domain only once it is verified", async () => {
    const pendingHost = `pending-${randomLabel(8)}.example.com`;
    const activeHost = `active-${randomLabel(8)}.example.com`;
    await tenantWith({ status: "active", schemaStatus: "current", custom: { host: pendingHost, status: "pending" } });
    const verified = await tenantWith({
      status: "active",
      schemaStatus: "current",
      custom: { host: activeHost, status: "active" },
    });
    expect(await resolveHost(pendingHost)).toBe("unknown");
    expect(await resolveHost(`${activeHost}:443`)).toMatchObject({ tenant: { id: verified.id } });
  });
});

describe("getTenantAccess", () => {
  it("allows only an active tenant whose schema is current", async () => {
    const tenant = await tenantWith({ status: "active", schemaStatus: "current" });
    expect(await getTenantAccess(`${tenant.label}.${BASE_DOMAIN}`)).toMatchObject({
      access: "allowed",
      tenant: { id: tenant.id },
    });
  });

  it("denies a suspended tenant", async () => {
    const tenant = await tenantWith({ status: "suspended", schemaStatus: "current" });
    expect(await getTenantAccess(`${tenant.label}.${BASE_DOMAIN}`)).toMatchObject({
      access: "suspended",
      tenant: { id: tenant.id },
    });
  });

  it("reports tenants whose setup has not finished as not ready", async () => {
    for (const setup of [
      { status: "pending" },
      { status: "provisioning" },
      { status: "failed" },
      { status: "active", schemaStatus: "pending" },
    ] as const) {
      const tenant = await tenantWith(setup);
      expect(await getTenantAccess(`${tenant.label}.${BASE_DOMAIN}`), JSON.stringify(setup)).toMatchObject({
        access: "not_ready",
        tenant: { id: tenant.id },
      });
    }
  });

  it("serves no tenant on the platform host, an unknown host or an unverified custom domain", async () => {
    const pendingHost = `unverified-${randomLabel(8)}.example.com`;
    await tenantWith({ status: "active", schemaStatus: "current", custom: { host: pendingHost, status: "pending" } });
    for (const host of [BASE_DOMAIN, "127.0.0.1:3000", `nosuch-${randomLabel(8)}.${BASE_DOMAIN}`, pendingHost]) {
      expect(await getTenantAccess(host), host).toStrictEqual({ access: "unknown" });
    }
  });
});

describe("proxy: isPlatformHost", () => {
  it("accepts the base domain, localhost and IP addresses, with or without a port", () => {
    for (const host of [
      "example.org",
      "EXAMPLE.org.:8443",
      "localhost",
      "localhost:3000",
      "127.0.0.1",
      "127.0.0.1:3000",
      "192.168.1.20:80",
      "[::1]:3000",
    ]) {
      expect(isPlatformHost(host, "example.org"), host).toBe(true);
    }
  });

  it("refuses tenant subdomains, other hosts and malformed or missing headers", () => {
    for (const host of [
      "acme.example.org",
      "acme.localhost:3000",
      "music.example.com",
      "example.org.evil.com",
      "evil-example.org",
      "",
      "a b",
      "example.org:99999",
      null,
      undefined,
    ]) {
      expect(isPlatformHost(host, "example.org"), String(host)).toBe(false);
    }
  });

  it("uses the base domain it is given", () => {
    expect(isPlatformHost("localhost:3000", "localhost")).toBe(true);
    expect(isPlatformHost("acme.localhost:3000", "localhost")).toBe(false);
    expect(isPlatformHost("platform.example.net", "platform.example.net")).toBe(true);
  });
});

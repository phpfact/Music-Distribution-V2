import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { requestContextFromHeaders, safeEndpoint, sanitizeRequestContext, REQUEST_ID_HEADER } from "@/lib/request-context";
import { recordAuthenticationEvent, recordHostRejection } from "@/lib/security-events";
import { reconcileWorkspaceAppearanceDraft, type WorkspaceAppearanceValue } from "@/lib/workspace/appearance-options";
import { proxy } from "@/proxy";

const mocks = vi.hoisted(() => ({ headers: vi.fn<() => Promise<Headers>>() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

beforeEach(() => { mocks.headers.mockRejectedValue(new Error("no request scope")); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("bounded request context", () => {
  it("drops queries, secrets in dynamic path segments, raw agent and spoofed earlier IP hops", () => {
    const context = requestContextFromHeaders(new Headers({
      "x-forwarded-for": "192.0.2.99, 203.0.113.12",
      "user-agent": `Mozilla Android Chrome/123 Mobile token=private-marker${"x".repeat(2000)}`,
      "cookie": "secret-session",
    }), { pathname: "/platform/tenants/private-token-value/edit?password=private-marker", method: "POST" });
    expect(context).toMatchObject({ clientIp: "203.0.113.12", endpoint: "/platform/tenants/[redacted]/edit", method: "POST", device: "mobile", browser: "chrome", os: "android" });
    expect(JSON.stringify(context)).not.toMatch(/private-marker|private-token-value|secret-session/);
    expect(context.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(safeEndpoint("https://attacker.example/secret")).toBe("unknown");
  });

  it("revalidates optional client information, status, method and arbitrary fields", () => {
    const context = requestContextFromHeaders(new Headers());
    const unsafe = { ...context, method: "POST\nsecret", endpoint: "/platform/private?token=secret", status: 9999, clientIp: "not-ip", device: "secret", browser: "secret", os: "secret", token: "secret" };
    const result = sanitizeRequestContext(unsafe as unknown as typeof context);
    expect(result).toMatchObject({ method: "unknown", clientIp: null, endpoint: "/platform/[redacted]", device: "unknown", browser: "unknown", os: "unknown" });
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("token");
  });

  it("overwrites forged correlation headers in the proxy and preserves generic host denial", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const forged = randomUUID();
    const allowed = proxy(new NextRequest("https://localhost/platform/dashboard", { headers: { host: "localhost", [REQUEST_ID_HEADER]: forged } }));
    expect(allowed.headers.get("x-request-id")).not.toBe(forged);
    expect(allowed.headers.get("x-middleware-request-x-md-request-id")).toBe(allowed.headers.get("x-request-id"));
    const denied = proxy(new NextRequest("https://tenant.invalid/platform/login?token=hidden", { headers: { host: "tenant.invalid", "x-forwarded-for": "203.0.113.14" } }));
    expect(denied.status).toBe(404);
    expect(warn.mock.calls.at(-1)?.[0]).not.toContain("hidden");
    expect(JSON.parse(warn.mock.calls.at(-1)![0] as string)).toMatchObject({ reason: "wrong_host", request: { clientIp: "203.0.113.14", endpoint: "/platform/login", status: 404 } });
  });
});

describe("administrative audit envelope", () => {
  it("propagates current HTTP context automatically while preserving existing action metadata", async () => {
    const requestId = randomUUID();
    mocks.headers.mockResolvedValue(new Headers({ "x-md-request-id": requestId, "x-md-request-path": "/platform/roles/secret-id/edit?token=hidden", "x-md-request-method": "POST", "x-forwarded-for": "203.0.113.7", "user-agent": "Firefox/124 Linux" }));
    const create = vi.fn().mockResolvedValue({});
    await recordAudit({ auditEvent: { create } } as never, { actorType: "super_admin", actorId: "owner", tenantId: null, action: "role.updated", metadata: { changed: ["name"] } });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ ipAddress: "203.0.113.7", metadata: { changed: ["name"], request: expect.objectContaining({ requestId, endpoint: "/platform/roles/[redacted]/edit", method: "POST", browser: "firefox", os: "linux", outcome: "success" }) } }) });
    expect(JSON.stringify(create.mock.calls)).not.toMatch(/secret-id|hidden|Firefox\/124/);
  });

  it("keeps background audit events valid without inventing HTTP context", async () => {
    const create = vi.fn().mockResolvedValue({});
    await recordAudit({ auditEvent: { create } } as never, { actorType: "system", actorId: null, tenantId: null, action: "tenant.provisioned", metadata: { phase: "done" } });
    expect(create.mock.calls[0]![0].data.metadata).toEqual({ phase: "done" });
  });
});

describe("authentication and host telemetry", () => {
  it("correlates failure/rate-limit/success through a stable tenant-scoped HMAC without raw identifiers", async () => {
    expect(() => getEnv()).not.toThrow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = requestContextFromHeaders(new Headers(), { pathname: "/login", method: "POST" });
    const base = { operation: "login" as const, area: "workspace" as const, tenantId: "tenant-a", clientIp: "203.0.113.9", submittedIdentifier: "private-identifier", requestContext: context };
    recordAuthenticationEvent({ ...base, outcome: "failure", reason: "invalid_credentials" });
    recordAuthenticationEvent({ ...base, outcome: "denied", reason: "rate_limited" });
    recordAuthenticationEvent({ ...base, outcome: "success", reason: "authenticated", actorId: "verified-user" });
    const rows = [...warn.mock.calls, ...log.mock.calls].map(([value]) => JSON.parse(value as string));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.anonymousId)).size).toBe(1);
    expect(rows[0].anonymousId).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[2]).toMatchObject({ actorId: "verified-user", occurredAt: expect.stringMatching(/Z$/), clientIp: "203.0.113.9", request: { ...context, outcome: "success" } });
    recordAuthenticationEvent({ ...base, tenantId: "tenant-b", outcome: "failure", reason: "invalid_credentials" });
    expect(JSON.parse(warn.mock.calls.at(-1)![0] as string).anonymousId).not.toBe(rows[0].anonymousId);
    expect(JSON.stringify([...warn.mock.calls, ...log.mock.calls])).not.toContain("private-identifier");
    // Module reload models another app process sharing the configured master key.
    vi.resetModules();
    const reloaded = await import("@/lib/security-events");
    reloaded.recordAuthenticationEvent({ ...base, outcome: "failure", reason: "invalid_credentials" });
    expect(JSON.parse(warn.mock.calls.at(-1)![0] as string).anonymousId).toBe(rows[0].anonymousId);
  });

  it("caps hostile host events without allocating one state entry per attacker host", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let index = 0; index < 1000; index += 1) recordHostRejection(`host-${index}.invalid`, "unknown_domain");
    expect(warn).toHaveBeenCalledTimes(20);
    vi.advanceTimersByTime(60_000);
    recordHostRejection("bad\nhost", "invalid_host");
    expect(warn).toHaveBeenCalledTimes(21);
    expect(JSON.parse(warn.mock.calls.at(-1)![0] as string).host).toBe("invalid");
  });
});

describe("authoritative appearance reconciliation", () => {
  const saved: WorkspaceAppearanceValue = { theme: "light", accent: "neutral", width: "default" };
  it("updates a clean settings draft after a header save", () => {
    const incoming = { ...saved, theme: "dark" as const };
    expect(reconcileWorkspaceAppearanceDraft(saved, saved, incoming)).toEqual({ draft: incoming, conflicts: [] });
  });
  it("keeps an edited accent while adopting the newer header theme", () => {
    expect(reconcileWorkspaceAppearanceDraft(saved, { ...saved, accent: "rose" }, { ...saved, theme: "dark" })).toEqual({ draft: { theme: "dark", accent: "rose", width: "default" }, conflicts: [] });
  });
  it("does not clear an unresolved draft conflict when the same saved state refreshes again", () => {
    const current = { ...saved, theme: "dark" as const };
    const draft = { ...saved, theme: "system" as const };
    expect(reconcileWorkspaceAppearanceDraft(current, draft, current, ["theme"])).toEqual({ draft, conflicts: ["theme"] });
    expect(reconcileWorkspaceAppearanceDraft(current, current, current, ["theme"]).conflicts).toEqual([]);
  });
  it("requires an explicit decision when both saved state and draft changed the same field", () => {
    expect(reconcileWorkspaceAppearanceDraft(saved, { ...saved, theme: "system" }, { ...saved, theme: "dark" })).toEqual({ draft: { ...saved, theme: "system" }, conflicts: ["theme"] });
  });
});

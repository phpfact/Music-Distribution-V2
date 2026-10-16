/**
 * The tenant portal's routing over plain HTTP, against the RUNNING dev server
 * (.vibe/memory/platform-host-gate.md, workspace-auth.md): the portal does not
 * exist on the platform host, an unknown tenant host gets the friendly 404
 * page without any tenant data, and nothing here writes to a database.
 *
 * `fetch` may not set the Host header, so these requests use node:http and
 * connect to the dev server's address while naming another host.
 */
import { request } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { randomLabel } from "./support/tenant-resources";

// The dev server compiles a route on its first request.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE_URL    = new URL(process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000");
const BASE_DOMAIN = process.env.PLATFORM_BASE_DOMAIN?.trim() || "localhost";
const port        = BASE_URL.port ? `:${BASE_URL.port}` : "";

/** One GET with an explicit Host header; resolves with status, location and body. */
function get(path: string, host: string): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: BASE_URL.hostname,
        port: BASE_URL.port || 80,
        path,
        method: "GET",
        headers: { Host: host },
        timeout: 55_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            location: (response.headers.location as string | undefined) ?? null,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error("request timed out")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("the tenant portal on the platform host", () => {
  it.each(["/login", "/tenant/dashboard", "/customer/signup", "/customer/dashboard"])("%s answers 404", async (path) => {
    const response = await get(path, `127.0.0.1${port}`);
    expect(response.status).toBe(404);
    expect(response.body).not.toContain("Log in");
  });
});

describe("an unknown tenant host", () => {
  it.each(["/", "/login", "/customer/signup"])("%s answers the friendly 404 page", async (path) => {
    const response = await get(path, `nosuch-${randomLabel(8)}.${BASE_DOMAIN}${port}`);
    expect(response.status).toBe(404);
    expect(response.body).toContain("Page not found");
    expect(response.body).not.toContain("Welcome to");
  });

  it("does not reach the protected areas", async () => {
    for (const path of ["/tenant/dashboard", "/customer/dashboard"]) {
      const response = await get(path, `nosuch-${randomLabel(8)}.${BASE_DOMAIN}${port}`);
      expect(response.status, path).toBe(404);
    }
  });
});

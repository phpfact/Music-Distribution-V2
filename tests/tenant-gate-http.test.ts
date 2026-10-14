/**
 * The tenant gate over plain HTTP, against the RUNNING dev server
 * (docs/tenant-management.md §7.3): the platform console does not exist on a
 * tenant host, an unknown tenant host has no start page, and the platform's
 * own start page is unchanged. Nothing is written to any database.
 *
 * `fetch` may not set the Host header, so these requests use node:http and
 * connect to the dev server's address while naming another host.
 */
import { request } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { randomLabel } from "./support/tenant-resources";

// The dev server compiles a route on its first request.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const BASE_URL = new URL(process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000");
const BASE_DOMAIN = process.env.PLATFORM_BASE_DOMAIN?.trim() || "localhost";

function get(path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: BASE_URL.hostname,
        port: BASE_URL.port || 80,
        path,
        method: "GET",
        headers: { Host: host },
        timeout: 25_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
        response.on("error", reject);
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error("request timed out")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}

const port = BASE_URL.port ? `:${BASE_URL.port}` : "";

describe("/platform on a tenant host", () => {
  it.each(["/platform/login", "/platform", "/platform/tenants"])("%s answers 404", async (path) => {
    const response = await get(path, `acme.${BASE_DOMAIN}${port}`);
    expect(response.status).toBe(404);
    expect(response.body).not.toContain("Sign in");
  });

  it("still answers on the platform host", async () => {
    const response = await get("/platform/login", `127.0.0.1${port}`);
    expect(response.status).toBe(200);
  });
});

describe("/ by host", () => {
  it("is 404 for a tenant host no tenant answers to", async () => {
    const response = await get("/", `nosuchtenant-${randomLabel(8)}.${BASE_DOMAIN}${port}`);
    expect(response.status).toBe(404);
  });

  it("is the unchanged start page on the platform host", async () => {
    const response = await get("/", `127.0.0.1${port}`);
    expect(response.status).toBe(200);
    expect(response.body).toContain("Music Distribution");
    expect(response.body).toContain("The application is up.");
    expect(response.body).toContain("/api/health/ready");
  });
});

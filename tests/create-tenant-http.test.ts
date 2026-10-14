/**
 * The create-tenant page over plain HTTP, against the RUNNING dev server,
 * without a valid platform session (docs/tenant-management.md §8.7, §10): the
 * visitor is sent to the login page. Nothing is written to any database.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// The dev server compiles a route on its first request.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const BASE_URL = (process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/+$/, "");
const LOGIN_PATH = "/platform/login";
const SESSION_COOKIE = "md_platform_session";

const NO_SESSIONS: [name: string, cookie: string | undefined][] = [
  ["no cookie", undefined],
  ["a garbage cookie", "garbage"],
  ["a well-formed token that was never issued", randomBytes(32).toString("base64url")],
];

async function get(path: string, session: string | undefined): Promise<Response> {
  const headers = new Headers();
  if (session !== undefined) headers.set("Cookie", `${SESSION_COOKIE}=${session}`);
  return fetch(`${BASE_URL}${path}`, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(25_000),
  });
}

describe("/platform/tenants/new", () => {
  it.each(NO_SESSIONS)("with %s: 307 to the login page", async (_name, session) => {
    const response = await get("/platform/tenants/new", session);
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "", BASE_URL).pathname).toBe(LOGIN_PATH);
    await response.body?.cancel();
  });
});

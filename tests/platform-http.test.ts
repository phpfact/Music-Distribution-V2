/**
 * End to end over plain HTTP, against the RUNNING dev server: the login page,
 * the Server Actions behind the two forms (posted the way a browser without
 * JavaScript posts them), the dashboard and the session cookie.
 *
 * The dev server uses the development database, so this suite adds one
 * throwaway owner (`e2e-<random>`) there and removes exactly that row again.
 * Every statement it sends to that database is scoped to that owner's id.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/platform-auth/password";
import {
  attribute,
  forms,
  hiddenInputs,
  inputNamed,
  openingTags,
  responseCookie,
} from "./support/html";
import { LoginKeys } from "./support/login-keys";
import { connectTo, insertOwner, listSessions, sha256Hex } from "./support/postgres";
import { PROJECT_ROOT } from "./support/process";

// The dev server compiles a route on its first request.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const BASE_URL = (process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/+$/, "");
const ORIGIN = new URL(BASE_URL).origin;

const LOGIN_PATH = "/platform/login";
const DASHBOARD_PATH = "/platform/dashboard";
const SESSION_COOKIE = "md_platform_session";
const THEME_COOKIE = "md_platform_theme";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// The stable start of the signed-in dashboard's greeting (the username follows).
const WELCOME = "Welcome back,";
const INVALID_CREDENTIALS = "Invalid username or password.";
const RATE_LIMITED = "Too many sign-in attempts. Try again later.";

const USERNAME = `e2e-${randomBytes(8).toString("hex")}`;
const PASSWORD = `e2e-${randomBytes(18).toString("base64url")}`;
const WRONG_PASSWORD = `e2e-${randomBytes(18).toString("base64url")}`;

let devDb: Client | undefined;
let keys: LoginKeys | undefined;
let ownerId: string | undefined;
let passwordHash: string;
let nextIpSuffix = 1;

type RequestOptions = {
  method?: "GET" | "POST";
  body?: FormData;
  /** The value of the session cookie to send. */
  session?: string;
  /** The value of the theme preference cookie to send. */
  theme?: string;
  ip?: string;
  origin?: string;
  redirect?: "manual" | "follow";
};

async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers = new Headers();
  const cookies: string[] = [];
  if (options.session !== undefined) cookies.push(`${SESSION_COOKIE}=${options.session}`);
  if (options.theme !== undefined) cookies.push(`${THEME_COOKIE}=${options.theme}`);
  if (cookies.length > 0) headers.set("Cookie", cookies.join("; "));
  // No proxy sits in front of the dev server, so the app takes this as the client address.
  if (options.ip) headers.set("X-Forwarded-For", options.ip);
  if (options.origin) headers.set("Origin", options.origin);
  return fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    redirect: options.redirect ?? "manual",
    signal: AbortSignal.timeout(25_000),
  });
}

/** A documentation address of this test's own, so tests do not share an address budget. */
async function newIp(): Promise<string> {
  const ip = `203.0.113.${nextIpSuffix}`;
  nextIpSuffix += 1;
  await loginKeys().claimIp(ip);
  return ip;
}

function theOwnerId(): string {
  if (!ownerId) throw new Error("the throwaway owner was not created");
  return ownerId;
}

function db(): Client {
  if (!devDb) throw new Error("not connected to the development database");
  return devDb;
}

function loginKeys(): LoginKeys {
  if (!keys) throw new Error("not connected to Redis");
  return keys;
}

function ownerSessions() {
  return listSessions(db(), theOwnerId());
}

async function setOwnerStatus(status: "active" | "disabled"): Promise<void> {
  const result = await db().query(
    "UPDATE platform_owners SET status = $3::platform_owner_status WHERE id = $1 AND username = $2",
    [theOwnerId(), USERNAME, status],
  );
  expect(result.rowCount).toBe(1);
}

/** Ages the one session of the throwaway owner that belongs to this cookie value. */
async function ageSession(token: string, column: "expires_at" | "last_used_at", minutesAgo: number) {
  const result = await db().query(
    `UPDATE platform_owner_sessions SET ${column} = now() - make_interval(mins => $3)
     WHERE owner_id = $1 AND token_hash = $2`,
    [theOwnerId(), sha256Hex(token), minutesAgo],
  );
  expect(result.rowCount).toBe(1);
}

function formWith(html: string, marker: string): string {
  const form = forms(html).find((candidate) => candidate.includes(marker));
  if (!form) throw new Error(`the page has no form containing ${marker}`);
  return form;
}

type SignInOptions = {
  username?: string;
  password?: string;
  ip: string;
  /** A session cookie the browser already holds. */
  session?: string;
  /** The login URL to load the form from and post it to. */
  path?: string;
  origin?: string;
};

/**
 * Loads the login page and posts its form the way a browser without
 * JavaScript does: every hidden field of the server-rendered form, plus the
 * two visible ones, as multipart/form-data to the same URL.
 */
async function signIn(options: SignInOptions): Promise<Response> {
  const path = options.path ?? LOGIN_PATH;
  const page = await request(path, { ip: options.ip });
  expect(page.status).toBe(200);
  const form = formWith(await page.text(), 'name="username"');
  const hidden = hiddenInputs(form);
  expect(hidden.map(([name]) => name)).toContain("$ACTION_KEY");

  const body = new FormData();
  for (const [name, value] of hidden) body.append(name, value);
  body.append("username", options.username ?? USERNAME);
  body.append("password", options.password ?? PASSWORD);

  return request(path, {
    method: "POST",
    body,
    ip: options.ip,
    session: options.session,
    origin: options.origin ?? ORIGIN,
  });
}

/** Signs the throwaway owner in and returns the session cookie value. */
async function signInForSession(session?: string): Promise<string> {
  const response = await signIn({ ip: await newIp(), session });
  expect(response.status).toBe(303);
  const token = responseCookie(response, SESSION_COOKIE)?.value;
  if (!token) throw new Error("the sign-in set no session cookie");
  expect(token).toMatch(TOKEN_PATTERN);
  return token;
}

/** Posts the dashboard's sign-out form, as taken from a signed-in rendering of the page. */
async function signOut(formSession: string, sendSession: string | undefined, theme?: string): Promise<Response> {
  const page = await request(DASHBOARD_PATH, { session: formSession });
  expect(page.status).toBe(200);
  const hidden = hiddenInputs(formWith(await page.text(), "$ACTION_ID_"));
  expect(hidden.some(([name]) => name.startsWith("$ACTION_ID_"))).toBe(true);

  const body = new FormData();
  for (const [name, value] of hidden) body.append(name, value);
  return request(DASHBOARD_PATH, { method: "POST", body, session: sendSession, theme, origin: ORIGIN });
}

/** The path a redirect points to; fails if it leaves the application's origin. */
function redirectTarget(response: Response): string {
  const location = response.headers.get("location");
  if (location === null) throw new Error(`status ${response.status} has no Location header`);
  const target = new URL(location, BASE_URL);
  expect(target.origin).toBe(ORIGIN);
  return `${target.pathname}${target.search}${target.hash}`;
}

async function expectSentToLogin(response: Response): Promise<void> {
  expect(response.status).toBe(307);
  expect(redirectTarget(response)).toBe(LOGIN_PATH);
  expect(await response.text()).not.toContain(WELCOME);
}

async function expectLoginFailure(response: Response, message: string): Promise<string> {
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(responseCookie(response, SESSION_COOKIE)).toBeUndefined();
  const html = await response.text();
  expect(html).toContain(message);
  expect(html).not.toContain(WELCOME);
  return html;
}

/** Everything the suite needs before its first test; throws with a clear message. */
async function prepare(): Promise<void> {
  if (process.env.PLATFORM_TEST_ORIGINAL_NODE_ENV === "production") {
    throw new Error(
      "refusing to run the HTTP suite with NODE_ENV=production: it writes a throwaway owner into the database",
    );
  }

  try {
    const probe = await request(LOGIN_PATH);
    await probe.arrayBuffer();
  } catch (error) {
    throw new Error(
      `the dev server at ${BASE_URL} is not reachable (${error instanceof Error ? error.message : String(error)}). ` +
        "Start the development stack (make up), or set E2E_BASE_URL.",
    );
  }

  keys = await LoginKeys.open();
  await keys.claimUsername(USERNAME);

  // The dev server reads the development database, not the scratch one.
  const devDatabase = process.env.PLATFORM_TEST_DEV_DATABASE ?? "";
  if (!devDatabase) throw new Error("PLATFORM_TEST_DEV_DATABASE is not set (see vitest.config.ts)");
  devDb = await connectTo(devDatabase);
  passwordHash = await hashPassword(PASSWORD);
  ownerId = await insertOwner(devDb, { username: USERNAME, passwordHash });
}

let setupError: unknown;

beforeAll(async () => {
  try {
    await prepare();
  } catch (error) {
    // Kept for beforeEach: a hook that throws here would mark every test as
    // skipped, and an unreachable server must fail them instead.
    setupError = error;
  }
});

beforeEach(() => {
  if (setupError) throw setupError;
});

afterEach(async () => {
  // Tests stay independent: no session and no counted attempt carries over.
  if (devDb && ownerId) {
    await devDb.query("DELETE FROM platform_owner_sessions WHERE owner_id = $1", [ownerId]);
    await devDb.query(
      "UPDATE platform_owners SET status = 'active' WHERE id = $1 AND username = $2 AND status <> 'active'",
      [ownerId, USERNAME],
    );
  }
  await keys?.cleanup();
  await keys?.claimUsername(USERNAME);
});

afterAll(async () => {
  try {
    if (devDb && ownerId) {
      // Exactly the row this suite inserted; its sessions go with it (cascade).
      const removed = await devDb.query(
        "DELETE FROM platform_owners WHERE id = $1 AND username = $2",
        [ownerId, USERNAME],
      );
      expect(removed.rowCount).toBe(1);
    }
  } finally {
    await devDb?.end();
    await keys?.close();
  }
});

describe("signing in", () => {
  it("[R5][R8] valid credentials: 303 to the dashboard and a session cookie", async () => {
    const ip = await newIp();

    const response = await signIn({ ip });

    expect(response.status).toBe(303);
    expect(redirectTarget(response)).toBe(DASHBOARD_PATH);

    const cookie = responseCookie(response, SESSION_COOKIE);
    if (!cookie) throw new Error("no session cookie was set");
    expect(cookie.value).toMatch(TOKEN_PATTERN);
    expect(cookie.attributes.has("httponly")).toBe(true);
    expect(cookie.attributes.get("samesite")?.toLowerCase()).toBe("lax");
    expect(cookie.attributes.get("path")).toBe("/platform");
    expect(cookie.attributes.get("max-age")).toBe("28800");
    // Development is served over plain HTTP; the cookie is host-only everywhere.
    expect(cookie.attributes.has("secure")).toBe(false);
    expect(cookie.attributes.has("domain")).toBe(false);

    // The database holds the SHA-256 of the cookie value, never the value.
    const sessions = await ownerSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.token_hash).toBe(sha256Hex(cookie.value));
    expect(sessions[0]?.token_hash).not.toBe(cookie.value);
    expect(JSON.stringify(sessions)).not.toContain(cookie.value);

    // A successful sign-in clears the username counter; the address counter stays.
    expect(await loginKeys().count(LoginKeys.usernameKey(USERNAME))).toBeNull();
    expect(await loginKeys().count(LoginKeys.ipKey(ip))).toBe(1);
  });

  it("[R5] the username is matched trimmed and case-insensitively", async () => {
    const response = await signIn({ ip: await newIp(), username: `  ${USERNAME.toUpperCase()} ` });

    expect(response.status).toBe(303);
    expect(redirectTarget(response)).toBe(DASHBOARD_PATH);
  });

  it("[R6] a wrong password: 200 with the generic message, no cookie, no session", async () => {
    const ip = await newIp();

    const response = await signIn({ ip, password: WRONG_PASSWORD });

    const html = await expectLoginFailure(response, INVALID_CREDENTIALS);
    expect(html).not.toContain(WRONG_PASSWORD);
    expect(html).not.toContain(PASSWORD);
    expect(await ownerSessions()).toHaveLength(0);
    // The attempt was counted for this test's address, as sent in X-Forwarded-For.
    expect(await loginKeys().count(LoginKeys.ipKey(ip))).toBe(1);
    expect(await loginKeys().count(LoginKeys.usernameKey(USERNAME))).toBe(1);
  });

  it("[R6] an unknown username: the same message as a wrong password", async () => {
    const unknown = `e2e-${randomBytes(8).toString("hex")}`;
    await loginKeys().claimUsername(unknown);

    const response = await signIn({ ip: await newIp(), username: unknown, password: PASSWORD });

    const html = await expectLoginFailure(response, INVALID_CREDENTIALS);
    expect(html).not.toContain(PASSWORD);
    expect(await ownerSessions()).toHaveLength(0);
  });

  it("[R6] a password with a trailing space is a wrong password", async () => {
    const response = await signIn({ ip: await newIp(), password: `${PASSWORD} ` });

    await expectLoginFailure(response, INVALID_CREDENTIALS);
    expect(await ownerSessions()).toHaveLength(0);
  });

  it("[R7] empty fields: both field messages, and no attempt is counted", async () => {
    const ip = await newIp();

    const response = await signIn({ ip, username: "", password: "" });

    const html = await expectLoginFailure(response, "Enter your username.");
    expect(html).toContain("Enter your password.");
    expect(html).not.toContain(INVALID_CREDENTIALS);
    expect(await loginKeys().count(LoginKeys.ipKey(ip))).toBeNull();
  });

  it("[R7] only the password empty: its message, and the username stays in the field", async () => {
    const response = await signIn({ ip: await newIp(), password: "" });

    const html = await expectLoginFailure(response, "Enter your password.");
    expect(html).not.toContain("Enter your username.");
    const form = formWith(html, 'name="username"');
    const usernameInput = inputNamed(form, "username");
    expect(usernameInput && attribute(usernameInput, "value")).toBe(USERNAME);
    // The password field is never pre-filled.
    const passwordInput = inputNamed(form, "password");
    expect(passwordInput).toBeDefined();
    expect(passwordInput && attribute(passwordInput, "value")).toBeUndefined();
  });

  it("[R7] only the username empty: its message alone", async () => {
    const response = await signIn({ ip: await newIp(), username: "   " });

    const html = await expectLoginFailure(response, "Enter your username.");
    expect(html).not.toContain("Enter your password.");
    expect(html).not.toContain(PASSWORD);
  });

  it("a disabled account: the generic message with the correct password, and its session stops working", async () => {
    const session = await signInForSession();
    expect((await request(DASHBOARD_PATH, { session })).status).toBe(200);

    await setOwnerStatus("disabled");
    try {
      await expectSentToLogin(await request(DASHBOARD_PATH, { session }));

      const response = await signIn({ ip: await newIp() });
      await expectLoginFailure(response, INVALID_CREDENTIALS);
      expect(await ownerSessions()).toHaveLength(1);
    } finally {
      await setOwnerStatus("active");
    }
  });

  it("rate limit: after 5 wrong attempts the correct password is refused too", async () => {
    const ip = await newIp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectLoginFailure(await signIn({ ip, password: WRONG_PASSWORD }), INVALID_CREDENTIALS);
    }

    const response = await signIn({ ip });

    const html = await expectLoginFailure(response, RATE_LIMITED);
    expect(html).not.toContain(INVALID_CREDENTIALS);
    expect(await ownerSessions()).toHaveLength(0);
  });
});

describe("the dashboard", () => {
  it("[R9] without a cookie: 307 to the login page, nothing of the dashboard", async () => {
    await expectSentToLogin(await request(DASHBOARD_PATH));
  });

  it.each([
    ["a garbage cookie", "garbage"],
    ["an empty cookie", ""],
    ["a well-formed token that was never issued", randomBytes(32).toString("base64url")],
    ["the SHA-256 of nothing", sha256Hex("")],
  ])("[R9] with %s: 307 to the login page", async (_name, session) => {
    await expectSentToLogin(await request(DASHBOARD_PATH, { session }));
  });

  it("[R9] /platform, when not signed in, ends at the login page", async () => {
    const first = await request("/platform");
    expect(first.status).toBe(307);
    expect(redirectTarget(first)).toBe(DASHBOARD_PATH);

    const followed = await request("/platform", { redirect: "follow" });
    expect(followed.status).toBe(200);
    expect(new URL(followed.url).pathname).toBe(LOGIN_PATH);
    const html = await followed.text();
    expect(html).toContain('name="username"');
    expect(html).not.toContain(WELCOME);
  });

  it("[R10] with the session cookie: 200 with the welcome text, also when refreshed", async () => {
    const session = await signInForSession();

    for (const visit of ["first visit", "refresh", "second refresh"]) {
      const response = await request(DASHBOARD_PATH, { session });
      expect(response.status, visit).toBe(200);
      const html = await response.text();
      expect(html, visit).toContain(WELCOME);
      // Nothing secret reaches the page.
      expect(html).not.toContain("argon2");
      expect(html).not.toContain(passwordHash);
      expect(html).not.toContain(session);
      expect(html).not.toContain(sha256Hex(session));
      // Viewing the page neither replaces nor extends the cookie.
      expect(responseCookie(response, SESSION_COOKIE)).toBeUndefined();
    }
    expect(await ownerSessions()).toHaveLength(1);
  });

  it("[R10] the login page sends a signed-in owner on to the dashboard", async () => {
    const session = await signInForSession();

    const response = await request(LOGIN_PATH, { session });

    expect(response.status).toBe(307);
    expect(redirectTarget(response)).toBe(DASHBOARD_PATH);
  });

  it("the dashboard response is not publicly cacheable", async () => {
    const session = await signInForSession();

    const response = await request(DASHBOARD_PATH, { session });

    expect(response.status).toBe(200);
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toMatch(/\b(no-store|private)\b/);
    expect(cacheControl).not.toMatch(/\bpublic\b/);
  });
});

describe("signing out", () => {
  it("[R11] ends the session: 303 to login, the cookie cleared, the old cookie useless", async () => {
    const session = await signInForSession();

    const response = await signOut(session, session);

    expect(response.status).toBe(303);
    expect(redirectTarget(response)).toBe(LOGIN_PATH);

    const cleared = responseCookie(response, SESSION_COOKIE);
    if (!cleared) throw new Error("the sign-out did not clear the session cookie");
    expect(cleared.value).toBe("");
    expect(cleared.attributes.get("path")).toBe("/platform");
    const expires = cleared.attributes.get("expires");
    const expired =
      cleared.attributes.get("max-age") === "0" ||
      (expires !== undefined && new Date(expires).getTime() < Date.now());
    expect(expired).toBe(true);

    expect(await ownerSessions()).toHaveLength(0);
    // Replaying the cookie a copy of which was kept.
    await expectSentToLogin(await request(DASHBOARD_PATH, { session }));
  });

  it("[R11] ends only that session", async () => {
    const first = await signInForSession();
    const second = await signInForSession();

    expect((await signOut(first, first)).status).toBe(303);

    await expectSentToLogin(await request(DASHBOARD_PATH, { session: first }));
    expect((await request(DASHBOARD_PATH, { session: second })).status).toBe(200);
  });

  it("keeps the theme preference: no Set-Cookie for it on sign-out", async () => {
    const session = await signInForSession();

    const response = await signOut(session, session, "dark");

    expect(response.status).toBe(303);
    expect(responseCookie(response, SESSION_COOKIE)).toBeDefined();
    expect(responseCookie(response, THEME_COOKIE)).toBeUndefined();
  });

  it("[R11] without a cookie still redirects to the login page", async () => {
    const session = await signInForSession();

    const response = await signOut(session, undefined);

    expect(response.status).toBe(303);
    expect(redirectTarget(response)).toBe(LOGIN_PATH);
    // Nobody was signed out.
    expect(await ownerSessions()).toHaveLength(1);
  });
});

describe("[R12] session expiry", () => {
  it("a session past its expires_at no longer opens the dashboard", async () => {
    const session = await signInForSession();
    expect((await request(DASHBOARD_PATH, { session })).status).toBe(200);

    await ageSession(session, "expires_at", 1);

    await expectSentToLogin(await request(DASHBOARD_PATH, { session }));
    // And the login page shows the form again instead of redirecting.
    expect((await request(LOGIN_PATH, { session })).status).toBe(200);
  });

  it("a session unused for 31 minutes no longer opens the dashboard", async () => {
    const session = await signInForSession();
    expect((await request(DASHBOARD_PATH, { session })).status).toBe(200);

    await ageSession(session, "last_used_at", 31);

    await expectSentToLogin(await request(DASHBOARD_PATH, { session }));
  });

  it("a session unused for 29 minutes still does, and is marked as used again", async () => {
    const session = await signInForSession();
    await ageSession(session, "last_used_at", 29);

    expect((await request(DASHBOARD_PATH, { session })).status).toBe(200);

    const [row] = await ownerSessions();
    expect(Math.abs(Date.now() - (row?.last_used_at.getTime() ?? 0))).toBeLessThan(15_000);
  });
});

describe("attacks", () => {
  it("session fixation: a cookie value chosen by an attacker is never adopted", async () => {
    const planted = randomBytes(32).toString("base64url");

    const response = await signIn({ ip: await newIp(), session: planted });

    expect(response.status).toBe(303);
    const issued = responseCookie(response, SESSION_COOKIE)?.value;
    expect(issued).toMatch(TOKEN_PATTERN);
    expect(issued).not.toBe(planted);
    await expectSentToLogin(await request(DASHBOARD_PATH, { session: planted }));
    expect((await request(DASHBOARD_PATH, { session: issued })).status).toBe(200);
    expect((await ownerSessions()).map((row) => row.token_hash)).toStrictEqual([
      sha256Hex(issued ?? ""),
    ]);
  });

  it("session fixation: signing in again issues a new token and ends the previous session", async () => {
    const previous = await signInForSession();

    const current = await signInForSession(previous);

    expect(current).not.toBe(previous);
    await expectSentToLogin(await request(DASHBOARD_PATH, { session: previous }));
    expect((await request(DASHBOARD_PATH, { session: current })).status).toBe(200);
    expect(await ownerSessions()).toHaveLength(1);
  });

  it.each([
    ["next", `${LOGIN_PATH}?next=https://example.com`],
    ["callbackUrl", `${LOGIN_PATH}?callbackUrl=//example.com`],
    ["redirect", `${LOGIN_PATH}?redirect=/%2F%2Fexample.com`],
    ["returnTo", `${LOGIN_PATH}?returnTo=${encodeURIComponent("https://example.com/platform/dashboard")}`],
  ])("open redirect: a `%s` parameter does not change the destination", async (_name, path) => {
    const response = await signIn({ ip: await newIp(), path });

    expect(response.status).toBe(303);
    // redirectTarget also fails on any other origin.
    expect(redirectTarget(response)).toBe(DASHBOARD_PATH);
    expect(response.headers.get("location")).not.toContain("example.com");
  });

  it.each([
    ["another site", "https://evil.example"],
    ["the same host on another port", "http://127.0.0.1:9"],
    ["a look-alike host", `${ORIGIN}.evil.example`],
  ])("cross-origin: a sign-in posted from %s is refused", async (_name, origin) => {
    const ip = await newIp();

    const response = await signIn({ ip, origin });

    expect(response.status).not.toBe(303);
    expect(response.headers.get("location")).toBeNull();
    expect(responseCookie(response, SESSION_COOKIE)).toBeUndefined();
    expect(await response.text()).not.toContain(WELCOME);
    expect(await ownerSessions()).toHaveLength(0);
    // The action never ran: not even an attempt was counted.
    expect(await loginKeys().count(LoginKeys.ipKey(ip))).toBeNull();
  });

  it("cross-origin: a sign-out posted from another site does not end the session", async () => {
    const session = await signInForSession();
    const page = await request(DASHBOARD_PATH, { session });
    const body = new FormData();
    for (const [name, value] of hiddenInputs(formWith(await page.text(), "$ACTION_ID_"))) {
      body.append(name, value);
    }

    const response = await request(DASHBOARD_PATH, {
      method: "POST",
      body,
      session,
      origin: "https://evil.example",
    });

    expect(response.status).not.toBe(303);
    expect(responseCookie(response, SESSION_COOKIE)).toBeUndefined();
    expect(await ownerSessions()).toHaveLength(1);
    expect((await request(DASHBOARD_PATH, { session })).status).toBe(200);
  });
});

describe("the pages", () => {
  it("the login page sends the security headers and is not indexed", async () => {
    const response = await request(LOGIN_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-powered-by")).toBeNull();

    const html = await response.text();
    const robots = openingTags(html, "meta").find((tag) => attribute(tag, "name") === "robots");
    expect(robots && attribute(robots, "content")).toContain("noindex");
  });

  it("the login form posts to its own URL and asks for the password in a password field", async () => {
    const html = await (await request(LOGIN_PATH)).text();
    const form = formWith(html, 'name="username"');
    const formTag = openingTags(form, "form")[0] ?? "";

    expect(attribute(formTag, "method")?.toUpperCase()).toBe("POST");
    expect(attribute(formTag, "action")).toBe("");
    const password = inputNamed(form, "password");
    expect(password && attribute(password, "type")).toBe("password");
    expect(password && attribute(password, "autoComplete")).toBe("current-password");
  });

  it("the theme is light without a preference and dark with one, rendered on the server", async () => {
    const light = await (await request(LOGIN_PATH)).text();
    expect(light).not.toMatch(/class="dark[ "]/);

    const dark = await (await request(LOGIN_PATH, { theme: "dark" })).text();
    expect(dark).toMatch(/class="dark[ "]/);
  });

  it("the dashboard also sends the security headers", async () => {
    const session = await signInForSession();

    const response = await request(DASHBOARD_PATH, { session });

    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("[R13] the platform error boundary renders neither the error message nor its digest (static check of error.tsx)", async () => {
    const source = await readFile(`${PROJECT_ROOT}src/app/platform/error.tsx`, "utf8");
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const start = withoutComments.indexOf("export default function");
    expect(start).toBeGreaterThanOrEqual(0);
    // From the component's signature on: the props type above it is not rendered.
    const component = withoutComments.slice(start);

    expect(component).toContain("Something went wrong");
    // The `error` prop is not even destructured, so nothing of it can be shown.
    expect(component).not.toMatch(/\berror\b/);
    expect(component).not.toMatch(/\bprops\b/);
    expect(component).not.toContain("digest");
    expect(component).not.toContain("message");
    expect(component).not.toContain("stack");
    expect(component).not.toContain("dangerouslySetInnerHTML");
  });
});

/** Real migrated scratch database: isolation, permissions and safe reset semantics. */
import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as audit from "@/lib/audit";
import { getAppearanceState, saveAppearance } from "@/lib/appearance/service";
import { DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance/preferences";
import { createSession, revokeSession, validateSession, type PlatformSession } from "@/lib/platform-auth/session";
import { closeAppDatabase } from "./support/app-connections";
import { clearPlatformTables, connectToTestDatabase, insertOwner } from "./support/postgres";

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo";
const DARK: Appearance = { theme: "dark", accent: "violet", width: "focused" };
const LIGHT: Appearance = { theme: "light", accent: "blue", width: "full" };
let db: Client;
let a: PlatformSession;
let b: PlatformSession;
let tokenA: string;

/**
 * Description: Create an isolated scratch-database owner and authenticated session.
 * Input: Whether this test owner can change the global appearance.
 * Output: The verified session and its cookie token for auth regression tests.
 * Use case: Test each permission scope without relying on seeded platform users.
 * Author: Mr. Sachin Sharma
 * Created date: 2026-10-14
 * Last modified date: 2026-10-14
 */
async function account(canManageAppearance = true) {
  const id = await insertOwner(db, { username: `vt-appearance-${randomBytes(4).toString("hex")}`, passwordHash: HASH });
  if (!canManageAppearance) await db.query("UPDATE platform_owners SET can_manage_appearance = false WHERE id = $1", [id]);
  const token = await createSession(id, HASH);
  if (!token) throw new Error("no session");
  const session = await validateSession(token);
  if (!session) throw new Error("invalid session");
  return { session, token };
}

beforeAll(async () => { db = await connectToTestDatabase(); });
beforeEach(async () => {
  await clearPlatformTables(db);
  await db.query("DELETE FROM platform_appearance");
  ({ session: a, token: tokenA } = await account());
  ({ session: b } = await account(false));
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await clearPlatformTables(db);
  await db.query("DELETE FROM platform_appearance");
  await db.end();
  await closeAppDatabase();
});

const apply = (session: PlatformSession, appearance: Appearance, scope: "personal" | "global" = "personal") =>
  saveAppearance(session, { operation: "apply", scope, appearance });
const reset = (session: PlatformSession, scope: "personal" | "global" = "personal") =>
  saveAppearance(session, { operation: "reset", scope });

describe("owner-specific persistence", () => {
  it("starts with designated defaults and reveals no private personal data on an anonymous read", async () => {
    expect(await getAppearanceState(a.owner.id)).toMatchObject({
      ownerId: a.owner.id, personal: null, global: null, appearance: DEFAULT_APPEARANCE,
      source: "default", canManageGlobal: true,
    });
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ canManageGlobal: false });
    await apply(a, DARK);
    expect(await getAppearanceState()).toStrictEqual({
      ownerId: null, personal: null, global: null, appearance: DEFAULT_APPEARANCE,
      source: "default", canManageGlobal: false,
    });
  });

  it("stores concurrent distinct appearances independently, visible across sessions/devices", async () => {
    const results = await Promise.all([apply(a, DARK), apply(b, LIGHT)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await getAppearanceState(a.owner.id)).toMatchObject({ personal: DARK, appearance: DARK, source: "personal" });
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ personal: LIGHT, appearance: LIGHT, source: "personal" });
    const anotherToken = await createSession(a.owner.id, HASH);
    const anotherSession = anotherToken ? await validateSession(anotherToken) : null;
    expect(anotherSession?.owner.id).toBe(a.owner.id);
    expect(await getAppearanceState(anotherSession?.owner.id)).toMatchObject({ appearance: DARK });
  });

  it("restores an owner's saved appearance after logout and subsequent login", async () => {
    await apply(a, DARK);
    await revokeSession(tokenA);
    expect(await validateSession(tokenA)).toBeNull();
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ appearance: DEFAULT_APPEARANCE });
    const newToken = await createSession(a.owner.id, HASH);
    const signedIn = newToken ? await validateSession(newToken) : null;
    expect(signedIn?.owner.id).toBe(a.owner.id);
    expect(await getAppearanceState(signedIn?.owner.id)).toMatchObject({ appearance: DARK });
  });

  it("is idempotent for duplicate concurrent personal applies", async () => {
    const results = await Promise.all([apply(a, DARK), apply(a, DARK)]);
    expect(results.every((result) => result.ok)).toBe(true);
    const rows = await db.query("SELECT * FROM platform_owner_appearances WHERE owner_id = $1", [a.owner.id]);
    expect(rows.rows).toHaveLength(1);
  });

  it("rejects unsupported values, invalid operation/scope, and submitted target IDs without writes", async () => {
    for (const input of [
      { operation: "apply", scope: "personal", appearance: { theme: "nope", accent: "violet", width: "default" } },
      { operation: "apply", scope: "global", appearance: { theme: "dark", accent: "#fff", width: "default" } },
      { operation: "apply", scope: "personal", appearance: { theme: "light", accent: "blue", width: "invalid" } },
      { operation: "apply", scope: "global", appearance: { theme: "light", accent: "blue" } },
      { operation: "reset", scope: "everyone" },
      { operation: "delete", scope: "personal" },
      { operation: "apply", scope: "personal", appearance: DARK, ownerId: b.owner.id },
    ]) expect(await saveAppearance(a, input)).toMatchObject({ ok: false });
    expect((await db.query("SELECT * FROM platform_owner_appearances")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM platform_appearance")).rows).toHaveLength(0);
  });

  it("never resolves an unknown, malformed or disabled identity to another owner's override", async () => {
    await apply(a, DARK);
    for (const id of [randomUUID(), "not-a-uuid", "' OR 1=1 --"]) {
      expect(await getAppearanceState(id)).toMatchObject({ ownerId: null, personal: null, canManageGlobal: false });
    }
    await db.query("UPDATE platform_owners SET status = 'disabled' WHERE id = $1", [a.owner.id]);
    expect(await getAppearanceState(a.owner.id)).toMatchObject({ ownerId: null, personal: null, canManageGlobal: false });
  });
});

describe("global defaults and safe resets", () => {
  it("global apply inherits for an initiating owner without an override and preserves other personal records", async () => {
    await apply(b, LIGHT);
    expect(await apply(a, DARK, "global")).toMatchObject({ ok: true });
    expect(await getAppearanceState(a.owner.id)).toMatchObject({ personal: null, global: DARK, appearance: DARK, source: "global" });
    expect((await db.query("SELECT * FROM platform_owner_appearances WHERE owner_id = $1", [a.owner.id])).rows).toHaveLength(0);
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ personal: LIGHT, global: DARK, appearance: LIGHT, source: "personal" });
    expect(await getAppearanceState()).toMatchObject({ ownerId: null, personal: null, appearance: DARK, source: "global" });
  });

  it("global apply replaces only the initiating owner's old override with the complete selection", async () => {
    await apply(a, DARK);
    await apply(b, DARK);
    const otherBefore = (await db.query("SELECT * FROM platform_owner_appearances WHERE owner_id = $1", [b.owner.id])).rows;
    expect(await apply(a, LIGHT, "global")).toMatchObject({
      ok: true, state: { personal: LIGHT, global: LIGHT, appearance: LIGHT, source: "personal" },
    });
    expect(await getAppearanceState(a.owner.id)).toMatchObject({ personal: LIGHT, appearance: LIGHT });
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ personal: DARK, global: LIGHT, appearance: DARK });
    // Verify even the untouched owner's persistence timestamp remains unchanged.
    expect((await db.query("SELECT * FROM platform_owner_appearances WHERE owner_id = $1", [b.owner.id])).rows).toStrictEqual(otherBefore);
  });

  it("serializes concurrent global and personal applies with an existing override", async () => {
    await apply(a, DARK);
    await apply(b, DARK);
    const results = await Promise.all([apply(a, LIGHT, "global"), apply(a, DARK)]);
    // Each transaction must return its own complete selection, even when another
    // request for the same account is waiting to commit a conflicting selection.
    expect(results[0]).toMatchObject({ ok: true, state: { appearance: LIGHT } });
    expect(results[1]).toMatchObject({ ok: true, state: { appearance: DARK } });
    const final = await getAppearanceState(a.owner.id);
    expect(final.global).toStrictEqual(LIGHT);
    expect([LIGHT, DARK]).toContainEqual(final.personal);
    expect(final.appearance).toStrictEqual(final.personal);
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ personal: DARK, appearance: DARK });
  });

  it("serializes concurrent global apply and personal creation when no override exists", async () => {
    await apply(b, DARK);
    expect(await getAppearanceState(a.owner.id)).toMatchObject({ personal: null });
    const results = await Promise.all([apply(a, LIGHT, "global"), apply(a, DARK)]);
    expect(results[0]).toMatchObject({ ok: true, state: { appearance: LIGHT } });
    expect(results[1]).toMatchObject({ ok: true, state: { appearance: DARK } });
    const final = await getAppearanceState(a.owner.id);
    expect(final.global).toStrictEqual(LIGHT);
    expect([LIGHT, DARK]).toContainEqual(final.personal);
    expect(final.appearance).toStrictEqual(final.personal);
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ personal: DARK, appearance: DARK });
  });

  it("personal reset removes only that owner's override and inherits the global default", async () => {
    await apply(a, DARK, "global");
    await apply(a, LIGHT);
    await apply(b, LIGHT);
    expect(await reset(a)).toMatchObject({ ok: true, state: { personal: null, appearance: DARK, source: "global" } });
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ personal: LIGHT });
    expect(await getAppearanceState()).toMatchObject({ global: DARK });
  });

  it("personal reset falls back to the application default when no global value exists", async () => {
    await apply(a, DARK);
    expect(await reset(a)).toMatchObject({ ok: true, state: { personal: null, appearance: DEFAULT_APPEARANCE, source: "default" } });
    expect(await reset(a)).toMatchObject({ ok: true });
  });

  it("global reset persists Light/Neutral without discarding either owner's override", async () => {
    await apply(a, DARK, "global");
    await apply(a, DARK);
    await apply(b, LIGHT);
    expect(await reset(a, "global")).toMatchObject({ ok: true, state: { global: DEFAULT_APPEARANCE, personal: DARK, appearance: DARK } });
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ global: DEFAULT_APPEARANCE, personal: LIGHT, appearance: LIGHT });
    expect(await getAppearanceState()).toMatchObject({ global: DEFAULT_APPEARANCE, appearance: DEFAULT_APPEARANCE, source: "global" });
  });

  it("denies global apply and reset for a personal-only owner even through a direct service call", async () => {
    await apply(a, DARK, "global");
    expect(await apply(b, LIGHT, "global")).toMatchObject({ ok: false, error: expect.stringContaining("permission") });
    expect(await reset(b, "global")).toMatchObject({ ok: false, error: expect.stringContaining("permission") });
    expect(await getAppearanceState()).toMatchObject({ global: DARK });
    expect(await apply(b, LIGHT)).toMatchObject({ ok: true });
  });

  it("checks the persisted permission again after the authenticated page was rendered", async () => {
    await db.query("UPDATE platform_owners SET can_manage_appearance = false WHERE id = $1", [a.owner.id]);
    expect(await apply(a, DARK, "global")).toMatchObject({ ok: false });
    expect(await reset(a, "global")).toMatchObject({ ok: false });
    expect(await apply(a, DARK)).toMatchObject({ ok: true });
  });
});

describe("write-time session checks and integrity", () => {
  it("background preference validation does not keep idle sessions alive", async () => {
    await db.query("UPDATE platform_owner_sessions SET last_used_at = now() - interval '2 minutes' WHERE id = $1", [a.sessionId]);
    const before = (await db.query<{ last_used_at: Date }>("SELECT last_used_at FROM platform_owner_sessions WHERE id = $1", [a.sessionId])).rows[0]?.last_used_at;
    expect(await validateSession(tokenA, { touch: false })).toStrictEqual(a);
    const after = (await db.query<{ last_used_at: Date }>("SELECT last_used_at FROM platform_owner_sessions WHERE id = $1", [a.sessionId])).rows[0]?.last_used_at;
    expect(after).toStrictEqual(before);
    expect(await validateSession(tokenA)).toStrictEqual(a);
    const interacted = (await db.query<{ last_used_at: Date }>("SELECT last_used_at FROM platform_owner_sessions WHERE id = $1", [a.sessionId])).rows[0]?.last_used_at;
    expect(interacted?.getTime()).toBeGreaterThan(before?.getTime() ?? 0);
  });

  it.each(["expired", "idle", "revoked", "disabled"])("refuses a previously authenticated session that is now %s", async (state) => {
    if (state === "expired") await db.query("UPDATE platform_owner_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1", [a.sessionId]);
    if (state === "idle") await db.query("UPDATE platform_owner_sessions SET last_used_at = now() - interval '31 minutes' WHERE id = $1", [a.sessionId]);
    if (state === "revoked") await revokeSession(tokenA);
    if (state === "disabled") await db.query("UPDATE platform_owners SET status = 'disabled' WHERE id = $1", [a.owner.id]);
    expect(await apply(a, DARK)).toMatchObject({ ok: false, error: expect.stringContaining("session has expired") });
    expect(await reset(a, "global")).toMatchObject({ ok: false });
    expect((await db.query("SELECT * FROM platform_owner_appearances")).rows).toHaveLength(0);
  });

  it("rejects the stale account guard while always targeting the authenticated account", async () => {
    expect(await saveAppearance(b, { operation: "apply", scope: "personal", appearance: DARK, expectedOwnerId: a.owner.id }))
      .toMatchObject({ ok: false, error: expect.stringContaining("account has changed") });
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ personal: null });
    expect(await saveAppearance(b, { operation: "apply", scope: "personal", appearance: LIGHT, expectedOwnerId: b.owner.id }))
      .toMatchObject({ ok: true, state: { ownerId: b.owner.id, personal: LIGHT } });
  });

  it("binds the verified session to its owner rather than allowing another owner ID", async () => {
    expect(await apply({ ...a, owner: b.owner }, DARK)).toMatchObject({ ok: false });
    expect(await apply({ ...a, sessionId: "malformed" }, DARK)).toMatchObject({ ok: false });
  });

  it("rolls back the preference if the transaction's audit write fails", async () => {
    vi.spyOn(audit, "recordAudit").mockRejectedValueOnce(new Error("test storage failure"));
    await expect(apply(a, DARK)).rejects.toThrow("test storage failure");
    expect(await getAppearanceState(a.owner.id)).toMatchObject({ personal: null, appearance: DEFAULT_APPEARANCE });
  });

  it("rolls back the global setting and initiating override together if audit persistence fails", async () => {
    await apply(a, DARK, "global");
    await apply(a, DARK);
    await apply(b, DARK);
    vi.spyOn(audit, "recordAudit").mockRejectedValueOnce(new Error("test audit failure"));
    await expect(apply(a, LIGHT, "global")).rejects.toThrow("test audit failure");
    expect(await getAppearanceState(a.owner.id)).toMatchObject({ personal: DARK, global: DARK, appearance: DARK });
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ personal: DARK, global: DARK, appearance: DARK });
  });

  it("rolls back the global update if updating the initiating override fails", async () => {
    await apply(a, DARK, "global");
    await apply(a, DARK);
    await apply(b, DARK);
    // Reject the initiating row's update at the database boundary, after the
    // global upsert, to verify the dependent writes are truly transactional.
    await db.query(`CREATE FUNCTION vt_reject_appearance_update() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test initiating override update failure'; END;
      $$ LANGUAGE plpgsql`);
    await db.query(`CREATE TRIGGER vt_reject_appearance_update BEFORE UPDATE ON platform_owner_appearances
      FOR EACH ROW EXECUTE FUNCTION vt_reject_appearance_update()`);
    try {
      await expect(apply(a, LIGHT, "global")).rejects.toThrow();
    } finally {
      await db.query("DROP TRIGGER vt_reject_appearance_update ON platform_owner_appearances");
      await db.query("DROP FUNCTION vt_reject_appearance_update()");
    }
    expect(await getAppearanceState(a.owner.id)).toMatchObject({ personal: DARK, global: DARK, appearance: DARK });
    expect(await getAppearanceState(b.owner.id)).toMatchObject({ personal: DARK, global: DARK, appearance: DARK });
  });

  it("legacy inserts retain valid preferences through the database's default width", async () => {
    await db.query("INSERT INTO platform_owner_appearances (owner_id, theme, accent) VALUES ($1, 'dark', 'violet')", [a.owner.id]);
    await db.query("INSERT INTO platform_appearance (theme, accent) VALUES ('light', 'blue')");
    expect(await getAppearanceState(a.owner.id)).toMatchObject({
      personal: { theme: "dark", accent: "violet", width: "default" },
      global: { theme: "light", accent: "blue", width: "default" },
      source: "personal",
    });
  });

  it("records successful actions with scope but no session tokens or other owners' preferences", async () => {
    await apply(a, DARK);
    await reset(a);
    const rows = await db.query("SELECT action, actor_id, target_id, metadata FROM audit_events WHERE actor_id = $1 AND action LIKE 'appearance.%' ORDER BY occurred_at", [a.owner.id]);
    expect(rows.rows).toStrictEqual([
      { action: "appearance.applied", actor_id: a.owner.id, target_id: a.owner.id, metadata: { scope: "personal" } },
      { action: "appearance.reset", actor_id: a.owner.id, target_id: a.owner.id, metadata: { scope: "personal" } },
    ]);
    expect(JSON.stringify(rows.rows)).not.toContain(tokenA);
  });

  it("enforces supported database values, a singleton global row, and the owner FK", async () => {
    await expect(db.query("INSERT INTO platform_appearance (id, theme, accent) VALUES ('other', 'light', 'emerald')"))
      .rejects.toMatchObject({ code: "23514" });
    await expect(db.query("INSERT INTO platform_appearance (theme, accent) VALUES ('unsupported', 'emerald')"))
      .rejects.toMatchObject({ code: "22P02" });
    await expect(db.query("INSERT INTO platform_appearance (theme, accent, width) VALUES ('light', 'emerald', '100vw')"))
      .rejects.toMatchObject({ code: "22P02" });
    await expect(db.query("INSERT INTO platform_owner_appearances (owner_id, theme, accent) VALUES ($1, 'dark', 'violet')", [randomUUID()]))
      .rejects.toMatchObject({ code: "23503" });
    await apply(a, DARK);
    await db.query("DELETE FROM platform_owners WHERE id = $1", [a.owner.id]);
    expect((await db.query("SELECT * FROM platform_owner_appearances WHERE owner_id = $1", [a.owner.id])).rows).toHaveLength(0);
  });
});

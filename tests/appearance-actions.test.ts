import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppearanceActionResult, AppearanceState } from "@/lib/appearance/preferences";
import type { PlatformSession } from "@/lib/platform-auth/session";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<PlatformSession | null>>(),
  headers: vi.fn<() => Promise<Headers>>(),
  cookies: vi.fn<() => Promise<{ get: (name: string) => { value: string } | undefined }>>(),
  validateSession: vi.fn<(token: string, options: { touch?: boolean }) => Promise<PlatformSession | null>>(),
  save: vi.fn<(...args: unknown[]) => Promise<AppearanceActionResult>>(),
  load: vi.fn<(...args: unknown[]) => Promise<AppearanceState>>(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/platform-auth/dal", () => ({ getPlatformSession: mocks.getSession }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/platform-auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/platform-auth/session")>(),
  validateSession: mocks.validateSession,
}));
vi.mock("@/lib/appearance/service", () => ({ getAppearanceState: mocks.load, saveAppearance: mocks.save }));
import { refreshAppearanceAction, updateAppearanceAction } from "@/app/platform/(console)/settings/appearance/actions";

const session: PlatformSession = {
  sessionId: "019ba263-00e2-7b41-9fc9-2a4b47b5e201",
  owner: { id: "019ba263-00e2-7b41-9fc9-2a4b47b5e202", username: "owner" },
};
const appearance = { theme: "dark", accent: "violet", width: "focused" } as const;
const input = { operation: "apply", scope: "personal", appearance } as const;
const state: AppearanceState = {
  ownerId: session.owner.id, personal: appearance, global: null, appearance,
  source: "personal", canManageGlobal: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue(session);
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "current-session-token" }) });
  mocks.validateSession.mockResolvedValue(session);
  mocks.headers.mockResolvedValue(new Headers({ origin: "https://platform.example.com", host: "platform.example.com", "sec-fetch-site": "same-origin" }));
  mocks.save.mockResolvedValue({ ok: true, state });
  mocks.load.mockResolvedValue(state);
});

describe("appearance Server Actions", () => {
  it("returns an expired-session message without redirecting or writing for unauthenticated users", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect(await updateAppearanceAction(input)).toMatchObject({ ok: false, error: expect.stringContaining("session has expired") });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("uses only the authenticated server identity and invalidates the platform after a successful save", async () => {
    expect(await updateAppearanceAction(input)).toStrictEqual({ ok: true, state });
    expect(mocks.save).toHaveBeenCalledWith(session, input, "unknown");
    expect(mocks.revalidate).toHaveBeenCalledWith("/platform", "layout");
  });

  it("rejects a client-submitted target identity and unsupported values before a save", async () => {
    for (const malformed of [
      { ...input, ownerId: "someone-else" },
      { ...input, appearance: { theme: "unsupported", accent: "violet", width: "default" } },
      { ...input, appearance: { theme: "dark", accent: "invalid", width: "default" } },
      { ...input, appearance: { theme: "dark", accent: "violet", width: "unsupported" } },
      { ...input, appearance: { theme: "dark", accent: "violet" } },
      { ...input, scope: "everyone" }, { ...input, operation: "delete" }, null,
    ]) expect(await updateAppearanceAction(malformed as typeof input)).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    { origin: "https://attacker.example", host: "platform.example.com" },
    { host: "platform.example.com" },
    { origin: "null", host: "platform.example.com" },
    { origin: "https://platform.example.com", host: "platform.example.com", "sec-fetch-site": "cross-site" },
    { origin: "https://platform.example.com", host: "platform.example.com:444" },
  ])("rejects hostile or unverifiable origin headers %j", async (values) => {
    mocks.headers.mockResolvedValue(new Headers(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
    expect(await updateAppearanceAction(input)).toMatchObject({ ok: false, error: expect.stringContaining("could not be verified") });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects an old tab's expected account after switching accounts, without targeting by the submitted identity", async () => {
    expect(await updateAppearanceAction({ ...input, expectedOwnerId: "019ba263-00e2-7b41-9fc9-2a4b47b5e299" }))
      .toMatchObject({ ok: false, error: expect.stringContaining("account has changed") });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(await updateAppearanceAction({ ...input, expectedOwnerId: session.owner.id })).toMatchObject({ ok: true });
    expect(mocks.save).toHaveBeenCalledWith(session, { ...input, expectedOwnerId: session.owner.id }, "unknown");
  });

  it("returns only global/default state when refreshing after logout", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.cookies.mockResolvedValueOnce({ get: () => undefined });
    const anonymous: AppearanceState = {
      ownerId: null, personal: null, global: appearance, appearance,
      source: "global", canManageGlobal: false,
    };
    mocks.load.mockResolvedValueOnce(anonymous);
    expect(await refreshAppearanceAction()).toStrictEqual({ ok: true, state: anonymous });
    expect(mocks.load).toHaveBeenCalledWith(undefined);
    expect(mocks.validateSession).not.toHaveBeenCalled();
  });

  it("supports the existing reverse proxy forwarded host while still checking the request origin", async () => {
    mocks.headers.mockResolvedValue(new Headers({ origin: "https://platform.example.com", host: "app:3000", "x-forwarded-host": "platform.example.com" }));
    expect(await updateAppearanceAction(input)).toMatchObject({ ok: true });
  });

  it.each(["apply", "reset"])("returns server denial for unauthorized global %s without success invalidation", async (operation) => {
    mocks.save.mockResolvedValue({ ok: false, error: "You do not have permission to change appearance for all users." });
    const update = operation === "apply" ? { operation: "apply" as const, scope: "global" as const, appearance } : { operation: "reset" as const, scope: "global" as const };
    expect(await updateAppearanceAction(update)).toMatchObject({ ok: false, error: expect.stringContaining("permission") });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("reports write failure without a success result or cache invalidation", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.save.mockRejectedValueOnce(new Error("connection unavailable"));
    expect(await updateAppearanceAction(input)).toStrictEqual({ ok: false, error: "Appearance settings could not be saved. Please try again." });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("continues to report a committed save accurately if page invalidation fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.revalidate.mockImplementationOnce(() => { throw new Error("invalidation failure"); });
    expect(await updateAppearanceAction(input)).toStrictEqual({ ok: true, state });
    log.mockRestore();
  });

  it("refreshes only the authenticated owner's state and clears private appearance after disable", async () => {
    expect(await refreshAppearanceAction()).toStrictEqual({ ok: true, state });
    expect(mocks.load).toHaveBeenCalledWith(session.owner.id);
    expect(mocks.validateSession).toHaveBeenCalledWith("current-session-token", { touch: false });
    mocks.load.mockResolvedValueOnce({ ...state, ownerId: null, personal: null, canManageGlobal: false });
    expect(await refreshAppearanceAction()).toMatchObject({ ok: true, state: { ownerId: null, personal: null } });
  });

  it("reports read failure safely", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.load.mockRejectedValueOnce(new Error("connection unavailable"));
    expect(await refreshAppearanceAction()).toStrictEqual({ ok: false, error: "Appearance settings could not be loaded. Please try again." });
    log.mockRestore();
  });
});

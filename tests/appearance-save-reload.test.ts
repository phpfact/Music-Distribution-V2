import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE, type Appearance, type AppearanceState } from "@/lib/appearance/preferences";
import {
  createAppearanceSaveController,
  installUnsavedAppearanceGuard,
  type AppearanceSaveRequest,
} from "@/app/platform/(console)/settings/appearance/save-and-reload";
import {
  appearanceFeedback,
  appearanceNoticeHref,
  clearAppearanceNoticeHref,
} from "@/app/platform/(console)/settings/appearance/feedback";

const OWNER = "019ba263-00e2-7b41-9fc9-2a4b47b5e202";
const OTHER_OWNER = "019ba263-00e2-7b41-9fc9-2a4b47b5e299";
const SELECTED: Appearance = { theme: "dark", accent: "violet", width: "full" };
const PERSONAL_APPLY: AppearanceSaveRequest = {
  operation: "apply", scope: "personal", expectedOwnerId: OWNER, appearance: SELECTED,
};
const SAVED: AppearanceState = {
  ownerId: OWNER,
  personal: SELECTED,
  global: null,
  appearance: SELECTED,
  source: "personal",
  canManageGlobal: true,
};

/**
 * Provide deterministic save, identity, feedback, and reload seams for UI behavior.
 * Input: none; individual tests control the mocked save result and account state.
 * Output: a controller and its observable dependency mocks.
 * Use case: verify success-only reloads without a browser or database writes.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
function harness() {
  const account = { ownerId: OWNER as string | null, mounted: true };
  const dependencies = {
    save: vi.fn<(input: AppearanceSaveRequest) => Promise<unknown>>().mockResolvedValue({ ok: true, state: SAVED }),
    currentOwnerId: () => account.ownerId,
    isMounted: () => account.mounted,
    onPending: vi.fn<(pending: boolean) => void>(),
    onError: vi.fn<(message: string) => void>(),
    onCommitted: vi.fn<(message: string) => void>(),
    prepareReload: vi.fn(),
    notifyTabs: vi.fn(),
    reload: vi.fn(),
  };
  return { account, dependencies, controller: createAppearanceSaveController(dependencies) };
}

describe("appearance save and single reload", () => {
  it("validates all selected fields before saving and never reloads an unsupported width", async () => {
    const { dependencies, controller } = harness();
    await controller.submit({ ...PERSONAL_APPLY, appearance: { ...SELECTED, width: "unsupported" } } as unknown as AppearanceSaveRequest);
    expect(dependencies.save).not.toHaveBeenCalled();
    expect(dependencies.onPending).not.toHaveBeenCalled();
    expect(dependencies.onError).toHaveBeenCalledWith("Choose a supported appearance and action.");
    expect(dependencies.reload).not.toHaveBeenCalled();
  });

  it("keeps the guard through navigation and ignores double submissions before and after one committed save", async () => {
    const { dependencies, controller } = harness();
    let complete!: (result: unknown) => void;
    dependencies.save.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const first = controller.submit(PERSONAL_APPLY);
    await controller.submit(PERSONAL_APPLY);
    expect(dependencies.save).toHaveBeenCalledTimes(1);
    expect(dependencies.reload).not.toHaveBeenCalled();
    complete({ ok: true, state: SAVED });
    await first;
    await controller.submit(PERSONAL_APPLY);
    expect(dependencies.save).toHaveBeenCalledTimes(1);
    expect(dependencies.reload).toHaveBeenCalledTimes(1);
    expect(dependencies.prepareReload).toHaveBeenCalledWith("appearance-personal-applied", OWNER);
    expect(dependencies.notifyTabs).toHaveBeenCalledTimes(1);
    expect(dependencies.onPending.mock.calls).toStrictEqual([[true]]);
    expect(controller.isPending()).toBe(true);
    expect(controller.hasCommitted()).toBe(true);
    expect(dependencies.onError).not.toHaveBeenCalled();
  });

  it("keeps the draft retryable on a denied save and reloads only the later successful attempt", async () => {
    const { dependencies, controller } = harness();
    dependencies.save.mockResolvedValueOnce({ ok: false, error: "Your session has expired." });
    await controller.submit(PERSONAL_APPLY);
    expect(dependencies.onError).toHaveBeenCalledWith("Your session has expired.");
    expect(dependencies.reload).not.toHaveBeenCalled();
    expect(controller.isPending()).toBe(false);
    expect(controller.hasCommitted()).toBe(false);
    expect(dependencies.onPending.mock.calls).toStrictEqual([[true], [false]]);
    await controller.submit(PERSONAL_APPLY);
    expect(dependencies.save).toHaveBeenNthCalledWith(2, PERSONAL_APPLY);
    expect(dependencies.reload).toHaveBeenCalledTimes(1);
  });

  it("does not notify or reload after a rejected save request", async () => {
    const { dependencies, controller } = harness();
    dependencies.save.mockRejectedValueOnce(new Error("offline"));
    await controller.submit(PERSONAL_APPLY);
    expect(dependencies.onError).toHaveBeenCalledWith(expect.stringContaining("couldn’t save"));
    expect(dependencies.reload).not.toHaveBeenCalled();
    expect(dependencies.prepareReload).not.toHaveBeenCalled();
    expect(dependencies.notifyTabs).not.toHaveBeenCalled();
    expect(dependencies.onCommitted).not.toHaveBeenCalled();
    expect(controller.isPending()).toBe(false);
  });

  it.each([
    null,
    undefined,
    { ok: "true", state: SAVED },
    { ok: true },
    { ok: true, state: { ...SAVED, ownerId: OTHER_OWNER } },
    { ok: true, state: { ...SAVED, appearance: { ...SELECTED, width: "invalid" } } },
    { ok: true, state: { ...SAVED, source: "global" } },
    { ok: true, state: { ...SAVED, canManageGlobal: "true" } },
    { ok: true, state: { ...SAVED, global: {} } },
  ])("rejects malformed or foreign success response %j without a reload", async (response) => {
    const { dependencies, controller } = harness();
    dependencies.save.mockResolvedValueOnce(response);
    await controller.submit(PERSONAL_APPLY);
    expect(dependencies.onError).toHaveBeenCalledWith(expect.stringContaining("response could not be verified"));
    expect(dependencies.reload).not.toHaveBeenCalled();
    expect(dependencies.notifyTabs).not.toHaveBeenCalled();
    expect(controller.isPending()).toBe(false);
  });

  it("rejects a coherent global result that leaves the initiating override at the former appearance", async () => {
    const { dependencies, controller } = harness();
    const selected = { ...DEFAULT_APPEARANCE, width: "focused" as const };
    // This is the old bug: the default is saved, but the actor still resolves
    // their conflicting personal override. It must not be reported as success.
    dependencies.save.mockResolvedValueOnce({ ok: true, state: { ...SAVED, global: selected } });
    await controller.submit({ ...PERSONAL_APPLY, scope: "global", appearance: selected });
    expect(dependencies.reload).not.toHaveBeenCalled();
    expect(dependencies.onCommitted).not.toHaveBeenCalled();
    expect(dependencies.onError).toHaveBeenCalledWith(expect.stringContaining("response could not be verified"));
  });

  it("rejects a coherent personal apply response whose width does not match the confirmed selection", async () => {
    const { dependencies, controller } = harness();
    const wrongWidth = { ...SELECTED, width: "focused" as const };
    dependencies.save.mockResolvedValueOnce({ ok: true, state: { ...SAVED, personal: wrongWidth, appearance: wrongWidth } });
    await controller.submit(PERSONAL_APPLY);
    expect(dependencies.reload).not.toHaveBeenCalled();
    expect(dependencies.onCommitted).not.toHaveBeenCalled();
  });

  it.each([true, false])("accepts global apply with initiating override present: %s", async (hasOverride) => {
    const { dependencies, controller } = harness();
    dependencies.save.mockResolvedValueOnce({ ok: true, state: {
      ...SAVED, personal: hasOverride ? SELECTED : null, global: SELECTED, source: hasOverride ? "personal" : "global",
    } });
    await controller.submit({ ...PERSONAL_APPLY, scope: "global" });
    expect(dependencies.prepareReload).toHaveBeenCalledWith("appearance-global-applied", OWNER);
    expect(dependencies.onCommitted).toHaveBeenCalledWith(expect.stringContaining("Other accounts’ personal overrides are preserved"));
    expect(dependencies.reload).toHaveBeenCalledTimes(1);
  });

  it("validates a personal reset removed its override before reloading", async () => {
    const { dependencies, controller } = harness();
    const reset: AppearanceSaveRequest = { operation: "reset", scope: "personal", expectedOwnerId: OWNER };
    await controller.submit(reset);
    expect(dependencies.reload).not.toHaveBeenCalled();
    dependencies.save.mockResolvedValueOnce({ ok: true, state: {
      ...SAVED, personal: null, global: SELECTED, appearance: SELECTED, source: "global",
    } });
    await controller.submit(reset);
    expect(dependencies.prepareReload).toHaveBeenCalledWith("appearance-personal-reset", OWNER);
    expect(dependencies.reload).toHaveBeenCalledTimes(1);
  });

  it("validates a global reset while preserving the actor's personal appearance", async () => {
    const { dependencies, controller } = harness();
    const reset: AppearanceSaveRequest = { operation: "reset", scope: "global", expectedOwnerId: OWNER };
    dependencies.save.mockResolvedValueOnce({ ok: true, state: { ...SAVED, global: SELECTED } });
    await controller.submit(reset);
    expect(dependencies.reload).not.toHaveBeenCalled();
    dependencies.save.mockResolvedValueOnce({ ok: true, state: { ...SAVED, global: DEFAULT_APPEARANCE } });
    await controller.submit(reset);
    expect(dependencies.prepareReload).toHaveBeenCalledWith("appearance-global-reset", OWNER);
    expect(dependencies.reload).toHaveBeenCalledTimes(1);
  });

  it("ignores completion after an account switch instead of reloading or showing old-account success", async () => {
    const { account, dependencies, controller } = harness();
    let complete!: (result: unknown) => void;
    dependencies.save.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const pending = controller.submit(PERSONAL_APPLY);
    account.ownerId = OTHER_OWNER;
    complete({ ok: true, state: SAVED });
    await pending;
    expect(dependencies.onError).toHaveBeenCalledWith(expect.stringContaining("account has changed"));
    expect(dependencies.onCommitted).not.toHaveBeenCalled();
    expect(dependencies.reload).not.toHaveBeenCalled();
  });

  it("ignores completion after unmount without calling state updates or reload", async () => {
    const { account, dependencies, controller } = harness();
    let complete!: (result: unknown) => void;
    dependencies.save.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const pending = controller.submit(PERSONAL_APPLY);
    account.mounted = false;
    complete({ ok: true, state: SAVED });
    await pending;
    expect(dependencies.onPending.mock.calls).toStrictEqual([[true]]);
    expect(dependencies.onCommitted).not.toHaveBeenCalled();
    expect(dependencies.onError).not.toHaveBeenCalled();
    expect(dependencies.reload).not.toHaveBeenCalled();
  });

  it("still reloads once and reports a committed save if feedback or tab notification fails", async () => {
    const { dependencies, controller } = harness();
    dependencies.prepareReload.mockImplementationOnce(() => { throw new Error("history unavailable"); });
    dependencies.notifyTabs.mockImplementationOnce(() => { throw new Error("channel unavailable"); });
    await controller.submit(PERSONAL_APPLY);
    expect(dependencies.onCommitted).toHaveBeenCalledWith(expect.stringContaining("appearance is saved"));
    expect(dependencies.onError).not.toHaveBeenCalled();
    expect(dependencies.reload).toHaveBeenCalledTimes(1);
    expect(controller.hasCommitted()).toBe(true);
  });

  it("keeps the commit guard and reports navigation failure accurately if the browser cannot reload", async () => {
    const { dependencies, controller } = harness();
    dependencies.reload.mockImplementationOnce(() => { throw new Error("reload unavailable"); });
    await controller.submit(PERSONAL_APPLY);
    await controller.submit(PERSONAL_APPLY);
    expect(dependencies.save).toHaveBeenCalledTimes(1);
    expect(dependencies.reload).toHaveBeenCalledTimes(1);
    expect(dependencies.onError).toHaveBeenCalledWith(expect.stringContaining("appearance was saved"));
    expect(controller.hasCommitted()).toBe(true);
  });
});

describe("account-bound appearance feedback", () => {
  it("shows only a known notice bound to the server-authenticated owner", () => {
    expect(appearanceFeedback({ notice: "appearance-global-applied", noticeOwner: OWNER }, OWNER))
      .toMatchObject({ ownerId: OWNER, message: expect.stringContaining("Other accounts’ personal overrides") });
    expect(appearanceFeedback({ notice: "appearance-global-applied", noticeOwner: OWNER }, OTHER_OWNER)).toBeNull();
  });

  it.each([
    {},
    { notice: "appearance-personal-applied" },
    { notice: "<script>", noticeOwner: OWNER },
    { notice: "__proto__", noticeOwner: OWNER },
    { notice: "appearance-personal-applied", noticeOwner: "not-an-owner" },
    { notice: ["appearance-personal-applied"], noticeOwner: OWNER },
    { notice: "appearance-personal-applied", noticeOwner: [OWNER, OTHER_OWNER] },
  ])("ignores malformed or unbound feedback %j", (params) => {
    expect(appearanceFeedback(params, OWNER)).toBeNull();
  });

  it("carries the notice across reload and consumes only its parameters without losing query or hash state", () => {
    const href = appearanceNoticeHref("https://platform.example.com/platform/settings/appearance?tab=preview#width", "appearance-personal-applied", OWNER);
    const url = new URL(href, "https://platform.example.com");
    expect(url.searchParams.get("notice")).toBe("appearance-personal-applied");
    expect(url.searchParams.get("noticeOwner")).toBe(OWNER);
    expect(url.searchParams.get("tab")).toBe("preview");
    expect(url.hash).toBe("#width");
    expect(clearAppearanceNoticeHref(url.href)).toBe("/platform/settings/appearance?tab=preview#width");
  });
});

describe("dirty appearance unload protection", () => {
  it("warns for a dirty draft, bypasses after a committed save, and cleans up on unmount", () => {
    const target = new EventTarget();
    let committed = false;
    const cleanup = installUnsavedAppearanceGuard(target as unknown as Pick<Window, "addEventListener" | "removeEventListener">, () => committed);
    const dirtyUnload = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    committed = true;
    const savedUnload = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(savedUnload);
    expect(savedUnload.defaultPrevented).toBe(false);
    committed = false;
    cleanup();
    const unmountedUnload = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(unmountedUnload);
    expect(unmountedUnload.defaultPrevented).toBe(false);
  });
});

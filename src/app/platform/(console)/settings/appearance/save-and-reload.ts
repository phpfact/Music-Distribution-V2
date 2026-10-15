import {
  DEFAULT_APPEARANCE,
  parseAppearance,
  parseAppearanceUpdate,
  resolveAppearance,
  type AppearanceState,
  type AppearanceUpdateInput,
} from "@/lib/appearance/preferences";
import { APPEARANCE_NOTICES, type AppearanceNoticeCode } from "./feedback";

export type AppearanceSaveRequest = AppearanceUpdateInput & { expectedOwnerId: string };

type SaveDependencies = {
  save: (input: AppearanceSaveRequest) => Promise<unknown>;
  currentOwnerId: () => string | null;
  isMounted: () => boolean;
  onPending: (pending: boolean) => void;
  onError: (message: string) => void;
  onCommitted: (message: string) => void;
  prepareReload: (code: AppearanceNoticeCode, ownerId: string) => void;
  notifyTabs: () => void;
  reload: () => void;
};

export type AppearanceSaveController = {
  submit: (input: AppearanceSaveRequest) => Promise<void>;
  isPending: () => boolean;
  hasCommitted: () => boolean;
};

const SAVE_ERROR     = "We couldn’t save your appearance. Your selection is unchanged. Please try again.";
const RESPONSE_ERROR = "The save response could not be verified. Your selection is unchanged. Refresh the page before trying again.";
const ACCOUNT_ERROR  = "Your account has changed. Refresh the page before saving appearance settings.";

/**
 * Compare all persisted appearance fields without discarding content width.
 * Input: two validated complete appearances.
 * Output: true when every selected preference matches.
 * Use case: verify the confirmed operation's actual database result.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export function sameAppearance(a: AppearanceState["appearance"], b: AppearanceState["appearance"]): boolean {
  return a.theme === b.theme && a.accent === b.accent && a.width === b.width;
}

/**
 * Check that a coherent result also fulfills the specific confirmed operation.
 * Input: a validated saved state and the parsed Apply/Default request.
 * Output: true only for the expected personal or global save/reset behavior.
 * Use case: reject the former global-apply bug or a mismatched operation response.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
function savedOperationMatches(state: AppearanceState, input: AppearanceUpdateInput): boolean {
  if (input.operation === "reset") {
    return input.scope === "personal"
      ? state.personal === null
      : state.global !== null && sameAppearance(state.global, DEFAULT_APPEARANCE);
  }
  if (!sameAppearance(state.appearance, input.appearance)) return false;
  if (input.scope === "personal") {
    return state.personal !== null && sameAppearance(state.personal, input.appearance);
  }
  return state.global !== null && sameAppearance(state.global, input.appearance)
    && (state.personal === null || sameAppearance(state.personal, input.appearance));
}

/**
 * Verify that a successful response is complete, valid, and belongs to this account.
 * Input: an untrusted result state and the expected authenticated owner ID.
 * Output: a coherent appearance state, or null for unsupported or inconsistent data.
 * Use case: never reload or claim success based on a malformed server response.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export function validSavedAppearanceState(value: unknown, ownerId: string): AppearanceState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (state.ownerId !== ownerId || typeof state.canManageGlobal !== "boolean") return null;
  const appearance = parseAppearance(state.appearance);
  const personal   = state.personal === null ? null : parseAppearance(state.personal);
  const global     = state.global === null ? null : parseAppearance(state.global);
  if (!appearance || (state.personal !== null && !personal) || (state.global !== null && !global)) return null;
  const resolved = resolveAppearance(personal, global);
  if (state.source !== resolved.source) return null;
  if (!sameAppearance(appearance, resolved.appearance)) return null;
  return {
    ownerId,
    appearance,
    personal,
    global,
    source: resolved.source,
    canManageGlobal: state.canManageGlobal,
  };
}

/**
 * Coordinate validation, one save, and exactly one successful-result reload.
 * Input: injected save, identity, UI feedback, and navigation dependencies.
 * Output: a controller that blocks duplicates and keeps its guard after a commit.
 * Use case: failures preserve the draft; confirmed commits bypass unload warnings.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export function createAppearanceSaveController(dependencies: SaveDependencies): AppearanceSaveController {
  let pending   = false;
  let committed = false;

  /**
   * Validate and save one confirmed operation, then perform its single reload.
   * Input: the confirmed appearance operation and expected account identity.
   * Output: completion with dependency callbacks; no duplicate network requests.
   * Use case: Apply/Default confirmations, including failed or stale responses.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-14
   */
  async function submit(input: AppearanceSaveRequest): Promise<void> {
    if (pending || committed || !dependencies.isMounted()) return;
    const validated = parseAppearanceUpdate(input);
    if (!validated || !validated.expectedOwnerId) {
      dependencies.onError("Choose a supported appearance and action.");
      return;
    }
    const ownerId = validated.expectedOwnerId;
    if (ownerId !== dependencies.currentOwnerId()) {
      dependencies.onError(ACCOUNT_ERROR);
      return;
    }

    pending = true;
    dependencies.onPending(true);
    try {
      const result = await dependencies.save({ ...validated, expectedOwnerId: ownerId });
      if (!dependencies.isMounted()) return;
      if (ownerId !== dependencies.currentOwnerId()) {
        dependencies.onError(ACCOUNT_ERROR);
        return;
      }
      if (typeof result !== "object" || result === null || Array.isArray(result)) {
        dependencies.onError(RESPONSE_ERROR);
        return;
      }
      const response = result as Record<string, unknown>;
      if (response.ok === false) {
        dependencies.onError(typeof response.error === "string" && response.error.trim() ? response.error : SAVE_ERROR);
        return;
      }
      const savedState = validSavedAppearanceState(response.state, ownerId);
      if (response.ok !== true || !savedState || !savedOperationMatches(savedState, validated)) {
        dependencies.onError(RESPONSE_ERROR);
        return;
      }

      // Commit is confirmed before navigation. Keep the guard set even if the
      // browser delays loading, and let beforeunload skip its dirty warning.
      committed = true;
      const code = `appearance-${validated.scope === "personal" ? "personal" : "global"}-${validated.operation === "apply" ? "applied" : "reset"}` as AppearanceNoticeCode;
      try { dependencies.onCommitted(APPEARANCE_NOTICES[code]); } catch { /* Navigation still follows a committed result. */ }
      try { dependencies.prepareReload(code, ownerId); } catch { /* Feedback cannot undo a committed save. */ }
      try { dependencies.notifyTabs(); } catch { /* Sibling tabs also refresh on focus. */ }
      try {
        dependencies.reload();
      } catch {
        dependencies.onError("Your appearance was saved, but the page could not reload. Refresh the page to continue.");
      }
    } catch {
      if (dependencies.isMounted()) {
        dependencies.onError(committed
          ? "Your appearance was saved, but the page could not reload. Refresh the page to continue."
          : SAVE_ERROR);
      }
    } finally {
      // Only a failure unlocks the form. Successful navigation remains guarded.
      if (!committed) {
        pending = false;
        if (dependencies.isMounted()) dependencies.onPending(false);
      }
    }
  }

  return { submit, isPending: () => pending, hasCommitted: () => committed };
}

/**
 * Warn before a browser close/refresh only while the form has an unsaved draft.
 * Input: the window event surface and a live committed-result check.
 * Output: a cleanup function that removes the listener.
 * Use case: register only for dirty drafts; successful automatic reloads never prompt.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export function installUnsavedAppearanceGuard(target: Pick<Window, "addEventListener" | "removeEventListener">, hasCommitted: () => boolean): () => void {
  /**
   * Request the browser's native unsaved-changes warning until a save commits.
   * Input: the browser's cancellable beforeunload event.
   * Output: a cancellation request for unsaved changes, or no action after commit.
   * Use case: protect a dirty draft without blocking the required success reload.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-14
   */
  function beforeUnload(event: BeforeUnloadEvent) {
    if (hasCommitted()) return;
    event.preventDefault();
    event.returnValue = "";
  }
  target.addEventListener("beforeunload", beforeUnload);
  return () => target.removeEventListener("beforeunload", beforeUnload);
}

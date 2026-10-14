/**
 * Whitelisted, account-bound feedback carried across a successful reload.
 * Input: known save/reset codes and the authenticated owner identity.
 * Output: safe text and URLs containing no preference or session data.
 * Use case: show an accurate one-time success notice after a committed save.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export const APPEARANCE_NOTICES = {
  "appearance-personal-applied": "Your appearance is saved. Only your account was updated.",
  "appearance-global-applied": "The platform default and your appearance are saved. Other accounts’ personal overrides are preserved.",
  "appearance-personal-reset": "Your personal override was removed. You now use the platform default.",
  "appearance-global-reset": "The platform default was reset to Light, Emerald, and Default Width. All personal overrides are preserved.",
} as const;

export type AppearanceNoticeCode = keyof typeof APPEARANCE_NOTICES;
export type AppearanceFeedback = {
  code: AppearanceNoticeCode;
  ownerId: string;
  message: string;
};

type NoticeParams = Record<string, string | string[] | undefined>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Select a notice only after its owner matches the server-authenticated account.
 * Input: route query parameters and the authenticated owner ID.
 * Output: safe feedback, or null for missing, repeated, unknown, or foreign values.
 * Use case: prevent one account's success message appearing after an account switch.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export function appearanceFeedback(params: NoticeParams, authenticatedOwnerId: string): AppearanceFeedback | null {
  const code = params.notice;
  const ownerId = params.noticeOwner;
  if (typeof code !== "string" || !Object.hasOwn(APPEARANCE_NOTICES, code)) return null;
  if (typeof ownerId !== "string" || !UUID_PATTERN.test(ownerId)) return null;
  if (ownerId !== authenticatedOwnerId) return null;
  return {
    code: code as AppearanceNoticeCode,
    ownerId,
    message: APPEARANCE_NOTICES[code as AppearanceNoticeCode],
  };
}

/**
 * Add committed-result feedback while preserving unrelated query values and hashes.
 * Input: the current absolute URL, a whitelisted notice code, and its owner ID.
 * Output: a same-page relative URL suitable for history.replaceState.
 * Use case: carry feedback across the single successful-save reload.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export function appearanceNoticeHref(currentUrl: string, code: AppearanceNoticeCode, ownerId: string): string {
  if (!Object.hasOwn(APPEARANCE_NOTICES, code) || !UUID_PATTERN.test(ownerId)) {
    throw new Error("Invalid appearance feedback.");
  }
  const url = new URL(currentUrl);
  url.searchParams.set("notice", code);
  url.searchParams.set("noticeOwner", ownerId);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Consume feedback without navigating or removing unrelated route state.
 * Input: the current absolute URL after the server has read its feedback.
 * Output: the same page URL with only notice and noticeOwner removed.
 * Use case: make feedback one-time and discard stale notices for another account.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export function clearAppearanceNoticeHref(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete("notice");
  url.searchParams.delete("noticeOwner");
  return `${url.pathname}${url.search}${url.hash}`;
}

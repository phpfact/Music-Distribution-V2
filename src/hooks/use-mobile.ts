import { useSyncExternalStore } from "react";

/** Below this width the shadcn Sidebar becomes an off-canvas Sheet. */
const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY      = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Description: Subscribe to changes of the mobile media query.
 * Input: React's change callback.
 * Output: An unsubscribe function.
 * Use case: useIsMobile (useSyncExternalStore).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/**
 * Description: Tell whether the viewport is narrower than the mobile breakpoint.
 * Input: None.
 * Output: True below 768px; false on the server (the desktop sidebar is hidden
 *   by CSS below md anyway, so the first paint is correct either way).
 * Use case: The shadcn Sidebar (desktop panel vs mobile Sheet) and menus that
 *   open on a different side on phones. Same contract as shadcn's useIsMobile,
 *   written on useSyncExternalStore instead of an effect.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/** How often the privileges are re-checked while the page is visible. */
const CHECK_INTERVAL_MS = 30_000;

/** What the area's fingerprint Server Action returns (and nothing else). */
export type PermissionCheckResult = { signedIn: boolean; fingerprint: string | null };

type PermissionSyncProps = {
  /** The fingerprint the server rendered the current page tree with. */
  initialFingerprint: string;
  /** The area's fingerprint Server Action (validates the session with touch: false). */
  check: () => Promise<PermissionCheckResult>;
};

/**
 * Description: Keep the rendered navigation and pages in step with the signed-in
 *   person's CURRENT privileges (.vibe/memory/role-privilege-management.md,
 *   "UI Behavior").
 * Input: The fingerprint the layout rendered with and the area's check action.
 * Output: Renders nothing. Calls `check` every 30 seconds while the document is
 *   visible, when the window gains focus or becomes visible again, and after
 *   every route change. When the person is signed out or the fingerprint
 *   differs, the server components are refreshed (router.refresh(): no full
 *   reload, entered form values stay). Calls never overlap; network or server
 *   errors are ignored silently (the next check tries again). The check does
 *   not extend the session's idle timeout (the action validates with touch: false).
 * Use case: Rendered once by the Platform console, tenant and customer layouts.
 *   The server still checks every page and action itself; this only refreshes
 *   what is shown (e.g. a revoked menu item disappears without a reload).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function PermissionSync({ initialFingerprint, check }: PermissionSyncProps) {
  const router   = useRouter();
  const pathname = usePathname();
  // The fingerprint the visible page tree was rendered with (updated after a refresh).
  const current  = useRef(initialFingerprint);
  // Synchronous guard: never two checks in flight at the same time.
  const running  = useRef(false);

  // A server refresh re-renders the layout with the new fingerprint: adopt it.
  useEffect(() => {
    current.current = initialFingerprint;
  }, [initialFingerprint]);

  /**
   * Description: Ask the server for the current fingerprint and refresh on a change.
   * Input: None (uses the check action and the remembered fingerprint).
   * Output: Nothing; calls router.refresh() when signed out or changed.
   * Use case: The interval, focus/visibility events and route changes below.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  const runCheck = useCallback(async () => {
    // Step 1: one check at a time, and only for a page the person can see.
    if (running.current || document.visibilityState !== "visible") return;
    running.current = true;
    try {
      // Step 2: the server's answer (session validated without touching the idle timer).
      const result = await check();
      // Step 3: signed out or privileges changed → re-render the server components.
      if (!result.signedIn || result.fingerprint !== current.current) {
        // Remember what was seen, so one change triggers exactly one refresh.
        current.current = result.fingerprint ?? "";
        router.refresh();
      }
    } catch {
      // Silent by design: offline or a server hiccup; the next check retries.
    } finally {
      running.current = false;
    }
  }, [check, router]);

  // Every route change (layouts do not re-render on client navigation).
  useEffect(() => {
    void runCheck();
  }, [pathname, runCheck]);

  // The 30-second interval plus focus and visibility changes.
  useEffect(() => {
    /**
     * Description: Re-check when the tab becomes visible again.
     * Input: None (reads document.visibilityState).
     * Output: A check when visible.
     * Use case: visibilitychange listener.
     * Author: Mr. Sachin Sharma
     * Created: 2026-10-16
     * Last modified: 2026-10-16
     */
    function onVisibilityChange() {
      if (document.visibilityState === "visible") void runCheck();
    }

    /**
     * Description: Re-check when the window gains focus.
     * Input: None.
     * Output: A check.
     * Use case: focus listener.
     * Author: Mr. Sachin Sharma
     * Created: 2026-10-16
     * Last modified: 2026-10-16
     */
    function onFocus() {
      void runCheck();
    }

    // runCheck itself skips hidden documents, so the interval costs nothing in a background tab.
    const timer = window.setInterval(() => void runCheck(), CHECK_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [runCheck]);

  return null;
}

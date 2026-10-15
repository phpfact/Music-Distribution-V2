"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type AutoRefreshProps = {
  /** Polls only while true; the page passes false once setup is over. */
  active: boolean;
  intervalMs?: number;
};

/**
 * Description: Refresh the server-rendered details page while setup runs.
 * Input: Whether polling is active and the interval (default 2 s).
 * Output: Nothing visible. Every interval (and when the tab is shown again) the
 *   server data is refreshed without a page reload; a hidden tab is not polled.
 * Use case: The details page while setup is pending or provisioning.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function AutoRefresh({ active, intervalMs = 2000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    /**
     * Description: Refresh the page's server data when the tab is visible.
     * Input: None.
     * Output: A router refresh, or nothing for a hidden tab.
     * Use case: AutoRefresh's interval and visibility listener.
     * Author: Mr. Sachin Sharma
     * Created: 2026-10-14
     * Last modified: 2026-10-15
     */
    function refreshIfVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    const timer = setInterval(refreshIfVisible, intervalMs);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [active, intervalMs, router]);

  return null;
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type AutoRefreshProps = {
  /** Polls only while true; the page passes false once setup is over. */
  active: boolean;
  intervalMs?: number;
};

/**
 * Re-renders the server page every few seconds while setup runs, so its
 * progress appears without a reload. A hidden tab is not polled; it catches
 * up as soon as it is shown again. Stops on unmount and when `active` ends.
 */
export function AutoRefresh({ active, intervalMs = 2000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
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

"use client";

import { useEffect } from "react";

/**
 * Description: Re-check the session when the browser restores a console page from its back/forward cache.
 * Input: None.
 * Output: Renders nothing. When a page is shown from the back/forward cache
 *   (`pageshow` with `persisted`), it reloads the page, so the server checks
 *   the session again and sends a signed-out visitor to the login page.
 * Use case: CLAUDE.md "Auth": after logout the Back button must never show a
 *   protected page. Console pages are dynamic (not stored in the HTTP cache)
 *   and logout clears the router cache; this covers the browser's own page
 *   snapshot, which some browsers keep even for such pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function AuthPageGuard() {
  useEffect(() => {
    /**
     * Description: Reload a page that was restored from the back/forward cache.
     * Input: The pageshow event.
     * Output: A reload when `event.persisted` is true; nothing otherwise.
     * Use case: Listener registered by AuthPageGuard.
     * Author: Mr. Sachin Sharma
     * Created: 2026-10-15
     * Last modified: 2026-10-15
     */
    function onPageShow(event: PageTransitionEvent) {
      // persisted: the page came from the back/forward cache, not the server.
      if (event.persisted) window.location.reload();
    }

    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return null;
}

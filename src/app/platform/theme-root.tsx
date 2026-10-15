"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ACCENT_OPTIONS, WIDTH_OPTIONS, type AppearanceState } from "@/lib/appearance/preferences";
import { refreshAppearanceAction } from "./(console)/settings/appearance/actions";
import { ThemePortalProvider } from "@/components/theme-portal";
import { TooltipProvider } from "@/components/ui/tooltip";

type ThemeContextValue = {
  state: AppearanceState;
  captureVersion: () => number;
  acceptState: (state: AppearanceState, version: number) => boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
// The BroadcastChannel name other tabs listen on for "a preference was saved".
const REFRESH_EVENT = "platform-appearance-saved";
// Background refresh interval while the tab is visible.
const REFRESH_INTERVAL_MS = 60_000;
// Tooltips open after this delay (one value for the whole console).
const TOOLTIP_DELAY_MS = 400;

/**
 * Description: Tell other tabs that an appearance preference was saved.
 * Input: None.
 * Output: A "refresh" message on the BroadcastChannel (no identity or
 *   preference is put in browser storage); nothing where BroadcastChannel is missing.
 * Use case: The save controller after a confirmed save.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function notifyAppearanceSaved() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(REFRESH_EVENT);
  channel.postMessage("refresh");
  channel.close();
}

/**
 * Description: Render authenticated database appearance, including content width, on first paint.
 * Input: Request-resolved appearance state and platform page children.
 * Output: A themed provider and CSS variables consumed by the console layout.
 * Use case: Preserve appearance through reloads, navigation, and account switches.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function ThemeRoot({ initialState, children }: { initialState: AppearanceState; children: ReactNode }) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState(initialState);
  const [previousInitial, setPreviousInitial] = useState(initialState);
  // Increments on every accepted state, so an older request's answer is ignored.
  const requestVersion = useRef(0);
  const stateRef       = useRef(state);
  const router         = useRouter();

  // A cookie-changing Server Action rerenders this layout. Reset during render
  // so an account switch never paints the preceding account's preference.
  if (initialState !== previousInitial) {
    setPreviousInitial(initialState);
    setState(initialState);
  }

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * Description: Read the current request version before an appearance request starts.
   * Input: None.
   * Output: The version number.
   * Use case: The save controller, to detect answers that arrive out of order.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  const captureVersion = useCallback(() => requestVersion.current, []);

  /**
   * Description: Accept a saved appearance state when it is still current.
   * Input: The new state and the version captured when its request started.
   * Output: True when accepted; false (and a server refresh) when the account
   *   changed or a newer request has already been answered.
   * Use case: The save controller after a confirmed save.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  const acceptState = useCallback(
    (next: AppearanceState, version: number) => {
      if (next.ownerId !== stateRef.current.ownerId || version !== requestVersion.current) {
        router.refresh();
        return false;
      }
      requestVersion.current += 1;
      stateRef.current = next;
      setState(next);
      return true;
    },
    [router],
  );

  // Background refresh: another tab's save, focus, visibility and a slow interval.
  useEffect(() => {
    let stopped  = false;
    let inFlight = false;

    /**
     * Description: Re-read the saved appearance from the server while the tab is visible.
     * Input: None.
     * Output: The newest state (and a router refresh when the account changed);
     *   a failed request changes nothing.
     * Use case: Messages from other tabs, window focus, visibility changes, the interval.
     * Author: Mr. Sachin Sharma
     * Created: 2026-10-14
     * Last modified: 2026-10-15
     */
    async function refresh() {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      const version = requestVersion.current;
      try {
        const result = await refreshAppearanceAction();
        if (stopped || version !== requestVersion.current) return;
        if (result.ok) {
          const identityChanged = result.state.ownerId !== stateRef.current.ownerId;
          requestVersion.current += 1;
          stateRef.current = result.state;
          setState(result.state);
          if (identityChanged) router.refresh();
        }
      } catch {
        // Background network failure does not pretend a save happened.
      } finally {
        inFlight = false;
      }
    }

    /**
     * Description: Start a refresh from an event without awaiting it.
     * Input: None.
     * Output: A refresh in the background.
     * Use case: Focus, visibility, BroadcastChannel and interval listeners.
     * Author: Mr. Sachin Sharma
     * Created: 2026-10-14
     * Last modified: 2026-10-15
     */
    function onVisible() {
      void refresh();
    }

    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(REFRESH_EVENT);
    if (channel) channel.onmessage = onVisible;
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(onVisible, REFRESH_INTERVAL_MS);

    return () => {
      stopped = true;
      channel?.close();
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, initialState]);

  const value = useMemo(() => ({ state, acceptState, captureVersion }), [state, acceptState, captureVersion]);
  // The selected presets (falling back to the first, the defaults, for unknown values).
  const accent = ACCENT_OPTIONS.find((option) => option.value === state.appearance.accent) ?? ACCENT_OPTIONS[0];
  const width  = WIDTH_OPTIONS.find((option) => option.value === state.appearance.width) ?? WIDTH_OPTIONS[0];
  const themeStyle = {
    "--accent-light": accent.light,
    "--accent-dark": accent.dark,
    "--platform-content-max-width": width.maxWidth,
  } as CSSProperties;

  return (
    <ThemeContext.Provider value={value}>
      {/* Keep width and accent presets centralized for the server-rendered layout. */}
      <div
        ref={setPortalContainer}
        data-appearance-source={state.source}
        data-accent={state.appearance.accent}
        data-content-width={state.appearance.width}
        style={themeStyle}
        className={`${state.appearance.theme} platform-theme min-h-dvh bg-canvas text-fg`}
      >
        {/* Portals inherit these same variables; no competing theme state. */}
        <ThemePortalProvider container={portalContainer}>
          <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>{children}</TooltipProvider>
        </ThemePortalProvider>
      </div>
    </ThemeContext.Provider>
  );
}

/**
 * Description: Read the platform appearance context.
 * Input: None (must be called inside ThemeRoot).
 * Output: The current appearance state and the save helpers; throws outside ThemeRoot.
 * Use case: Appearance settings and the theme toggle.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside the platform ThemeRoot.");
  return context;
}

/**
 * Description: Subscribe to the operating system's light/dark preference.
 * Input: React's change callback.
 * Output: An unsubscribe function.
 * Use case: useSystemDark (useSyncExternalStore).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function subscribeSystemTheme(callback: () => void) {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/**
 * Description: Tell whether the operating system currently prefers dark mode.
 * Input: None.
 * Output: True for dark; false on the server (CSS handles System before hydration).
 * Use case: Labels and icons that depend on the resolved System theme.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function useSystemDark() {
  return useSyncExternalStore(
    subscribeSystemTheme,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
}

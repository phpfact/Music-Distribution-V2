"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ACCENT_OPTIONS, type AppearanceState } from "@/lib/appearance/preferences";
import { refreshAppearanceAction } from "./(console)/settings/appearance/actions";

type ThemeContextValue = {
  state: AppearanceState;
  captureVersion: () => number;
  acceptState: (state: AppearanceState, version: number) => boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const REFRESH_EVENT = "platform-appearance-saved";

/** Notify sibling tabs without putting identities or preferences in browser storage. */
export function notifyAppearanceSaved() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(REFRESH_EVENT);
  channel.postMessage("refresh");
  channel.close();
}

/** The database result is also the first paint: no shared theme cookie or local cache. */
export function ThemeRoot({ initialState, children }: { initialState: AppearanceState; children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const [previousInitial, setPreviousInitial] = useState(initialState);
  const requestVersion = useRef(0);
  const stateRef = useRef(state);
  const router = useRouter();

  // A cookie-changing Server Action rerenders this layout. Reset during render
  // so an account switch never paints the preceding account's preference.
  if (initialState !== previousInitial) {
    setPreviousInitial(initialState);
    setState(initialState);
  }

  useEffect(() => { stateRef.current = state; }, [state]);

  const captureVersion = useCallback(() => requestVersion.current, []);

  const acceptState = useCallback((next: AppearanceState, version: number) => {
    if (next.ownerId !== stateRef.current.ownerId || version !== requestVersion.current) {
      router.refresh();
      return false;
    }
    requestVersion.current += 1;
    stateRef.current = next;
    setState(next);
    return true;
  }, [router]);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
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
      } finally { inFlight = false; }
    }
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(REFRESH_EVENT);
    if (channel) channel.onmessage = () => { void refresh(); };
    const onVisible = () => { void refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(onVisible, 60_000);
    return () => {
      stopped = true;
      channel?.close();
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, initialState]);

  const value = useMemo(() => ({ state, acceptState, captureVersion }), [state, acceptState, captureVersion]);
  const accent = ACCENT_OPTIONS.find((option) => option.value === state.appearance.accent) ?? ACCENT_OPTIONS[0];
  return (
    <ThemeContext.Provider value={value}>
      <div data-appearance-source={state.source} data-accent={state.appearance.accent}
        style={{ "--accent-light": accent.light, "--accent-dark": accent.dark } as CSSProperties}
        className={`${state.appearance.theme} platform-theme min-h-dvh bg-canvas text-fg`}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside the platform ThemeRoot.");
  return context;
}

function subscribeSystemTheme(callback: () => void) {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/** CSS handles System before hydration; this hook supports labels and previews. */
export function useSystemDark() {
  return useSyncExternalStore(subscribeSystemTheme,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches, () => false);
}

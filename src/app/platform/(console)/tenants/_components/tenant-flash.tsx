"use client";

import { createContext, use, useState, type ReactNode } from "react";
import { Notice } from "../../_components/notice";

type TenantFlash = {
  show: (message: string) => void;
};

const TenantFlashContext = createContext<TenantFlash | null>(null);
const MessageContext = createContext<{ message: string | null; clear: () => void } | null>(null);

/** Lets an action anywhere on the page report its success in one place. */
export function useTenantFlash(): TenantFlash {
  const value = use(TenantFlashContext);
  // Unreachable while every tenant screen with actions renders the provider.
  if (!value) throw new Error("useTenantFlash outside TenantFlashProvider");
  return value;
}

/** Holds the latest success message of a tenant page, shown by `<TenantFlashNotice>`. */
export function TenantFlashProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <TenantFlashContext value={{ show: setMessage }}>
      <MessageContext value={{ message, clear: () => setMessage(null) }}>{children}</MessageContext>
    </TenantFlashContext>
  );
}

/**
 * Where the success message appears. The live region is always there, so the
 * message is announced when it is added, not only seen.
 */
export function TenantFlashNotice() {
  const value = use(MessageContext);
  const message = value?.message ?? null;

  return (
    <div aria-live="polite" className="empty:hidden">
      {message ? (
        <Notice variant="success" onDismiss={value?.clear}>
          {message}
        </Notice>
      ) : null}
    </div>
  );
}

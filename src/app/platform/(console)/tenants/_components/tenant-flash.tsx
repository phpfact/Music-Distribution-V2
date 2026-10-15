"use client";

import { createContext, use, useState, type ReactNode } from "react";
import { Notice } from "../../_components/notice";

type TenantFlash = {
  show: (message: string) => void;
};

const TenantFlashContext = createContext<TenantFlash | null>(null);
const MessageContext     = createContext<{ message: string | null; clear: () => void } | null>(null);

/**
 * Description: Read the page's success-message reporter.
 * Input: None (must be inside TenantFlashProvider).
 * Output: show(message), which puts the message in the page's flash notice.
 * Use case: Lifecycle, credential and DNS actions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function useTenantFlash(): TenantFlash {
  const value = use(TenantFlashContext);
  // Unreachable while every tenant screen with actions renders the provider.
  if (!value) throw new Error("useTenantFlash outside TenantFlashProvider");
  return value;
}

/**
 * Description: Hold the latest success message of a tenant page.
 * Input: The page content.
 * Output: Providers for showing and reading/clearing the message.
 * Use case: Directory and details pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function TenantFlashProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <TenantFlashContext value={{ show: setMessage }}>
      <MessageContext value={{ message, clear: () => setMessage(null) }}>{children}</MessageContext>
    </TenantFlashContext>
  );
}

/**
 * Description: Show the page's success message.
 * Input: None.
 * Output: A dismissible success notice inside an always-present live region, so the
 *   message is announced when it is added.
 * Use case: Below the page header of the directory and details pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function TenantFlashNotice() {
  const value   = use(MessageContext);
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

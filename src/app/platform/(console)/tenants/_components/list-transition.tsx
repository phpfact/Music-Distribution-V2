"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useTransition, type ReactNode } from "react";

type ListTransition = {
  /** True while a filter change is loading the new results. */
  pending: boolean;
  /** Replaces the list URL (no new history entry, no scroll) inside the transition. */
  navigate: (href: string) => void;
};

const ListTransitionContext = createContext<ListTransition | null>(null);

export function useListTransition(): ListTransition {
  const value = use(ListTransitionContext);
  // Unreachable while both parts sit inside the provider on the list page.
  if (!value) throw new Error("useListTransition outside TenantListTransition");
  return value;
}

/**
 * Shares one transition between the toolbar, which starts it, and the
 * results, which dim while it runs: the server renders the results, so the
 * toolbar cannot reach them otherwise.
 */
export function TenantListTransition({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function navigate(href: string) {
    startTransition(() => router.replace(href, { scroll: false }));
  }

  return <ListTransitionContext value={{ pending, navigate }}>{children}</ListTransitionContext>;
}

/** The results of the list: busy (and dimmed) while new ones load. */
export function TenantListResults({ children }: { children: ReactNode }) {
  const { pending } = useListTransition();
  return (
    <div
      id="tenant-results"
      aria-busy={pending}
      className={`flex flex-col gap-4 transition-opacity ${pending ? "opacity-60" : ""}`}
    >
      {children}
    </div>
  );
}

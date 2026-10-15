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

/**
 * Description: Read the directory's shared filter transition.
 * Input: None (must be inside TenantListTransition).
 * Output: Whether new results are loading and the navigate function.
 * Use case: The toolbar and the results wrapper.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function useListTransition(): ListTransition {
  const value = use(ListTransitionContext);
  // Unreachable while both parts sit inside the provider on the list page.
  if (!value) throw new Error("useListTransition outside TenantListTransition");
  return value;
}

/**
 * Description: Share one transition between the toolbar and the results.
 * Input: The toolbar and results.
 * Output: A provider; the toolbar starts the transition, the results dim while it runs.
 * Use case: The tenant directory card.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function TenantListTransition({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  /**
   * Description: Replace the directory URL inside the transition.
   * Input: The new list URL.
   * Output: router.replace without a new history entry or scrolling.
   * Use case: Search, status filter and Clear filters.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function navigate(href: string) {
    startTransition(() => router.replace(href, { scroll: false }));
  }

  return <ListTransitionContext value={{ pending, navigate }}>{children}</ListTransitionContext>;
}

/**
 * Description: Wrap the directory results with a busy state.
 * Input: The results.
 * Output: A container with aria-busy and reduced opacity while new results load.
 * Use case: The tenant directory card.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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

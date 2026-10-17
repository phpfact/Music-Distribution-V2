import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/*
 * The generic console skeleton. It used to be `(console)/loading.tsx`, which
 * wrapped EVERY console page in one Suspense boundary; that made notFound()
 * on the role / Sub-Platform Owner `[id]` pages answer HTTP 200. It is now
 * rendered by the `loading.tsx` of the sections that have no skeleton of their
 * own (dashboard, settings, subscriptions, support), so they show exactly the
 * same loading state while the RBAC `[id]` routes stay outside any boundary
 * (.vibe/memory/role-privilege-management.md, "RBAC pages (all panels)").
 */

/**
 * Description: Announce console page loading with shared reduced-motion-aware skeletons.
 * Input: none; Next.js renders this while the content route is pending.
 * Output: summary Cards and content placeholders inside the existing shell.
 * Use case: retain navigation and show a consistent responsive loading state.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
export function ConsoleLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-8">
      <span className="sr-only">Loading page…</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index}>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-36 max-w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent><Skeleton className="h-52 w-full" /></CardContent>
      </Card>
    </div>
  );
}

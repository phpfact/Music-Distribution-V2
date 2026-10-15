import { Skeleton } from "@/components/ui/skeleton";

// Placeholder blocks shaped like the tenant details page (back link, header,
// the four cards and the history) while it renders.
/**
 * Description: Show accessible skeletons matching the tenant detail view.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export default function TenantDetailsLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6">
      <Skeleton className="h-4 w-20 rounded bg-surface-2" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 shrink-0 rounded-full bg-surface-2" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-56 max-w-full rounded-lg bg-surface-2" />
            <Skeleton className="h-4 w-40 max-w-full rounded bg-surface-2" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-20 rounded-lg bg-surface-2" />
          <Skeleton className="h-10 w-28 rounded-lg bg-surface-2" />
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton
            key={index}
            className="h-56 rounded-xl border border-line bg-surface"
          />
        ))}
      </div>
      <Skeleton className="h-48 rounded-xl border border-line bg-surface" />
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

// Placeholder blocks shaped like the edit form (back link, header and the three
// numbered sections) while it renders, so the details page's skeleton one level
// up is not shown here.
/**
 * Description: Show skeletons shaped like the edit page while it loads.
 * Input: None (Next.js loading convention).
 * Output: An accessible "Loading" status with placeholder header and sections.
 * Use case: /platform/tenants/<id>/edit while it renders.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export default function EditTenantLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex w-full max-w-3xl flex-col gap-8"
    >
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28 rounded bg-surface-2" />
        <Skeleton className="mt-2 h-3 w-32 rounded bg-surface-2" />
        <Skeleton className="h-8 w-48 max-w-full rounded-lg bg-surface-2" />
        <Skeleton className="h-4 w-96 max-w-full rounded bg-surface-2" />
      </div>
      <div className="flex flex-col gap-6">
        {[0, 1, 2].map((index) => (
          <div key={index} className="rounded-xl border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line p-5">
              <Skeleton className="size-7 shrink-0 rounded-full bg-surface-2" />
              <Skeleton className="h-5 w-40 max-w-full rounded bg-surface-2" />
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              {[0, 1].map((field) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-24 rounded bg-surface-2" />
                  <Skeleton className="h-10 rounded-lg bg-surface-2" />
                </div>
              ))}
              {index === 0 ? (
                <div className="flex items-center gap-4 sm:col-span-2">
                  <Skeleton className="size-16 shrink-0 rounded-full bg-surface-2" />
                  <Skeleton className="h-8 w-32 rounded-lg bg-surface-2" />
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Skeleton className="h-10 rounded-lg bg-surface-2 sm:w-24" />
          <Skeleton className="h-10 rounded-lg bg-surface-2 sm:w-36" />
        </div>
      </div>
    </div>
  );
}

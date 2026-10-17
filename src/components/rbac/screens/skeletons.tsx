/**
 * Loading skeletons of the RBAC list and create pages of every panel
 * (Platform, Tenant, Customer; CLAUDE.md "Loading states": pages never appear
 * blank). Each `(list)/loading.tsx` and `new/loading.tsx` under the roles and
 * sub-users routes renders one of these shapes. The [id] routes have none on
 * purpose (a Suspense boundary would turn notFound() into HTTP 200).
 */
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Description: The header placeholder shared by every skeleton (eyebrow, title, description).
 * Input: Whether a header button is expected.
 * Output: Placeholder blocks in the portal's gutters.
 * Use case: The three skeletons below.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function HeaderSkeleton({ withAction }: { withAction: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {withAction ? <Skeleton className="h-9 w-36" /> : null}
    </div>
  );
}

/**
 * Description: Placeholder shaped like a roles / sub-users list (figures, toolbar, rows).
 * Input: How many summary figures the page has (roles 4, sub-users 3) and the
 *   panel's content gutters (binding.gutterClassName).
 * Output: An accessible "Loading" status.
 * Use case: The roles / sub-users list loading.tsx of every panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RbacListSkeleton({ figures, gutterClassName }: { figures: 3 | 4; gutterClassName: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("flex flex-col gap-6", gutterClassName)}>
      <HeaderSkeleton withAction />
      <div className={figures === 4 ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-4" : "grid gap-4 sm:grid-cols-3"}>
        {Array.from({ length: figures }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 sm:w-44" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Description: Placeholder shaped like a sectioned form (role editor, sub-user form).
 * Input: The panel's content gutters (binding.gutterClassName).
 * Output: An accessible "Loading" status.
 * Use case: The /new loading.tsx of the roles and sub-users routes of every panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RbacFormSkeleton({ gutterClassName }: { gutterClassName: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("flex flex-col gap-6", gutterClassName)}>
      <HeaderSkeleton withAction={false} />
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <Skeleton className="hidden h-32 lg:block" />
        <div className="flex flex-col gap-6">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-56 rounded-xl" />
          ))}
          <Skeleton className="h-14 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

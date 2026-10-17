import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Description: Show a stable loading surface while the platform module switches load.
 * Input: None; Next.js owns the pending route state.
 * Output: An announced status with header and module row skeletons.
 * Use case: /platform/settings/modules while the server reads the switches.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function PlatformModulesLoading() {
  return (
    <div role="status" aria-label="Loading modules" className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <span className="sr-only">Loading modules…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Card className="py-0">
        <CardContent className="divide-y divide-border px-5 py-1">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-start justify-between gap-6 py-4">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-full max-w-md" />
                <Skeleton className="h-5 w-64" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

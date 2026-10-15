import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Show a shared loading surface while authenticated Appearance settings resolve.
 * Input: none; Next.js owns the pending route state.
 * Output: an announced heading and settings Card skeleton.
 * Use case: preserve a stable responsive layout without flashing draft controls.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export default function AppearanceLoading() {
  return (
    <div role="status" aria-label="Loading appearance settings" className="mx-auto max-w-5xl space-y-6">
      <span className="sr-only">Loading appearance settings…</span>
      <Skeleton className="h-8 w-48" />
      <Card>
        <CardContent className="space-y-8">
          <Skeleton className="h-6 w-36" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="grid gap-4 sm:grid-cols-[13rem_1fr]">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

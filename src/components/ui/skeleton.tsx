import { cn } from "@/lib/utils";

/**
 * Render the shared skeleton primitive using semantic theme tokens.
 * Input: component props. Output: accessible React UI with merged classes.
 * Use case: consistent skeleton behavior across application screens.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("motion-safe:animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  );
}

export { Skeleton };

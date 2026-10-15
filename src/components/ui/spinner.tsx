import { cn } from "@/lib/utils";
import { Loader2Icon } from "lucide-react";

/**
 * Render the shared spinner primitive using semantic theme tokens.
 * Input: component props. Output: accessible React UI with merged classes.
 * Use case: consistent spinner behavior across application screens.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 motion-safe:animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };

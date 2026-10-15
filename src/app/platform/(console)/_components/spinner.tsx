import { Spinner as UiSpinner } from "@/components/ui/spinner";
type SpinnerSize = "sm" | "md" | "lg";
const SIZES: Record<SpinnerSize, string> = {
  sm: "size-4",
  md: "size-5",
  lg: "size-8",
};

/**
 * Show a decorative shared spinner beside existing loading announcements.
 * Input: size and optional classes. Output: motion-aware current-color indicator.
 * Use case: pending buttons keep their own descriptive text without duplicate announcements.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function Spinner({
  size = "sm",
  className = "",
}: {
  size?: SpinnerSize;
  className?: string;
}) {
  return (
    <UiSpinner
      role={undefined}
      aria-label={undefined}
      aria-hidden="true"
      focusable="false"
      className={`${SIZES[size]} ${className}`}
    />
  );
}

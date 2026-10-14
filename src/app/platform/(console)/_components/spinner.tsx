type SpinnerSize = "sm" | "md" | "lg";

const SIZES: Record<SpinnerSize, string> = {
  sm: "size-4",
  md: "size-5",
  lg: "size-8",
};

type SpinnerProps = {
  size?: SpinnerSize;
  className?: string;
};

/**
 * A decorative busy indicator in the current text colour. The surrounding
 * text ("Creating…") says what is happening; without motion it stays a ring.
 */
export function Spinner({ size = "sm", className = "" }: SpinnerProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 motion-safe:animate-spin ${SIZES[size]} ${className}`}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

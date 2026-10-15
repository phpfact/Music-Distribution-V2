"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { RevealToggle } from "./reveal-toggle";

/**
 * The mask shown instead of a hidden value. Always the same length, so the
 * mask never gives away how long the real value is.
 */
const MASK = "••••••••••";

type SensitiveValueProps = {
  /** The real value; rendered only while revealed. */
  value: string;
  /** What the value is, for the eye button's name: "username" → "Show username". */
  noun: string;
  /** When set, a Copy button with this accessible name copies the value (hidden or not). */
  copyLabel?: string;
  className?: string;
};

/**
 * Description: Show a read-only sensitive value as a fixed mask, with an eye button to reveal it.
 * Input: The value, the noun for the eye button and an optional copy-button label.
 * Output: The mask (or the value once revealed), a RevealToggle and an optional CopyButton.
 * Use case: Tenant usernames, database names/users and generated passwords on
 *   the detail page, the creation success panel and the password-reset result.
 *   This guards against shoulder surfing only: the owner is already authorised
 *   to see the value and it is part of the page data.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function SensitiveValue({
  value,
  noun,
  copyLabel,
  className,
}: SensitiveValueProps) {
  const valueId = useId();
  // Hidden by default on every render of a new page or panel.
  const [visible, setVisible] = useState(false);

  return (
    <span
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
    >
      <span
        id={valueId}
        className="min-w-0 font-mono text-sm break-all text-fg"
      >
        {visible ? (
          value
        ) : (
          <>
            {/* Dots for the eye; screen readers hear "hidden" instead. */}
            <span aria-hidden="true" className="tracking-[0.2em] text-fg-muted">
              {MASK}
            </span>
            <span className="sr-only">Hidden</span>
          </>
        )}
      </span>
      <RevealToggle
        visible={visible}
        onToggle={() => setVisible((current) => !current)}
        noun={noun}
        controls={valueId}
        className="size-7 shrink-0"
      />
      {copyLabel ? <CopyButton value={value} label={copyLabel} /> : null}
    </span>
  );
}

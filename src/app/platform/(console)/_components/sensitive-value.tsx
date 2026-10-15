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
  /**
   * Monospace font for identifiers and passwords (default). Emails, phone
   * numbers and names read better in the regular font: pass false.
   */
  monospace?: boolean;
  className?: string;
};

/**
 * Description: Show a read-only sensitive value as a fixed mask, with an eye button to reveal it.
 * Input: The value, the noun for the eye button and an optional copy-button label.
 * Output: The mask (or the value once revealed), a RevealToggle and an optional CopyButton.
 * Use case: Tenant usernames, emails, phone numbers, database names/users and
 *   server, generated passwords and platform-owner usernames on the detail
 *   page, the directory, the creation success panel, the password-reset result
 *   and the status history. This guards against shoulder surfing only: the
 *   owner is already authorised to see the value and it is part of the page data.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function SensitiveValue({
  value,
  noun,
  copyLabel,
  monospace = true,
  className,
}: SensitiveValueProps) {
  const valueId = useId();
  // Hidden by default on every render of a new page or panel.
  const [visible, setVisible] = useState(false);

  return (
    <span
      className={cn("inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5", className)}
    >
      <span
        id={valueId}
        className={cn(
          "min-w-0 text-sm break-all text-fg",
          // Identifiers and passwords in monospace; emails and phones in the body font.
          monospace ? "font-mono" : "[overflow-wrap:anywhere]",
        )}
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

"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "./icons";
import { Spinner } from "./spinner";

type CopyState = "idle" | "copying" | "copied" | "failed";

type CopyButtonProps = {
  /** The text put on the clipboard. Never rendered or logged by this button. */
  value: string;
  /** Accessible name saying what is copied, e.g. "Copy master password". */
  label: string;
  size?: "sm" | "md";
  className?: string;
};

// Long enough to notice, short enough that a second copy isn't confusing.
const RESET_AFTER_MS = 2000;

const TEXT: Record<CopyState, string> = {
  idle: "Copy",
  copying: "Copying…",
  copied: "Copied",
  failed: "Copy failed",
};

/**
 * Copy a value and report the actual result visibly and to screen readers.
 * Input: clipboard value, accessible label and presentation options.
 * Output: shadcn Button and a live-region result with automatic reset.
 * Use case: share safe copy feedback for credentials and account information.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function CopyButton({
  value,
  label,
  size = "sm",
  className = "",
}: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copying = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * Present one clipboard result and schedule its neutral state.
   * Input: copied or failed state.
   * Output: visible feedback that resets after the established delay.
   * Use case: avoid stale copy confirmation on later interactions.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function show(next: CopyState) {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), RESET_AFTER_MS);
  }

  /**
   * Write the supplied value using the native clipboard API.
   * Input: the value retained by this component.
   * Output: copied/failed feedback without logging sensitive error details.
   * Use case: report clipboard permission or secure-context failures accurately.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  async function copy() {
    // Guard synchronously because the browser can leave clipboard permission
    // pending while another click happens before the disabled state renders.
    if (copying.current) return;
    copying.current = true;
    if (timer.current) clearTimeout(timer.current);
    setState("copying");
    try {
      // Unavailable outside a secure context; that lands in the catch too.
      await navigator.clipboard.writeText(value);
      show("copied");
    } catch {
      // Deliberately silent: the error could carry the value.
      show("failed");
    } finally {
      copying.current = false;
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={copy}
        aria-label={label}
        aria-busy={state === "copying" || undefined}
        disabled={state === "copying"}
        variant="outline"
        size={size === "md" ? "default" : "sm"}
        className={className}
      >
        {state === "copying" ? (
          <Spinner />
        ) : (
          <Icon
            name={state === "copied" ? "check" : "copy"}
            className="size-4 shrink-0"
          />
        )}
        {TEXT[state]}
      </Button>
      {/* The accessible name stays fixed, so the outcome is announced separately. */}
      <span aria-live="polite" className="sr-only">
        {state === "copied"
          ? "Copied to clipboard"
          : state === "failed"
            ? "Copy failed"
            : ""}
      </span>
    </>
  );
}

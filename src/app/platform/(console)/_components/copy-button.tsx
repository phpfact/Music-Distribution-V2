"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { buttonClass, type ButtonSize } from "./ui";

type CopyState = "idle" | "copied" | "failed";

type CopyButtonProps = {
  /** The text put on the clipboard. Never rendered or logged by this button. */
  value: string;
  /** Accessible name saying what is copied, e.g. "Copy master password". */
  label: string;
  size?: ButtonSize;
  className?: string;
};

// Long enough to notice, short enough that a second copy isn't confusing.
const RESET_AFTER_MS = 2000;

const TEXT: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Copy failed",
};

/** Copies a value to the clipboard and says, visibly and to screen readers, whether it worked. */
export function CopyButton({ value, label, size = "sm", className = "" }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function show(next: CopyState) {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), RESET_AFTER_MS);
  }

  async function copy() {
    try {
      // Unavailable outside a secure context; that lands in the catch too.
      await navigator.clipboard.writeText(value);
      show("copied");
    } catch {
      // Deliberately silent: the error could carry the value.
      show("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className={`${buttonClass("secondary", size)} ${className}`}
      >
        <Icon name={state === "copied" ? "check" : "copy"} className="size-4 shrink-0" />
        {TEXT[state]}
      </button>
      {/* The accessible name stays fixed, so the outcome is announced separately. */}
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? "Copied to clipboard" : state === "failed" ? "Copy failed" : ""}
      </span>
    </>
  );
}

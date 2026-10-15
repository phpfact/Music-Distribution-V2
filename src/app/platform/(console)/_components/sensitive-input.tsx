"use client";

import { useState, type ComponentPropsWithRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RevealToggle } from "./reveal-toggle";

type SensitiveInputProps = Omit<
  ComponentPropsWithRef<"input">,
  "type" | "className"
> & {
  id: string;
  /** What the field holds, for the eye button's name: "username" → "Show username". */
  noun: string;
  hasError?: boolean;
  className?: string;
};

/**
 * Description: A text input whose characters are masked until the eye button reveals them.
 * Input: Native input props/ref, the required id, the noun for the eye button and an optional error flag.
 * Output: A `type="text"` input masked with CSS `-webkit-text-security`, plus a RevealToggle.
 * Use case: Usernames and database names/users in the tenant forms: sensitive,
 *   but not passwords. A real `type="password"` would make browsers' password
 *   managers treat them as passwords and offer to save them; masking only the
 *   rendering keeps the field a plain text field. Toggling never changes the
 *   value, focus, validation or ARIA wiring.
 *
 *   Browsers without `-webkit-text-security` support show the text unmasked;
 *   the field still works normally.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function SensitiveInput({
  id,
  noun,
  hasError = false,
  className = "",
  disabled,
  ...inputProps
}: SensitiveInputProps) {
  // Hidden by default: the value is only shown when the owner asks for it.
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        // Identifiers: no autofill, capitalisation, correction or spell check.
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        {...inputProps}
        id={id}
        type="text"
        disabled={disabled}
        aria-invalid={hasError || inputProps["aria-invalid"] || undefined}
        // pr-12 keeps the typed text clear of the eye button.
        className={cn(
          className,
          "pr-12",
          visible ? null : "[-webkit-text-security:disc]",
        )}
      />
      <RevealToggle
        visible={visible}
        onToggle={() => setVisible((current) => !current)}
        noun={noun}
        controls={id}
        disabled={disabled}
        className="absolute top-1/2 right-1 -translate-y-1/2"
      />
    </div>
  );
}

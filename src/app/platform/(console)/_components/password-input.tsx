"use client";

import { useState, type ComponentPropsWithRef } from "react";
import { inputClass } from "./ui";

type PasswordInputProps = Omit<ComponentPropsWithRef<"input">, "type" | "className"> & {
  /** Required: the Show/Hide toggle points at the input with `aria-controls`. */
  id: string;
  hasError?: boolean;
  className?: string;
};

/**
 * A password field with a Show/Hide toggle, as on the login form. Every other
 * prop (name, value, onChange, aria-*, ref…) goes to the `<input>`.
 */
export function PasswordInput({
  id,
  hasError = false,
  className = "",
  autoComplete = "new-password",
  disabled,
  ...inputProps
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...inputProps}
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        // Right padding keeps the text clear of the toggle.
        className={inputClass(hasError, `pr-16 ${className}`)}
      />
      <button
        type="button"
        aria-pressed={visible}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-0 rounded-r-lg px-3 text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}

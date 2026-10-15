"use client";

import { useState, type ComponentPropsWithRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RevealToggle } from "./reveal-toggle";

type PasswordInputProps = Omit<
  ComponentPropsWithRef<"input">,
  "type" | "className"
> & {
  id: string;
  hasError?: boolean;
  className?: string;
};

/**
 * Compose a shadcn input with an accessible password visibility control.
 * Input: native input props/ref, required ID, and optional error/classes.
 * Output: a password/text field that retains its value and form semantics.
 * Use case: share password entry across login, creation, and credential dialogs.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
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
      <Input
        {...inputProps}
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        aria-invalid={hasError || inputProps["aria-invalid"] || undefined}
        className={cn(className, "pr-12")}
      />
      {/* The same eye button as every other masked value in the console. */}
      <RevealToggle
        visible={visible}
        onToggle={() => setVisible((current) => !current)}
        noun="password"
        controls={id}
        disabled={disabled}
        className="absolute top-1/2 right-1 -translate-y-1/2"
      />
    </div>
  );
}

"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentPropsWithRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
 * Created: 2026-10-15. Last modified: 2026-10-15.
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
  const accessibleName = visible ? "Hide password" : "Show password";

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
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={accessibleName}
        title={accessibleName}
        aria-pressed={visible}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        className="absolute top-1/2 right-1 size-8 -translate-y-1/2 text-muted-foreground"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
}

"use client";

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RevealToggleProps = {
  /** True while the value is shown in clear text. */
  visible: boolean;
  /** Flips between shown and hidden; never changes the value itself. */
  onToggle: () => void;
  /**
   * What the button reveals, used in its accessible name:
   * "password" gives "Show password" / "Hide password".
   */
  noun: string;
  /** The id of the input or value element this button shows and hides. */
  controls: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Description: The eye button that shows or hides one sensitive value.
 * Input: The current visibility, the toggle callback, the noun for the accessible name and the controlled element's id.
 * Output: A ghost icon button with `aria-pressed` and a "Show …" / "Hide …" name and tooltip.
 * Use case: Shared by PasswordInput, SensitiveInput and SensitiveValue so every
 *   masked value in the console behaves and reads out the same way.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function RevealToggle({
  visible,
  onToggle,
  noun,
  controls,
  disabled,
  className,
}: RevealToggleProps) {
  // The name says what a press will do next, so it is always current.
  const accessibleName = `${visible ? "Hide" : "Show"} ${noun}`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={accessibleName}
      title={accessibleName}
      aria-pressed={visible}
      aria-controls={controls}
      disabled={disabled}
      onClick={onToggle}
      className={cn("size-8 text-muted-foreground", className)}
    >
      {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </Button>
  );
}

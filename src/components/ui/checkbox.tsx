"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CheckIcon, MinusIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

/**
 * Description: Render the shared checkbox primitive (official shadcn new-york
 *   source) using semantic theme tokens, with a visible indeterminate state.
 * Input: Radix Checkbox props. `checked` may be true, false or "indeterminate"
 *   (shown as a minus sign, e.g. for a "some selected" group header).
 * Output: An accessible `role="checkbox"` button (`aria-checked="mixed"` while
 *   indeterminate) styled with theme tokens only, so light, dark and every
 *   accent work.
 * Use case: Privilege selection in the role editor (per privilege and the
 *   tri-state module header) and any other multi-select list.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // `group` lets the indicator pick the check or the minus icon from the state.
        "peer group size-4 shrink-0 rounded-[4px] border border-input bg-card shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        // Checked and indeterminate both use the brand colour.
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground dark:data-[state=indeterminate]:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        {/* The check for "checked", the minus for "indeterminate" (decorative: aria-checked carries the state). */}
        <CheckIcon aria-hidden="true" className="size-3.5 group-data-[state=indeterminate]:hidden" />
        <MinusIcon aria-hidden="true" className="hidden size-3.5 group-data-[state=indeterminate]:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };

"use client";

import * as React from "react";
import { useThemePortal } from "@/components/theme-portal";
import { cn } from "@/lib/utils";
import { Popover as PopoverPrimitive } from "radix-ui";

/**
 * Description: Render the shared popover root primitive (official shadcn new-york source).
 * Input: Radix Popover Root props (`open`, `onOpenChange`, `modal`, …).
 * Output: Context for a trigger and its floating content.
 * Use case: SearchableSelect's option list; any small floating panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

/**
 * Description: Render the element that opens and closes a Popover.
 * Input: Radix PopoverTrigger props (use `asChild` to style it as a Button).
 * Output: A button with `aria-expanded` / `aria-controls` set by Radix.
 * Use case: The SearchableSelect trigger.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/**
 * Description: Render the popover's floating panel inside the theme ancestor.
 * Input: Radix PopoverContent props; `align` (default "center") and
 *   `sideOffset` (default 4) as in the official source.
 * Output: A themed panel portalled into the element `useThemePortal()` names
 *   (like Dialog and DropdownMenu), so account accents and dark mode apply.
 *   While the theme root is still mounting (null) nothing is rendered.
 * Use case: SearchableSelect's search box and option list.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  // The theme ancestor: undefined = standalone (body), null = still mounting.
  const container = useThemePortal();
  if (container === null) return null;

  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/**
 * Description: Render an optional element the popover positions itself against.
 * Input: Radix PopoverAnchor props.
 * Output: An anchor element (no visual output of its own).
 * Use case: Positioning a popover against something other than its trigger.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };

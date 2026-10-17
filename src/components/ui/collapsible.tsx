"use client";

import * as React from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";

/**
 * Description: Render the shared collapsible root primitive (official shadcn new-york source).
 * Input: Radix Collapsible Root props (`open`, `defaultOpen`, `onOpenChange`, …).
 * Output: A container whose content can be shown or hidden by its trigger.
 * Use case: One card per module in the role editor; any expandable section.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

/**
 * Description: Render the button that expands or collapses a Collapsible.
 * Input: Radix CollapsibleTrigger props (use `asChild` to style it as a Button).
 * Output: A button with `aria-expanded` and `aria-controls` set by Radix.
 * Use case: The chevron button of a role-editor module card.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  );
}

/**
 * Description: Render the content a Collapsible shows while open.
 * Input: Radix CollapsibleContent props.
 * Output: The content region (removed from the page while closed).
 * Use case: The privilege rows of a role-editor module card.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };

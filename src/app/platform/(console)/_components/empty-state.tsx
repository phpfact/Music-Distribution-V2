import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icons";

type EmptyStateProps = {
  /** The symbol drawn in the middle of the illustration. */
  icon: IconName;
  /** A short heading, e.g. "No tenants yet". */
  title: ReactNode;
  /** One or two sentences: why it is empty and what to do next. */
  description: ReactNode;
  /** Optional button(s), e.g. "Create tenant" or "Clear filters". */
  action?: ReactNode;
  /** "md" for page and card bodies, "sm" for dialogs and compact cards. */
  size?: "sm" | "md";
  className?: string;
};

/**
 * Description: The one empty-state design of the console (CLAUDE.md "Empty states").
 * Input: An icon, a heading, a description, an optional action and a size.
 * Output: The shared shadcn Empty block with an illustration (the icon in a tile
 *   surrounded by decorative rings), the heading, the description and the action.
 * Use case: Tenant directory results, status history, count-details lists, the
 *   dashboard's activity card: never a bare "No records found" line.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "md",
  className,
}: EmptyStateProps) {
  const compact = size === "sm";

  return (
    <Empty className={cn(compact ? "gap-4 px-4 py-8" : "px-6 py-14", className)}>
      <EmptyHeader>
        {/* The illustration is decorative: the heading carries the meaning. */}
        <EmptyMedia aria-hidden="true" className="relative mb-2">
          {/* Two soft rings around the tile, drawn with theme tokens only. */}
          <span
            className={cn(
              "absolute rounded-full border border-primary/10 bg-primary/[0.03]",
              compact ? "-inset-3" : "-inset-5",
            )}
          />
          <span
            className={cn(
              "absolute rounded-full border border-primary/15",
              compact ? "-inset-1.5" : "-inset-2.5",
            )}
          />
          <span
            className={cn(
              "relative grid place-items-center rounded-2xl border border-border bg-card text-primary shadow-xs",
              compact ? "size-12" : "size-16",
            )}
          >
            <Icon name={icon} className={compact ? "size-5" : "size-7"} />
          </span>
        </EmptyMedia>
        <EmptyTitle className={compact ? "text-base" : undefined}>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

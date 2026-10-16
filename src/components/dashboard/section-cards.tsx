import type { ReactNode } from "react";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Description: Lay out the dashboard's summary cards (dashboard-01's SectionCards grid).
 * Input: The cards and optional classes.
 * Output: One column on phones, two from @xl, four from @5xl of the main
 *   container, with the block's subtle gradient in light mode.
 * Use case: The first row of the tenant and customer dashboards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function SectionCards({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

type SectionCardProps = {
  /** The small label above the figure, e.g. "Pending approvals". */
  label: string;
  /** The figure or short value (a clickable CountDetails for real counts). */
  value: ReactNode;
  /** Top-right badge (e.g. a status), optional. */
  badge?: ReactNode;
  /** First footer line (bold). */
  footerTitle: ReactNode;
  /** Second footer line (muted). */
  footerDescription: ReactNode;
};

/**
 * Description: Render one summary card exactly like dashboard-01's cards.
 * Input: Label, value, optional badge and two footer lines.
 * Output: A Card with the value in large tabular figures.
 * Use case: SectionCards rows. Values are real data or an explicit
 *   "not available yet" text, never invented numbers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function SectionCard({ label, value, badge, footerTitle, footerDescription }: SectionCardProps) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        {badge ? <CardAction>{badge}</CardAction> : null}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 flex gap-2 font-medium">{footerTitle}</div>
        <div className="text-muted-foreground">{footerDescription}</div>
      </CardFooter>
    </Card>
  );
}

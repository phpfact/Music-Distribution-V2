import type { ReactNode } from "react";

type PageHeadingProps = {
  /** The page's only h1. */
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right (they wrap below the text on phones). */
  actions?: ReactNode;
};

/**
 * Description: Render a dashboard page's heading row.
 * Input: Title, optional description and actions.
 * Output: The h1, a muted description and the actions, with the block's gutters.
 * Use case: Every tenant and customer dashboard page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function PageHeading({ title, description, actions }: PageHeadingProps) {
  return (
    <div className="flex flex-col gap-3 px-4 sm:flex-row sm:items-end sm:justify-between lg:px-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

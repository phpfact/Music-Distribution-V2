import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";
import { FOCUS_RING } from "./styles";

type PageHeaderProps = {
  /** Where the back link goes; no link when omitted. */
  backHref?: string;
  /** The back link's text, e.g. "Tenants" or the tenant's name. */
  backLabel?: ReactNode;
  /** The small uppercase line above the title, e.g. "Platform management". */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right (below the text on narrow screens). */
  actions?: ReactNode;
};

/**
 * Description: The standard header of a console page: back link, eyebrow, title, description and actions.
 * Input: The header texts, an optional back link and optional action buttons.
 * Output: A `<header>` with the page's only `<h1>`.
 * Use case: Tenant directory, create and edit pages, so every page starts the same way.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function PageHeader({
  backHref,
  backLabel,
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <header className="flex min-w-0 flex-col gap-4">
      {backHref ? (
        <Link
          href={backHref}
          className={`inline-flex w-fit max-w-full items-center gap-1.5 rounded-md text-sm font-medium text-fg-muted transition-colors hover:text-fg ${FOCUS_RING}`}
        >
          <Icon name="arrow-left" className="size-4 shrink-0" />
          <span className="truncate">{backLabel}</span>
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          {eyebrow ? (
            <p className="text-[11px] font-semibold tracking-[0.15em] text-primary uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm leading-6 text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

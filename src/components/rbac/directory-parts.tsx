"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { rbacListHref, type RbacListQuery } from "./list-href";
import type { PageView } from "./types";

/**
 * Description: The paging bar of a roles or sub-users directory (client-side navigation).
 * Input: The list path, the current query, the page view and the accessible name.
 * Output: "Showing x–y of N" and, with more than one page, Previous/Next links
 *   that keep the search and filters (no full reload, no scroll jump).
 * Use case: RolesDirectory and SubUsersDirectory.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function DirectoryPaging({
  basePath,
  query,
  page,
  label,
}: {
  basePath: string;
  query: RbacListQuery;
  page: PageView<unknown>;
  label: string;
}) {
  const first = (page.page - 1) * page.pageSize + 1;
  const last  = Math.min(page.page * page.pageSize, page.total);

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-muted-foreground">
        Showing {first}–{last} of {page.total}
      </p>
      {page.pageCount > 1 ? (
        <div className="flex items-center gap-2">
          <PageLink href={rbacListHref(basePath, { ...query, page: page.page - 1 })} disabled={page.page <= 1}>
            <ChevronLeftIcon aria-hidden="true" />
            Previous
          </PageLink>
          <span className="text-muted-foreground">
            Page {page.page} of {page.pageCount}
          </span>
          <PageLink href={rbacListHref(basePath, { ...query, page: page.page + 1 })} disabled={page.page >= page.pageCount}>
            Next
            <ChevronRightIcon aria-hidden="true" />
          </PageLink>
        </div>
      ) : null}
    </nav>
  );
}

/**
 * Description: One Previous/Next paging link, or a disabled button at the ends.
 * Input: The target URL, whether it is disabled, and the label.
 * Output: A Next Link styled as an outline button (scroll position kept), or a disabled button.
 * Use case: DirectoryPaging.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: ReactNode }) {
  if (disabled) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href} scroll={false}>
        {children}
      </Link>
    </Button>
  );
}

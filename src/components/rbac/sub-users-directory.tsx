"use client";

import { PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { EmptyState, Notice, SensitiveValue } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SubUserVariant } from "@/lib/authz/sub-user-rules";
import { accountTypeLabel } from "@/lib/workspace/rules";
import { NoValue } from "./assigned-users";
import { DirectoryPaging } from "./directory-parts";
import { formatRbacDate } from "./format";
import { hasRbacFilters, rbacListHref, type RbacListQuery } from "./list-href";
import { MasterBadge, PrimaryBadge, SelfBadge, UserStatusBadge } from "./role-badges";
import { SubUserRowActions } from "./row-actions";
import type { PageView, RbacActionResult, SubUserRowView, UserStatusChange } from "./types";

/** What each panel calls its sub-users (headings, empty states, buttons). */
const NOUNS: Record<SubUserVariant, { singular: string; plural: string; add: string }> = {
  platform: { singular: "Sub-Platform Owner", plural: "Sub-Platform Owners", add: "Add Sub-Platform Owner" },
  tenant: { singular: "sub-tenant", plural: "sub-tenants", add: "Add sub-tenant" },
  customer: { singular: "sub-customer", plural: "sub-customers", add: "Add sub-customer" },
};

export type SubUsersDirectoryProps = {
  /** Which panel: decides the Email column (not platform) and Account type (customer only). */
  variant: SubUserVariant;
  /** One server page (search, filters and paging already applied by the server). */
  page: PageView<SubUserRowView>;
  /** The parsed URL query (parseRbacListQuery). */
  query: RbacListQuery;
  /** The list path, e.g. "/tenant/users" (Edit/New links derive from it). */
  basePath: string;
  /** The viewer's permissions (`*.users.create|edit|suspend` / `customer.sub_customers.*`). */
  permissions: { create: boolean; edit: boolean; suspend: boolean };
  /**
   * Bound action: makes `change` ("suspend" for an active row, "reactivate"
   * for a suspended one; computed from the row's shown status).
   */
  toggleStatusAction?: (userId: string, change: UserStatusChange) => Promise<RbacActionResult>;
  /** Optional per-row override of the built-in actions, keyed by user id. */
  rowActions?: Partial<Record<string, ReactNode>>;
};

/**
 * Description: The sub-users directory of a panel (UI spec "Sub-users list").
 * Input: See SubUsersDirectoryProps: variant, one server page, the query, the
 *   list path, the viewer's permissions and the bound suspend/reactivate action.
 * Output: A table from xl and cards below with Name (+ "Primary" / "You"),
 *   Username and Email masked with an eye toggle (platform: no email column),
 *   Role (+ "Master"), Account type (sub-customers), Status, Created and the
 *   actions (Edit, Suspend/Reactivate with confirmation) only where manageable
 *   and permitted. Paging keeps the filters; success messages appear above the
 *   list and only the server data is refreshed. Empty states with "Add …" or
 *   "Clear filters".
 * Use case: /platform/users, /tenant/users, /customer/sub-customers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function SubUsersDirectory({
  variant,
  page,
  query,
  basePath,
  permissions,
  toggleStatusAction,
  rowActions,
}: SubUsersDirectoryProps) {
  const router                = useRouter();
  const [, startTransition]   = useTransition();
  const [success, setSuccess] = useState<string | null>(null);

  const nouns           = NOUNS[variant];
  const showEmail       = variant !== "platform";
  const showAccountType = variant === "customer";
  const filtered        = hasRbacFilters(query);

  /**
   * Description: Show a row action's success and refresh only the server data.
   * Input: The success message.
   * Output: A dismissible success notice; the page data re-renders (no full reload).
   * Use case: onDone of the row actions.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function done(message: string) {
    setSuccess(message);
    startTransition(() => router.refresh());
  }

  /**
   * Description: The actions cell of one row (override slot or the built-in actions).
   * Input: The row.
   * Output: The row's action elements.
   * Use case: Table rows and cards.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function actionsOf(row: SubUserRowView): ReactNode {
    const override = rowActions?.[row.id];
    if (override !== undefined) return override;
    return (
      <SubUserRowActions
        row={row}
        basePath={basePath}
        canEdit={permissions.edit}
        canSuspend={permissions.suspend}
        toggleStatusAction={toggleStatusAction}
        onDone={done}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {success ? (
        <Notice variant="success" onDismiss={() => setSuccess(null)}>
          {success}
        </Notice>
      ) : null}

      {page.total === 0 ? (
        <EmptyState
          icon="user"
          title={filtered ? `No ${nouns.plural} match` : `No ${nouns.plural} yet`}
          description={
            filtered
              ? "Try another search, status or role, or clear the filters."
              : `Add a ${nouns.singular} and give them exactly one role.`
          }
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href={rbacListHref(basePath, {})}>
                  <XIcon aria-hidden="true" />
                  Clear filters
                </Link>
              </Button>
            ) : permissions.create ? (
              <Button asChild>
                <Link href={`${basePath}/new`}>
                  <PlusIcon aria-hidden="true" />
                  {nouns.add}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Wide screens: a table (from xl). */}
          <div className="hidden overflow-x-auto rounded-lg border xl:block">
            <Table>
              <TableCaption className="sr-only">{nouns.plural}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  {showEmail ? <TableHead>Email</TableHead> : null}
                  <TableHead>Role</TableHead>
                  {showAccountType ? <TableHead>Account type</TableHead> : null}
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row) => (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="max-w-72 whitespace-normal">
                      <UserName row={row} />
                    </TableCell>
                    <TableCell>{row.username ? <SensitiveValue value={row.username} noun="username" /> : <NoValue />}</TableCell>
                    {showEmail ? (
                      <TableCell>{row.email ? <SensitiveValue value={row.email} noun="email" monospace={false} /> : <NoValue />}</TableCell>
                    ) : null}
                    <TableCell>
                      <RoleName row={row} />
                    </TableCell>
                    {showAccountType ? (
                      <TableCell>{row.accountType ? accountTypeLabel(row.accountType) : <NoValue />}</TableCell>
                    ) : null}
                    <TableCell>
                      <UserStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatRbacDate(row.createdAt)}</TableCell>
                    <TableCell>{actionsOf(row)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phones and tablets: one card per account (actions always visible). */}
          <ul className="flex flex-col gap-3 xl:hidden">
            {page.rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <UserName row={row} />
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {showAccountType && row.accountType ? `${accountTypeLabel(row.accountType)} · ` : null}
                      Created {formatRbacDate(row.createdAt)}
                    </p>
                  </div>
                  <UserStatusBadge status={row.status} />
                </div>
                <dl className="grid gap-2 text-sm">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Username</dt>
                    <dd>{row.username ? <SensitiveValue value={row.username} noun="username" /> : <NoValue />}</dd>
                  </div>
                  {showEmail ? (
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">Email</dt>
                      <dd>{row.email ? <SensitiveValue value={row.email} noun="email" monospace={false} /> : <NoValue />}</dd>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Role</dt>
                    <dd>
                      <RoleName row={row} />
                    </dd>
                  </div>
                </dl>
                {actionsOf(row)}
              </li>
            ))}
          </ul>

          <DirectoryPaging basePath={basePath} query={query} page={page} label={`${nouns.plural} pages`} />
        </>
      )}
    </div>
  );
}

/**
 * Description: The name of a sub-user with the "Primary" and "You" badges.
 * Input: The row.
 * Output: The full name and the applicable badges.
 * Use case: SubUsersDirectory table and cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function UserName({ row }: { row: SubUserRowView }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-medium break-words">{row.fullName}</span>
      {row.isPrimary ? <PrimaryBadge /> : null}
      {row.isSelf ? <SelfBadge /> : null}
    </span>
  );
}

/**
 * Description: The role a sub-user holds, with the "Master" badge.
 * Input: The row.
 * Output: The role name and, for a master role, the Master badge.
 * Use case: SubUsersDirectory table and cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function RoleName({ row }: { row: SubUserRowView }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {row.roleName}
      {row.roleIsMaster ? <MasterBadge /> : null}
    </span>
  );
}

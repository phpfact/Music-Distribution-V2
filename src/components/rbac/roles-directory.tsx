"use client";

import { PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { CountDetails, EmptyState, Notice } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DirectoryPaging } from "./directory-parts";
import { formatRbacDate, privilegeCountText } from "./format";
import { hasRbacFilters, rbacListHref, type RbacListQuery } from "./list-href";
import { RolePrivilegesRecords, RoleUsersRecords, type PrivilegesResult } from "./rbac-records";
import { AboveAuthorityBadge, RoleStatusBadge, SystemRoleBadge } from "./role-badges";
import { RoleRowActions } from "./row-actions";
import type { AssignedUserView, PageView, RbacActionResult, RecordsResult, RoleOptionView, LoadRoleOptions, RoleRowView, RoleStatusValue } from "./types";

export type RolesDirectoryProps = {
  /** One server page of roles (search, filters and paging already applied by the server). */
  page: PageView<RoleRowView>;
  /** The parsed URL query (parseRbacListQuery). */
  query: RbacListQuery;
  /** The roles list path, e.g. "/tenant/roles" (View/Edit/New links derive from it). */
  basePath: string;
  /** Number of privileges in the panel's catalog, shown as "All (N)" for master roles. */
  catalogPrivilegeCount: number;
  /** The viewer's role-management permissions (`*.roles.create|edit|delete`). */
  permissions: { create: boolean; edit: boolean; delete: boolean };
  /** Bound action: loads one role's privileges grouped by module (privileges popup). */
  loadPrivileges: (roleId: string) => Promise<PrivilegesResult>;
  /** Bound action: loads the users holding a role, paged (users popup and dialogs). */
  loadUsers: (roleId: string, page: number) => Promise<RecordsResult<AssignedUserView>>;
  /**
   * Bound action: switches a role to `next` ("disabled" for an active row,
   * "active" for a disabled one; computed from the row's shown status).
   */
  toggleStatusAction?: (roleId: string, next: RoleStatusValue) => Promise<RbacActionResult>;
  /** Bound action: deletes a role, reassigning its users to the replacement. */
  deleteAction?: (roleId: string, replacementRoleId: string | null) => Promise<RbacActionResult>;
  /** Active roles the viewer may assign (delete-and-reassign choices). */
  replacementRoles?: readonly RoleOptionView[];
  /** Scoped database search for later replacement options. */
  loadReplacementRoles?: LoadRoleOptions;
  /** Optional per-row override of the built-in actions, keyed by role id. */
  rowActions?: Partial<Record<string, ReactNode>>;
};

/**
 * Description: The role directory of a panel (UI spec "Roles list").
 * Input: See RolesDirectoryProps: one server page, the query, the list path,
 *   the catalog size, the viewer's permissions, bound loaders and actions.
 * Output: A table from xl and cards below with: Role (name, muted description,
 *   "System" lock badge for master roles, "Above your authority" when not
 *   manageable), Status, Privileges (count or "All (N)", opens the privileges
 *   popup grouped by module), Users (count, opens the users popup), Updated and
 *   the row actions (View; Edit, Disable/Enable, Delete only when manageable and
 *   permitted). Paging keeps the filters; success messages appear above the
 *   list and only the server data is refreshed. Empty states: "No roles yet"
 *   (+ Create role) or "No roles match" (+ Clear filters).
 * Use case: /platform|tenant|customer/roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RolesDirectory({
  page,
  query,
  basePath,
  catalogPrivilegeCount,
  permissions,
  loadPrivileges,
  loadUsers,
  toggleStatusAction,
  deleteAction,
  replacementRoles = [],
  loadReplacementRoles,
  rowActions,
}: RolesDirectoryProps) {
  const router                = useRouter();
  const [, startTransition]   = useTransition();
  const [success, setSuccess] = useState<string | null>(null);

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
  function actionsOf(row: RoleRowView): ReactNode {
    const override = rowActions?.[row.id];
    if (override !== undefined) return override;
    return (
      <RoleRowActions
        row={row}
        basePath={basePath}
        canEdit={permissions.edit}
        canDelete={permissions.delete}
        toggleStatusAction={toggleStatusAction}
        deleteAction={deleteAction}
        replacementRoles={replacementRoles}
        loadReplacementRoles={loadReplacementRoles}
        loadUsers={loadUsers}
        onDone={done}
      />
    );
  }

  /**
   * Description: The clickable privileges count of a row.
   * Input: The row.
   * Output: A CountDetails trigger ("All (N)" or the count) whose popup lists
   *   the role's privileges grouped by module and explains the figure.
   * Use case: Privileges column and card line.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function privilegesOf(row: RoleRowView): ReactNode {
    const text = privilegeCountText(row.privilegeCount, catalogPrivilegeCount);
    return (
      <CountDetails
        label={`${row.name}: ${text}. Show the privileges of this role.`}
        title={`Privileges of ${row.name}`}
        description="Grouped by module."
        calculation={
          row.isMaster
            ? `A master role always grants every privilege of this panel: ${catalogPrivilegeCount}. Privileges of modules the Platform Owner disabled are marked.`
            : `The privileges stored on this role: ${row.privilegeCount ?? 0}. Privileges of modules the Platform Owner disabled are marked; they grant nothing until the module is enabled again.`
        }
        records={<RolePrivilegesRecords roleId={row.id} loadPrivileges={loadPrivileges} />}
        className="tabular-nums"
      >
        {row.isMaster ? text : row.privilegeCount ?? 0}
      </CountDetails>
    );
  }

  /**
   * Description: The clickable users count of a row.
   * Input: The row.
   * Output: A CountDetails trigger whose popup lists the users holding the role.
   * Use case: Users column and card line.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function usersOf(row: RoleRowView): ReactNode {
    return (
      <CountDetails
        label={`${row.name}: ${row.userCount} users. Show the users who hold this role.`}
        title={`Users with the role ${row.name}`}
        description="Every user has exactly one role."
        calculation={`Users whose single role is ${row.name}: ${row.userCount}.`}
        records={<RoleUsersRecords roleId={row.id} loadUsers={loadUsers} />}
        className="tabular-nums"
      >
        {row.userCount}
      </CountDetails>
    );
  }

  const filtered = hasRbacFilters(query);

  return (
    <div className="flex flex-col gap-4">
      {success ? (
        <Notice variant="success" onDismiss={() => setSuccess(null)}>
          {success}
        </Notice>
      ) : null}

      {page.total === 0 ? (
        <EmptyState
          icon="shield-check"
          title={filtered ? "No roles match" : "No roles yet"}
          description={
            filtered
              ? "Try another search or status, or clear the filters."
              : "Create a role to give your team exactly the access it needs."
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
                  Create role
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Wide screens: a table (from xl, where it fits beside the sidebar). */}
          <div className="hidden overflow-x-auto rounded-lg border xl:block">
            <Table>
              <TableCaption className="sr-only">Roles</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Privileges</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row) => (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="max-w-96 whitespace-normal">
                      <RoleName row={row} />
                    </TableCell>
                    <TableCell>
                      <RoleStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{privilegesOf(row)}</TableCell>
                    <TableCell>{usersOf(row)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatRbacDate(row.updatedAt)}</TableCell>
                    <TableCell>{actionsOf(row)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phones and tablets: one card per role (actions always visible). */}
          <ul className="flex flex-col gap-3 xl:hidden">
            {page.rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <RoleName row={row} />
                  <RoleStatusBadge status={row.status} />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Privileges</dt>
                    <dd>{privilegesOf(row)}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Users</dt>
                    <dd>{usersOf(row)}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Updated</dt>
                    <dd>{formatRbacDate(row.updatedAt)}</dd>
                  </div>
                </dl>
                {actionsOf(row)}
              </li>
            ))}
          </ul>

          <DirectoryPaging basePath={basePath} query={query} page={page} label="Role pages" />
        </>
      )}
    </div>
  );
}

/**
 * Description: The name cell of a role: name, badges and muted description.
 * Input: The row.
 * Output: The name with "System" (master) or "Above your authority" (not
 *   manageable) badges and the description below it.
 * Use case: RolesDirectory table and cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function RoleName({ row }: { row: RoleRowView }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium break-words">{row.name}</span>
        {row.isMaster ? <SystemRoleBadge /> : null}
        {!row.isMaster && !row.manageable ? <AboveAuthorityBadge /> : null}
      </div>
      {row.description ? <p className="text-xs break-words text-muted-foreground">{row.description}</p> : null}
    </div>
  );
}

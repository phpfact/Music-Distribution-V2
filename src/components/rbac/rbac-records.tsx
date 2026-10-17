"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { EmptyState, Notice, SensitiveValue } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accountTypeLabel } from "@/lib/workspace/rules";
import { AssignedUsersTable, NoValue } from "./assigned-users";
import { formatRbacDate, privilegeCountText } from "./format";
import type { RbacStatusFilter } from "./list-href";
import { PrivilegeList } from "./privilege-list";
import { MasterBadge, RoleStatusBadge, UserStatusBadge } from "./role-badges";
import type {
  AssignedUserView,
  PageView,
  ReadOnlyModuleView,
  RecordsResult,
  RoleRowView,
  SubUserRowView,
} from "./types";

// Shown when the Server Action itself could not be reached.
const LOAD_FAILED = "The records could not be loaded right now. Try again.";
// Placeholder rows while loading.
const SKELETON_ROWS = 4;

/** The result of loading one role's privileges (privileges popup). */
export type PrivilegesResult = { ok: true; modules: ReadOnlyModuleView[] } | { ok: false; error: string };

type LoadState<T> = { status: "loading" } | { status: "loaded"; value: T } | { status: "error"; message: string };

/**
 * Description: Load something from a Server Action when mounted and on every retry/page change.
 * Input: A function that loads the value for a page, the page, and a retry counter.
 * Output: The load state (loading → loaded / error); an answer for an older
 *   request is ignored.
 * Use case: Every records list of a count-details popup (mounted only while open).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function useLoaded<T>(
  load: (page: number) => Promise<{ ok: true; value: T } | { ok: false; error: string }>,
  page: number,
  attempt: number,
): [LoadState<T>, (state: LoadState<T>) => void] {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  // The callers recreate `load` on every render; only page and attempt decide a reload.
  const loadPage = useEffectEvent((requested: number) => load(requested));

  useEffect(() => {
    let obsolete = false;
    loadPage(page)
      .then((result) => {
        if (obsolete) return;
        setState(result.ok ? { status: "loaded", value: result.value } : { status: "error", message: result.error });
      })
      .catch(() => {
        if (!obsolete) setState({ status: "error", message: LOAD_FAILED });
      });
    return () => {
      obsolete = true;
    };
  }, [page, attempt]);

  return [state, setState];
}

/**
 * Description: The loading and error states every records list shares.
 * Input: The load state and a retry callback.
 * Output: A skeleton while loading, an error notice with Retry, or null when loaded.
 * Use case: All records components below.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function LoadingOrError<T>({ state, onRetry }: { state: LoadState<T>; onRetry: () => void }) {
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading records">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        <Notice variant="error">{state.message}</Notice>
        <Button type="button" variant="outline" className="self-start" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  return null;
}

/**
 * Description: Previous / Next paging of a records popup.
 * Input: The current page view and the page change callback.
 * Output: Nothing for a single page; otherwise two buttons and "Page x of y".
 * Use case: All paged records components below.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function Pager({ page, onPage }: { page: PageView<unknown>; onPage: (page: number) => void }) {
  if (page.pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <Button type="button" variant="outline" size="sm" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>
        <ChevronLeftIcon aria-hidden="true" />
        Previous
      </Button>
      <span className="text-muted-foreground">
        Page {page.page} of {page.pageCount}
      </span>
      <Button type="button" variant="outline" size="sm" disabled={page.page >= page.pageCount} onClick={() => onPage(page.page + 1)}>
        Next
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * Description: Shared shell of a paged records popup (loading, error, empty, rows, paging).
 * Input: The page loader, the empty state, and a renderer for one loaded page.
 * Output: The current state of the list with Previous/Next paging.
 * Use case: Role, user and sub-user records popups.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function PagedRecords<Row>({
  load,
  empty,
  render,
}: {
  load: (page: number) => Promise<RecordsResult<Row>>;
  empty: ReactNode;
  render: (rows: Row[]) => ReactNode;
}) {
  const [page, setPage]       = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState]     = useLoaded<PageView<Row>>(
    (requested) => load(requested).then((result) => (result.ok ? { ok: true, value: result.page } : result)),
    page,
    attempt,
  );

  if (state.status !== "loaded") {
    return (
      <LoadingOrError
        state={state}
        onRetry={() => {
          setState({ status: "loading" });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  const current = state.value;
  if (current.total === 0) return <>{empty}</>;
  return (
    <div className="flex flex-col gap-3">
      {render(current.rows)}
      <Pager
        page={current}
        onPage={(next) => {
          setState({ status: "loading" });
          setPage(next);
        }}
      />
    </div>
  );
}

/**
 * Description: The privileges of one role, grouped by module (privileges popup).
 * Input: The role id and the panel's load action.
 * Output: Loading/error states, then the read-only PrivilegeList (compact).
 * Use case: Privileges count of the roles directory.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RolePrivilegesRecords({
  roleId,
  loadPrivileges,
}: {
  roleId: string;
  loadPrivileges: (roleId: string) => Promise<PrivilegesResult>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState]     = useLoaded<ReadOnlyModuleView[]>(
    () => loadPrivileges(roleId).then((result) => (result.ok ? { ok: true, value: result.modules } : result)),
    1,
    attempt,
  );
  if (state.status !== "loaded") {
    return (
      <LoadingOrError
        state={state}
        onRetry={() => {
          setState({ status: "loading" });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }
  return <PrivilegeList modules={state.value} size="sm" />;
}

/**
 * Description: The users holding one role, page by page (users popup).
 * Input: The role id and the panel's load action.
 * Output: A table of users (masked username/email, status) with paging, or an empty state.
 * Use case: Users count of the roles directory.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RoleUsersRecords({
  roleId,
  loadUsers,
}: {
  roleId: string;
  loadUsers: (roleId: string, page: number) => Promise<RecordsResult<AssignedUserView>>;
}) {
  return (
    <PagedRecords
      load={(page) => loadUsers(roleId, page)}
      empty={<EmptyState size="sm" icon="user" title="No users yet" description="Nobody holds this role right now." />}
      render={(rows) => <AssignedUsersTable users={rows} caption="Users who hold this role" size="sm" />}
    />
  );
}

/**
 * Description: The roles behind a roles summary figure.
 * Input: The status filter and the panel's load action.
 * Output: A table (role, status, privileges, users, updated) with paging, or an empty state.
 * Use case: Total / Active / Disabled roles StatCards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RoleRecords({
  filter,
  catalogPrivilegeCount,
  loadRoles,
}: {
  filter: RbacStatusFilter;
  catalogPrivilegeCount?: number;
  loadRoles: (filter: RbacStatusFilter, page: number) => Promise<RecordsResult<RoleRowView>>;
}) {
  return (
    <PagedRecords
      load={(page) => loadRoles(filter, page)}
      empty={<EmptyState size="sm" icon="shield-check" title="No roles here" description="There are no roles in this group right now." />}
      render={(rows) => (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableCaption className="sr-only">Roles</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Privileges</TableHead>
                <TableHead>Users</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>
                    <RoleStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{privilegeCountText(row.privilegeCount, catalogPrivilegeCount)}</TableCell>
                  <TableCell className="tabular-nums">{row.userCount}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatRbacDate(row.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    />
  );
}

/** A user behind the "Users assigned" figure, with the role they hold. */
export type AssignedUserWithRoleView = AssignedUserView & { roleName: string };

/**
 * Description: The users behind the "Users assigned" figure of the roles summary.
 * Input: The panel's load action (paged).
 * Output: A table (name, masked username/email, role, status) with paging, or an empty state.
 * Use case: "Users assigned" StatCard.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function AssignedUserRecords({
  loadAssignedUsers,
}: {
  loadAssignedUsers: (page: number) => Promise<RecordsResult<AssignedUserWithRoleView>>;
}) {
  return (
    <PagedRecords
      load={loadAssignedUsers}
      empty={<EmptyState size="sm" icon="user" title="No users assigned" description="No user holds a role yet." />}
      render={(rows) => {
        const showEmail = rows.some((row) => row.email !== null);
        return (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableCaption className="sr-only">Users with a role</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  {showEmail ? <TableHead>Email</TableHead> : null}
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell>{row.username ? <SensitiveValue value={row.username} noun="username" /> : <NoValue />}</TableCell>
                    {showEmail ? (
                      <TableCell>{row.email ? <SensitiveValue value={row.email} noun="email" monospace={false} /> : <NoValue />}</TableCell>
                    ) : null}
                    <TableCell>{row.roleName}</TableCell>
                    <TableCell>
                      <UserStatusBadge status={row.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      }}
    />
  );
}

/**
 * Description: The sub-users behind a sub-users summary figure.
 * Input: The status filter and the panel's load action.
 * Output: A table (name, masked username/email, role, account type when
 *   present, status, created) with paging, or an empty state.
 * Use case: Total / Active / Suspended StatCards of the sub-users pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function SubUserRecords({
  filter,
  loadUsers,
}: {
  filter: RbacStatusFilter;
  loadUsers: (filter: RbacStatusFilter, page: number) => Promise<RecordsResult<SubUserRowView>>;
}) {
  return (
    <PagedRecords
      load={(page) => loadUsers(filter, page)}
      empty={<EmptyState size="sm" icon="user" title="No accounts here" description="There are no accounts in this group right now." />}
      render={(rows) => {
        const showEmail       = rows.some((row) => row.email !== null);
        const showAccountType = rows.some((row) => row.accountType !== undefined);
        return (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableCaption className="sr-only">Accounts</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  {showEmail ? <TableHead>Email</TableHead> : null}
                  <TableHead>Role</TableHead>
                  {showAccountType ? <TableHead>Account type</TableHead> : null}
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell>{row.username ? <SensitiveValue value={row.username} noun="username" /> : <NoValue />}</TableCell>
                    {showEmail ? (
                      <TableCell>{row.email ? <SensitiveValue value={row.email} noun="email" monospace={false} /> : <NoValue />}</TableCell>
                    ) : null}
                    <TableCell>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {row.roleName}
                        {row.roleIsMaster ? <MasterBadge /> : null}
                      </span>
                    </TableCell>
                    {showAccountType ? (
                      <TableCell>{row.accountType ? accountTypeLabel(row.accountType) : <NoValue />}</TableCell>
                    ) : null}
                    <TableCell>
                      <UserStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatRbacDate(row.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      }}
    />
  );
}

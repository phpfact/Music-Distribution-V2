"use client";

import { EmptyState, SensitiveValue } from "@/components/shared";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserStatusBadge } from "./role-badges";
import type { AssignedUserView } from "./types";

// How many users a confirmation dialog names before "and N more".
export const AFFECTED_USERS_PREVIEW = 10;

type AssignedUsersTableProps = {
  users: readonly AssignedUserView[];
  /** The table's accessible caption, e.g. "Users with the role Sales". */
  caption: string;
  /** Heading of the empty state. */
  emptyTitle?: string;
  /** Text of the empty state. */
  emptyDescription?: string;
  /** "md" for pages, "sm" for popups. */
  size?: "sm" | "md";
};

/**
 * Description: List users holding a role, with masked username and email.
 * Input: The users, a caption, optional empty-state texts and a size.
 * Output: A table (name, username, email, status); username and email are
 *   masked with an eye toggle (CLAUDE.md sensitive-value rule); a dash when the
 *   panel has no such field (platform owners have no email). Without users, an
 *   empty state with illustration.
 * Use case: Role details "Assigned users" section; users popup of the roles
 *   directory; role editor "N users affected" popup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function AssignedUsersTable({
  users,
  caption,
  emptyTitle = "No users yet",
  emptyDescription = "Nobody holds this role right now.",
  size = "md",
}: AssignedUsersTableProps) {
  if (users.length === 0) {
    return <EmptyState size={size} icon="user" title={emptyTitle} description={emptyDescription} />;
  }

  // Platform owners have no email: the column is left out when no row has one.
  const showEmail = users.some((user) => user.email !== null);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Username</TableHead>
            {showEmail ? <TableHead>Email</TableHead> : null}
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.fullName}</TableCell>
              <TableCell>
                {user.username ? <SensitiveValue value={user.username} noun="username" /> : <NoValue />}
              </TableCell>
              {showEmail ? (
                <TableCell>
                  {user.email ? <SensitiveValue value={user.email} noun="email" monospace={false} /> : <NoValue />}
                </TableCell>
              ) : null}
              <TableCell>
                <UserStatusBadge status={user.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Description: Name the users a role change affects, briefly.
 * Input: The affected users (any length) and the total (may exceed the list).
 * Output: A list of the first 10 names with their status, plus "and N more"
 *   when there are more; nothing when there are none.
 * Use case: Disable/enable and delete confirmations (spec: "first 10 + and N more").
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function AffectedUsersPreview({ users, total }: { users: readonly AssignedUserView[]; total: number }) {
  if (total === 0) return null;
  const shown     = users.slice(0, AFFECTED_USERS_PREVIEW);
  const remaining = Math.max(total - shown.length, 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-sm font-medium text-foreground">Affected users</p>
      <ul className="flex flex-col gap-1.5">
        {shown.map((user) => (
          <li key={user.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 break-words text-foreground">{user.fullName}</span>
            <UserStatusBadge status={user.status} />
          </li>
        ))}
      </ul>
      {remaining > 0 ? <p className="text-xs text-muted-foreground">and {remaining} more</p> : null}
    </div>
  );
}

/**
 * Description: Show a dash for a value the panel does not have.
 * Input: None.
 * Output: A muted dash for the eye and "Not available" for screen readers.
 * Use case: Missing username/email cells.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function NoValue() {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">Not available</span>
    </>
  );
}

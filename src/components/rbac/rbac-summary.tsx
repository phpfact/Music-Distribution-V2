"use client";

import { StatCard } from "@/components/shared";
import type { RbacStatusFilter } from "./list-href";
import { AssignedUserRecords, RoleRecords, SubUserRecords, type AssignedUserWithRoleView } from "./rbac-records";
import type { RecordsResult, RoleRowView, SubUserRowView } from "./types";

/** The four figures of the roles summary. */
export type RolesSummaryCounts = {
  total: number;
  active: number;
  disabled: number;
  /** Users holding any role of this scope (each user holds exactly one). */
  usersAssigned: number;
};

type RolesSummaryProps = {
  counts: RolesSummaryCounts;
  /** Number of privileges in the panel's catalog ("All (N)" for master roles in the popups). */
  catalogPrivilegeCount?: number;
  /** Bound action: the roles behind Total / Active / Disabled, paged. */
  loadRoles: (filter: RbacStatusFilter, page: number) => Promise<RecordsResult<RoleRowView>>;
  /** Bound action: the users behind "Users assigned", paged. */
  loadAssignedUsers: (page: number) => Promise<RecordsResult<AssignedUserWithRoleView>>;
};

/**
 * Description: The roles summary: Total roles, Active, Disabled, Users assigned.
 * Input: The counts, the catalog size and the bound record loaders.
 * Output: Four StatCards inside a `<dl>`; every figure opens a CountDetails
 *   popup with a one-line calculation and the exact records behind it
 *   (CLAUDE.md "Count transparency").
 * Use case: Summary section of /platform|tenant|customer/roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RolesSummary({ counts, catalogPrivilegeCount, loadRoles, loadAssignedUsers }: RolesSummaryProps) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Total roles"
        icon="shield-check"
        value={counts.total}
        note="System and custom roles"
        details={{
          title: "All roles",
          calculation: `Active roles (${counts.active}) + disabled roles (${counts.disabled}) = ${counts.total}.`,
          records: <RoleRecords filter="all" catalogPrivilegeCount={catalogPrivilegeCount} loadRoles={loadRoles} />,
        }}
      />
      <StatCard
        label="Active"
        icon="circle-check"
        value={counts.active}
        note="Their users have access"
        details={{
          title: "Active roles",
          calculation: `Roles whose status is Active: ${counts.active}.`,
          records: <RoleRecords filter="active" catalogPrivilegeCount={catalogPrivilegeCount} loadRoles={loadRoles} />,
        }}
      />
      <StatCard
        label="Disabled"
        icon="ban"
        value={counts.disabled}
        note="Their users have no protected access"
        details={{
          title: "Disabled roles",
          calculation: `Roles whose status is Disabled: ${counts.disabled}.`,
          records: <RoleRecords filter="disabled" catalogPrivilegeCount={catalogPrivilegeCount} loadRoles={loadRoles} />,
        }}
      />
      <StatCard
        label="Users assigned"
        icon="user"
        value={counts.usersAssigned}
        note="Every user holds exactly one role"
        details={{
          title: "Users with a role",
          calculation: `Users holding one of these roles (each user holds exactly one): ${counts.usersAssigned}.`,
          records: <AssignedUserRecords loadAssignedUsers={loadAssignedUsers} />,
        }}
      />
    </dl>
  );
}

/** The three figures of a sub-users summary. */
export type SubUsersSummaryCounts = {
  total: number;
  active: number;
  suspended: number;
};

type SubUsersSummaryProps = {
  counts: SubUsersSummaryCounts;
  /** Plural noun for the cards, e.g. "Sub-Tenants". */
  nounPlural: string;
  /** Bound action: the accounts behind Total / Active / Suspended ("disabled"), paged. */
  loadUsers: (filter: RbacStatusFilter, page: number) => Promise<RecordsResult<SubUserRowView>>;
};

/**
 * Description: The sub-users summary: Total, Active, Suspended.
 * Input: The counts, the panel's plural noun and the bound record loader.
 * Output: Three StatCards; every figure opens a CountDetails popup with the
 *   calculation and the exact accounts behind it.
 * Use case: Summary section of the Sub-Platform Owners, Sub-Tenants and
 *   Sub-Customers pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function SubUsersSummary({ counts, nounPlural, loadUsers }: SubUsersSummaryProps) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        label={`Total ${nounPlural}`}
        icon="user"
        value={counts.total}
        details={{
          title: `All ${nounPlural}`,
          calculation: `Active (${counts.active}) + suspended (${counts.suspended}) = ${counts.total}.`,
          records: <SubUserRecords filter="all" loadUsers={loadUsers} />,
        }}
      />
      <StatCard
        label="Active"
        icon="circle-check"
        value={counts.active}
        note="Can sign in"
        details={{
          title: `Active ${nounPlural}`,
          calculation: `Accounts whose status is Active: ${counts.active}.`,
          records: <SubUserRecords filter="active" loadUsers={loadUsers} />,
        }}
      />
      <StatCard
        label="Suspended"
        icon="ban"
        value={counts.suspended}
        note="Cannot sign in"
        details={{
          title: `Suspended ${nounPlural}`,
          calculation: `Accounts whose status is Suspended: ${counts.suspended}.`,
          records: <SubUserRecords filter="disabled" loadUsers={loadUsers} />,
        }}
      />
    </dl>
  );
}

"use client";
/**
 * Small display pieces of the tenant's Customers module
 * (.vibe/memory/customer-management.md): the source badge and the records
 * table shown inside every customers count-details popup (Customers summary
 * and the dashboard's "Active customers" figure).
 */
import { EmptyState, SensitiveValue } from "@/components/shared";
import { NoValue } from "@/components/rbac/assigned-users";
import { formatRbacDate } from "@/components/rbac/format";
import type { RbacStatusFilter } from "@/components/rbac/list-href";
import { PagedRecords } from "@/components/rbac/rbac-records";
import { UserStatusBadge } from "@/components/rbac/role-badges";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CUSTOMER_SOURCE_LABELS, type CustomerRecordsResult, type CustomerSource } from "@/lib/workspace/customer-rules";
import { accountTypeLabel } from "@/lib/workspace/rules";

/**
 * Description: Show where a main customer came from.
 * Input: The source ("signup" = approved public sign-up, "tenant" = added by tenant staff).
 * Output: A small outline badge ("Sign-up" / "Added by tenant"); theme tokens only.
 * Use case: Customers directory (table and cards) and the records popups.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function CustomerSourceBadge({ source }: { source: CustomerSource }) {
  return (
    <Badge variant={source === "tenant" ? "secondary" : "outline"} className="whitespace-nowrap">
      {CUSTOMER_SOURCE_LABELS[source]}
    </Badge>
  );
}

type CustomerRecordsProps = {
  /** Which customers: all, active or suspended ("disabled"). */
  filter: RbacStatusFilter;
  /** Hidden table caption (screen readers), e.g. "Active customers". */
  caption: string;
  /** The panel's bound Server Action (needs tenant.customers.view on the server). */
  loadRecords: (filter: RbacStatusFilter, page: number) => Promise<CustomerRecordsResult>;
};

/**
 * Description: The exact customers behind a customers figure, page by page.
 * Input: The status filter, a caption and the bound load action.
 * Output: Loading skeleton → a table (name, masked username and email, account
 *   type, source, status, created) with Previous/Next paging; an error notice
 *   with Retry; or an empty state when the group has no customers.
 * Use case: Total / Active / Suspended figures of /tenant/customers and the
 *   dashboard's "Active customers" figure (CLAUDE.md count transparency).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function CustomerRecords({ filter, caption, loadRecords }: CustomerRecordsProps) {
  return (
    <PagedRecords
      load={(page) => loadRecords(filter, page)}
      empty={<EmptyState size="sm" icon="user" title="No customers here" description="There are no customers in this group right now." />}
      render={(rows) => (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableCaption className="sr-only">{caption}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Account type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  {/* Login details are sensitive: masked until the eye button reveals them. */}
                  <TableCell>{row.username ? <SensitiveValue value={row.username} noun="username" /> : <NoValue />}</TableCell>
                  <TableCell>{row.email ? <SensitiveValue value={row.email} noun="email" monospace={false} /> : <NoValue />}</TableCell>
                  <TableCell>{accountTypeLabel(row.accountType)}</TableCell>
                  <TableCell>
                    <CustomerSourceBadge source={row.source} />
                  </TableCell>
                  <TableCell>
                    <UserStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatRbacDate(row.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    />
  );
}

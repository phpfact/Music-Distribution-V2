"use client";

import { StatCard } from "@/components/shared";
import type { RbacStatusFilter } from "@/components/rbac/list-href";
import type { CustomerRecordsResult, CustomerSummary } from "@/lib/workspace/customer-rules";
import { CustomerRecords } from "./customer-records";

type CustomersSummaryProps = {
  /** The three figures (total = active + suspended). */
  counts: CustomerSummary;
  /** Bound Server Action: the customers behind a figure, paged. */
  loadRecords: (filter: RbacStatusFilter, page: number) => Promise<CustomerRecordsResult>;
};

/**
 * Description: The Customers summary: Total customers, Active, Suspended.
 * Input: The counts and the bound records loader.
 * Output: Three StatCards inside a `<dl>`; every figure opens a details popup
 *   with a one-line calculation and the exact customers behind it (CLAUDE.md
 *   "Count transparency").
 * Use case: Summary section of /tenant/customers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function CustomersSummary({ counts, loadRecords }: CustomersSummaryProps) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        label="Total customers"
        icon="user"
        value={counts.total}
        note="Sign-ups and customers you added"
        details={{
          title: "All customers",
          calculation: `Active customers (${counts.active}) + suspended customers (${counts.suspended}) = ${counts.total}. Sub-customers are not counted.`,
          records: <CustomerRecords filter="all" caption="All customers" loadRecords={loadRecords} />,
        }}
      />
      <StatCard
        label="Active"
        icon="circle-check"
        value={counts.active}
        note="Can log in"
        details={{
          title: "Active customers",
          calculation: `Main customers whose status is Active: ${counts.active}.`,
          records: <CustomerRecords filter="active" caption="Active customers" loadRecords={loadRecords} />,
        }}
      />
      <StatCard
        label="Suspended"
        icon="ban"
        value={counts.suspended}
        note="Cannot log in, nor can their sub-customers"
        details={{
          title: "Suspended customers",
          calculation: `Main customers whose status is Suspended: ${counts.suspended}.`,
          records: <CustomerRecords filter="disabled" caption="Suspended customers" loadRecords={loadRecords} />,
        }}
      />
    </dl>
  );
}

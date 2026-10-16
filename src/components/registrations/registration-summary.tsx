"use client";

import { CountDetails } from "@/components/shared";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RegistrationFilter, RegistrationRecordsResult, RegistrationSummary } from "@/lib/workspace/rules";
import { RegistrationRecords } from "./registration-records";

type Figure = {
  filter: RegistrationFilter;
  label: string;
  hint: string;
  calculation: string;
};

// Every figure, with the plain-words calculation shown in its popup.
const FIGURES: readonly Figure[] = [
  {
    filter: "pending",
    label: "Pending",
    hint: "Waiting for a decision",
    calculation: "Registrations whose status is Pending, including those whose applicant asked for a new review.",
  },
  {
    filter: "active",
    label: "Active",
    hint: "Approved and can sign in",
    calculation: "Approved registrations whose customer account is active.",
  },
  {
    filter: "suspended",
    label: "Suspended",
    hint: "Approved, access paused",
    calculation: "Approved registrations whose customer account is suspended.",
  },
  {
    filter: "rejected",
    label: "Rejected",
    hint: "Not approved",
    calculation: "Registrations that were rejected and have no open review request.",
  },
  {
    filter: "all",
    label: "Total",
    hint: "Every registration",
    calculation: "Pending + Active + Suspended + Rejected.",
  },
];

type RegistrationSummaryCardsProps = {
  summary: RegistrationSummary;
  /** The area's own Server Action that loads the records behind a figure. */
  loadRecords: (filter: RegistrationFilter, page: number) => Promise<RegistrationRecordsResult>;
};

/**
 * Description: Show the registration counts; each figure opens its exact records.
 * Input: The counts and the area's load action.
 * Output: Five cards (Pending, Active, Suspended, Rejected, Total). Each figure
 *   is a button that opens a popup with the calculation and the registrations
 *   it contains (CLAUDE.md "Count transparency").
 * Use case: Tenant and Platform Owner registrations pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RegistrationSummaryCards({ summary, loadRecords }: RegistrationSummaryCardsProps) {
  const values: Record<RegistrationFilter, number> = {
    pending: summary.pending,
    active: summary.active,
    suspended: summary.suspended,
    rejected: summary.rejected,
    all: summary.total,
  };

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {FIGURES.map((figure) => (
        <Card key={figure.filter} className="gap-2 py-5">
          <CardHeader className="px-5">
            <CardDescription>{figure.label}</CardDescription>
            <CardTitle className="text-3xl font-semibold tabular-nums">
              <CountDetails
                label={`${figure.label} registrations: ${values[figure.filter]}. Show the registrations behind this figure.`}
                title={`${figure.label} registrations`}
                description={figure.hint}
                calculation={`${figure.calculation} Currently ${values[figure.filter]}.`}
                records={
                  <RegistrationRecords
                    filter={figure.filter}
                    caption={`${figure.label} registrations`}
                    loadRecords={loadRecords}
                  />
                }
                className="text-3xl font-semibold tabular-nums"
              >
                {values[figure.filter]}
              </CountDetails>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{figure.hint}</p>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

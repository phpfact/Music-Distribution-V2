import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { CountDetails } from "./count-details";
import { Icon, type IconName } from "./icons";

/** What the figure's details dialog shows (see CountDetails). */
export type StatCardDetails = {
  /** The dialog title, e.g. "Active tenants". */
  title: ReactNode;
  /** One sentence under the title. */
  description?: ReactNode;
  /** How the figure is calculated, in plain words. */
  calculation: ReactNode;
  /** The records behind the figure; mounted only while the dialog is open. */
  records: ReactNode;
};

type StatCardProps = {
  label: string;
  icon: IconName;
  /** The figure; null shows a dash (the note says why), never a made-up 0. */
  value: number | null;
  /** The small line under the figure. */
  note?: ReactNode;
  /**
   * The figure's supporting records. Required by CLAUDE.md for every count
   * that is shown; omitted only when there is no figure (value null).
   */
  details?: StatCardDetails;
};

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

/**
 * Description: One summary figure of the dashboard and the tenant directory.
 * Input: The label, the icon, the figure (or null when unknown), an optional
 *   note and the figure's details (calculation and records).
 * Output: A card inside a `<dl>`: the label as `<dt>`, the figure and note as
 *   `<dd>`. With details, the figure is a button that opens the details dialog.
 * Use case: "Total tenants", "Active", "Suspended", "Pending setup" and the
 *   dashboard widgets; every shown figure can be verified record by record.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function StatCard({ label, icon, value, note, details }: StatCardProps) {
  // The number as text, formatted with thousands separators.
  const figure = value === null ? null : NUMBER_FORMAT.format(value);

  return (
    <Card className="relative min-w-0 gap-0 overflow-hidden p-5 shadow-xs sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <dt className="pt-1 text-sm font-medium text-fg-muted">{label}</dt>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-primary">
          <Icon name={icon} className="size-[18px]" />
        </span>
      </div>
      <dd className="mt-4">
        {figure === null ? (
          <>
            {/* No figure: a dash for the eye, "No data" for screen readers. */}
            <span aria-hidden="true" className="text-4xl font-semibold tracking-tight">
              —
            </span>
            <span className="sr-only">No data</span>
          </>
        ) : details ? (
          // A figure with details: pressing it opens the calculation and the records.
          <CountDetails
            label={`${label}: ${figure}. Show the records behind this figure.`}
            title={details.title}
            description={details.description}
            calculation={details.calculation}
            records={details.records}
            className="text-4xl font-semibold tracking-tight tabular-nums"
          >
            {figure}
          </CountDetails>
        ) : (
          <span className="text-4xl font-semibold tracking-tight tabular-nums">{figure}</span>
        )}
        {note ? <div className="mt-2 text-xs leading-5 text-fg-subtle">{note}</div> : null}
      </dd>
    </Card>
  );
}

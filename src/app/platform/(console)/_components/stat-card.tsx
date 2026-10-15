import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Icon, type IconName } from "./icons";

type StatCardProps = {
  label: string;
  icon: IconName;
  /** The figure; null shows a dash (the note says why), never a made-up 0. */
  value: number | null;
  /** The small line under the figure. */
  note?: ReactNode;
};

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

/**
 * One summary figure (the dashboard's and the tenant list's widgets). Must sit
 * inside a `<dl>`.
 * Input: component props or field identifiers. Output: themed UI or ARIA attributes.
 * Use case: preserve shared application semantics across the shadcn migration.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function StatCard({ label, icon, value, note }: StatCardProps) {
  return (
    <Card className="relative min-w-0 gap-0 overflow-hidden p-5 shadow-xs sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <dt className="pt-1 text-sm font-medium text-fg-muted">{label}</dt>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-primary">
          <Icon name={icon} className="size-[18px]" />
        </span>
      </div>
      <dd className="mt-4">
        {value === null ? (
          <>
            <span
              aria-hidden="true"
              className="text-4xl font-semibold tracking-tight"
            >
              —
            </span>
            <span className="sr-only">No data</span>
          </>
        ) : (
          <span className="text-4xl font-semibold tracking-tight tabular-nums">
            {NUMBER_FORMAT.format(value)}
          </span>
        )}
        {note ? (
          <p className="mt-2 text-xs leading-5 text-fg-subtle">{note}</p>
        ) : null}
      </dd>
    </Card>
  );
}

import type { ReactNode } from "react";
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
 */
export function StatCard({ label, icon, value, note }: StatCardProps) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <dt className="pt-1 text-sm font-medium text-fg-muted">{label}</dt>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon name={icon} className="size-[18px]" />
        </span>
      </div>
      <dd className="mt-4">
        {value === null ? (
          <>
            <span aria-hidden="true" className="text-4xl font-semibold tracking-tight">
              —
            </span>
            <span className="sr-only">No data</span>
          </>
        ) : (
          <span className="text-4xl font-semibold tracking-tight tabular-nums">
            {NUMBER_FORMAT.format(value)}
          </span>
        )}
        {note ? <p className="mt-2 text-xs leading-5 text-fg-subtle">{note}</p> : null}
      </dd>
    </div>
  );
}

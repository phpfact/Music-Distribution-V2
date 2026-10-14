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
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <dt className="text-sm font-medium text-fg-muted">{label}</dt>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted">
          <Icon name={icon} className="size-5" />
        </span>
      </div>
      <dd className="mt-3">
        {value === null ? (
          <>
            <span aria-hidden="true" className="text-3xl font-semibold">
              —
            </span>
            <span className="sr-only">No data</span>
          </>
        ) : (
          <span className="text-3xl font-semibold tabular-nums">
            {NUMBER_FORMAT.format(value)}
          </span>
        )}
        {note ? <p className="mt-1 text-xs text-fg-subtle">{note}</p> : null}
      </dd>
    </div>
  );
}

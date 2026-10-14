import { Icon, type IconName } from "../../_components/icons";
import type { DatabaseCheck } from "../action-types";

type CheckStatus = DatabaseCheck["status"];

// Each status differs in its glyph and in words, not only in colour.
const STATUS: Record<CheckStatus, { icon: IconName; srLabel: string; className: string }> = {
  pass: {
    icon: "check",
    srLabel: "Passed",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  warn: {
    icon: "alert-triangle",
    srLabel: "Warning",
    className: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  fail: {
    icon: "x",
    srLabel: "Failed",
    className: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
};

function overall(ok: boolean, checks: DatabaseCheck[]): { status: CheckStatus; text: string } {
  if (!ok) {
    return {
      status: "fail",
      text: "The database can't be attached until every failing check passes.",
    };
  }
  if (checks.some((check) => check.status === "warn")) {
    return { status: "warn", text: "The database can be attached. Review the warnings below." };
  }
  return { status: "pass", text: "All checks passed. The database can be attached." };
}

type ConnectionChecksProps = {
  ok: boolean;
  checks: DatabaseCheck[];
};

/** The result of "Test connection" (or of the checks a failed create ran). */
export function ConnectionChecks({ ok, checks }: ConnectionChecksProps) {
  const summary = overall(ok, checks);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-2 p-4">
      <p className="flex items-start gap-2.5 text-sm font-semibold text-fg">
        <CheckIcon status={summary.status} />
        <span className="min-w-0 break-words">{summary.text}</span>
      </p>
      <ul className="flex flex-col gap-3">
        {checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2.5">
            <CheckIcon status={check.status} />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-fg">
                <span className="sr-only">{STATUS[check.status].srLabel}: </span>
                {check.label}
              </p>
              <p className="mt-0.5 break-words text-fg-muted">{check.message}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckIcon({ status }: { status: CheckStatus }) {
  const { icon, className } = STATUS[status];
  return (
    <span className={`grid size-5 shrink-0 place-items-center rounded-full ${className}`}>
      <Icon name={icon} className="size-3.5" />
    </span>
  );
}

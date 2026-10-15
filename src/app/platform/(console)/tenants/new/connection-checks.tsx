import { Alert, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Icon, type IconName } from "../../_components/icons";
import type { DatabaseCheck } from "../action-types";

type CheckStatus = DatabaseCheck["status"];

// Each status differs in its glyph and in words, not only in colour.
const STATUS: Record<
  CheckStatus,
  { icon: IconName; srLabel: string; className: string }
> = {
  pass: {
    icon: "check",
    srLabel: "Passed",
    className: "bg-success/10 text-success",
  },
  warn: {
    icon: "alert-triangle",
    srLabel: "Warning",
    className: "bg-warning/10 text-warning",
  },
  fail: {
    icon: "x",
    srLabel: "Failed",
    className: "bg-destructive/10 text-destructive",
  },
};

/**
 * Description: Summarize the existing-database checks in one sentence.
 * Input: Whether all checks passed and the checks.
 * Output: fail (cannot attach), warn (can attach, review warnings) or pass, with its text.
 * Use case: ConnectionChecks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function overall(
  ok: boolean,
  checks: DatabaseCheck[],
): { status: CheckStatus; text: string } {
  if (!ok) {
    return {
      status: "fail",
      text: "The database can't be attached until every failing check passes.",
    };
  }
  if (checks.some((check) => check.status === "warn")) {
    return {
      status: "warn",
      text: "The database can be attached. Review the warnings below.",
    };
  }
  return {
    status: "pass",
    text: "All checks passed. The database can be attached.",
  };
}

type ConnectionChecksProps = {
  ok: boolean;
  checks: DatabaseCheck[];
};

/**
 * Description: Show the result of Test connection (or of a failed create's checks).
 * Input: Whether the database can be attached and the checks.
 * Output: A summary alert and every check with its status icon, label and message.
 * Use case: The create form's Manual database section (existing database).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function ConnectionChecks({ ok, checks }: ConnectionChecksProps) {
  const summary = overall(ok, checks);

  return (
    <Card className="gap-0 bg-muted/50 py-0">
      <CardContent className="flex flex-col gap-4 p-4">
        <Alert variant={summary.status === "fail" ? "destructive" : "default"}>
          <Icon name={STATUS[summary.status].icon} className="size-4" />
          <AlertTitle className="break-words">{summary.text}</AlertTitle>
        </Alert>
        <ul className="flex flex-col gap-3">
          {checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2.5">
              <CheckIcon status={check.status} />
              <div className="min-w-0 text-sm">
                <p className="font-medium text-fg">
                  <span className="sr-only">
                    {STATUS[check.status].srLabel}:{" "}
                  </span>
                  {check.label}
                </p>
                <p className="mt-0.5 break-words text-fg-muted">
                  {check.message}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Description: Draw one check's status icon in its semantic colour.
 * Input: The check status.
 * Output: A small round pass/warn/fail icon.
 * Use case: ConnectionChecks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function CheckIcon({ status }: { status: CheckStatus }) {
  const { icon, className } = STATUS[status];
  return (
    <span
      className={`grid size-5 shrink-0 place-items-center rounded-full ${className}`}
    >
      <Icon name={icon} className="size-3.5" />
    </span>
  );
}

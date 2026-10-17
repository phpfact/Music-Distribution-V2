import { CheckIcon } from "lucide-react";
import { EmptyState } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { countText } from "./format";
import type { ReadOnlyModuleView } from "./types";

type PrivilegeListProps = {
  /** The role's privileges, grouped by module (modules without privileges are skipped). */
  modules: readonly ReadOnlyModuleView[];
  /** "md" for the role details page, "sm" for count popups. */
  size?: "sm" | "md";
  /** Heading of the empty state (no privileges). */
  emptyTitle?: string;
  /** Text of the empty state. */
  emptyDescription?: string;
};

/**
 * Description: Show a role's privileges read-only, grouped by module.
 * Input: The modules with their privileges (each may be marked
 *   `moduleDisabled`), a size and optional empty-state texts.
 * Output: One block per module (label, "N privileges") listing each privilege
 *   with a check, its label and description. Privileges of modules the
 *   Platform Owner switched off are marked "Module disabled by the Platform
 *   Owner" (they stay stored but grant nothing). Without privileges, an empty
 *   state with illustration.
 * Use case: Role details "Privileges" section and the privileges popup of the
 *   roles directory (CountDetails records).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function PrivilegeList({
  modules,
  size = "md",
  emptyTitle = "No privileges",
  emptyDescription = "This role does not grant any privilege yet.",
}: PrivilegeListProps) {
  // Step 1: only modules that actually contain privileges are listed.
  const filled = modules.filter((module) => module.privileges.length > 0);
  if (filled.length === 0) {
    return <EmptyState size="sm" icon="shield-check" title={emptyTitle} description={emptyDescription} />;
  }

  const compact = size === "sm";

  // Step 2: one block per module, privileges in catalog order.
  return (
    <div className={compact ? "flex flex-col gap-3" : "flex flex-col gap-4"}>
      {filled.map((module) => (
        <section key={module.key} aria-label={module.label} className="rounded-lg border border-border">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-foreground">{module.label}</h3>
            <span className="text-xs text-muted-foreground">
              {countText(module.privileges.length, "privilege", "privileges")}
            </span>
          </header>
          <ul className="flex flex-col divide-y divide-border">
            {module.privileges.map((privilege) => (
              <li key={privilege.key} className="flex items-start gap-3 px-4 py-2.5">
                <CheckIcon
                  aria-hidden="true"
                  className={privilege.moduleDisabled ? "mt-0.5 size-4 shrink-0 text-muted-foreground" : "mt-0.5 size-4 shrink-0 text-success"}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={privilege.moduleDisabled ? "text-sm font-medium text-muted-foreground" : "text-sm font-medium text-foreground"}>
                      {privilege.label}
                    </span>
                    {privilege.moduleDisabled ? (
                      <Badge variant="warning">Module disabled by the Platform Owner</Badge>
                    ) : null}
                  </div>
                  {compact ? null : <p className="mt-0.5 text-xs text-muted-foreground">{privilege.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

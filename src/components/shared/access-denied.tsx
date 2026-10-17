import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/app/platform/(console)/_components/empty-state";
import { Icon } from "@/app/platform/(console)/_components/icons";
import { Notice } from "@/app/platform/(console)/_components/notice";
import { Button } from "@/components/ui/button";

/** The account menu's role label when the role grants nothing (all three panels). */
export const NO_ACTIVE_ROLE_LABEL = "No active role";
/** The dashboards' warning for a person whose role is missing, disabled or invalid. */
export const NO_ACTIVE_ROLE_NOTICE =
  "Your account has no active role, so only your dashboard and personal appearance are available. Ask your administrator to assign a role.";

/** The default heading of the access-denied state (UI spec approved 2026-10-16). */
const DEFAULT_TITLE = "You don't have access to this page";
/** The default explanation: what happened and what the person can do about it. */
const DEFAULT_DESCRIPTION =
  "Your role doesn't include the privilege this page needs. Ask your administrator if you need access.";

type AccessDeniedProps = {
  /** The panel's dashboard, where "Go to dashboard" leads (always allowed). */
  homeHref: string;
  /** Optional heading instead of "You don't have access to this page". */
  title?: ReactNode;
  /** Optional explanation (e.g. the "no active role" message). */
  description?: ReactNode;
};

/**
 * Description: Show the access-denied state of a page the person may not open
 *   (.vibe/memory/role-privilege-management.md, "Access denied / no role").
 * Input: The panel's dashboard path and, optionally, a heading and description.
 * Output: The shared EmptyState (illustration, heading, short explanation) with
 *   a "Go to dashboard" button. Rendered inline by the page itself, so the
 *   response stays HTTP 200 and reveals nothing about the protected data.
 * Use case: Every protected page of the Platform, Tenant and Customer panels
 *   when the signed-in person lacks the page's privilege (the server decided;
 *   hidden navigation is only a convenience).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function AccessDenied({ homeHref, title = DEFAULT_TITLE, description = DEFAULT_DESCRIPTION }: AccessDeniedProps) {
  return (
    // data-access-denied: a stable hook for tests and support tooling (no styling).
    <div data-access-denied="" className="rounded-xl border border-border bg-card">
      <EmptyState
        icon="shield-check"
        title={title}
        description={description}
        action={
          <Button asChild variant="default">
            <Link href={homeHref}>
              <Icon name="arrow-left" className="size-4" />
              Go to dashboard
            </Link>
          </Button>
        }
      />
    </div>
  );
}

/**
 * Description: Warn a signed-in person that their role grants nothing
 *   (.vibe/memory/role-privilege-management.md, "Access denied / no role").
 * Input: None.
 * Output: A warning Notice: only the dashboard and personal appearance are
 *   available until an administrator assigns a role.
 * Use case: The Platform, Tenant and Customer dashboards when the access's
 *   roleState is not "active" (their gated widgets are hidden at the same time).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function NoActiveRoleNotice() {
  return <Notice variant="warning" title="No active role">{NO_ACTIVE_ROLE_NOTICE}</Notice>;
}

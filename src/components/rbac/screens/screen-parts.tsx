/**
 * Small layout pieces shared by every RBAC screen of every panel (Platform,
 * Tenant, Customer; .vibe/memory/role-privilege-management.md, "Technical
 * Notes" → "RBAC pages (all panels)"): the page frame with the shared
 * PageHeader and the one-off notice, the access-denied frame, and the
 * friendly "could not load" state. Server components, presentational only.
 */
import type { ReactNode } from "react";
import { AccessDenied, Notice, PageHeader } from "@/components/shared";
import type { PageActorResult } from "@/lib/authz/page-support";
import { cn } from "@/lib/utils";
import type { RbacPanelBinding } from "./types";

type ScreenFrameProps = {
  /** The panel's content gutters (binding.gutterClassName; "" inside the platform console). */
  gutterClassName: string;
  /** The small line above the title ("Access control" / "Account"). */
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  /** Back link (details / edit pages). */
  backHref?: string;
  backLabel?: ReactNode;
  /** Header buttons (only what the viewer may do). */
  actions?: ReactNode;
  /** One-off success notice after a redirect (fixed text from notices.ts). */
  notice?: string | null;
  children: ReactNode;
};

/**
 * Description: The frame of an RBAC page: header, notice and content with the panel's gutters.
 * Input: The panel's gutters, the header texts, optional back link and
 *   actions, an optional notice and the content.
 * Output: The PageHeader (the page's only h1), the success notice when given,
 *   then the content. `relative` keeps the editors' sr-only texts inside the
 *   page (the platform console scrolls its own content area).
 * Use case: Every roles / sub-users page of the Platform, Tenant and Customer panels.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function ScreenFrame({
  gutterClassName,
  eyebrow,
  title,
  description,
  backHref,
  backLabel,
  actions,
  notice,
  children,
}: ScreenFrameProps) {
  return (
    <div className={cn("relative flex min-w-0 flex-col gap-6", gutterClassName)}>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        backHref={backHref}
        backLabel={backLabel}
        actions={actions}
      />
      {notice ? <Notice variant="success">{notice}</Notice> : null}
      {children}
    </div>
  );
}

/**
 * Description: The access-denied state of an RBAC page, with the panel's gutters.
 * Input: The panel's gutters, its dashboard path and an optional explanation
 *   (e.g. why a role or account cannot be edited).
 * Output: The shared AccessDenied state (HTTP 200, nothing protected rendered).
 * Use case: A page opened without its privilege, or an edit page of a record
 *   above the viewer's authority.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function DeniedScreen({
  gutterClassName,
  homeHref,
  description,
}: {
  gutterClassName: string;
  homeHref: string;
  description?: string;
}) {
  return (
    <div className={gutterClassName}>
      <AccessDenied homeHref={homeHref} {...(description ? { description } : {})} />
    </div>
  );
}

/**
 * Description: What a screen shows when its page actor is not available.
 * Input: The panel binding, the refused / failed page actor result and the
 *   page title (shown above the friendly error).
 * Output: `denied` → the access-denied state (HTTP 200, nothing read);
 *   `unavailable` → the page frame with the friendly "could not load" notice
 *   (the technical reason was logged by the panel's page guard).
 * Use case: The first step of every shared RBAC screen.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function ActorFallback({
  binding,
  result,
  title,
}: {
  binding: RbacPanelBinding;
  result: Extract<PageActorResult, { ok: false }>;
  title: string;
}) {
  if (result.reason === "denied") return <DeniedScreen gutterClassName={binding.gutterClassName} homeHref={binding.home} />;
  return (
    <ScreenFrame gutterClassName={binding.gutterClassName} eyebrow={binding.eyebrow} title={title}>
      <LoadFailed message={result.error} />
    </ScreenFrame>
  );
}

/**
 * Description: The friendly state of a section whose data could not be loaded.
 * Input: The service's friendly message (never a raw database error).
 * Output: An error notice asking to try again.
 * Use case: Any RBAC screen when a service answers "unavailable".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function LoadFailed({ message }: { message: string }) {
  return <Notice variant="error" title="Something went wrong">{message}</Notice>;
}

/**
 * Description: One label/value line of a details list.
 * Input: The label and the value.
 * Output: A `<dt>`/`<dd>` pair (inside a `<dl>` grid).
 * Use case: Role details "Overview".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

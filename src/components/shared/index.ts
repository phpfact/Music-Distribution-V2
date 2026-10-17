/**
 * The project's shared presentational wrappers, as used by the tenant portal
 * (.vibe/memory/ui-components.md).
 *
 * CLAUDE.md requires ONE implementation of each of these behaviours (secondary
 * menu with scroll-spy, clickable counts with a details popup, empty states,
 * masked values with an eye toggle, password visibility, risky-action
 * confirmation, field label/error layout, notices, back/forward-cache guard).
 * They were built for the Platform Owner console and still live in its
 * `_components` folder; this file is the explicit, reviewed list of what the
 * tenant and customer areas may reuse.
 *
 * Every component listed here is purely presentational: none of them reads a
 * session, a cookie, a database or a Server Action of the platform. The
 * platform's layouts, navigation, theme and actions are NOT exported here and
 * must never be imported by the tenant portal (owner decision 2026-10-15).
 */
export { AuthPageGuard } from "@/app/platform/(console)/_components/auth-page-guard";
export { ConfirmDialog } from "@/app/platform/(console)/_components/confirm-dialog";
export { CountDetails } from "@/app/platform/(console)/_components/count-details";
export { EmptyState } from "@/app/platform/(console)/_components/empty-state";
export { describedBy, errorId, Field, hintId } from "@/app/platform/(console)/_components/field";
export type { IconName } from "@/app/platform/(console)/_components/icons";
export { Notice } from "@/app/platform/(console)/_components/notice";
export { PasswordInput } from "@/app/platform/(console)/_components/password-input";
// The live checklist of the shared password rule (src/lib/tenants/rules.ts).
export { PasswordChecklist } from "@/app/platform/(console)/tenants/new/password-checklist";
export { SectionedLayout, type SecondaryMenuItem } from "@/app/platform/(console)/_components/secondary-menu";
export { SensitiveInput } from "@/app/platform/(console)/_components/sensitive-input";
export { SensitiveValue } from "@/app/platform/(console)/_components/sensitive-value";
// Added for the shared RBAC screens (2026-10-16): already-reviewed presentational
// console wrappers, plus the searchable single-value select.
export { FormActions, RequiredLegend } from "@/app/platform/(console)/_components/form-actions";
export { FormSection } from "@/app/platform/(console)/_components/form-section";
export { Icon } from "@/app/platform/(console)/_components/icons";
export { PageHeader } from "@/app/platform/(console)/_components/page-header";
export { Spinner } from "@/app/platform/(console)/_components/spinner";
export { StatCard, type StatCardDetails } from "@/app/platform/(console)/_components/stat-card";
export { ToneBadge, type BadgeTone } from "@/app/platform/(console)/_components/status-badge";
export {
  SearchableSelect,
  type SearchableSelectOption,
  type SearchableSelectProps,
} from "./searchable-select";
// RBAC (.vibe/memory/role-privilege-management.md): the inline access-denied
// state of protected pages and the background privilege refresh of the shells.
export { AccessDenied, NO_ACTIVE_ROLE_LABEL, NO_ACTIVE_ROLE_NOTICE, NoActiveRoleNotice } from "./access-denied";
export { PermissionSync, type PermissionCheckResult } from "./permission-sync";

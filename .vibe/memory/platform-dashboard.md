# Platform Dashboard

## Overview and requested change

The authenticated platform dashboard greets the owner, shows real tenant totals
and active counts, links to existing navigation modules, and clearly marks
unimplemented subscriptions, support and activity tracking. The 2026-10-15
shadcn/ui migration replaces page cards, badges, navigation actions, error
boundaries and loading surfaces with shared primitives. The migration is
implemented on codex/shadcn-pages-appearance; TypeScript, lint and Git diff checks
passed. The parent task owns combined business tests and rendered verification.

## User flow, business rules and data

Every dashboard request requires a valid Platform Owner on the server. It then
loads the existing database-backed tenant summary. An unavailable summary shows
an explanatory no-data state rather than fabricated zero values. Navigation and
descriptions come from the single existing navigation registry. Planned modules
remain placeholders; the migration does not add invented product functionality.

## UI, dependencies and edge cases

Cards, badges and buttons inherit semantic tokens supplied by the existing
Appearance system. Shared StatCard and ComingSoon wrappers are migrated by the
central component task. Login, shell navigation and tenant pages remain separate
modules. Error boundaries keep raw errors and digests in server logs, offer only
a safe retry action and retain console navigation where possible. Skeletons
announce loading and respect reduced-motion preferences.

## Change history

- 2026-10-15: Recorded shared-component migration requirements and existing
  dashboard and error/loading behavior before implementation.
- 2026-10-15: Migrated quick access and planned activity to Card, Badge and
  Button, with shared Alert/Button error boundaries and Skeleton loading states.

## Integrated verification

The combined regression suite passed 1,062 tests with one existing skip,
including protected HTTP/Server Action behavior. All 11 final shared UI contract
tests passed after review fixes; lint, TypeScript and production build passed.
On 2026-10-15 the user explicitly waived browser verification after the browser
permission gate prevented access. No rendered-browser results are claimed.

## CLAUDE.md compliance audit (requested 2026-10-15)

### Findings

- The greeting printed the owner's username in plain text (sensitive data).
- Total Tenants and Active Tenants were plain numbers; CLAUDE.md requires every
  count to open a details popup showing the exact records and the calculation.
- The page has three sections (Platform at a glance, Quick access, Recent
  activity) but no secondary menu.
- The empty "Recent activity" state was built inline instead of a shared component.

### Decisions and behaviour after this change

- Greeting reads "Welcome back" without the username (not displaying the value
  is the strictest form of masking; the account menu reveals it on request).
- Total Tenants / Active Tenants figures are buttons. Each opens the shared
  count-details dialog: a plain explanation of how the figure is calculated and
  the exact tenants it contains, loaded page by page from the server
  (`loadTenantCountRecordsAction`, database-level pagination, 20 per page),
  with loading, empty and error states. Only id, name, status and created date
  leave the server for this list.
- Subscription Plans / Open Support Requests show no figure (modules are not
  built), so they have nothing to open; their note keeps saying so.
- A top (horizontal) secondary menu lists the three sections with scroll-spy.
- Recent activity uses the shared `EmptyState` component.

### Change history

- 2026-10-15: Recorded the CLAUDE.md compliance requirements for the dashboard
  (masked greeting, clickable counts, secondary menu, shared empty state).
- 2026-10-15: Implemented: greeting "Welcome back" (no username), Total and
  Active Tenants open the shared count-details dialog (calculation + server-paged
  tenants via `tenantSummaryDetails`), top secondary menu (Platform at a
  glance, Quick access, Recent activity), shared `EmptyState` for activity.
- 2026-10-15: Code-quality pass (CLAUDE.md): every function in this module's
  frontend and backend files now has the full doc block (Description, Input,
  Output, Use case, Author, Created, Last modified; "Created: X. Last modified:
  Y." one-liners split into two lines); consecutive single-line const/let
  declarations have their "=" vertically aligned (typed and untyped
  declarations are aligned in separate groups).
- 2026-10-15: Verification of the compliance pass: TypeScript (including tests)
  and ESLint (zero warnings) pass; the full Vitest suite passes in the app
  container: 37 files, 1136 tests, 1 pre-existing localhost-only skip.

## RBAC (2026-10-16)

- Available to every signed-in owner (`requirePlatformAccess`); the tenant
  figures ("Platform at a glance", read only then) and the "Manage tenants"
  button need `platform.tenants.view`; the secondary menu drops the summary
  item when the section is hidden.
- Quick access lists `filterNavSections(access.permissions)` minus the
  dashboard — exactly the sidebar's rules.
- A role that is missing/disabled/invalid shows `NoActiveRoleNotice`
  ("Your account has no active role, so only your dashboard and personal
  appearance are available…").
- Change history: 2026-10-16 — widgets, quick access and notice follow the
  owner's privileges.

## Loading skeleton location (2026-10-16)

- The console-wide `src/app/platform/(console)/loading.tsx` was removed: its
  Suspense boundary wrapped every console page and made `notFound()` on the
  RBAC `[id]` pages answer HTTP 200. The same skeleton now lives in
  `(console)/_components/console-loading.tsx` (`ConsoleLoading`) and is
  rendered by `dashboard/loading.tsx` (and `settings`, `subscriptions`,
  `support`), so the dashboard's loading state is unchanged. Reason and
  details: `role-privilege-management.md`, "RBAC pages (all panels)".
- Change history: 2026-10-16 — dashboard got its own `loading.tsx` (same
  skeleton) when the console-wide one was removed.
